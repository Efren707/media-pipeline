package com.mediapipeline.backend.jobs;

import com.mediapipeline.backend.config.MediaProperties;
import com.mediapipeline.backend.jobs.JobDtos.AnalysisResult;
import com.mediapipeline.backend.jobs.JobDtos.CreateUploadRequest;
import com.mediapipeline.backend.jobs.JobDtos.CreateUploadResponse;
import com.mediapipeline.backend.jobs.JobDtos.JobListResponse;
import com.mediapipeline.backend.jobs.JobDtos.JobStatusResponse;
import com.mediapipeline.backend.jobs.JobDtos.UploadInstructions;
import com.mediapipeline.backend.web.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import tools.jackson.core.JacksonException;

@Service
class JobService {

  private static final Pattern JOB_ID =
      Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

  private static final Logger LOG = LoggerFactory.getLogger(JobService.class);
  private static final int WATCHDOG_ATTEMPTS = 3;

  /** D21: a list request reads at most this many valid jobs, and {@code limit} can't exceed it. */
  static final int MAX_SCANNED_JOBS = 100;

  static final int DEFAULT_LIST_LIMIT = 25;
  static final int MAX_LABEL_QUERY_LENGTH = 64;

  private final StatusStore statusStore;
  private final S3Presigner presigner;
  private final MediaProperties properties;
  private final StaleJobPolicy stalePolicy;
  private final Clock clock;

  JobService(
      StatusStore statusStore,
      S3Presigner presigner,
      MediaProperties properties,
      StaleJobPolicy stalePolicy,
      Clock clock) {
    this.statusStore = statusStore;
    this.presigner = presigner;
    this.properties = properties;
    this.stalePolicy = stalePolicy;
    this.clock = clock;
  }

  /**
   * Writes {@code QUEUED} first, then signs a PUT for one exact key. Content-Type and
   * Content-Length are signed, so the browser must send exactly what was approved here.
   */
  CreateUploadResponse createUpload(String userId, CreateUploadRequest request) {
    ImageType type =
        ImageType.fromContentType(request.contentType())
            .orElseThrow(
                () ->
                    new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "UNSUPPORTED_FORMAT",
                        "Upload a JPEG, PNG, or WebP image."));
    if (request.sizeBytes() > properties.maxUploadBytes()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "FILE_TOO_LARGE",
          "Images must be %d MB or smaller.".formatted(properties.maxUploadBytes() / 1024 / 1024));
    }

    String jobId = UUID.randomUUID().toString();
    String sourceKey = "uploads/" + userId + "/" + jobId + "." + type.extension();
    statusStore.create(JobStatus.queued(userId, jobId, sourceKey, now()));

    String url =
        presigner
            .presignPutObject(
                r ->
                    r.signatureDuration(properties.presignTtl())
                        .putObjectRequest(
                            p ->
                                p.bucket(properties.mediaBucket())
                                    .key(sourceKey)
                                    .contentType(type.contentType())
                                    .contentLength(request.sizeBytes())))
            .url()
            .toString();

    return new CreateUploadResponse(
        jobId,
        "QUEUED",
        new UploadInstructions(
            "PUT",
            url,
            properties.presignTtl().toSeconds(),
            Map.of("Content-Type", type.contentType())));
  }

  Optional<JobStatusResponse> findJob(String userId, String jobId) {
    if (!JOB_ID.matcher(jobId).matches()) {
      return Optional.empty();
    }
    return statusStore
        .findVersioned(userId, jobId)
        .map(this::failIfStale)
        .map(status -> toResponse(userId, status));
  }

  /**
   * The signed-in user's jobs, newest first (D21). Scans {@code status/{userId}/} until it has
   * {@link #MAX_SCANNED_JOBS} valid jobs, applies the watchdog, sorts that bounded set, applies the
   * optional case-insensitive label filter, then {@code limit}. Malformed or identity-mismatched
   * status files are skipped.
   */
  JobListResponse listJobs(String userId, String label, Integer limit) {
    int max = limit == null ? DEFAULT_LIST_LIMIT : limit;
    if (max < 1 || max > MAX_SCANNED_JOBS) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_REQUEST",
          "limit must be between 1 and %d.".formatted(MAX_SCANNED_JOBS));
    }
    String query = label == null ? "" : label.strip().toLowerCase(Locale.ROOT);
    if (query.length() > MAX_LABEL_QUERY_LENGTH) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_REQUEST",
          "label must be %d characters or fewer.".formatted(MAX_LABEL_QUERY_LENGTH));
    }

    List<StatusStore.Versioned> scanned = new ArrayList<>();
    boolean truncated = false;
    String token = null;
    scan:
    do {
      StatusStore.JobIdPage page = statusStore.listJobIds(userId, token, MAX_SCANNED_JOBS);
      for (String jobId : page.jobIds()) {
        if (!JOB_ID.matcher(jobId).matches()) {
          continue;
        }
        if (scanned.size() == MAX_SCANNED_JOBS) {
          truncated = true;
          break scan;
        }
        readForList(userId, jobId).ifPresent(scanned::add);
      }
      token = page.nextToken();
    } while (token != null);

    // Sort before mapping: the stream is lazy, so only the jobs that end up in the response (or
    // that the label filter has to look at) get a result read and a presigned URL.
    List<JobStatus> newestFirst =
        scanned.stream()
            .map(this::failIfStale)
            .sorted(
                Comparator.comparing((JobStatus s) -> updatedAt(s.updatedAt()))
                    .reversed()
                    .thenComparing(JobStatus::jobId))
            .toList();
    List<JobStatusResponse> items =
        newestFirst.stream()
            .map(status -> toResponse(userId, status))
            .filter(job -> query.isEmpty() || hasLabel(job, query))
            .limit(max)
            .toList();
    return new JobListResponse(items, truncated);
  }

  private Optional<StatusStore.Versioned> readForList(String userId, String jobId) {
    try {
      Optional<StatusStore.Versioned> status = statusStore.findVersioned(userId, jobId);
      if (status.isEmpty()) {
        LOG.warn("{\"event\":\"job_list_skipped\",\"jobId\":\"{}\"}", jobId);
      }
      return status;
    } catch (JacksonException e) {
      LOG.warn("{\"event\":\"job_list_skipped\",\"jobId\":\"{}\"}", jobId);
      return Optional.empty();
    }
  }

  private static boolean hasLabel(JobStatusResponse job, String query) {
    return job.result() != null
        && job.result().labels() != null
        && job.result().labels().stream()
            .anyMatch(l -> l.name() != null && l.name().toLowerCase(Locale.ROOT).contains(query));
  }

  /** Unparseable timestamps sort last instead of failing the whole list. */
  private static Instant updatedAt(String value) {
    try {
      return value == null ? Instant.EPOCH : Instant.parse(value);
    } catch (DateTimeParseException e) {
      return Instant.EPOCH;
    }
  }

  /**
   * The read-time watchdog (D18). If the job has been in a non-final state too long, writes {@code
   * FAILED} with {@code If-Match}, so a final state a Lambda writes at the same moment is never
   * overwritten. If the ETag changed, re-reads and checks again.
   */
  private JobStatus failIfStale(StatusStore.Versioned current) {
    for (int attempt = 0; attempt < WATCHDOG_ATTEMPTS; attempt++) {
      JobStatus status = current.status();
      Optional<JobStatus.Error> failure = stalePolicy.check(status, Instant.now(clock));
      if (failure.isEmpty() || current.etag() == null) {
        return status;
      }
      JobStatus failed = status.failed(failure.get(), now());
      if (statusStore.replaceIfMatch(failed, current.etag())) {
        LOG.info(
            "{\"event\":\"job_marked_stale\",\"jobId\":\"{}\",\"code\":\"{}\"}",
            status.jobId(),
            failure.get().code());
        return failed;
      }
      Optional<StatusStore.Versioned> reread =
          statusStore.findVersioned(status.userId(), status.jobId());
      if (reread.isEmpty()) {
        return status;
      }
      current = reread.get();
    }
    return current.status();
  }

  private JobStatusResponse toResponse(String userId, JobStatus status) {
    return new JobStatusResponse(
        status.schemaVersion(),
        status.jobId(),
        status.state(),
        thumbnailUrl(userId, status),
        status.updatedAt(),
        result(userId, status),
        status.error());
  }

  private AnalysisResult result(String userId, JobStatus status) {
    String expectedKey = StatusStore.resultKey(userId, status.jobId());
    if (!("COMPLETE".equals(status.state()) || "FLAGGED".equals(status.state()))
        || !expectedKey.equals(status.resultKey())) {
      return null;
    }
    try {
      return statusStore
          .findResult(userId, status.jobId())
          .map(JobDtos.ResultDocument::toResponse)
          .orElse(null);
    } catch (JacksonException e) {
      LOG.warn("{\"event\":\"result_unreadable\",\"jobId\":\"{}\"}", status.jobId());
      return null;
    }
  }

  /** Only signs the exact thumbnail key derived from the authenticated user and job. */
  private String thumbnailUrl(String userId, JobStatus status) {
    String key = status.thumbnailKey();
    String expectedKey = "thumbnails/" + userId + "/" + status.jobId() + ".jpg";
    if (key == null || "FAILED".equals(status.state()) || !key.equals(expectedKey)) {
      return null;
    }
    return presigner
        .presignGetObject(
            r ->
                r.signatureDuration(properties.presignTtl())
                    .getObjectRequest(g -> g.bucket(properties.mediaBucket()).key(key)))
        .url()
        .toString();
  }

  private String now() {
    return Instant.now(clock).truncatedTo(ChronoUnit.SECONDS).toString();
  }
}
