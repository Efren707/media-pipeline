# Roadmap

This is the high-level plan for building the Media Pipeline, one phase at a time. Each phase gets its own **planning session** before work starts. That session produces a detailed plan in [`docs/plans/`](docs/plans/README.md), linked from the table below.

## Current focus

> Update this at the end of every work session (`/wrap-up`). Read it first when starting one (`/start-session`). **Edit only your own block**, so parallel branches merge without conflicts.

**Active phase:** 3, Upload flow (built; waiting on CI and review) → next: Phase 4, Validate stage

#### Efren (updated 2026-10-14)
- **Working on:** Phase 3 done locally. Backend (`POST /api/uploads`, `GET /api/jobs/{id}`) and React upload page tested end to end against my sandbox; PR on `feat/backend-upload-flow`
- **Next:** get CI green and the PR reviewed; Phase 4 is mostly covered by Fahad's Validate Lambda, so agree what's left (live invalid-file test, Ruff in CI) and prep the Oct 19 demo
- **Blockers:** merges wait on Fahad's review

#### Fahad (updated 2026-10-13)
- **Working on:** secure M2 vertical slice: contracts, TypeScript CDK, and Validate Lambda
- **Next:** verify the AWS role check, deploy in the sandbox, and open the scaffold PR for Efren's review
- **Blockers:** AWS deployment must be run during an active Academy lab session

---

**Status legend:** ⬜ Not started · 📝 Planning · 🔨 In progress · ✅ Done

Dates are targets. Revisit them at each planning session. Owners are assigned during planning; see the suggested split in [SETUP.md §7](SETUP.md#7-milestones-and-ownership-proposal-confirm-together).

## Overview

### Milestones

| Milestone | Date | Phases | Proof it's done |
|---|---|---|---|
| **M1 Foundation** | Oct 5 | 0–1 | Repo live, both sandboxes verified, design approved |
| **M2 Checkpoint** (class) | Oct 19 | 2–4 | Demo: upload → validate → thumbnail + status on AWS |
| **M3 Core pipeline** | Nov 1 | 5–7 | AI tags + moderation, failure handling, login with RDS |
| **M4 Feature complete** | Nov 10 | 8–10 | Email, dashboard/gallery/search, full AWS deployment |
| **M5 Presentation** | Nov 16 | 11–12 | Tests, slides, rehearsed demo |

### Phases

| # | Phase | Milestone | Target | Owner | Status | Plan |
|---|---|---|---|---|---|---|
| 0 | [Repo & collaboration setup](#0-repo--collaboration-setup) | M1 | Oct 3 | Efren | 🔨 | n/a |
| 1 | [Design finalization](#1-design-finalization) | M1 | Oct 5 | Both | ✅ | [plan](docs/plans/01-design-finalization.md) |
| 🏁 | **M1 Foundation** | | **Oct 5** | | | |
| 2 | [Infrastructure foundation (CDK)](#2-infrastructure-foundation-cdk) | M2 | Oct 9 | Fahad | 🔨 | [plan](docs/plans/02-infrastructure-foundation.md) |
| 3 | [Upload flow](#3-upload-flow) | M2 | Oct 17 | Efren | 🔨 | [plan](docs/plans/03-upload-flow.md) |
| 4 | [Validate stage](#4-validate-stage) | M2 | Oct 16 | Fahad | 🔨 | [plan](docs/plans/04-validate-stage.md) |
| 🏁 | **M2 Checkpoint**: upload → validate → thumbnail + status | | **Oct 19** | | | |
| 5 | [Analyze stage (AI)](#5-analyze-stage-ai) | M3 | Oct 26 | TBD | ⬜ | n/a |
| 6 | [Failure handling & retries](#6-failure-handling--retries) | M3 | Oct 29 | TBD | ⬜ | n/a |
| 7 | [Auth & users](#7-auth--users) | M3 | Nov 1 | TBD | ⬜ | n/a |
| 🏁 | **M3 Core pipeline** | | **Nov 1** | | | |
| 8 | [Notifications](#8-notifications) | M4 | Nov 3 | TBD | ⬜ | n/a |
| 9 | [Status dashboard, gallery & search](#9-status-dashboard-gallery--search) | M4 | Nov 7 | TBD | ⬜ | n/a |
| 10 | [Cloud deployment](#10-cloud-deployment) | M4 | Nov 9 | TBD | ⬜ | n/a |
| 🏁 | **M4 Feature complete** | | **Nov 10** | | | |
| 11 | [Testing & hardening](#11-testing--hardening) | M5 | Nov 12 | Both | ⬜ | n/a |
| 12 | [Presentation prep](#12-presentation-prep) | M5 | Nov 15 | Both | ⬜ | n/a |
| 🎤 | **M5 Final presentation** | | **Nov 16** | | | |

**Working in parallel:** after Phase 4, Phase 7 (backend/auth) can run alongside Phases 5–6 (Lambdas), because they touch different folders.

## Scope & fallbacks

We're building the **full scope** described in the phases below. If we miss a milestone's proof, we simplify the upcoming phases using the fallbacks here, instead of letting the schedule slip.

**Core (never cut):** direct-to-S3 upload, S3-driven pipeline, validation, thumbnail, AI tagging, moderation, status tracking, retries + `Failed` status + watchdog, status dashboard + gallery, per-user separation, completion email, CDK, running on AWS.

**Fallbacks** (apply in this order if behind):

| # | Full scope | Fallback | Phase |
|---|---|---|---|
| 1 | Load test + cost check | One end-to-end script | 11 |
| 2 | S3 + CloudFront frontend | Spring Boot serves the React build | 10 |
| 3 | ALB + Auto Scaling | Single EC2 instance | 10 |
| 4 | Signup auto-subscribes SNS email | Subscription script for demo users | 8 |
| 5 | RDS label search | Filter S3 results in Spring Boot, or drop search | 9 |
| 6 | RDS + JWT signup/login | Built-in demo accounts | 7 |

**Schedule rule:** at each milestone date, check its proof. If it isn't met, pick fallbacks for the next milestone's phases at the next planning session.

**Extended goals** (beyond scope; only if well ahead): real-time push updates (SSE/WebSocket), extra stages (EXIF stripping, face blur, OCR), WebP / multiple thumbnail sizes, CloudWatch dashboard, video support, friendlier emails via an EventBridge input transformer.

## How each phase works

We work **async**, with no fixed meetings. A planning session is a pull request.

1. **Plan:** the phase owner copies [`docs/plans/_template.md`](docs/plans/_template.md) to `docs/plans/NN-short-name.md`, fills it in, links it above, sets status to 📝 and opens a PR. The partner reviews and comments. **Merging the PR means the plan is approved.**
2. **Build:** set status to 🔨. Work on `feat/...` branches and open PRs that the partner reviews (see [SETUP.md §6](SETUP.md#6-collaboration-workflow)). Add a line to the plan's Progress log each session.
3. **Close:** check the "Done when" criteria, fill in the plan's Outcome notes and set status to ✅.

Record significant design choices in [`docs/decisions.md`](docs/decisions.md).

---

## Phases

### 0. Repo & collaboration setup
**Goal:** a shared repo both partners can work from, with a working sandbox setup.
- Initial commit; **public** GitHub repo `media-pipeline`; invite @Sefa256
- GitHub milestones M1–M5
- Branch protection on `main` (PR + 1 approval), secret scanning + push protection
- Both partners complete SETUP §1–3, including the role check in each sandbox

**Depends on:** nothing
**Done when:** both partners can clone, push a branch, open a PR, and run `aws sts get-caller-identity` in their own sandbox.

### 1. Design finalization
**Goal:** turn `docs/media_pipeline.md` into the agreed design, built on the sandbox findings.
- Final stage list and S3 key layout (`uploads/`, `stage/`, `status/`, `results/`, `thumbnails/`)
- Status JSON schema and state transitions (Queued → Validating → Analyzing → Complete/Failed/Flagged)
- API contract between React and Spring Boot
- Example contract files in `docs/contracts/` (status, result, API responses)
- Image model choice (tagging + moderation) and moderation policy

**Depends on:** 0
**Done when:** both partners approve the updated `docs/media_pipeline.md`.

### 2. Infrastructure foundation (CDK)
**Goal:** one command deploys the base AWS resources into a sandbox.
- CDK app with `CliCredentialsStackSynthesizer` and an assets bucket
- Media bucket, imported `lambda-run-role`, SNS topic with its topic policy
- S3 → Lambda and S3 → SNS notifications wired with L1 constructs
- Deploy and destroy scripts; synth check for no `AWS::IAM::Role`
- Resource names from `.env` (`MP_OWNER`); no NAT Gateway
- GitHub Actions CI started: `cdk synth` + IAM-role check on every PR

**Depends on:** 1
**Done when:** `cdk deploy` succeeds in both partners' sandboxes and a placeholder Lambda fires on upload.

### 3. Upload flow
**Goal:** a user can pick an image in the browser and it lands in S3.
- Spring Boot project skeleton with a presigned-URL endpoint
- React project skeleton with a simple upload page
- The job gets an ID and an initial `Queued` status
- Formatters (Spotless, Prettier + oxlint), Maven wrapper; backend tests + frontend build added to CI

**Depends on:** 1 (2 for a real bucket)
**Done when:** uploading from the React page creates `uploads/{user}/{job}.jpg` and a `Queued` status.

### 4. Validate stage
**Goal:** the first real pipeline stage.
- Lambda checks file type (magic bytes) and size
- Generates a thumbnail (Pillow layer)
- Writes status updates and triggers the Analyze stage via S3
- Invalid files are marked `Failed` with a reason
- Ruff + pytest (using `docs/contracts/` examples) added to CI

**Depends on:** 2, 3
**Done when:** a valid upload produces a thumbnail and a `Validating`/next-stage status; an invalid one ends as `Failed`.

### 5. Analyze stage (AI)
**Goal:** automatic tags and moderation with a self-hosted model.
- Pick and test ONNX models (tagging + NSFW/moderation)
- Package ONNX Runtime as a layer; keep the weights in S3, loaded on cold start
- Write `results/{user}/{job}.json` with labels, confidence and moderation verdict

**Depends on:** 4
**Done when:** test images get sensible labels, and a flagged image is marked `Flagged`.

### 6. Failure handling & retries
**Goal:** the pipeline recovers or fails clearly, and never silently.
- Separate permanent errors (fail immediately) from temporary ones (let Lambda retry)
- Every failure ends in a `Failed` status with a reason
- Spring Boot watchdog marks jobs stuck too long as `Failed`

**Depends on:** 4 (5 for full coverage)
**Done when:** forced failures at each stage end in the right status, which shows up in the UI or API.

### 7. Auth & users
**Goal:** real user accounts.
- Test RDS in the sandbox, then set up PostgreSQL
- Spring Security + JWT: sign up, log in, protected endpoints
- Uploads and results scoped to each user's S3 prefix

**Depends on:** 3
**Done when:** two users can log in and see only their own uploads.

### 8. Notifications
**Goal:** users get emailed when their upload finishes.
- An SNS email subscription with a per-user filter policy, created at signup
- Handle confirmation, since users must confirm the SNS subscription
- Stretch: friendlier email content

**Depends on:** 2, 7
**Done when:** a user gets an email for their own completed job and no one else's.

### 9. Status dashboard, gallery & search
**Goal:** the user-facing experience from the proposal.
- Live status per upload (polling the status API)
- Gallery of thumbnails and labels (presigned GET URLs)
- Label search, with results indexed into RDS

**Depends on:** 5, 7
**Done when:** a user watches an upload move through each stage, then finds it by searching a label.

### 10. Cloud deployment
**Goal:** the whole app runs on AWS, not just locally.
- Spring Boot on EC2 (`myS3Role`) behind an ALB, with Auto Scaling if time allows
- React build on S3 + CloudFront
- RDS reachable from EC2; deploy and teardown scripts

**Depends on:** 2, 9
**Done when:** the full demo works from the CloudFront URL in a fresh sandbox session.

### 11. Testing & hardening
**Goal:** confidence before the presentation.
- End-to-end test script (upload → complete)
- Bulk-upload test to show parallel scaling
- Cleanup scripts; cost and usage check

**Depends on:** 10
**Done when:** the end-to-end and bulk tests pass twice in a row in a fresh session.

### 12. Presentation prep
**Goal:** a clear, reliable demo.
- Architecture diagram, including the "why" behind the sandbox-driven choices
- Demo script and slides
- Recorded backup demo

**Depends on:** 11
**Done when:** a full rehearsal runs within the time limit.
