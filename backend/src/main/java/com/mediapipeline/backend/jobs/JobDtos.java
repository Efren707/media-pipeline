package com.mediapipeline.backend.jobs;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.List;
import java.util.Map;

/** API request and response bodies. See docs/contracts/api/. */
final class JobDtos {

  private JobDtos() {}

  record CreateUploadRequest(@NotBlank String contentType, @NotNull @Positive Long sizeBytes) {}

  record CreateUploadResponse(String jobId, String state, UploadInstructions upload) {}

  record UploadInstructions(
      String method, String url, long expiresInSeconds, Map<String, String> requiredHeaders) {}

  record Label(String name, double confidence) {}

  record Moderation(String verdict, double confidence, List<String> categories) {}

  record AnalysisResult(String modelVersion, List<Label> labels, Moderation moderation) {}

  /** Stored Analyze output. Identity fields are checked before exposing the result. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  record ResultDocument(
      String jobId, String userId, String modelVersion, List<Label> labels, Moderation moderation) {
    AnalysisResult toResponse() {
      return new AnalysisResult(modelVersion, labels, moderation);
    }
  }

  /** Deliberately leaves out userId, sourceKey and sourceETag from the stored status. */
  record JobStatusResponse(
      String schemaVersion,
      String jobId,
      String state,
      String thumbnailUrl,
      String updatedAt,
      AnalysisResult result,
      JobStatus.Error error) {}
}
