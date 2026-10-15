package com.mediapipeline.backend.jobs;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * The status document at {@code status/{userId}/{jobId}.json}, shared with the Lambdas. See
 * docs/contracts/status.example.json.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record JobStatus(
    String schemaVersion,
    String jobId,
    String userId,
    String state,
    String sourceKey,
    String sourceETag,
    String thumbnailKey,
    String resultKey,
    String updatedAt,
    Error error) {

  static final String SCHEMA_VERSION = "1.0";

  /**
   * Written before the upload URL is issued. Validate binds {@code sourceETag} when it claims it.
   */
  static JobStatus queued(String userId, String jobId, String sourceKey, String updatedAt) {
    return new JobStatus(
        SCHEMA_VERSION, jobId, userId, "QUEUED", sourceKey, null, null, null, updatedAt, null);
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  record Error(String code, String message) {}
}
