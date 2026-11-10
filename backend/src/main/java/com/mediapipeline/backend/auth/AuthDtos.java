package com.mediapipeline.backend.auth;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** Request and response bodies for {@code /api/auth/*}; see {@code docs/contracts/api/auth-*}. */
final class AuthDtos {

  private AuthDtos() {}

  /**
   * Signup and login body. Usernames are case-insensitive. BCrypt ignores bytes past 72, so longer
   * passwords are rejected rather than silently truncated.
   */
  record Credentials(
      @NotNull @Pattern(regexp = "[A-Za-z0-9_]{3,32}") String username,
      @NotNull @Size(min = 8, max = 72) String password) {}

  record TokenResponse(String tokenType, String accessToken, Instant expiresAt, UserView user) {}

  record UserView(String id, String username) {}
}
