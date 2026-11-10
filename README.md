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

## Architecture

Designed around what our AWS Academy sandbox allows ([SETUP.md §4](SETUP.md#4-sandbox-test-results-tested-2026-09-30)). S3 is both the storage and the thing that moves each upload from one stage to the next.

```
React (local Vite demo)
   │ request upload URL / poll job
   ▼
Spring Boot (local demo user; EC2 deployment deferred)
   │ presigned PUT URL                 ▲ reads status/results from S3
   ▼                                   │
S3  uploads/{user}/{job}.jpg       ──▶ λ Validate (type, size, thumbnail)
    stage/analyze/{user}/{job}.json ──▶ λ Analyze (self-hosted model: tags + moderation)
    results/{user}/{job}.json
    status/{user}/{job}.json        ◀── every stage writes its status here
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

## Current implementation (2026-11-09)

The deadline-rescue vertical slice is implemented:

- TypeScript CDK creates a private encrypted media bucket and imports the existing Academy Lambda role.
- `uploads/` and `stage/analyze/` S3 events invoke separate Python 3.12 Lambdas.
- Validate checks key syntax, byte size, true image format and decoded dimensions, creates a metadata-free thumbnail, and writes the next-stage manifest before publishing the ready status.
- Upload reads are bound to the event's source ETag, and conditional S3 writes make duplicate or concurrent events idempotent without requiring `s3:ListBucket`.
- Analyze runs SqueezeNet 1.1 through ONNX Runtime, returns the top labels, and applies a documented restricted-label review policy. It writes immutable results and terminal `COMPLETE` or `FLAGGED` status.
- The API reads result data only from the authenticated/demo user's exact result key. The React dashboard polls through `ANALYZING`, then shows labels, scores, and review categories.
- Twenty-seven Lambda tests cover validation, identity and ETag binding, duplicate events, terminal-state protection, model failures, labels, and moderation. Frontend and CDK tests cover the final UI and Academy-safe infrastructure.
- CI validates contracts, tests all components, synthesizes CDK, audits production Node dependencies, and rejects IAM-role or NAT-Gateway resources.

Live deployment and real-model evidence still require an active AWS Academy session. Follow [the Phase 5 runbook](docs/plans/05-analyze-stage.md).

The repository is intended to remain as a portfolio and skills-building project after grading. Optional teardown removes deployed AWS resources—not source code.
