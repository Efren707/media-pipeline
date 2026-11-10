package com.mediapipeline.backend.user;

import java.util.regex.Pattern;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * The caller is the verified JWT's subject (the {@code users.id} UUID). Read per call from the
 * request's security context, so this singleton is safe across concurrent requests.
 */
@Component
class JwtCurrentUser implements CurrentUser {

  private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

  @Override
  public String id() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication instanceof JwtAuthenticationToken jwt
        && ID.matcher(jwt.getName()).matches()) {
      return jwt.getName();
    }
    // Only reachable if a protected endpoint was left open in SecurityConfig.
    throw new IllegalStateException("No authenticated user for this request");
  }
}
