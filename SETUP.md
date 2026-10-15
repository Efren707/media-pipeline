# Project Setup

Both partners should follow this guide once, before writing code. Sections 3 and 4 need an active AWS Academy sandbox session.

## 1. Prerequisites

Install these, then run the check command for each.

| Tool | Version | Check | Used for |
|---|---|---|---|
| Git | 2.40+ | `git --version` | Version control |
| JDK | 21 | `java -version` | Spring Boot backend |
| Node.js | 20+ | `node --version` | React frontend, AWS CDK |
| Python | 3.12 | `python --version` | Lambda functions (matches the Lambda runtime) |
| AWS CLI | v2 | `aws --version` | Talking to the sandbox |
| AWS CDK CLI | 2.x | `cdk --version` | Deploying infrastructure. Install with `npm install -g aws-cdk` |
| GitHub CLI | any (optional) | `gh --version` | PRs and issues from the terminal |

> Python 3.13+ also works locally, but write Lambda code for **3.12**, the runtime we deploy to.

## 2. Get the repo

1. Accept the GitHub collaborator invite (check your email or https://github.com/notifications).
2. Clone the repo:
   ```bash
   git clone https://github.com/Efren707/media-pipeline.git
   cd media-pipeline
   ```
3. Create your personal config (untracked):
   ```bash
   cp .env.example .env    # then set MP_OWNER (e.g. efren / fahad) and MP_EMAIL
   ```
4. Never commit to `main` directly (branch protection blocks it anyway). Start work on a branch (see §6):
   ```bash
   git switch -c feat/<area>-<short-description>
   ```

> ⚠️ **This repo is public.** Never commit credentials, AWS account IDs, lab user IDs, personal emails or `.env` files. GitHub secret scanning + push protection is on as a backstop, not as a substitute for checking `git diff --staged`.

## 3. AWS Academy sandbox access

We use the **AWS Academy Cloud Architecting 3 - Sandbox**. You and your partner each have a **separate sandbox account**, so each of you deploys your own copy of the stack.

**Quickest option: CloudShell.** Start the lab, open the AWS Console and click the `>_` CloudShell icon. It's already logged in, so you don't need local credentials.

**From your own machine:** sandbox credentials are temporary (they include a session token and expire when the lab session ends), so repeat these steps each session.

1. In AWS Academy, click **Start Lab**. Wait for the indicator to turn green.
2. Click **AWS Details → AWS CLI: Show**. Copy the whole `[default]` block.
3. Paste it into your credentials file, replacing the old block:
   - Windows: `%USERPROFILE%\.aws\credentials`
   - macOS/Linux: `~/.aws/credentials`
4. Set the region to `us-east-1`:
   ```bash
   aws configure set region us-east-1
   ```
5. Check that it works:
   ```bash
   aws sts get-caller-identity
   ```
   The `Arn` should contain `assumed-role/voclabs/...`.

**Partner check (one time):** confirm your sandbox has the same pre-made roles we rely on:
```bash
aws iam list-roles --query "Roles[?RoleName=='lambda-run-role' || RoleName=='myS3Role' || RoleName=='myBasicLambdaRole'].RoleName"
```
All three should appear.

**Never commit credentials.** `.gitignore` blocks `.env` and `.aws/`, but check `git diff --staged` anyway.

## 4. Sandbox test results (tested 2026-09-30)

We tested each service in Efren's sandbox. **Key finding: there is no `LabRole`.** Code running on AWS can only use the pre-made roles below, and those only allow S3 and logs.

### Services

| Service | Result | What we use instead |
|---|---|---|
| S3, SNS, CloudFormation, EC2, Lambda, CloudShell | ✅ Allowed | n/a |
| EventBridge | ✅ Can create rules (not needed in the current design) | n/a |
| Rekognition | ⚠️ Works from **your login only**; Lambda/EC2 roles are denied | Self-hosted image model (ONNX) inside Lambda |
| DynamoDB | ⚠️ Works from your login only; roles are denied | Job status as JSON in S3; users and labels in RDS PostgreSQL |
| Step Functions | ❌ `AccessDenied` on create | Each stage writes an S3 object that triggers the next stage |
| SES | ❌ `AccessDenied` | SNS email subscriptions |
| Cognito | ❌ `AccessDenied` on create | Spring Security + JWT |
| API Gateway | ❌ `AccessDenied` on create | Spring Boot on EC2 behind an Application Load Balancer |
| SQS | ❌ `AccessDenied` | Lambda auto-retry + a Spring Boot watchdog for stuck jobs |
| ECR | ⏭️ Not tested (not needed) | Zip + layer Lambda deploys |
| RDS | Listed as allowed, not tested yet | n/a |

### Pre-made roles (IAM is read-only; we can't create roles)

| Role | Used by | Permissions |
|---|---|---|
| `lambda-run-role` | **All our Lambdas** | `s3:GetObject`, `s3:PutObject` on any bucket; CloudWatch Logs |
| `myBasicLambdaRole` | n/a | CloudWatch Logs only |
| `myS3Role` (instance profile) | **Spring Boot EC2 instance** | `s3:*` |

### Confirmed working patterns

- S3 upload → triggers a Lambda (with `lambda add-permission` + bucket notification). A failed run is retried automatically.
- CloudFormation deploys a Lambda that uses `lambda-run-role`, so **CDK is viable**.
- An EC2 instance launched with `myS3Role` gets S3 access through the role, so the backend doesn't need stored keys.
- S3 `results/` prefix → SNS topic → email, **filtered per user**. A subscription filter policy (`FilterPolicyScope: MessageBody`) on the object key prefix `results/<user>/` sends each user only their own jobs.
- Lambda accepts 3008 MB memory, a 120 s timeout and 2 GB of `/tmp`, and Lambda layers can be published.
- Lambda account concurrency is **1000** (the standard AWS default), so there's no special sandbox cap on parallel runs.

### Design rules that follow from this

1. **Lambdas may only read and write S3.** No DynamoDB, Rekognition or SNS calls from Lambda code.
2. **Lambdas stay outside a VPC.** The role has no network-interface permissions, so they can't reach a private RDS instance.
3. **The backend reaches AWS only through S3 (role) and RDS (username/password).** It can't publish to SNS.
4. **Notifications come from S3 → SNS**, triggered by writing to `results/<user>/...`.
5. **Never put your personal lab credentials into deployed code.**

### Budget and cost rules ($20 per sandbox)

Each sandbox has a **$20 budget**. Exceeding it can disable the sandbox. Approximate hourly costs (us-east-1):

| Resource | ≈ Cost | Rule |
|---|---|---|
| S3, Lambda, SNS | Pennies at our volume | Can stay deployed |
| EC2 t3.micro | $0.01/hr | **Stop at the end of every session** |
| RDS db.t3.micro | $0.017/hr + storage | **Stop at the end of every session** (20 GB gp2, single-AZ) |
| Application Load Balancer | $0.023/hr | **Destroy when not in use** (deploy for work/demo sessions) |
| NAT Gateway | $0.045/hr | **Never create one.** CDK `Vpc` must use `natGateways: 0` or the default VPC |
| Public IPv4 / idle Elastic IP | $0.005/hr each | Release unused ones |

EC2 + RDS + ALB left running 24/7 costs about **$1.20/day**, which would use up the budget in roughly 2½ weeks. Check your spend on the AWS Academy lab page at the start of each session. `/wrap-up` lists anything still running.

## 5. Using AWS CDK in the sandbox (read-only IAM)

We can't create IAM roles, and default CDK creates them in several places. Follow these rules:

1. **Don't run a plain `cdk bootstrap`.** It creates IAM roles and will fail. Instead, create an assets bucket once per account:
   ```bash
   aws s3 mb s3://media-pipeline-cdk-assets-<ACCOUNT_ID>
   ```
   Then use `CliCredentialsStackSynthesizer`, which deploys with your CLI credentials:
   ```ts
   new MediaPipelineStack(app, 'MediaPipeline', {
     synthesizer: new CliCredentialsStackSynthesizer({
       fileAssetsBucketName: 'media-pipeline-cdk-assets-${AWS::AccountId}',
     }),
   });
   ```
2. **Import the existing roles.** Never let CDK create one:
   ```ts
   const lambdaRole = iam.Role.fromRoleName(this, 'LambdaRunRole', 'lambda-run-role', { mutable: false });
   new lambda.Function(this, 'Validate', { role: lambdaRole, /* ... */ });
   // EC2: use the existing instance profile 'myS3Role'
   ```
3. **Avoid constructs that create hidden roles or custom resources:**
   - `autoDeleteObjects: true` on buckets. Empty buckets manually before `cdk destroy`.
   - `bucket.addEventNotification(...)`. Configure S3 → Lambda and S3 → SNS notifications on the L1 `CfnBucket`, plus `lambda.CfnPermission` and `sns.CfnTopicPolicy`. Use a fixed bucket name to avoid circular references.
   - `BucketDeployment`. Upload the frontend build with `aws s3 sync`.
   - The `logRetention` prop on Lambdas. Create a `logs.LogGroup` and pass it as `logGroup` instead.
4. **Check before deploying:** after `cdk synth`, search `cdk.out/*.template.json` for `AWS::IAM::Role`. There should be none. CI runs this check on every PR once `infra/` exists.
5. **Networking:** use the default VPC, or `natGateways: 0` if a VPC is required. Never create a NAT Gateway (see the cost rules).
6. **Names come from `.env`:** the stack is `MediaPipeline-<MP_OWNER>`, buckets are `mp-<owner>-<purpose>-<accountId>`, and other resources are `mp-<owner>-<name>`. That way both sandboxes use the same code.
7. **Large dependencies** (ONNX Runtime, NumPy, Pillow) go in a Lambda layer. Bundling Python dependencies needs Docker. If Docker isn't available, build locally (`pip install -r requirements.txt -t build/python --platform manylinux2014_x86_64 --only-binary=:all:`) and use `Code.fromAsset('build')`. Model files live in S3 and are downloaded to `/tmp` on cold start.

## 6. Collaboration workflow

- **`main` is always deployable.** All work goes through branches and pull requests.
- **Branch names:** `feat/<area>-<desc>`, `fix/<area>-<desc>`, `docs/<desc>`, where area is `backend`, `frontend`, `lambdas`, `infra` or `docs`. Example: `feat/lambdas-validate-thumbnail`.
- **Commits:** use Conventional Commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- **Pull requests:** fill in the PR template, request your partner's review, and **squash merge** after approval. Branch protection requires 1 approval for every PR, including docs.
- **Async by default:** there are no fixed meetings. Planning sessions are PRs (see [ROADMAP.md](ROADMAP.md#how-each-phase-works)). Aim to review PRs within about 2 days, and flag blockers in chat right away.
- **Stay in sync:** `git pull --rebase origin main` before you start and before you open a PR.
- **Contracts:** changes to `docs/contracts/` must update the design doc in the same PR (see [docs/contracts/README.md](docs/contracts/README.md)).
- **Decisions:** record significant design choices in [docs/decisions.md](docs/decisions.md).
- **Secrets:** never commit credentials or `.env` files. Put config in `.env.example` with placeholder values.

### Definition of done (every PR)
- Tests for the area pass locally:
  - **Lambdas:** pytest for the logic (validation, status transitions, result format), using the `docs/contracts/` examples
  - **Backend:** Spring Boot tests for the endpoints touched
  - **Frontend:** `npm run build` succeeds
- Formatters/linters are clean (Ruff, Spotless, Prettier + oxlint, once each area is scaffolded).
- CI is green. GitHub Actions runs linters, unit tests and the `cdk synth` IAM-role check on every PR, and never deploys.
- The phase plan's demo steps work in your own sandbox, when the PR touches AWS resources.
- Docs are updated if behavior, setup or contracts changed.

## 7. Milestones and ownership (proposal, confirm together)

| Milestone | Due | Goal |
|---|---|---|
| M1 Foundation | **Oct 5** | Repo live, both sandboxes verified, design approved |
| M2 Checkpoint (class) | **Oct 19** | Demo: upload → validate → thumbnail + status on AWS |
| M3 Core pipeline | **Nov 1** | AI tags + moderation, failure handling, login with RDS |
| M4 Feature complete | **Nov 10** | Email, dashboard/gallery/search, full AWS deployment |
| M5 Presentation | **Nov 16** | Tests, slides, rehearsed demo |

Phase-by-phase breakdown, fallbacks and status: [ROADMAP.md](ROADMAP.md).

Suggested split (swap freely):

- **Partner A:** `infra/` (CDK) + `lambdas/` (pipeline stages, image model, retries)
- **Partner B:** `backend/` (Spring Boot API, auth, presigned URLs, RDS, watchdog) + `frontend/` (React upload, dashboard, gallery)
- **Shared:** the S3 key layout, the status JSON schema and the API contract. Agree on these first and write them into `docs/media_pipeline.md`.

## 8. Session routine

We work in short sessions across different days and Claude Code conversations. This routine keeps them connected. With Claude Code, run the checked-in commands `/start-session` and `/wrap-up`. Without it, follow the same steps by hand.

**Start** (`/start-session`):
1. `git pull --rebase` on your branch (or `main` if starting fresh).
2. Read **Current focus** in [ROADMAP.md](ROADMAP.md), then the active phase plan's tasks and latest **Progress log** entries.
3. Start the lab and check `aws sts get-caller-identity`. Check the remaining budget on the lab page.
4. Review your partner's open PRs first, since they may be blocked on you.

**End** (`/wrap-up`):
1. Add a Progress log line to the active phase plan: `- YYYY-MM-DD Name: done. Next: …`
2. Update **your own block** in Current focus (never your partner's).
3. Add to [docs/decisions.md](docs/decisions.md) if you made a design choice.
4. Stop or destroy costly resources (EC2, RDS, ALB); see the §4 cost rules.
5. Commit and push your branch. Never push to `main`.

## Next steps

1. Both of you: complete §1–§3, including the partner role check and your `.env`.
2. Phase 1: draft `docs/plans/01-design-finalization.md` in a PR, then refine `docs/media_pipeline.md` and write the `docs/contracts/` examples.
3. Scaffold `backend/`, `frontend/` and `infra/`, and add Lambda stubs.
