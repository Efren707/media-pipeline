package com.mediapipeline.backend.auth;

import com.mediapipeline.backend.auth.AuthDtos.Credentials;
import com.mediapipeline.backend.auth.AuthDtos.TokenResponse;
import com.mediapipeline.backend.auth.AuthDtos.UserView;
import com.mediapipeline.backend.user.UserAccount;
import com.mediapipeline.backend.user.UserAccountRepository;
import com.mediapipeline.backend.web.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

/** Creates accounts, checks passwords and issues access tokens whose subject is the user id. */
@Service
class AuthService {

  private final UserAccountRepository users;
  private final PasswordEncoder passwords;
  private final JwtEncoder jwtEncoder;
  private final JwtProperties properties;
  private final Clock clock;

  /** Compared against when the username doesn't exist, so both failures take about as long. */
  private final String dummyHash;

  AuthService(
      UserAccountRepository users,
      PasswordEncoder passwords,
      JwtEncoder jwtEncoder,
      JwtProperties properties,
      Clock clock) {
    this.users = users;
    this.passwords = passwords;
    this.jwtEncoder = jwtEncoder;
    this.properties = properties;
    this.clock = clock;
    this.dummyHash = passwords.encode("not-a-real-password");
  }

  TokenResponse signup(Credentials credentials) {
    String username = UserAccount.normalizeUsername(credentials.username());
    if (users.existsByUsername(username)) {
      throw usernameTaken();
    }
    UserAccount account =
        new UserAccount(username, passwords.encode(credentials.password()), clock.instant());
    try {
      users.saveAndFlush(account);
    } catch (DataIntegrityViolationException e) {
      throw usernameTaken(); // lost a race with a signup for the same name
    }
    return issueToken(account);
  }

  TokenResponse login(Credentials credentials) {
    Optional<UserAccount> account =
        users.findByUsername(UserAccount.normalizeUsername(credentials.username()));
    String hash = account.map(UserAccount::getPasswordHash).orElse(dummyHash);
    boolean matches = passwords.matches(credentials.password(), hash);
    if (account.isEmpty() || !matches) {
      throw new ApiException(
          HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Wrong username or password.");
    }
    return issueToken(account.get());
  }

  private TokenResponse issueToken(UserAccount account) {
    Instant now = clock.instant();
    Instant expiresAt = now.plus(properties.ttl());
    JwtClaimsSet claims =
        JwtClaimsSet.builder()
            .issuer(SecurityConfig.ISSUER)
            .subject(account.getId().toString())
            .issuedAt(now)
            .expiresAt(expiresAt)
            .claim("username", account.getUsername())
            .build();
    String token =
        jwtEncoder
            .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
            .getTokenValue();
    return new TokenResponse(
        "Bearer",
        token,
        expiresAt,
        new UserView(account.getId().toString(), account.getUsername()));
  }

  private static ApiException usernameTaken() {
    return new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "That username is taken.");
  }
}
