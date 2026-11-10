package com.mediapipeline.backend.user;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Pass usernames through {@link UserAccount#normalizeUsername(String)} before looking them up. */
public interface UserAccountRepository extends JpaRepository<UserAccount, UUID> {

  Optional<UserAccount> findByUsername(String username);

  boolean existsByUsername(String username);
}
