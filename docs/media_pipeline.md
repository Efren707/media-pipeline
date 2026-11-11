# Event-Driven Media Pipeline with AI Analysis

## 1. Purpose

Users upload images without waiting for image processing to finish. AWS stores the original privately, validates it asynchronously, creates a safe thumbnail, analyzes it, records progress, and reports a clear final state.

This design reflects the services and pre-created roles that were verified in the AWS Academy sandbox on 2026-09-30. It replaces the original Step Functions, Rekognition, DynamoDB, API Gateway, Cognito, SQS, and SES design because deployed code cannot use those services in this sandbox.

## 2. Deployed architecture

```text
React (local during M2; S3 + CloudFront later)
  |
  | HTTPS: request a short-lived upload URL
  v
Spring Boot (local during M2; EC2 + ALB later)
  |
  | presigned PUT URL
  v
Private S3 media bucket
  uploads/{userId}/{jobId}.{extension}
          |
          | ObjectCreated event, prefix uploads/
          v
Validate Lambda (existing lambda-run-role)
  |-- thumbnails/{userId}/{jobId}.jpg
  |-- status/{userId}/{jobId}.json
  `-- stage/analyze/{userId}/{jobId}.json
          |
          | ObjectCreated event, prefix stage/analyze/
          v
Analyze Lambda: self-hosted ONNX tagging and moderation
  |-- results/{userId}/{jobId}.json
  `-- status/{userId}/{jobId}.json
          |
          | S3 ObjectCreated event, prefix results/
          v
SNS topic -> confirmed user email subscription
```

S3 is storage, status store, and the handoff mechanism between stages. Each stage writes a new object under a dedicated prefix; S3 invokes the next stage. Notifications must be filtered by prefix so outputs never retrigger the input Lambda.

## 3. Sandbox constraints

- Every Lambda imports the existing `lambda-run-role`. It may access only S3 and CloudWatch Logs.
- Spring Boot uses the existing `myS3Role` instance profile on EC2. No AWS access keys are stored in the application.
- CDK uses `CliCredentialsStackSynthesizer`; the project never runs a normal `cdk bootstrap` and never creates IAM roles.
- Lambda cannot call Rekognition, DynamoDB, SNS, SQS, or RDS.
- Step Functions, API Gateway, Cognito, SES, and SQS creation is blocked.
- There is no NAT Gateway. Lambdas remain outside a VPC.
- Large Python dependencies use Lambda-compatible manylinux wheels in the function package. Model weights live in S3 and are loaded into `/tmp` during a cold start.

## 4. S3 key contract

| Prefix | Writer | Reader / trigger | Purpose |
|---|---|---|---|
| `uploads/{userId}/{jobId}.{ext}` | Browser through presigned URL | Validate Lambda | Private original image |
| `thumbnails/{userId}/{jobId}.jpg` | Validate Lambda | Backend | Re-encoded preview without original metadata |
| `stage/analyze/{userId}/{jobId}.json` | Validate Lambda | Analyze Lambda | Deterministic handoff manifest |
| `status/{userId}/{jobId}.json` | Backend and Lambdas | Backend | Latest job state |
| `results/{userId}/{jobId}.json` | Analyze Lambda | Backend and S3-to-SNS | Labels, moderation verdict, final metadata |
| `models/...` | Deployment process | Analyze Lambda | Versioned ONNX model files |

`userId` and `jobId` contain only letters, numbers, `_`, and `-`, with a maximum length of 64 characters. The backend generates `jobId` as a UUID. Output keys are derived from the validated input key, never from untrusted metadata.

## 5. Status contract

The current status is stored at `status/{userId}/{jobId}.json`. The canonical example is [`contracts/status.example.json`](contracts/status.example.json).

| State | Writer | Meaning | Allowed next states |
|---|---|---|---|
| `QUEUED` | Backend | Upload URL issued or upload accepted | `VALIDATING`, `FAILED` |
| `VALIDATING` | Validate Lambda | File checks and thumbnail generation are running | `READY_FOR_ANALYSIS`, `FAILED` |
| `READY_FOR_ANALYSIS` | Validate Lambda | Validation passed and the analyze manifest exists | `ANALYZING`, `FAILED` |
| `ANALYZING` | Analyze Lambda | Tagging and moderation are running | `COMPLETE`, `FLAGGED`, `FAILED` |
| `COMPLETE` | Analyze Lambda | Safe result is available | terminal |
| `FLAGGED` | Analyze Lambda | Moderation policy requires review | terminal |
| `FAILED` | Backend or Lambda | A permanent error occurred or watchdog timed out | terminal; retry with a new job ID |

Every status includes `schemaVersion`, `jobId`, `userId`, `state`, `sourceKey`, `sourceETag`, `updatedAt`, and an optional safe `error`. Timestamps use UTC ISO 8601. Error objects contain a stable code and a user-safe message, never a stack trace.

## 6. Validation stage

The Validate Lambda performs these checks before decoding the entire object:

1. Confirm the event bucket matches `MEDIA_BUCKET_NAME`.
2. Accept only keys matching `uploads/{userId}/{jobId}.{ext}`.
3. Read object metadata and reject files larger than `MAX_IMAGE_BYTES`.
4. Verify the decoded image and its true format; do not trust the filename or submitted content type.
5. Accept JPEG, PNG, and WebP only, require the encoded format to match the key extension, and reject decompression-bomb-sized dimensions.
6. Apply EXIF orientation, convert to RGB, and re-encode a JPEG thumbnail. This removes original metadata.
7. Create the deterministic thumbnail and Analyze manifest, then publish `READY_FOR_ANALYSIS` only after both artifacts exist.

S3 events are delivered at least once and may overlap. Validate compares the event ETag with the current object and downloads with `If-Match`, so a source change between metadata inspection and download causes a retry instead of mixing versions. Before publishing any derived artifact, it conditionally claims the job as `VALIDATING`. A missing status is created with `If-None-Match: *`; an existing `QUEUED` or `VALIDATING` status is updated with `If-Match`; later, terminal, or differently bound status is rejected.

The thumbnail and manifest are also created with `If-None-Match: *`, so a duplicate cannot replace artifacts and no missing-object lookup or `s3:ListBucket` permission is required. The final status uses another conditional update, and later or terminal states are never moved backward.

A `{userId, jobId}` identifies one immutable upload. Re-uploading or retrying with different source bytes requires a new job ID. Existing outputs record the source key and ETag so accidental job-ID reuse is rejected.

Permanent input errors write `FAILED` and return successfully so AWS does not retry a bad file. Unexpected AWS or runtime errors are raised so asynchronous Lambda retry can run.

## 7. API contract

The Spring Boot API is responsible for authentication, authorization, presigned URLs, status retrieval, gallery results, and the stuck-job watchdog.

Planned endpoints:

| Method and path | Purpose |
|---|---|
| `POST /api/auth/signup` | Create an account and return an access token (`201`) |
| `POST /api/auth/login` | Check the password and return an access token |
| `POST /api/uploads` | Authorize the user, generate a job ID, write `QUEUED`, and return a short-lived presigned PUT URL |
| `GET /api/jobs/{jobId}` | Return the authenticated user's status, labels, and moderation result |
| `GET /api/jobs?label=&limit=` | The gallery: the authenticated user's jobs, newest first, optionally filtered by label |

The API always derives the S3 user prefix from the authenticated account. A caller cannot choose another user's prefix. Terminal results are read only when the status points to the exact `results/{authenticatedUser}/{jobId}.json` key, and the embedded result identity must match. Example requests and responses are in [`contracts/api/`](contracts/api/).

`POST /api/uploads` takes `{contentType, sizeBytes}` ([`create-upload.request.json`](contracts/api/create-upload.request.json)). It rejects types other than JPEG, PNG and WebP (`UNSUPPORTED_FORMAT`) and sizes over 10 MiB (`FILE_TOO_LARGE`) before writing anything. It then writes `QUEUED` with `If-None-Match: *` and `sourceETag: null`, and only after that signs the PUT. `Content-Type` and `Content-Length` are part of the signature, so the browser must upload exactly the approved type and size. The status response leaves out `userId`, `sourceKey` and `sourceETag`. Errors use `{"error": {"code", "message"}}`, and an unknown or malformed job ID returns `404 JOB_NOT_FOUND`.

**Gallery and search (Phase 9, D21).** `GET /api/jobs` returns `{items, truncated}` ([`job-list.response.json`](contracts/api/job-list.response.json)). Each item has the same shape as the single-job status response. The API lists only `status/{authenticatedUser}/`, reads at most 100 valid status files, and skips malformed or identity-mismatched ones. It applies the stuck-job watchdog to each, sorts them by `updatedAt` (newest first), and then applies `label`, a case-insensitive substring match on label names (at most 64 characters). Last, it applies `limit` (default 25, 1–100). `truncated: true` means the user has more than 100 jobs, so older ones aren't searched. A bad `limit` or `label` returns `400 INVALID_REQUEST`. The response is `Cache-Control: no-store` because it contains presigned thumbnail URLs.

**Authentication (Phase 7, D5).** Signup and login take `{username, password}` ([`auth-credentials.request.json`](contracts/api/auth-credentials.request.json)) and return `{tokenType: "Bearer", accessToken, expiresAt, user: {id, username}}` ([`auth-token.response.json`](contracts/api/auth-token.response.json)). Usernames are 3–32 letters, digits or `_` and are case-insensitive (stored lowercase). Passwords are 8–72 characters and stored only as BCrypt hashes in the PostgreSQL `users` table. The access token is an HS256 JWT signed with `MP_JWT_SECRET`, issuer `media-pipeline`, valid for 60 minutes, with no refresh token. Its subject is `users.id`, a server-generated UUID, and that is the `{userId}` in every S3 key. Every other endpoint needs `Authorization: Bearer <token>`. Errors: `400 INVALID_REQUEST`, `409 USERNAME_TAKEN`, `401 INVALID_CREDENTIALS` (the same for an unknown user and a wrong password), and `401 UNAUTHORIZED` for a missing, expired or forged token. The React app keeps the token in `sessionStorage`.

**Notifications (Phase 8, D19).** Creating `results/{userId}/{jobId}.json` makes S3 publish its event to the results SNS topic. An operator with temporary Academy credentials runs `bash scripts/subscribe-user-notifications.sh {userId}`, enters the email interactively, and confirms the AWS email. The creation request includes the exact `results/{userId}/` message-body filter; rerunning the helper after confirmation reapplies it with a fail-closed update sequence. Neither the backend nor EC2 or Lambda runtime roles publish to or manage SNS. Do not process uploads during subscription setup or for up to 15 minutes afterward while the SNS filter policy propagates.

## 8. Security design

- The media bucket blocks all public access, disables ACLs with bucket-owner enforcement, uses S3-managed encryption, and rejects insecure transport.
- Presigned URLs expire in five minutes, authorize one exact key, and are returned only after the backend authorizes the user.
- Browser CORS allows only configured origins and the minimum required methods and headers.
- Original images and results remain private. The backend provides short-lived GET URLs after checking ownership.
- Validation enforces byte size, decoded format, dimensions, and safe key syntax. Thumbnail re-encoding removes EXIF and embedded metadata.
- Logs contain job IDs and safe error codes, not credentials, presigned URLs, image bytes, tokens, or personal email addresses.
- Subscription email addresses are entered only at the operator prompt and are never written to `.env`, logs, command arguments, or the repository.
- The SNS topic policy permits only S3 `Publish` from the exact media-bucket ARN and current AWS account; subscriber filters are exact user-result prefixes.
- Secrets and temporary Academy credentials stay in local untracked files. They are never placed in Lambda environment variables or committed.
- The Academy-provided roles are broader than ideal. This is a documented sandbox exception; separate per-owner buckets and strict application-level prefix checks reduce exposure.
- CDK synthesis fails CI if a template contains `AWS::IAM::Role` or `AWS::EC2::NatGateway`.
- Analyze accepts only fixed trusted model keys, binds source reads to Validate's ETag, uses conditional writes, and never replaces a result or regresses a terminal status.
- The restricted-label policy demonstrates auditable moderation for weapons, alcohol, and tobacco labels. It is not presented as general NSFW detection or a production safety classifier.

## 9. Failure handling

- Permanent validation failures: write `FAILED` with `UNSUPPORTED_FORMAT`, `FILE_TOO_LARGE`, `INVALID_IMAGE`, or another stable code; do not retry.
- Temporary AWS/runtime failures: raise the error and let asynchronous Lambda retry.
- Duplicate and overlapping events: use ETag-bound reads plus conditional writes; accept matching existing artifacts and never overwrite outputs or regress a later status.
- Stuck jobs (D18): when `GET /api/jobs/{id}` reads a job that has been in a non-final state longer than `mp.stale-after.*` (15 minutes by default), the API writes `FAILED` with `If-Match` on the ETag it read. A job stuck in `QUEUED` gets `UPLOAD_NOT_RECEIVED`; one stuck in `VALIDATING`, `READY_FOR_ANALYSIS` or `ANALYZING` gets `PROCESSING_TIMEOUT`. If a Lambda changes the status first, the write fails and the API re-reads; `FAILED` from the watchdog likewise makes a late Lambda's own `If-Match` write fail, so the final state never changes twice. The check runs only when a job is read; there is no background sweep.
- Operators diagnose unexpected failures with CloudWatch logs using the job ID.

## 10. Cost and lifecycle

S3, Lambda, logs, and SNS may remain deployed at class-scale usage. EC2, RDS, and ALB are deployed only for work or demonstrations and are stopped or destroyed afterward. The project source, documentation, tests, and CDK code remain in Git permanently so the complete system can be redeployed for portfolio demonstrations.

No automatic task deletes the project after grading.
