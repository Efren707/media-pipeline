package com.mediapipeline.backend.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mediapipeline.backend.TestcontainersConfiguration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;

/** Runs the Flyway migrations on a real PostgreSQL, so the schema and entity must agree. */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(TestcontainersConfiguration.class)
class UserAccountRepositoryTest {

  private static final Instant NOW = Instant.parse("2026-11-09T12:00:00Z");

  @Autowired private UserAccountRepository users;

  @Test
  void savesAndFindsByNormalizedUsername() {
    UserAccount alice = users.saveAndFlush(new UserAccount("  Alice ", "hash", NOW));

    assertThat(alice.getUsername()).isEqualTo("alice");
    assertThat(users.findByUsername("alice"))
        .get()
        .extracting(UserAccount::getId)
        .isEqualTo(alice.getId());
    assertThat(users.existsByUsername("alice")).isTrue();
    assertThat(users.existsByUsername("bob")).isFalse();
  }

  @Test
  void givesEachUserADifferentId() {
    UserAccount alice = users.saveAndFlush(new UserAccount("alice", "hash", NOW));
    UserAccount bob = users.saveAndFlush(new UserAccount("bob", "hash", NOW));

    assertThat(alice.getId()).isNotEqualTo(bob.getId());
  }

  @Test
  void rejectsADuplicateUsernameRegardlessOfCase() {
    users.saveAndFlush(new UserAccount("alice", "hash", NOW));

    assertThatThrownBy(() -> users.saveAndFlush(new UserAccount("ALICE", "hash", NOW)))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  // One case per test: after a constraint violation PostgreSQL aborts the whole transaction.
  @ParameterizedTest
  @ValueSource(strings = {"a b", "ab", "alice!", "thirty_three_characters_long_name"})
  void rejectsUsernamesOutsideTheAllowedFormat(String username) {
    assertThatThrownBy(() -> users.saveAndFlush(new UserAccount(username, "hash", NOW)))
        .isInstanceOf(DataIntegrityViolationException.class);
  }
}
