package com.mediapipeline.backend.user;

import com.mediapipeline.backend.config.MediaProperties;
import org.springframework.stereotype.Component;

/** Phase 3 stand-in until JWT login exists (Phase 7): every request is the configured user. */
@Component
class DemoCurrentUser implements CurrentUser {

  private final String id;

  DemoCurrentUser(MediaProperties properties) {
    this.id = properties.demoUserId();
  }

  @Override
  public String id() {
    return id;
  }
}
