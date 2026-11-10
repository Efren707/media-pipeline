# backend/

Spring Boot API (Java 21). It runs locally during M2 and moves to EC2 behind an ALB with the `myS3Role` instance profile in Phase 10.

## Endpoints

| Method and path | What it does |
|---|---|
| `POST /api/auth/signup` | Body `{"username": "alice", "password": "..."}`. Creates the account and returns `{tokenType, accessToken, expiresAt, user}` (`201`, or `409 USERNAME_TAKEN`) |
| `POST /api/auth/login` | Same body; returns a new token, or `401 INVALID_CREDENTIALS` |
| `POST /api/uploads` | Body `{"contentType": "image/jpeg", "sizeBytes": 12345}`. Checks type (JPEG/PNG/WebP) and size (≤ 10 MiB), writes a `QUEUED` status, and returns a 5-minute presigned PUT URL for one exact key |
| `GET /api/jobs/{jobId}` | The caller's job status, with a short-lived thumbnail URL when one exists |

Errors always look like `{"error": {"code": "FILE_TOO_LARGE", "message": "..."}}`. Contracts: [`../docs/contracts/api/`](../docs/contracts/api/).

Everything except signup and login needs `Authorization: Bearer <accessToken>`; without a valid token the API returns `401 UNAUTHORIZED`. The user is the token's subject (`users.id`), never taken from the request.

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
| `MP_JWT_SECRET` | required | 32+ random characters (`openssl rand -base64 48`); signs access tokens. Changing it logs everyone out |
| `MP_DB_URL` | `jdbc:postgresql://localhost:5432/mediapipeline` | `jdbc:postgresql://<DbEndpoint>:5432/mediapipeline?sslmode=require` for RDS ([infra README](../infra/README.md#optional-postgresql-phase-7)) |
| `MP_DB_USER` | `mpadmin` | |
| `MP_DB_PASSWORD` | empty | Same value as in `.env` |

Flyway applies `src/main/resources/db/migration` at startup, and Hibernate only validates the schema (`ddl-auto: validate`). To change the schema, add a new `V<n>__*.sql`; never edit one that has been applied.

## Develop

```bash
./mvnw verify            # tests + Spotless check (what CI runs); no AWS needed, Docker Desktop must be running
./mvnw spotless:apply    # format (google-java-format)
```
