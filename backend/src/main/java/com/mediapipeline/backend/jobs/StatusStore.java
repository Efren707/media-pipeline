package com.mediapipeline.backend.jobs;

import com.mediapipeline.backend.config.MediaProperties;
import java.util.Optional;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
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

  Optional<JobStatus> find(String userId, String jobId) {
    try {
      GetObjectRequest request =
          GetObjectRequest.builder().bucket(bucket).key(key(userId, jobId)).build();
      byte[] body = s3.getObjectAsBytes(request).asByteArray();
      return Optional.of(json.readValue(body, JobStatus.class));
    } catch (NoSuchKeyException e) {
      return Optional.empty();
    }
  }
}
