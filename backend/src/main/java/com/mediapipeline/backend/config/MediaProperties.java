package com.mediapipeline.backend.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
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
    @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{1,64}") String demoUserId,
    @NotNull Duration presignTtl,
    @Positive long maxUploadBytes) {}
