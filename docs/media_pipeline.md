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
          | ObjectCreated event, prefix stage/analyze/ (Phase 5)
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
- Large Python dependencies use Lambda-compatible wheels or a layer. Model weights live in S3 and are loaded into `/tmp` during a cold start.

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
| `FAILED` | Backend or Lambda | A permanent error occurred or watchdog timed out | terminal unless a new upload replaces the source key |

Every status includes `schemaVersion`, `jobId`, `userId`, `state`, `sourceKey`, `sourceETag`, `updatedAt`, and an optional safe `error`. Timestamps use UTC ISO 8601. Error objects contain a stable code and a user-safe message, never a stack trace.

## 6. Validation stage

The Validate Lambda performs these checks before decoding the entire object:

1. Confirm the event bucket matches `MEDIA_BUCKET_NAME`.
2. Accept only keys matching `uploads/{userId}/{jobId}.{ext}`.
3. Read object metadata and reject files larger than `MAX_IMAGE_BYTES`.
4. Verify the decoded image and its true format; do not trust the filename or submitted content type.
5. Accept JPEG, PNG, and WebP only, require the encoded format to match the key extension, and reject decompression-bomb-sized dimensions.
6. Apply EXIF orientation, convert to RGB, and re-encode a JPEG thumbnail. This removes original metadata.
7. Write the deterministic thumbnail, status, and analyze manifest keys.

S3 events are delivered at least once. Before processing, the Lambda checks whether the same source ETag has already reached `READY_FOR_ANALYSIS` or a later state. Deterministic output keys make retries safe.

Permanent input errors write `FAILED` and return successfully so AWS does not retry a bad file. Unexpected AWS or runtime errors are raised so asynchronous Lambda retry can run.

## 7. API contract

The Spring Boot API is responsible for authentication, authorization, presigned URLs, status retrieval, gallery results, and the stuck-job watchdog.

Planned endpoints:

| Method and path | Purpose |
|---|---|
| `POST /api/uploads` | Authorize the user, generate a job ID, write `QUEUED`, and return a short-lived presigned PUT URL |
| `GET /api/jobs/{jobId}` | Return the authenticated user's status JSON |
| `GET /api/jobs` | List the authenticated user's jobs |
| `GET /api/gallery` | Return completed results and short-lived thumbnail URLs |

The API always derives the S3 user prefix from the authenticated account. A caller cannot choose another user's prefix. Example responses are in [`contracts/api/`](contracts/api/).

## 8. Security design

- The media bucket blocks all public access, disables ACLs with bucket-owner enforcement, uses S3-managed encryption, and rejects insecure transport.
- Presigned URLs expire in five minutes, authorize one exact key, and are returned only after the backend authorizes the user.
- Browser CORS allows only configured origins and the minimum required methods and headers.
- Original images and results remain private. The backend provides short-lived GET URLs after checking ownership.
- Validation enforces byte size, decoded format, dimensions, and safe key syntax. Thumbnail re-encoding removes EXIF and embedded metadata.
- Logs contain job IDs and safe error codes, not credentials, presigned URLs, image bytes, tokens, or personal email addresses.
- Secrets and temporary Academy credentials stay in local untracked files. They are never placed in Lambda environment variables or committed.
- The Academy-provided roles are broader than ideal. This is a documented sandbox exception; separate per-owner buckets and strict application-level prefix checks reduce exposure.
- CDK synthesis fails CI if a template contains `AWS::IAM::Role` or `AWS::EC2::NatGateway`.

## 9. Failure handling

- Permanent validation failures: write `FAILED` with `UNSUPPORTED_FORMAT`, `FILE_TOO_LARGE`, `INVALID_IMAGE`, or another stable code; do not retry.
- Temporary AWS/runtime failures: raise the error and let asynchronous Lambda retry.
- Duplicate events: detect the same ETag and skip work already completed.
- Stuck jobs: the later Spring Boot watchdog marks jobs that have not changed within the configured time as `FAILED` with `PROCESSING_TIMEOUT`.
- Operators diagnose unexpected failures with CloudWatch logs using the job ID.

## 10. Cost and lifecycle

S3, Lambda, logs, and SNS may remain deployed at class-scale usage. EC2, RDS, and ALB are deployed only for work or demonstrations and are stopped or destroyed afterward. The project source, documentation, tests, and CDK code remain in Git permanently so the complete system can be redeployed for portfolio demonstrations.

No automatic task deletes the project after grading.
