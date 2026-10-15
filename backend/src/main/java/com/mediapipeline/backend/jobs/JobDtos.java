package com.mediapipeline.backend.jobs;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.Map;

/** API request and response bodies. See docs/contracts/api/. */
final class JobDtos {

  private JobDtos() {}

  record CreateUploadRequest(@NotBlank String contentType, @NotNull @Positive Long sizeBytes) {}

  record CreateUploadResponse(String jobId, String state, UploadInstructions upload) {}

  record UploadInstructions(
      String method, String url, long expiresInSeconds, Map<String, String> requiredHeaders) {}

  /** Deliberately leaves out userId, sourceKey and sourceETag from the stored status. */
  record JobStatusResponse(
      String schemaVersion,
      String jobId,
      String state,
      String thumbnailUrl,
      String updatedAt,
      JobStatus.Error error) {}
}
