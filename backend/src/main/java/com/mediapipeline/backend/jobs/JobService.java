package com.mediapipeline.backend.jobs;

import com.mediapipeline.backend.config.MediaProperties;
import com.mediapipeline.backend.jobs.JobDtos.CreateUploadRequest;
import com.mediapipeline.backend.jobs.JobDtos.CreateUploadResponse;
import com.mediapipeline.backend.jobs.JobDtos.JobStatusResponse;
import com.mediapipeline.backend.jobs.JobDtos.UploadInstructions;
import com.mediapipeline.backend.web.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Service
class JobService {

  private static final Pattern JOB_ID =
      Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

  private final StatusStore statusStore;
  private final S3Presigner presigner;
  private final MediaProperties properties;
  private final Clock clock;

  JobService(
      StatusStore statusStore, S3Presigner presigner, MediaProperties properties, Clock clock) {
    this.statusStore = statusStore;
    this.presigner = presigner;
    this.properties = properties;
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
    return statusStore.find(userId, jobId).map(status -> toResponse(userId, status));
  }

  private JobStatusResponse toResponse(String userId, JobStatus status) {
    return new JobStatusResponse(
        status.schemaVersion(),
        status.jobId(),
        status.state(),
        thumbnailUrl(userId, status),
        status.updatedAt(),
        status.error());
  }

  /** Only signs keys inside this user's thumbnail prefix, whatever the status document says. */
  private String thumbnailUrl(String userId, JobStatus status) {
    String key = status.thumbnailKey();
    if (key == null
        || "FAILED".equals(status.state())
        || !key.startsWith("thumbnails/" + userId + "/")) {
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
