# Demo-First Project Completion Design

**Date:** 2026-11-10
**Status:** Approved
**Owners:** Fahad and Efren
**Target:** A reliable final demonstration by 2026-11-16

## Intent

Finish the Media Pipeline as a secure, affordable AWS class project and a reusable portfolio project. The final demonstration must show a signed-in user uploading an image, watching the event-driven pipeline finish, receiving a filtered completion email, and finding the processed image in a gallery by label. The application code remains in Git after grading; only optional paid AWS resources are removed after a work or demo session.

## Current baseline

Phases 1–7 are already merged on `main`:

- private direct-to-S3 uploads;
- Validate and Analyze Lambdas with retry-safe conditional S3 writes;
- SqueezeNet labels and restricted-label moderation;
- terminal failure handling and a stuck-job watchdog;
- PostgreSQL users, BCrypt passwords, JWT login, and per-user isolation;
- live AWS evidence for the image pipeline and RDS authentication.

The completion work starts from commit `8667620` on `origin/main`. The local baseline has 18 passing frontend tests, 29 passing Lambda/script tests, 14 passing CDK tests, and seven valid shared contract examples. Backend verification remains a GitHub CI responsibility in this environment because Maven Central is unavailable here.

## Goals

1. Send completion email through S3 → SNS with one confirmed, user-filtered email subscription.
2. Restore a user's jobs after login and provide a thumbnail gallery with label search.
3. Run the Spring Boot API and React production build on one `t3.micro` EC2 instance connected to a temporary `db.t3.micro` PostgreSQL database.
4. Keep passwords, JWT secrets, AWS credentials, private media, and presigned URLs out of Git and logs.
5. Provide repeatable deploy, smoke-test, cost-check, and teardown commands.
6. Produce final diagrams, evidence, a short demo script, slides, and a recorded-demo checklist.

## Non-goals

- General NSFW detection. Moderation remains the documented restricted-label demonstration.
- A production multi-tenant SaaS deployment.
- Password reset, refresh tokens, roles, administration, or social login.
- A public, always-on website.
- Automatic deletion of the repository or portfolio materials.

## Anti-goals

- Do not store AWS credentials, database passwords, JWT secrets, account IDs, personal email addresses, or presigned URLs in the repository.
- Do not weaken user isolation to simplify gallery or email behavior.
- Do not create IAM roles, a NAT Gateway, or services blocked by AWS Academy.
- Do not leave EC2, RDS, or other paid demo resources running after a session.
- Do not describe the restricted-label classifier as a complete safety or NSFW system.

## Constraints

- AWS Academy provides read-only IAM. Lambda uses `lambda-run-role`; EC2 uses the existing `myS3Role` instance profile.
- Lambda may call S3 only. The backend role can use S3 but cannot create or publish SNS messages.
- SQS, SES, Cognito, API Gateway, Step Functions, and Rekognition are unavailable for this project.
- The budget is $20 per sandbox. EC2 and RDS are opt-in and temporary.
- The final presentation is scheduled for 2026-11-16.

## Approaches considered

### 1. Demo-first completion — selected

Use an operator-run SNS subscription script, filter gallery results from the user's S3 prefix, and deploy a single EC2 host with temporary RDS. Access the demo through an SSH tunnel. This completes the product story with the lowest permission, cost, and deadline risk.

### 2. Full original architecture

Add an ALB, Auto Scaling, CloudFront, a separate frontend bucket, and RDS label indexing. This is closer to a production topology but adds cost, security-group complexity, certificate/domain questions, and several new failure points before the presentation.

### 3. Freeze features and prepare the current system

Keep Phases 1–7 and work only on evidence and presentation material. This is reliable but leaves the proposal's email and searchable gallery experience incomplete.

The team selected approach 1 because it preserves the important cloud, security, and user-facing behavior while using the roadmap's documented fallbacks.

## Final architecture

### Request and processing path

1. The browser reaches Nginx on EC2 through an encrypted SSH tunnel.
2. Nginx serves the React build and proxies `/api` to Spring Boot on EC2 loopback.
3. Spring Boot authenticates the user against PostgreSQL and issues a short-lived JWT.
4. Spring Boot creates a user-scoped `QUEUED` status and returns a five-minute presigned S3 PUT URL.
5. S3 invokes Validate for `uploads/`; Validate writes the thumbnail and Analyze manifest.
6. S3 invokes Analyze for `stage/analyze/`; Analyze writes the immutable result and terminal status.
7. The result object triggers SNS directly. SNS forwards the event only to the confirmed subscription whose payload filter matches that user's `results/{userId}/` prefix.
8. The browser polls job status and refreshes the user's gallery.

### Deployment topology

- The CDK stack keeps the existing private media bucket and two Lambdas.
- An opt-in SNS topic and topic policy support S3 notifications. The topic itself is inexpensive and may remain with the base stack.
- An opt-in `t3.micro` EC2 instance uses the existing `myS3Role` instance profile.
- EC2 accepts SSH only from one detected developer IPv4 `/32`. Application ports are not public.
- An opt-in `db.t3.micro` PostgreSQL instance is private when deployed with EC2 and accepts port 5432 only from the EC2 security group.
- The user opens the application locally with an SSH port forward, such as `localhost:8080` to EC2 port 80.

## Phase 8: filtered email notification

### Infrastructure

- Add an SNS topic, S3-compatible topic policy, and an S3 `results/` notification to CDK using L1 resources so no IAM role is created.
- Keep Lambda out of the notification path. Analyze only writes the result to S3.
- Add CDK tests for the topic, policy, result-prefix notification, and absence of IAM roles.

### Subscription workflow

- Add a guarded script that takes an email address and the signed-in user's UUID, creates an email subscription, and sets `FilterPolicyScope=MessageBody` with the already sandbox-tested result-key prefix policy.
- The operator runs the script with temporary Academy credentials. The user confirms the AWS email before the demo.
- The script never writes the email address into a tracked file or log beyond the immediate console confirmation.
- Because the EC2 role cannot manage SNS, signup will not pretend to auto-subscribe. The UI may display a neutral note that email notifications require a confirmed demo subscription.

### Acceptance

- Alice receives the S3 completion event for Alice's result.
- Bob's confirmed subscription does not receive Alice's result.
- Cancelled or unconfirmed subscriptions do not block image processing.

## Phase 9: gallery and label search

### Backend

- Add `GET /api/jobs` with optional `label` query text and a bounded response `limit` (default 25, maximum 100).
- Derive the S3 prefix exclusively from the authenticated JWT user ID: `status/{userId}/`.
- List only that prefix, read and validate each status document, apply the watchdog when needed, attach a result only for valid terminal jobs, and issue short-lived thumbnail URLs.
- Sort by `updatedAt` descending. Apply a case-insensitive label substring filter in Spring Boot. This is the roadmap's S3-filtering fallback; no RDS search table is introduced for the deadline build.
- Ignore malformed or identity-mismatched objects and log only the safe object key suffix/job ID.
- Scan the authenticated user's status prefix across S3 pages, but stop after 100 valid jobs. Sort that bounded set by `updatedAt`, apply the optional label filter, and then apply the response limit. This makes the class/demo history complete while preventing an unbounded request.
- Do not add a continuation-token API in the deadline build. If a user has more than 100 valid jobs, return `truncated: true`; ordering and search are explicitly limited to the scanned 100. Cursor pagination or an RDS job index is a documented portfolio follow-up.

### API contract

`GET /api/jobs?label=dog&limit=25` returns:

```json
{
  "items": [
    {
      "jobId": "...",
      "state": "COMPLETE",
      "thumbnailUrl": "...",
      "updatedAt": "...",
      "result": { "modelVersion": "...", "labels": [], "moderation": {} },
      "error": null
    }
  ],
  "truncated": false
}
```

The response is `Cache-Control: no-store` because it contains presigned URLs.

### Frontend

- Load the gallery after login so jobs survive a refresh or new browser session.
- Show terminal and in-progress jobs in one responsive grid.
- Poll non-terminal jobs and replace their gallery entries as state changes.
- Add a debounced label search field, empty-state messages, retry behavior, and accessible status text.
- Never carry one user's gallery across logout/login.

### Acceptance

- Alice cannot list or fetch Bob's jobs even when Alice knows a Bob job ID.
- Refreshing after login restores Alice's jobs.
- Searching a displayed label returns the matching image and omits nonmatching images.
- Failed and flagged jobs are clearly represented without exposing internal errors.

## Phase 10: single-host AWS deployment

### Infrastructure

- Add opt-in `withServer=true` CDK resources: one `t3.micro` Amazon Linux 2023 instance, the existing `myS3Role` instance profile, and a security group allowing SSH only from one `/32`.
- When the server and database are deployed together, make RDS non-public and allow PostgreSQL only from the EC2 security group.
- Do not open ports 80 or 8080 to the internet. Use SSH tunneling for the demo.
- Parameterize the existing EC2 key-pair name. Do not commit a private key.

### Application packaging

- Build React with Vite.
- Package the Spring Boot executable JAR.
- Upload versioned artifacts to the existing private CDK assets bucket or copy them over SSH.
- Install Java 21 and Nginx on EC2. Nginx serves the React build and proxies `/api` to Spring Boot on `127.0.0.1:8080`.
- Run Spring Boot as a systemd service under a non-root user.

### Secrets

- Store `MP_JWT_SECRET`, database URL, username, and password only in a root-readable EC2 environment file (`0600`) created during the guarded deployment step.
- Transfer the environment file through SSH/SCP; never place those values in user data, the synthesized template, command-line output, Git, or application logs.
- Keep RDS password input as the existing CloudFormation `NoEcho` parameter.

### Operations

- `scripts/deploy-demo.sh`: validate Academy identity, build/test, deploy opt-in resources, install artifacts/configuration, and print the SSH tunnel command.
- `scripts/demo-status.sh`: show stack, EC2, RDS, and estimated session exposure without printing secrets.
- `scripts/stop-demo.sh`: stop EC2 and RDS for a short pause when supported.
- `scripts/destroy-demo.sh`: remove EC2/RDS and demo data only after explicit confirmation; never delete source code.

### Acceptance

- Through the SSH tunnel, a fresh browser can sign up, log in, upload, observe status changes, see the final gallery result, and search a label.
- AWS credentials are not installed on EC2; S3 access comes from `myS3Role`.
- No database or application port is publicly reachable.
- A teardown check confirms that no EC2 or RDS demo resource remains running.

## Phase 11: testing and hardening

- Expand backend isolation, pagination/bounds, malformed-object, and search tests.
- Expand frontend gallery, polling, search, logout, and failure-state tests.
- Add CDK tests for SNS, EC2, private RDS ingress, opt-in behavior, no IAM roles, and no NAT Gateway.
- Add an end-to-end script: signup → create upload → PUT image → poll → gallery → search.
- Add a small bounded parallel test (three images) to demonstrate event-driven concurrency without a cost-heavy load test.
- Run the end-to-end flow twice in a fresh Academy session.
- Audit dependencies and verify that logs contain no credentials, tokens, passwords, emails, presigned URLs, or image data.

## Phase 12: final presentation package

- Update the architecture diagram to distinguish always-cheap resources from temporary demo resources.
- Create a five-minute presentation and a five-to-ten-minute demo script.
- Capture evidence for authentication isolation, valid/flagged/failed processing, filtered email, gallery search, CloudWatch logs, CI, and teardown.
- Record one backup demonstration before the live presentation.
- Include an honest limitations slide: Academy role constraints, operator-confirmed SNS email, S3-filtered search, restricted-label moderation, and SSH-tunneled demo access.

## Delivery sequence

1. Phase 8 SNS infrastructure and subscription script.
2. Phase 9 jobs/gallery/search API and UI.
3. Phase 10 opt-in EC2/private-RDS deployment and operations scripts.
4. Phase 11 end-to-end verification and hardening.
5. Phase 12 documentation, slides, evidence, and rehearsal.

Each phase is a small PR or clearly separated commit. CI must be green before merge. Live AWS checks require an active Academy session and are recorded without account IDs or secrets.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| SNS payload filtering differs from the previous manual test | Add a disposable two-user live check before relying on it in the demo. |
| Academy credentials expire mid-deploy | Validate the `voclabs` identity first, keep deploy steps resumable, and destroy paid resources promptly. |
| EC2 cannot download dependencies | Build artifacts on the developer machine/GitHub CI and transfer completed artifacts. |
| Default-VPC behavior differs between sandboxes | Fail deployment with a clear preflight message and keep the local-backend demo as a backup. |
| Search becomes slow with many S3 objects | Bound results to 100 and document that RDS indexing is a production follow-up. |
| Live demo network fails | Keep screenshots, test output, and a recorded end-to-end demonstration. |

## Completion definition

The project is complete when CI is green, the two-user isolation and notification checks pass, the full flow works twice through the EC2 SSH tunnel in a fresh Academy session, paid resources are verified removed afterward, and the final presentation package accurately demonstrates the system and its limitations.
