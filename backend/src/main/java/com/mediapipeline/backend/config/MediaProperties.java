package com.mediapipeline.backend.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Settings under {@code mp.*}; the app refuses to start if any are missing or invalid. */
@Validated
@ConfigurationProperties("mp")
public record MediaProperties(
    @NotBlank(message = "set MP_MEDIA_BUCKET to the stack's MediaBucketName output")
        String mediaBucket,
    @NotBlank String awsRegion,
    @NotNull Duration presignTtl,
    @Positive long maxUploadBytes,
    @NotNull @Valid StaleAfter staleAfter) {

  /** How long a job may sit in a non-final state before the API marks it FAILED (D18). */
  public record StaleAfter(@NotNull Duration queued, @NotNull Duration processing) {}
}
