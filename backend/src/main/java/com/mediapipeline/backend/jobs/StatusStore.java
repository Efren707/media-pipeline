package com.mediapipeline.backend.jobs;

import com.mediapipeline.backend.config.MediaProperties;
import com.mediapipeline.backend.jobs.JobDtos.ResultDocument;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import tools.jackson.databind.json.JsonMapper;

/** Reads and writes job status JSON in the media bucket. */
@Component
class StatusStore {

  private final S3Client s3;
  private final JsonMapper json;
  private final String bucket;

  StatusStore(S3Client s3, JsonMapper json, MediaProperties properties) {
    this.s3 = s3;
    this.json = json;
    this.bucket = properties.mediaBucket();
  }

  static String key(String userId, String jobId) {
    return "status/" + userId + "/" + jobId + ".json";
  }

  /**
   * Creates the status only if none exists ({@code If-None-Match: *}), so it can never overwrite a
   * state a Lambda already wrote.
   */
  void create(JobStatus status) {
    PutObjectRequest request =
        PutObjectRequest.builder()
            .bucket(bucket)
            .key(key(status.userId(), status.jobId()))
            .contentType("application/json")
            .ifNoneMatch("*")
            .build();
    s3.putObject(request, RequestBody.fromBytes(json.writeValueAsBytes(status)));
  }

  /** A status together with the S3 ETag it was read at, for conditional replacement. */
  record Versioned(JobStatus status, String etag) {}

  Optional<JobStatus> find(String userId, String jobId) {
    return findVersioned(userId, jobId).map(Versioned::status);
  }

  Optional<Versioned> findVersioned(String userId, String jobId) {
    try {
      GetObjectRequest request =
          GetObjectRequest.builder().bucket(bucket).key(key(userId, jobId)).build();
      ResponseBytes<GetObjectResponse> object = s3.getObjectAsBytes(request);
      JobStatus status = json.readValue(object.asByteArray(), JobStatus.class);
      if (!jobId.equals(status.jobId()) || !userId.equals(status.userId())) {
        return Optional.empty();
      }
      return Optional.of(new Versioned(status, object.response().eTag()));
    } catch (NoSuchKeyException e) {
      return Optional.empty();
    }
  }

  /**
   * Replaces the status only if it still has {@code etag} ({@code If-Match}, D15). Returns false if
   * something else (usually a Lambda) changed it first.
   */
  boolean replaceIfMatch(JobStatus status, String etag) {
    PutObjectRequest request =
        PutObjectRequest.builder()
            .bucket(bucket)
            .key(key(status.userId(), status.jobId()))
            .contentType("application/json")
            .ifMatch(etag)
            .build();
    try {
      s3.putObject(request, RequestBody.fromBytes(json.writeValueAsBytes(status)));
      return true;
    } catch (S3Exception e) {
      // 412: the ETag changed. 409: a concurrent conditional write is in progress.
      if (e.statusCode() == 412 || e.statusCode() == 409) {
        return false;
      }
      throw e;
    }
  }

  Optional<ResultDocument> findResult(String userId, String jobId) {
    try {
      GetObjectRequest request =
          GetObjectRequest.builder().bucket(bucket).key(resultKey(userId, jobId)).build();
      byte[] body = s3.getObjectAsBytes(request).asByteArray();
      ResultDocument result = json.readValue(body, ResultDocument.class);
      if (!jobId.equals(result.jobId()) || !userId.equals(result.userId())) {
        return Optional.empty();
      }
      return Optional.of(result);
    } catch (NoSuchKeyException e) {
      return Optional.empty();
    }
  }

  /** One page of job IDs under {@code status/{userId}/}, in S3 key order. */
  record JobIdPage(List<String> jobIds, String nextToken) {}

  /**
   * Lists one page of job IDs for exactly this user's prefix. Keys that aren't {@code <jobId>.json}
   * directly under the prefix are skipped.
   */
  JobIdPage listJobIds(String userId, String continuationToken, int pageSize) {
    String prefix = "status/" + userId + "/";
    ListObjectsV2Response page =
        s3.listObjectsV2(
            ListObjectsV2Request.builder()
                .bucket(bucket)
                .prefix(prefix)
                .maxKeys(pageSize)
                .continuationToken(continuationToken)
                .build());
    List<String> ids = new ArrayList<>();
    for (var object : page.contents()) {
      String rest = object.key().substring(prefix.length());
      if (rest.endsWith(".json") && !rest.contains("/")) {
        ids.add(rest.substring(0, rest.length() - ".json".length()));
      }
    }
    String next = Boolean.TRUE.equals(page.isTruncated()) ? page.nextContinuationToken() : null;
    return new JobIdPage(ids, next);
  }

  static String resultKey(String userId, String jobId) {
    return "results/" + userId + "/" + jobId + ".json";
  }
}
