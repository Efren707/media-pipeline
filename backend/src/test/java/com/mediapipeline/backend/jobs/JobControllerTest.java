package com.mediapipeline.backend.jobs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mediapipeline.backend.TestcontainersConfiguration;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.model.S3Object;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Every request carries a verified JWT for {@code demo-user}; 401 cases are in AuthControllerTest.
 */
@SpringBootTest(properties = "mp.media-bucket=mp-test-media-bucket")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class JobControllerTest {

  private static final String JOB_ID = "550e8400-e29b-41d4-a716-446655440000";
  private static final Path CONTRACTS = Path.of("..", "docs", "contracts", "api");

  @Autowired MockMvc mvc;
  @Autowired JsonMapper json;
  @MockitoBean S3Client s3;

  /** Presigning is local signing math, so fake credentials let it run without AWS. */
  @TestConfiguration
  static class FakeAws {
    @Bean
    @Primary
    S3Presigner testPresigner() {
      return S3Presigner.builder()
          .region(Region.US_EAST_1)
          .credentialsProvider(
              StaticCredentialsProvider.create(AwsBasicCredentials.create("AKIATEST", "secret")))
          .build();
    }

    @Bean
    @Primary
    Clock testClock() {
      return Clock.fixed(Instant.parse("2026-10-14T12:00:00.123Z"), ZoneOffset.UTC);
    }

    @Bean
    MockMvcBuilderCustomizer authenticatedAsDemoUser() {
      return builder ->
          builder.defaultRequest(get("/").with(jwt().jwt(j -> j.subject("demo-user"))));
    }
  }

  // --- POST /api/uploads ---

  @Test
  void createUploadWritesQueuedStatusThenReturnsPresignedPut() throws Exception {
    String body =
        mvc.perform(
                post("/api/uploads")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"contentType\":\"image/png\",\"sizeBytes\":1234}"))
            .andExpect(status().isCreated())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.state").value("QUEUED"))
            .andExpect(jsonPath("$.upload.method").value("PUT"))
            .andExpect(jsonPath("$.upload.expiresInSeconds").value(300))
            .andExpect(jsonPath("$.upload.requiredHeaders.Content-Type").value("image/png"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode response = json.readTree(body);
    String jobId = response.get("jobId").asString();
    String sourceKey = "uploads/demo-user/" + jobId + ".png";

    URI url = URI.create(response.get("upload").get("url").asString());
    assertThat(url.getHost()).startsWith("mp-test-media-bucket.");
    assertThat(url.getPath()).isEqualTo("/" + sourceKey);
    assertThat(url.getQuery())
        .contains("X-Amz-Expires=300")
        .contains("X-Amz-SignedHeaders=content-length;content-type;host");

    ArgumentCaptor<PutObjectRequest> put = ArgumentCaptor.forClass(PutObjectRequest.class);
    ArgumentCaptor<RequestBody> putBody = ArgumentCaptor.forClass(RequestBody.class);
    verify(s3).putObject(put.capture(), putBody.capture());
    assertThat(put.getValue().bucket()).isEqualTo("mp-test-media-bucket");
    assertThat(put.getValue().key()).isEqualTo("status/demo-user/" + jobId + ".json");
    assertThat(put.getValue().ifNoneMatch()).isEqualTo("*");

    JsonNode written = json.readTree(read(putBody.getValue()));
    assertThat(written.get("state").asString()).isEqualTo("QUEUED");
    assertThat(written.get("userId").asString()).isEqualTo("demo-user");
    assertThat(written.get("sourceKey").asString()).isEqualTo(sourceKey);
    assertThat(written.get("sourceETag").isNull()).isTrue();
    assertThat(written.get("updatedAt").asString()).isEqualTo("2026-10-14T12:00:00Z");
    assertThat(fieldNames(written)).isEqualTo(contractFields("../status.example.json"));
  }

  @Test
  void createUploadResponseMatchesContract() throws Exception {
    String body =
        mvc.perform(
                post("/api/uploads")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"contentType\":\"image/jpeg\",\"sizeBytes\":10}"))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode response = json.readTree(body);
    assertThat(fieldNames(response)).isEqualTo(contractFields("create-upload.response.json"));
    assertThat(fieldNames(response.get("upload")))
        .isEqualTo(fieldNames(contract("create-upload.response.json").get("upload")));
  }

  @Test
  void createUploadIgnoresClientSuppliedUserId() throws Exception {
    mvc.perform(
            post("/api/uploads")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"contentType\":\"image/jpeg\",\"sizeBytes\":10,\"userId\":\"someone-else\"}"))
        .andExpect(status().isCreated());

    ArgumentCaptor<PutObjectRequest> put = ArgumentCaptor.forClass(PutObjectRequest.class);
    verify(s3).putObject(put.capture(), any(RequestBody.class));
    assertThat(put.getValue().key()).startsWith("status/demo-user/");
  }

  @Test
  void createUploadRejectsUnsupportedType() throws Exception {
    mvc.perform(
            post("/api/uploads")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"contentType\":\"image/gif\",\"sizeBytes\":10}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error.code").value("UNSUPPORTED_FORMAT"));
    verify(s3, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  @Test
  void createUploadRejectsOversizedFile() throws Exception {
    mvc.perform(
            post("/api/uploads")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"contentType\":\"image/jpeg\",\"sizeBytes\":10485761}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error.code").value("FILE_TOO_LARGE"));
    verify(s3, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  @Test
  void createUploadRejectsMissingOrInvalidFields() throws Exception {
    for (String content :
        new String[] {"{}", "{\"contentType\":\"image/jpeg\",\"sizeBytes\":0}", "not json"}) {
      mvc.perform(post("/api/uploads").contentType(MediaType.APPLICATION_JSON).content(content))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }
    verify(s3, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  // --- GET /api/jobs/{jobId} ---

  @Test
  void getJobReturnsContractFieldsWithThumbnailUrl() throws Exception {
    // Use the test clock's time, so the watchdog doesn't treat the example as stuck.
    stubStatus(
        Files.readString(CONTRACTS.resolve("../status.example.json"))
            .replace("2026-10-13T15:00:00Z", "2026-10-14T12:00:00Z"));

    String body =
        mvc.perform(get("/api/jobs/" + JOB_ID))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.state").value("READY_FOR_ANALYSIS"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode response = json.readTree(body);
    assertThat(fieldNames(response)).isEqualTo(contractFields("job-status.response.json"));

    URI thumbnail = URI.create(response.get("thumbnailUrl").asString());
    assertThat(thumbnail.getPath()).isEqualTo("/thumbnails/demo-user/" + JOB_ID + ".jpg");

    ArgumentCaptor<GetObjectRequest> request = ArgumentCaptor.forClass(GetObjectRequest.class);
    verify(s3).getObjectAsBytes(request.capture());
    assertThat(request.getValue().bucket()).isEqualTo("mp-test-media-bucket");
    assertThat(request.getValue().key()).isEqualTo("status/demo-user/" + JOB_ID + ".json");
  }

  @Test
  void getJobShowsFailureReasonWithoutThumbnail() throws Exception {
    stubStatus(
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","state":"FAILED",
         "sourceKey":"uploads/demo-user/%s.jpg","sourceETag":"abc",
         "thumbnailKey":"thumbnails/demo-user/%s.jpg","resultKey":null,
         "updatedAt":"2026-10-14T12:00:00Z",
         "error":{"code":"INVALID_IMAGE","message":"The file is not a readable image."}}
        """
            .formatted(JOB_ID, JOB_ID, JOB_ID));

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("FAILED"))
        .andExpect(jsonPath("$.thumbnailUrl").isEmpty())
        .andExpect(jsonPath("$.error.code").value("INVALID_IMAGE"));
  }

  @Test
  void getCompleteJobReturnsLabelsAndModerationFromItsResult() throws Exception {
    String status =
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","state":"COMPLETE",
         "sourceKey":"uploads/demo-user/%s.jpg","sourceETag":"abc",
         "thumbnailKey":"thumbnails/demo-user/%s.jpg",
         "resultKey":"results/demo-user/%s.json","updatedAt":"2026-10-14T12:00:00Z","error":null}
        """
            .formatted(JOB_ID, JOB_ID, JOB_ID, JOB_ID);
    String result =
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user",
         "modelVersion":"squeezenet1.1-7",
         "labels":[{"name":"tabby cat","confidence":0.86}],
         "moderation":{"verdict":"SAFE","confidence":0.0,"categories":[]}}
        """
            .formatted(JOB_ID);
    stubStatusAndResult(status, result);

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.result.modelVersion").value("squeezenet1.1-7"))
        .andExpect(jsonPath("$.result.labels[0].name").value("tabby cat"))
        .andExpect(jsonPath("$.result.labels[0].confidence").value(0.86))
        .andExpect(jsonPath("$.result.moderation.verdict").value("SAFE"));

    ArgumentCaptor<GetObjectRequest> requests = ArgumentCaptor.forClass(GetObjectRequest.class);
    verify(s3, times(2)).getObjectAsBytes(requests.capture());
    assertThat(requests.getAllValues().get(1).key())
        .isEqualTo("results/demo-user/" + JOB_ID + ".json");
  }

  @Test
  void getJobRejectsResultKeyOutsideAuthenticatedUserPrefix() throws Exception {
    stubStatus(
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","state":"COMPLETE",
         "thumbnailKey":"thumbnails/demo-user/%s.jpg",
         "resultKey":"results/other-user/%s.json","updatedAt":"2026-10-14T12:00:00Z"}
        """
            .formatted(JOB_ID, JOB_ID, JOB_ID));

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.result").isEmpty());

    verify(s3, times(1)).getObjectAsBytes(any(GetObjectRequest.class));
  }

  @Test
  void getJobNeverSignsThumbnailOutsideUserPrefix() throws Exception {
    stubStatus(
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","state":"READY_FOR_ANALYSIS",
         "thumbnailKey":"thumbnails/other-user/%s.jpg","updatedAt":"2026-10-14T12:00:00Z"}
        """
            .formatted(JOB_ID, JOB_ID));

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.thumbnailUrl").isEmpty());
  }

  @Test
  void getJobRejectsStatusWhoseEmbeddedIdentityDoesNotMatchItsKey() throws Exception {
    stubStatus(
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"other-user","state":"COMPLETE",
         "thumbnailKey":"thumbnails/other-user/%s.jpg",
         "resultKey":"results/other-user/%s.json","updatedAt":"2026-10-14T12:00:00Z"}
        """
            .formatted(JOB_ID, JOB_ID, JOB_ID));

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.error.code").value("JOB_NOT_FOUND"));

    verify(s3, times(1)).getObjectAsBytes(any(GetObjectRequest.class));
  }

  @Test
  void getJobReturns404WhenStatusMissing() throws Exception {
    when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
        .thenThrow(NoSuchKeyException.builder().message("missing").build());

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.error.code").value("JOB_NOT_FOUND"));
  }

  @Test
  void getJobRejectsMalformedIdWithoutCallingS3() throws Exception {
    // Spring Security's firewall rejects encoded slashes and ".." before the controller runs.
    mvc.perform(get("/api/jobs/..%2Fother-user%2Fjob")).andExpect(status().isBadRequest());
    mvc.perform(get("/api/jobs/not-a-uuid")).andExpect(status().isNotFound());
    verify(s3, never()).getObjectAsBytes(any(GetObjectRequest.class));
  }

  // --- read-time watchdog (D18); test clock is 2026-10-14T12:00:00Z, limits are 15 min ---

  @Test
  void watchdogFailsJobStuckInProcessingWithIfMatch() throws Exception {
    stubVersionedStatus(statusJson("ANALYZING", "2026-10-14T11:44:00Z"), "\"etag-1\"");

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("FAILED"))
        .andExpect(jsonPath("$.thumbnailUrl").isEmpty())
        .andExpect(jsonPath("$.error.code").value("PROCESSING_TIMEOUT"));

    ArgumentCaptor<PutObjectRequest> put = ArgumentCaptor.forClass(PutObjectRequest.class);
    ArgumentCaptor<RequestBody> putBody = ArgumentCaptor.forClass(RequestBody.class);
    verify(s3).putObject(put.capture(), putBody.capture());
    assertThat(put.getValue().key()).isEqualTo("status/demo-user/" + JOB_ID + ".json");
    assertThat(put.getValue().ifMatch()).isEqualTo("\"etag-1\"");
    JsonNode written = json.readTree(read(putBody.getValue()));
    assertThat(written.get("state").asString()).isEqualTo("FAILED");
    assertThat(written.get("error").get("code").asString()).isEqualTo("PROCESSING_TIMEOUT");
    assertThat(written.get("updatedAt").asString()).isEqualTo("2026-10-14T12:00:00Z");
    assertThat(written.get("sourceETag").asString()).isEqualTo("abc");
    assertThat(fieldNames(written)).isEqualTo(contractFields("../status.example.json"));
  }

  @Test
  void watchdogFailsQueuedJobWhoseUploadNeverArrived() throws Exception {
    stubVersionedStatus(statusJson("QUEUED", "2026-10-14T11:30:00Z"), "\"etag-1\"");

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("FAILED"))
        .andExpect(jsonPath("$.error.code").value("UPLOAD_NOT_RECEIVED"));
    verify(s3).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  @Test
  void watchdogLeavesFreshJobAlone() throws Exception {
    stubVersionedStatus(statusJson("ANALYZING", "2026-10-14T11:50:00Z"), "\"etag-1\"");

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("ANALYZING"));
    verify(s3, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  @Test
  void watchdogNeverTouchesFinalStates() throws Exception {
    stubVersionedStatus(
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","state":"FAILED",
         "sourceKey":"uploads/demo-user/%s.jpg","sourceETag":"abc","thumbnailKey":null,
         "resultKey":null,"updatedAt":"2026-10-01T00:00:00Z",
         "error":{"code":"INVALID_IMAGE","message":"The file is not a readable image."}}
        """
            .formatted(JOB_ID, JOB_ID),
        "\"etag-1\"");

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.error.code").value("INVALID_IMAGE"));
    verify(s3, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  @Test
  void watchdogYieldsWhenLambdaWritesFirst() throws Exception {
    String failedByLambda =
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","state":"FAILED",
         "sourceKey":"uploads/demo-user/%s.jpg","sourceETag":"abc","thumbnailKey":null,
         "resultKey":null,"updatedAt":"2026-10-14T11:59:59Z",
         "error":{"code":"SOURCE_CHANGED","message":"The uploaded image changed."}}
        """
            .formatted(JOB_ID, JOB_ID);
    when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
        .thenReturn(
            versioned(statusJson("ANALYZING", "2026-10-14T11:00:00Z"), "\"etag-1\""),
            versioned(failedByLambda, "\"etag-2\""));
    when(s3.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
        .thenThrow(S3Exception.builder().statusCode(412).message("Precondition Failed").build());

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("FAILED"))
        .andExpect(jsonPath("$.error.code").value("SOURCE_CHANGED"));
    verify(s3, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  @Test
  void watchdogSkipsWriteWhenStatusHasNoEtag() throws Exception {
    stubStatus(statusJson("ANALYZING", "2026-10-14T11:00:00Z"));

    mvc.perform(get("/api/jobs/" + JOB_ID))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.state").value("ANALYZING"));
    verify(s3, never()).putObject(any(PutObjectRequest.class), any(RequestBody.class));
  }

  // --- GET /api/jobs (Phase 9, D21) ---

  private static final String JOB_A = "11111111-1111-4111-8111-111111111111";
  private static final String JOB_B = "22222222-2222-4222-8222-222222222222";
  private static final String JOB_C = "33333333-3333-4333-8333-333333333333";

  @Test
  void listJobsReturnsNewestFirstWithContractFields() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    putStatus(bucket, JOB_A, "READY_FOR_ANALYSIS", "2026-10-14T11:58:00Z");
    putComplete(bucket, JOB_B, "2026-10-14T11:59:00Z", "tabby cat");
    putStatus(bucket, JOB_C, "QUEUED", "2026-10-14T11:57:00Z");
    stubBucket(bucket);

    String body =
        mvc.perform(get("/api/jobs"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.truncated").value(false))
            .andExpect(jsonPath("$.items[0].jobId").value(JOB_B))
            .andExpect(jsonPath("$.items[0].result.labels[0].name").value("tabby cat"))
            .andExpect(jsonPath("$.items[1].jobId").value(JOB_A))
            .andExpect(jsonPath("$.items[2].jobId").value(JOB_C))
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode response = json.readTree(body);
    assertThat(fieldNames(response)).isEqualTo(contractFields("job-list.response.json"));
    assertThat(fieldNames(response.get("items").get(0)))
        .isEqualTo(fieldNames(contract("job-list.response.json").get("items").get(0)))
        .isEqualTo(contractFields("job-status.response.json"));
    assertThat(URI.create(response.get("items").get(0).get("thumbnailUrl").asString()).getPath())
        .isEqualTo("/thumbnails/demo-user/" + JOB_B + ".jpg");

    ArgumentCaptor<ListObjectsV2Request> list = ArgumentCaptor.forClass(ListObjectsV2Request.class);
    verify(s3).listObjectsV2(list.capture());
    assertThat(list.getValue().bucket()).isEqualTo("mp-test-media-bucket");
    assertThat(list.getValue().prefix()).isEqualTo("status/demo-user/");
  }

  @Test
  void listJobsFiltersByLabelCaseInsensitively() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    putComplete(bucket, JOB_A, "2026-10-14T11:58:00Z", "tabby cat");
    putComplete(bucket, JOB_B, "2026-10-14T11:59:00Z", "golden retriever");
    putStatus(bucket, JOB_C, "ANALYZING", "2026-10-14T11:59:30Z");
    stubBucket(bucket);

    mvc.perform(get("/api/jobs").param("label", "  CAT "))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(1))
        .andExpect(jsonPath("$.items[0].jobId").value(JOB_A));
    mvc.perform(get("/api/jobs").param("label", "zebra"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(0));
  }

  @Test
  void listJobsAppliesLimitAfterSorting() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    putStatus(bucket, JOB_A, "QUEUED", "2026-10-14T11:57:00Z");
    putStatus(bucket, JOB_B, "QUEUED", "2026-10-14T11:59:00Z");
    putStatus(bucket, JOB_C, "QUEUED", "2026-10-14T11:58:00Z");
    stubBucket(bucket);

    mvc.perform(get("/api/jobs").param("limit", "2"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(2))
        .andExpect(jsonPath("$.items[0].jobId").value(JOB_B))
        .andExpect(jsonPath("$.items[1].jobId").value(JOB_C))
        .andExpect(jsonPath("$.truncated").value(false));
  }

  @Test
  void listJobsSkipsMalformedMismatchedAndUnexpectedKeys() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    putStatus(bucket, JOB_A, "QUEUED", "2026-10-14T11:59:00Z");
    bucket.put("status/demo-user/" + JOB_B + ".json", "{not json");
    bucket.put(
        "status/demo-user/" + JOB_C + ".json",
        statusJsonFor(JOB_C, "QUEUED", "2026-10-14T11:59:00Z").replace("demo-user", "other-user"));
    bucket.put("status/demo-user/not-a-uuid.json", "{}");
    bucket.put("status/demo-user/nested/" + JOB_A + ".json", "{}");
    stubBucket(bucket);

    mvc.perform(get("/api/jobs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(1))
        .andExpect(jsonPath("$.items[0].jobId").value(JOB_A));
    // Only the three well-formed <uuid>.json keys are read.
    verify(s3, times(3)).getObjectAsBytes(any(GetObjectRequest.class));
  }

  @Test
  void listJobsShowsJobWithUnreadableResultInsteadOfFailing() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    putComplete(bucket, JOB_A, "2026-10-14T11:59:00Z", "tabby cat");
    bucket.put("results/demo-user/" + JOB_A + ".json", "{not json");
    stubBucket(bucket);

    mvc.perform(get("/api/jobs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].state").value("COMPLETE"))
        .andExpect(jsonPath("$.items[0].result").isEmpty());
  }

  @Test
  void listJobsFollowsS3Pages() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    putStatus(bucket, JOB_A, "QUEUED", "2026-10-14T11:59:00Z");
    putStatus(bucket, JOB_B, "QUEUED", "2026-10-14T11:58:00Z");
    stubGets(bucket);
    when(s3.listObjectsV2(any(ListObjectsV2Request.class)))
        .thenReturn(page(List.of(JOB_A), "token-2"), page(List.of(JOB_B), null));

    mvc.perform(get("/api/jobs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(2))
        .andExpect(jsonPath("$.truncated").value(false));

    ArgumentCaptor<ListObjectsV2Request> list = ArgumentCaptor.forClass(ListObjectsV2Request.class);
    verify(s3, times(2)).listObjectsV2(list.capture());
    assertThat(list.getAllValues().get(0).continuationToken()).isNull();
    assertThat(list.getAllValues().get(1).continuationToken()).isEqualTo("token-2");
  }

  @Test
  void listJobsStopsAfterOneHundredValidJobs() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    List<String> firstPage = new ArrayList<>();
    for (int i = 0; i < 100; i++) {
      String id = UUID.nameUUIDFromBytes(("job-" + i).getBytes()).toString();
      firstPage.add(id);
      putStatus(bucket, id, "QUEUED", "2026-10-14T11:59:00Z");
    }
    String extra = UUID.nameUUIDFromBytes("extra".getBytes()).toString();
    putStatus(bucket, extra, "QUEUED", "2026-10-14T11:59:00Z");
    stubGets(bucket);
    when(s3.listObjectsV2(any(ListObjectsV2Request.class)))
        .thenReturn(page(firstPage, "token-2"), page(List.of(extra), null));

    mvc.perform(get("/api/jobs").param("limit", "100"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(100))
        .andExpect(jsonPath("$.truncated").value(true));
    verify(s3, times(100)).getObjectAsBytes(any(GetObjectRequest.class));
  }

  @Test
  void listJobsAppliesTheWatchdog() throws Exception {
    Map<String, String> bucket = new LinkedHashMap<>();
    putStatus(bucket, JOB_A, "ANALYZING", "2026-10-14T11:00:00Z");
    stubBucket(bucket);

    mvc.perform(get("/api/jobs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].state").value("FAILED"))
        .andExpect(jsonPath("$.items[0].error.code").value("PROCESSING_TIMEOUT"));
    ArgumentCaptor<PutObjectRequest> put = ArgumentCaptor.forClass(PutObjectRequest.class);
    verify(s3).putObject(put.capture(), any(RequestBody.class));
    assertThat(put.getValue().ifMatch()).isEqualTo("\"etag-" + JOB_A + "\"");
  }

  @Test
  void listJobsRejectsBadParametersWithoutCallingS3() throws Exception {
    for (String limit : new String[] {"0", "101", "-1", "abc"}) {
      mvc.perform(get("/api/jobs").param("limit", limit))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }
    mvc.perform(get("/api/jobs").param("label", "x".repeat(65)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    verify(s3, never()).listObjectsV2(any(ListObjectsV2Request.class));
  }

  // --- helpers ---

  private static String statusJsonFor(String jobId, String state, String updatedAt) {
    return statusJson(state, updatedAt).replace(JOB_ID, jobId);
  }

  private static void putStatus(
      Map<String, String> bucket, String jobId, String state, String updatedAt) {
    bucket.put("status/demo-user/" + jobId + ".json", statusJsonFor(jobId, state, updatedAt));
  }

  private static void putComplete(
      Map<String, String> bucket, String jobId, String updatedAt, String label) {
    bucket.put(
        "status/demo-user/" + jobId + ".json",
        statusJsonFor(jobId, "COMPLETE", updatedAt)
            .replace(
                "\"resultKey\":null", "\"resultKey\":\"results/demo-user/" + jobId + ".json\""));
    bucket.put(
        "results/demo-user/" + jobId + ".json",
        """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","modelVersion":"squeezenet1.1-7",
         "labels":[{"name":"%s","confidence":0.9}],
         "moderation":{"verdict":"SAFE","confidence":0.0,"categories":[]}}
        """
            .formatted(jobId, label));
  }

  /** A fake bucket: one listing page for the requested prefix, and GETs by exact key. */
  private void stubBucket(Map<String, String> bucket) {
    stubGets(bucket);
    when(s3.listObjectsV2(any(ListObjectsV2Request.class)))
        .thenAnswer(
            call -> {
              String prefix = call.<ListObjectsV2Request>getArgument(0).prefix();
              List<S3Object> objects =
                  bucket.keySet().stream()
                      .filter(k -> k.startsWith(prefix))
                      .map(k -> S3Object.builder().key(k).build())
                      .toList();
              return ListObjectsV2Response.builder().contents(objects).isTruncated(false).build();
            });
  }

  private void stubGets(Map<String, String> bucket) {
    when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
        .thenAnswer(
            call -> {
              String key = call.<GetObjectRequest>getArgument(0).key();
              String body = bucket.get(key);
              if (body == null) {
                throw NoSuchKeyException.builder().message("missing").build();
              }
              String jobId = key.substring(key.lastIndexOf('/') + 1).replace(".json", "");
              return ResponseBytes.fromByteArray(
                  GetObjectResponse.builder().eTag("\"etag-" + jobId + "\"").build(),
                  body.getBytes());
            });
  }

  private static ListObjectsV2Response page(List<String> jobIds, String nextToken) {
    return ListObjectsV2Response.builder()
        .contents(
            jobIds.stream()
                .map(id -> S3Object.builder().key("status/demo-user/" + id + ".json").build())
                .toList())
        .isTruncated(nextToken != null)
        .nextContinuationToken(nextToken)
        .build();
  }

  private static String statusJson(String state, String updatedAt) {
    return """
        {"schemaVersion":"1.0","jobId":"%s","userId":"demo-user","state":"%s",
         "sourceKey":"uploads/demo-user/%s.jpg","sourceETag":"abc",
         "thumbnailKey":"thumbnails/demo-user/%s.jpg","resultKey":null,
         "updatedAt":"%s","error":null}
        """
        .formatted(JOB_ID, state, JOB_ID, JOB_ID, updatedAt);
  }

  private static ResponseBytes<GetObjectResponse> versioned(String statusJson, String etag) {
    return ResponseBytes.fromByteArray(
        GetObjectResponse.builder().eTag(etag).build(), statusJson.getBytes());
  }

  private void stubVersionedStatus(String statusJson, String etag) {
    when(s3.getObjectAsBytes(any(GetObjectRequest.class))).thenReturn(versioned(statusJson, etag));
  }

  private void stubStatus(String statusJson) {
    when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
        .thenReturn(
            ResponseBytes.fromByteArray(
                GetObjectResponse.builder().build(), statusJson.getBytes()));
  }

  private void stubStatusAndResult(String statusJson, String resultJson) {
    when(s3.getObjectAsBytes(any(GetObjectRequest.class)))
        .thenReturn(
            ResponseBytes.fromByteArray(GetObjectResponse.builder().build(), statusJson.getBytes()),
            ResponseBytes.fromByteArray(
                GetObjectResponse.builder().build(), resultJson.getBytes()));
  }

  private JsonNode contract(String name) throws IOException {
    return json.readTree(Files.readString(CONTRACTS.resolve(name)));
  }

  private Set<String> contractFields(String name) throws IOException {
    return fieldNames(contract(name));
  }

  private static Set<String> fieldNames(JsonNode node) {
    return Set.copyOf(node.propertyNames());
  }

  private static String read(RequestBody body) throws IOException {
    try (InputStream in = body.contentStreamProvider().newStream()) {
      return new String(in.readAllBytes());
    }
  }
}
