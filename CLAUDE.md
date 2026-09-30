# CLAUDE.md

Shared context for Claude Code sessions in this repo.

## Project
An event-driven image pipeline on AWS for a class project (Efren + Fahad, working async in separate sandboxes). Users upload photos directly to S3. The upload automatically goes through Validate (type/size, thumbnail) and then Analyze (self-hosted AI tagging + moderation). Each stage hands off through S3, writes a status JSON, and ends in an email and a status dashboard.

## Where things are
- **Start here:** the "Current focus" block at the top of `ROADMAP.md`, then the active phase plan in `docs/plans/` (its Tasks and Progress log).
- Session routine: `/start-session` and `/wrap-up` (`.claude/commands/`), also described in SETUP.md §8.
- Why things are the way they are: `docs/decisions.md`.
- Data contracts and shared test data: `docs/contracts/`.
- Environment, sandbox findings, cost rules and team workflow: `SETUP.md`.
- Design: `docs/media_pipeline.md`. Proposal: `docs/project_proposal.md`.

## Layout
- `backend/`: Spring Boot, Java 21
- `frontend/`: React, Node 20
- `lambdas/`: Python 3.12, one folder per stage
- `infra/`: AWS CDK
- `docs/`: design, decisions, contracts, plans

## Sandbox rules (hard constraints; see SETUP.md §4–§5)
We deploy into an **AWS Academy sandbox with read-only IAM**. Code that breaks these rules will fail to deploy or fail at runtime.
- **Never create IAM roles or policies.** There is no `LabRole`. Use only the existing roles:
  - `lambda-run-role` for **every Lambda**. It allows only `s3:GetObject`, `s3:PutObject` and logs.
  - `myS3Role` instance profile for **EC2**. It allows only `s3:*`.
- **Lambda code may call S3 only.** No DynamoDB, Rekognition, SNS or SQS calls. Lambdas stay outside a VPC.
- **Blocked services:** Step Functions, SES, Cognito, API Gateway, SQS. DynamoDB and Rekognition are also unusable from our roles.
- **Notifications:** S3 `results/<user>/...` → SNS (topic policy + per-user filter). The backend can't publish to SNS.
- **CDK:**
  - no `cdk bootstrap`; use `CliCredentialsStackSynthesizer`
  - import roles with `Role.fromRoleName(..., { mutable: false })`
  - no `autoDeleteObjects`, `addEventNotification`, `BucketDeployment` or `logRetention`; use L1 constructs instead
  - `cdk synth` must contain no `AWS::IAM::Role`
- **Naming:** read `MP_OWNER` from `.env`. The stack is `MediaPipeline-<owner>`, buckets are `mp-<owner>-<purpose>-<accountId>`, and other resources are `mp-<owner>-<name>`. Never hardcode an account ID.

## Cost rules ($20 budget per sandbox)
- **Never create a NAT Gateway.** Use the default VPC, or `natGateways: 0`.
- Use the smallest sizes only: t3.micro, db.t3.micro, 20 GB gp2, single-AZ.
- EC2, RDS and the ALB are stopped or destroyed at the end of every session. Don't design anything that must run 24/7.

## Public repo
This repo is **public**. Never write credentials, AWS account IDs, lab user IDs or personal emails into any file. Real values go in the untracked `.env`.

## Conventions
- Branches: `feat|fix|docs/<area>-<desc>`. Conventional Commit messages. Never push to `main`; every PR needs the partner's approval.
- Contracts: changing anything in `docs/contracts/` means updating `docs/media_pipeline.md` in the same PR.
- Definition of done: SETUP.md §6 (tests for the area, linters clean, CI green, docs updated).
- Keep the UI simple and functional. Put the effort into the pipeline and AWS pieces.
- Follow the decisions in `docs/decisions.md` and the current phase plan. If a change conflicts with them, flag it; don't work around it.
- In `ROADMAP.md` Current focus, only edit the block of the person you're working with.
