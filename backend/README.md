# backend/

Spring Boot API (Java 21). It runs locally during M2 and moves to EC2 behind an ALB with the `myS3Role` instance profile in Phase 10.

## Endpoints

| Method and path | What it does |
|---|---|
| `POST /api/uploads` | Body `{"contentType": "image/jpeg", "sizeBytes": 12345}`. Checks type (JPEG/PNG/WebP) and size (≤ 10 MiB), writes a `QUEUED` status, and returns a 5-minute presigned PUT URL for one exact key |
| `GET /api/jobs/{jobId}` | The caller's job status, with a short-lived thumbnail URL when one exists |

Errors always look like `{"error": {"code": "FILE_TOO_LARGE", "message": "..."}}`. Contracts: [`../docs/contracts/api/`](../docs/contracts/api/).

Until login exists (Phase 7), every request acts as `MP_DEMO_USER` (default `demo-user`). The user is never taken from the request.

## Run locally against your sandbox

You need an active lab session, the `sandbox` AWS profile and a deployed `MediaPipeline-<owner>` stack.

```bash
export AWS_PROFILE=sandbox
export MP_MEDIA_BUCKET=$(aws cloudformation describe-stacks --stack-name MediaPipeline-$MP_OWNER \
  --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" --output text)
./mvnw spring-boot:run          # http://localhost:8080
```

| Variable | Default | Purpose |
|---|---|---|
| `MP_MEDIA_BUCKET` | required | Stack output `MediaBucketName` |
| `AWS_REGION` | `us-east-1` | |
| `MP_DEMO_USER` | `demo-user` | Stand-in user until Phase 7 |

## Develop

```bash
./mvnw verify            # tests + Spotless check (what CI runs); no AWS needed
./mvnw spotless:apply    # format (google-java-format)
```
