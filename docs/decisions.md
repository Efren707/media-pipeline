# Decision log

The "why" behind significant design and process choices. Add new entries at the bottom and never delete old ones. If a decision changes, add a new entry that says which one it replaces.

**Format:** decision · date · why · alternatives considered.

Most of D1–D8 come from the sandbox service tests in [SETUP.md §4](../SETUP.md#4-sandbox-test-results-tested-2026-09-30). In short: code running on AWS can only use pre-made roles that allow S3 (plus logs), and several services are blocked.

---

### D1: No Step Functions; stages hand off through S3
- **Date:** 2026-09-30
- **Why:** `states:CreateStateMachine` is denied in the sandbox. Each stage writes an S3 object (e.g. `stage/analyze/{job}.json`) that triggers the next stage's Lambda. That needs only `s3:GetObject`/`PutObject`, which `lambda-run-role` allows.
- **Alternatives:** Step Functions (blocked); EventBridge-chained Lambdas (EventBridge works, but Lambda can't call `PutEvents` with its role); a single monolithic Lambda (loses the per-stage retry and status story).

### D2: Self-hosted image model (ONNX) instead of Rekognition
- **Date:** 2026-09-30
- **Why:** Rekognition works from our personal login but is denied for `lambda-run-role` and `myS3Role`. An ONNX model running inside Lambda (weights in S3, runtime in a layer) needs no extra permissions. Lambda accepts 3008 MB memory and 2 GB of `/tmp`.
- **Alternatives:** putting personal lab credentials into Lambda config (expire every session, bad practice); calling Rekognition from EC2 (same role problem).

### D3: Job status as JSON in S3; users and labels in RDS, not DynamoDB
- **Date:** 2026-09-30
- **Why:** DynamoDB is denied for both roles. Lambdas can write `status/{job}.json` to S3. RDS PostgreSQL authenticates with a username and password, not IAM, so Spring Boot can use it.
- **Alternatives:** DynamoDB (blocked for our roles); keeping everything in S3 (fine for status, weak for user accounts and search).

### D4: Email via S3 → SNS with per-user filter policies, instead of SES
- **Date:** 2026-09-30
- **Why:** SES is denied. S3 can publish to an SNS topic through a topic policy, with no role needed. A subscription filter (`FilterPolicyScope: MessageBody`, prefix `results/<user>/`) emails each user only their own jobs. Tested and working.
- **Alternatives:** SES (blocked); Lambda publishing to SNS (role denies it); SMTP from app code (credentials to manage).

### D5: Spring Security + JWT instead of Cognito
- **Date:** 2026-09-30
- **Why:** `cognito-idp:CreateUserPool` is denied.
- **Alternatives:** Cognito (blocked). The fallback if we're behind: built-in demo accounts (see ROADMAP fallbacks).

### D6: Spring Boot on EC2 behind an ALB instead of API Gateway
- **Date:** 2026-09-30
- **Why:** API Gateway create is denied. EC2 + ELB are allowed, and EC2 gets S3 access through the `myS3Role` instance profile (tested), so no keys are stored.
- **Alternatives:** API Gateway (blocked); Lambda function URLs for the API (the Lambda role can't reach RDS or DynamoDB).

### D7: Lambda auto-retry + a watchdog instead of SQS
- **Date:** 2026-09-30
- **Why:** SQS is denied. S3 → Lambda invocations are async and retried automatically (confirmed in the logs). Lambda failure destinations would need permissions the role lacks, so a Spring Boot watchdog marks jobs stuck too long as `Failed`.
- **Alternatives:** SQS + dead-letter queue (blocked); on-failure destinations (role lacks permissions).

### D8: CDK with `CliCredentialsStackSynthesizer` and existing roles only
- **Date:** 2026-09-30
- **Why:** IAM is read-only and there's no `LabRole`, so the default `cdk bootstrap` can't create its roles. CloudFormation can deploy a Lambda using `lambda-run-role` (tested). Every construct that would create a role is avoided (see SETUP §5).
- **Alternatives:** AWS CLI scripts (less reproducible); SAM (same role constraints, less flexible).

### D9: Build the full scope, with ordered fallbacks
- **Date:** 2026-09-30
- **Why:** Claude Code speeds up the app code, so we aim for the full design. If a milestone is missed, we simplify using the ordered fallback list in ROADMAP instead of letting the schedule slip.
- **Alternatives:** building only the minimum version from the start (safer, but less ambitious).

### D10: Five milestones around the class dates
- **Date:** 2026-09-30
- **Why:** The class sets Oct 19 (checkpoint) and Nov 16 (presentation). We added Oct 5 (Foundation), Nov 1 (Core pipeline) and Nov 10 (Feature complete), so we never go more than ~2 weeks without a check.
- **Alternatives:** only the 3 class dates (3-week gap between checkpoint and feature complete); weekly milestones (too much overhead for async work).

### D11: Public repo with branch protection; async collaboration
- **Date:** 2026-09-30
- **Why:** Branch protection is free on public repos. Secret scanning + push protection guard against leaked credentials. We work async, so planning happens in PRs and "Current focus" in ROADMAP is the coordination point.
- **Alternatives:** a private repo with no enforcement; weekly meetings.

### D12: $20-per-sandbox cost rules
- **Date:** 2026-09-30
- **Why:** Each sandbox has a $20 budget. EC2 + RDS + ALB running 24/7 costs about $1.20/day. Costly resources run only during sessions, NAT Gateways are banned, and we use the smallest instance sizes.
- **Alternatives:** leaving resources running (the budget would run out in ~2.5 weeks).

### D13: User-scoped status keys and idempotent validation
- **Date:** 2026-10-13
- **Why:** `status/{userId}/{jobId}.json` lets the backend enforce per-user access consistently. S3 can deliver an event more than once, so Validate compares the source ETag and uses deterministic output keys before doing duplicate work.
- **Alternatives:** global `status/{jobId}.json` keys (harder to reason about user isolation); random output keys (duplicates accumulate on retries).

### D14: Keep the portfolio code; deploy paid resources on demand
- **Date:** 2026-10-13
- **Why:** The source, tests, and CDK are useful for resumes and continued learning. Automatic deletion after grading would remove that value. Guarded scripts can destroy deployed resources and demo data when desired without deleting the repository.
- **Alternatives:** automatically delete the whole project after grading; leave every AWS resource running continuously.

### D15: Conditional S3 writes and immutable job IDs
- **Date:** 2026-10-13
- **Replaces:** the duplicate-handling implementation described in D13; user-scoped status keys remain unchanged.
- **Why:** `lambda-run-role` has object read/write access but no `s3:ListBucket`, so probing for a missing status object can return `AccessDenied` instead of a reliable not-found result. Validate now downloads the source with its inspected ETag, conditionally claims an eligible job as `VALIDATING` before creating outputs, creates artifacts with `If-None-Match: *`, and updates status with `If-Match`. The manifest is created before `READY_FOR_ANALYSIS`, later states cannot be overwritten, and a job ID is bound to one source key and ETag.
- **Alternatives:** grant `s3:ListBucket` (the Academy role cannot be changed); accept last-writer-wins updates (can regress `COMPLETE`); reuse a job ID for replacement bytes (can mix artifacts from different uploads).
