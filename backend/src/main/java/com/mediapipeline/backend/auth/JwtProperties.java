package com.mediapipeline.backend.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Settings under {@code mp.jwt.*}; the app refuses to start without a strong secret. */
@Validated
@ConfigurationProperties("mp.jwt")
public record JwtProperties(
    @NotBlank @Size(min = 32, message = "set MP_JWT_SECRET to at least 32 random characters")
        String secret,
    @NotNull Duration ttl) {}
