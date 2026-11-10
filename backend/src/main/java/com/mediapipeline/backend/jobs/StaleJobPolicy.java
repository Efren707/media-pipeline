package com.mediapipeline.backend.jobs;

import com.mediapipeline.backend.config.MediaProperties;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Decides when a job has been in a non-final state too long (D18). A job stuck in {@code QUEUED}
 * never got its upload; one stuck in a processing state ran out of Lambda retries, timed out, or
 * crashed.
 */
@Component
class StaleJobPolicy {

  static final String UPLOAD_NOT_RECEIVED = "UPLOAD_NOT_RECEIVED";
  static final String PROCESSING_TIMEOUT = "PROCESSING_TIMEOUT";

  private static final Set<String> PROCESSING_STATES =
      Set.of("VALIDATING", "READY_FOR_ANALYSIS", "ANALYZING");

  private final Duration queuedLimit;
  private final Duration processingLimit;

  StaleJobPolicy(MediaProperties properties) {
    this.queuedLimit = properties.staleAfter().queued();
    this.processingLimit = properties.staleAfter().processing();
  }

  /** Returns the failure to record, or empty if the job is final, fresh, or has no usable time. */
  Optional<JobStatus.Error> check(JobStatus status, Instant now) {
    Duration limit;
    JobStatus.Error error;
    if ("QUEUED".equals(status.state())) {
      limit = queuedLimit;
      error =
          new JobStatus.Error(
              UPLOAD_NOT_RECEIVED, "The upload never arrived. Try uploading the image again.");
    } else if (PROCESSING_STATES.contains(status.state())) {
      limit = processingLimit;
      error =
          new JobStatus.Error(
              PROCESSING_TIMEOUT, "Processing took too long. Try uploading the image again.");
    } else {
      return Optional.empty();
    }

    Instant updatedAt;
    try {
      updatedAt = Instant.parse(status.updatedAt());
    } catch (DateTimeParseException | NullPointerException e) {
      // Never fail a job because of a timestamp we can't read.
      return Optional.empty();
    }
    return now.isAfter(updatedAt.plus(limit)) ? Optional.of(error) : Optional.empty();
  }
}
