# Event-Driven Media Pipeline with AI Analysis

## Concept
Users upload images through a web app. The upload kicks off a multi-stage, serverless pipeline — orchestrated by AWS Step Functions — that validates the file, runs it through Amazon Rekognition for content analysis, stores the results, and notifies the user when it's done. The UI shows live status per upload (Queued → Validating → Analyzing → Complete/Failed) plus a searchable gallery of results.

## User flow
1. User logs in, drags an image onto the upload area.
2. Frontend requests a **pre-signed S3 URL** from the Spring Boot API, then uploads the file **directly to S3** (never routed through the app server — a real scalability lesson worth citing in interviews).
3. Upload triggers the pipeline automatically (via an EventBridge rule on the S3 `ObjectCreated` event, starting a Step Functions execution).
4. User watches the job's status update on a dashboard as it moves through the pipeline.
5. On completion, they see a thumbnail + detected labels/tags (and get an email notification). Failed jobs show what went wrong.

## Architecture (Step Functions state machine)
1. **Validate** (Lambda) — check file type/size, generate a thumbnail.
2. **Analyze** (Lambda) — call Rekognition `DetectLabels` / `DetectModerationLabels`.
3. **Persist** — write results to DynamoDB, ideally as a *direct Step Functions service integration* rather than another Lambda (cuts glue code, shows depth beyond "just wire Lambdas together").
4. **Notify** — SNS/SES email on success.
5. **Catch/Retry** — any state can fail (e.g. Rekognition throttling); retries with backoff, and a final `MarkFailed` state writes an error status to DynamoDB and still notifies the user.

## Tech stack
- **Backend:** Spring Boot — auth, presigned-URL issuance, status/list API reading from DynamoDB.
- **Frontend:** React.
- **AWS:** S3 (storage + event source), Lambda (validate/analyze), Step Functions (orchestration), Rekognition (AI analysis), DynamoDB (job/result store), SNS/SES (notifications), IAM (per-function least-privilege roles).
