package com.mediapipeline.backend.user;

/**
 * The authenticated caller. Every S3 key is derived from {@link #id()}, never from request input,
 * so one user can't reach another user's prefix.
 */
public interface CurrentUser {

  /** Letters, digits, {@code _} and {@code -}, at most 64 characters. */
  String id();
}
