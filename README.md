# Media Pipeline

An event-driven, serverless image-processing pipeline on AWS. Users upload photos straight to S3. Each upload then moves through **validate → analyze → persist → notify** on its own, retries a stage when it fails, and reports live status to the user (Queued → Validating → Analyzing → Complete/Failed).

AWS Cloud Computing class project.

> **New here? Start with [SETUP.md](SETUP.md).**

## Documents

| Doc | Purpose |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Phases, targets and status; start here for "what's next" |
| [docs/project_proposal.md](docs/project_proposal.md) | Approved proposal: problem, audience, opportunity |
| [docs/media_pipeline.md](docs/media_pipeline.md) | Design and architecture (draft, being refined) |
| [docs/aws_academy_sandbox.md](docs/aws_academy_sandbox.md) | Services allowed in our AWS Academy sandbox |
| [docs/decisions.md](docs/decisions.md) | Decision log: why the design looks the way it does |
| [docs/contracts/](docs/contracts/README.md) | Data contracts + shared example files for tests and mocks |
| [SETUP.md](SETUP.md) | Environment setup, sandbox test results, cost rules, team workflow, session routine |
| [CLAUDE.md](CLAUDE.md) | Shared rules for Claude Code sessions (sandbox constraints, conventions) |

## Architecture (draft)

Designed around what our AWS Academy sandbox allows ([SETUP.md §4](SETUP.md#4-sandbox-test-results-tested-2026-09-30)). S3 is both the storage and the thing that moves each upload from one stage to the next.

```
React (S3 + CloudFront)
   │ login / request upload URL
   ▼
Spring Boot on EC2 + ALB (role: myS3Role) ── users + searchable labels ──▶ RDS PostgreSQL
   │ presigned PUT URL                          ▲ reads status/results from S3
   ▼                                            │
S3  uploads/{user}/{job}.jpg ──▶ λ Validate (type, size, thumbnail)
    stage/analyze/{job}.json ──▶ λ Analyze (self-hosted model: tags + moderation)
    results/{user}/{job}.json ──▶ SNS ──▶ email (filtered per user)
    status/{job}.json        ◀── every stage writes its status here
```

## Repo layout

```
backend/    Spring Boot API: auth, presigned URLs, status/list endpoints
frontend/   React app: upload, live status dashboard, gallery
lambdas/    Python Lambda functions for the pipeline stages
infra/      AWS CDK app that deploys everything
docs/       Proposal, design, sandbox constraints
```

## Team

| Member | GitHub |
|---|---|
| Efren | [@Efren707](https://github.com/Efren707) |
| Fahad | [@Sefa256](https://github.com/Sefa256) |

## Milestones

| Date | Milestone |
|---|---|
| **Oct 5, 2026** | M1 Foundation: repo live, sandboxes verified, design approved |
| **Oct 19, 2026** | M2 Checkpoint (class): upload → validate → thumbnail + status demo |
| **Nov 1, 2026** | M3 Core pipeline: AI tags + moderation, failure handling, login |
| **Nov 10, 2026** | M4 Feature complete: full app running on AWS |
| **Nov 16, 2026** | M5 Final presentation |

Phases and progress: [ROADMAP.md](ROADMAP.md).
