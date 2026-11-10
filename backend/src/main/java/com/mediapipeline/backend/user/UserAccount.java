package com.mediapipeline.backend.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * A row in {@code users}. The {@link #getId() id} is generated here, never by the client, and is
 * the {@code {userId}} in every S3 key the user owns.
 */
@Entity
@Table(name = "users")
public class UserAccount {

  @Id private UUID id;

  @Column(nullable = false, unique = true, length = 32)
  private String username;

  @Column(name = "password_hash", nullable = false, length = 100)
  private String passwordHash;

  @Column(name = "created_at", nullable = false, updatable = false)
  private Instant createdAt;

  /** For JPA only. */
  protected UserAccount() {}

  /**
   * A new account with a random id.
   *
   * @param username normalized to lowercase; the database rejects anything outside {@code
   *     [a-z0-9_]{3,32}}
   * @param passwordHash an already-encoded hash, never the raw password
   */
  public UserAccount(String username, String passwordHash, Instant createdAt) {
    this.id = UUID.randomUUID();
    this.username = normalizeUsername(username);
    this.passwordHash = Objects.requireNonNull(passwordHash, "passwordHash");
    this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
  }

  /** Usernames are case-insensitive; this is the stored form. */
  public static String normalizeUsername(String username) {
    return Objects.requireNonNull(username, "username").trim().toLowerCase(Locale.ROOT);
  }

  public UUID getId() {
    return id;
  }

  public String getUsername() {
    return username;
  }

  public String getPasswordHash() {
    return passwordHash;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }
}
