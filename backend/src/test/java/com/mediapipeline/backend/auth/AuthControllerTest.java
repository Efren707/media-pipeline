package com.mediapipeline.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mediapipeline.backend.TestcontainersConfiguration;
import com.mediapipeline.backend.user.UserAccountRepository;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Signup, login and token checks against a real PostgreSQL; S3 is mocked. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AuthControllerTest {

  private static final String JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
  private static final String TEST_SECRET = "test-only-jwt-secret-not-used-anywhere-real";
  private static final Path CONTRACTS = Path.of("..", "docs", "contracts", "api");

  @Autowired MockMvc mvc;
  @Autowired JsonMapper json;
  @Autowired UserAccountRepository users;
  @MockitoBean S3Client s3;

  @BeforeEach
  void startWithNoUsers() {
    users.deleteAll();
    when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
        .thenThrow(NoSuchKeyException.builder().message("missing").build());
  }

  // --- signup ---

  @Test
  void signupCreatesAccountAndReturnsTokenMatchingContract() throws Exception {
    JsonNode response =
        body(
            signup("Alice", "correct-horse-battery")
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.user.username").value("alice")));

    assertThat(fieldNames(response)).isEqualTo(fieldNames(contract("auth-token.response.json")));
    assertThat(fieldNames(response.get("user")))
        .isEqualTo(fieldNames(contract("auth-token.response.json").get("user")));
    assertThat(users.findByUsername("alice")).isPresent();
  }

  @Test
  void storesOnlyABcryptHashOfThePassword() throws Exception {
    signup("alice", "correct-horse-battery").andExpect(status().isCreated());

    String hash = users.findByUsername("alice").orElseThrow().getPasswordHash();
    assertThat(hash).startsWith("$2").doesNotContain("correct-horse-battery");
  }

  @Test
  void rejectsADuplicateUsernameRegardlessOfCase() throws Exception {
    signup("alice", "correct-horse-battery").andExpect(status().isCreated());

    signup("ALICE", "another-password")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error.code").value("USERNAME_TAKEN"));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "{}",
        "{\"username\":\"alice\"}",
        "{\"username\":\"al\",\"password\":\"long-enough\"}",
        "{\"username\":\"al ice\",\"password\":\"long-enough\"}",
        "{\"username\":\"alice\",\"password\":\"short\"}",
        "not json"
      })
  void signupRejectsInvalidBodies(String content) throws Exception {
    mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON).content(content))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    assertThat(users.count()).isZero();
  }

  @Test
  void signupRejectsPasswordsBcryptWouldTruncate() throws Exception {
    signup("alice", "x".repeat(73)).andExpect(status().isBadRequest());
  }

  // --- login ---

  @Test
  void loginReturnsTokenForTheSameUser() throws Exception {
    String id = body(signup("alice", "correct-horse-battery")).get("user").get("id").asString();

    login("Alice", "correct-horse-battery")
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.user.id").value(id));
  }

  @Test
  void loginGivesTheSameAnswerForWrongPasswordAndUnknownUser() throws Exception {
    signup("alice", "correct-horse-battery").andExpect(status().isCreated());

    String wrongPassword =
        login("alice", "wrong-password")
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String unknownUser =
        login("nobody", "wrong-password")
            .andExpect(status().isUnauthorized())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(unknownUser).isEqualTo(wrongPassword);
  }

  // --- protected endpoints ---

  @Test
  void protectedEndpointsNeedAToken() throws Exception {
    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string("WWW-Authenticate", "Bearer"))
        .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    mvc.perform(
            post("/api/uploads")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"contentType\":\"image/png\",\"sizeBytes\":1234}"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void rejectsGarbageForgedExpiredAndForeignTokens() throws Exception {
    Instant now = Instant.now();
    String[] badTokens = {
      "not-a-jwt",
      token("a-completely-different-secret-of-32-chars-plus", "media-pipeline", now, 3600),
      token(TEST_SECRET, "media-pipeline", now.minusSeconds(7200), 3600),
      token(TEST_SECRET, "someone-else", now, 3600)
    };
    for (String bad : badTokens) {
      mvc.perform(get("/api/jobs/" + JOB_ID).header("Authorization", "Bearer " + bad))
          .andExpect(status().isUnauthorized())
          .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
    }
  }

  @Test
  void eachUserSeesOnlyTheirOwnJobs() throws Exception {
    JsonNode alice = body(signup("alice", "correct-horse-battery"));
    JsonNode bob = body(signup("bob", "correct-horse-battery"));
    String aliceId = alice.get("user").get("id").asString();
    String bobId = bob.get("user").get("id").asString();
    assertThat(aliceId).isNotEqualTo(bobId);

    // Only Alice's status object exists in "S3".
    String aliceKey = "status/" + aliceId + "/" + JOB_ID + ".json";
    Set<String> requestedKeys = new HashSet<>();
    when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
        .thenAnswer(
            call -> {
              String key = call.<GetObjectRequest>getArgument(0).key();
              requestedKeys.add(key);
              if (!key.equals(aliceKey)) {
                throw NoSuchKeyException.builder().message("missing").build();
              }
              return ResponseBytes.fromByteArray(
                  GetObjectResponse.builder().build(),
                  failedStatus(aliceId).getBytes(StandardCharsets.UTF_8));
            });

    mvc.perform(get("/api/jobs/" + JOB_ID).header("Authorization", bearer(alice)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.jobId").value(JOB_ID));
    mvc.perform(get("/api/jobs/" + JOB_ID).header("Authorization", bearer(bob)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.error.code").value("JOB_NOT_FOUND"));

    assertThat(requestedKeys)
        .containsExactlyInAnyOrder(aliceKey, "status/" + bobId + "/" + JOB_ID + ".json");
  }

  // --- helpers ---

  private ResultActions signup(String username, String password) throws Exception {
    return mvc.perform(
        post("/api/auth/signup")
            .contentType(MediaType.APPLICATION_JSON)
            .content(credentials(username, password)));
  }

  private ResultActions login(String username, String password) throws Exception {
    return mvc.perform(
        post("/api/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content(credentials(username, password)));
  }

  private String credentials(String username, String password) {
    return json.writeValueAsString(java.util.Map.of("username", username, "password", password));
  }

  private JsonNode body(ResultActions result) throws Exception {
    return json.readTree(result.andReturn().getResponse().getContentAsString());
  }

  private static String bearer(JsonNode tokenResponse) {
    return "Bearer " + tokenResponse.get("accessToken").asString();
  }

  private static String token(String secret, String issuer, Instant issuedAt, long ttlSeconds) {
    NimbusJwtEncoder encoder =
        new NimbusJwtEncoder(
            new ImmutableSecret<>(
                new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256")));
    JwtClaimsSet claims =
        JwtClaimsSet.builder()
            .issuer(issuer)
            .subject("3f2b8c1e-9d4a-4e2b-8f61-0c7d5a9e1b42")
            .issuedAt(issuedAt)
            .expiresAt(issuedAt.plusSeconds(ttlSeconds))
            .build();
    return encoder
        .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
        .getTokenValue();
  }

  /** A final state, so the read-time watchdog leaves it alone. */
  private static String failedStatus(String userId) {
    return """
        {"schemaVersion":"1.0","jobId":"%s","userId":"%s","state":"FAILED",
         "sourceKey":"uploads/%s/%s.jpg","sourceETag":"abc","thumbnailKey":null,
         "resultKey":null,"updatedAt":"2026-11-09T12:00:00Z",
         "error":{"code":"INVALID_IMAGE","message":"The file is not a readable image."}}
        """
        .formatted(JOB_ID, userId, userId, JOB_ID);
  }

  private JsonNode contract(String name) throws Exception {
    return json.readTree(Files.readString(CONTRACTS.resolve(name)));
  }

  private static Set<String> fieldNames(JsonNode node) {
    return new HashSet<>(node.propertyNames());
  }
}
