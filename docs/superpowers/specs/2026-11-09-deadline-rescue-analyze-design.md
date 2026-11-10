# Deadline-Rescue Analyze Stage Design

## Intent

Complete the missing AWS pipeline stage before the November 16 final presentation. A successful upload must move from validation into image classification, produce a result document, finish as `COMPLETE` or `FLAGGED`, and remain compatible with the AWS Academy sandbox.

## Goals

- Add an S3-triggered Python 3.12 Analyze Lambda for `stage/analyze/` manifests.
- Run a lightweight ONNX image classifier and return ranked labels.
- Apply a clearly documented label-based moderation policy for the class demonstration.
- Preserve per-user isolation, immutable job identity, idempotency, and terminal-state protection.
- Wire the stage through CDK without creating IAM roles or a NAT Gateway.
- Let the existing API and React page continue polling through `ANALYZING` and display final labels or a flagged state.

## Non-goals for this deadline slice

- RDS, JWT signup/login, label search, ALB, Auto Scaling, or CloudFront.
- General-purpose or production-grade NSFW detection.
- Model training or committing model binaries to the public repository.
- Automatic recovery from a permanently missing model asset.

## Architecture

1. Validate writes `stage/analyze/{userId}/{jobId}.json` only after the thumbnail exists.
2. S3 invokes Analyze for that prefix.
3. Analyze validates the manifest and binds the job to the same source key and ETag.
4. Analyze conditionally changes `READY_FOR_ANALYSIS` to `ANALYZING`.
5. Analyze downloads the source with `If-Match`, loads a fixed model and label file from trusted `models/` keys, and runs ONNX inference.
6. Analyze creates `results/{userId}/{jobId}.json` and conditionally publishes `COMPLETE` or `FLAGGED`.
7. Duplicate events accept only a result from the same immutable source. Later or terminal states cannot be regressed.

The initial classifier target is SqueezeNet 1.1 because its model is small enough for Lambda. Its top labels provide image tags. Moderation is a demonstration policy: configured restricted-label groups such as weapons, alcohol, and tobacco cause `FLAGGED` only when a matching label exceeds the configured confidence threshold. The UI and documentation must call this “restricted-label moderation,” not comprehensive safety or NSFW detection.

## Security constraints

- Continue using the imported `lambda-run-role`; Analyze may call S3 and CloudWatch Logs only.
- Do not create IAM roles, policies, a VPC, or a NAT Gateway.
- Accept only the expected bucket and `stage/analyze/{user}/{uuid}.json` key format.
- Reject manifest fields whose user, job, source, thumbnail, or status keys do not match the event-derived identity.
- Use fixed `models/` keys supplied by Lambda environment variables; user input never chooses a model path.
- Use ETag-bound source reads and conditional S3 writes.
- Never overwrite `COMPLETE`, `FLAGGED`, or `FAILED`.
- Treat malformed input as permanent failure; raise unexpected AWS/runtime errors so Lambda retry remains available.
- Do not log image bytes, presigned URLs, credentials, account IDs, or personal email addresses.

## Result behavior

- At most five labels are returned, ordered by confidence.
- Labels below the configured minimum confidence are omitted.
- `SAFE` produces `COMPLETE`; a restricted label above the moderation threshold produces `FLAGGED` with matching policy categories.
- The result records the source key, source ETag, thumbnail key, model version, label confidences, moderation verdict, and completion time.

## Deadline fallbacks

- Tests inject a fake analyzer; the real model binary remains a separately uploaded S3 deployment asset.
- If RDS/JWT is unfinished, retain the existing demo user while preserving user-scoped S3 keys.
- If CloudFront/ALB is unfinished, run the React/Spring application through the simplest working deployment path.

## Approaches considered

1. **Full original roadmap:** strongest final architecture but too large for the remaining week.
2. **Deadline-rescue vertical slice:** selected; proves the cloud pipeline and security story while keeping later portfolio expansion possible.
3. **Portfolio-first rebuild:** cleaner long-term work but would miss the class deadline.

