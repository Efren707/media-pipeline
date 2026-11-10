# Phase 8 Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send each confirmed demo user an email only when S3 creates a result under that user's own `results/{userId}/` prefix.

**Architecture:** CDK adds one Standard SNS topic, a topic policy that permits this one media bucket to publish, and an S3 `results/` notification. A guarded operator script creates an email subscription with `FilterPolicyScope=MessageBody`; signup does not call SNS because the EC2 role cannot manage SNS.

**Tech Stack:** AWS CDK v2 and Jest (TypeScript), Amazon S3, Amazon SNS, Bash, AWS CLI, Python `unittest` for script regression tests.

**Spec:** `docs/superpowers/specs/2026-11-10-demo-first-completion-design.md`

## Global Constraints

- Never create `AWS::IAM::Role` or `AWS::EC2::NatGateway` resources.
- The SNS topic and the media bucket must be in the same AWS region.
- S3 publishes directly to SNS; neither Lambda nor Spring Boot publishes a notification.
- The topic policy grants only `sns:Publish` to `s3.amazonaws.com`, restricted by this bucket ARN and the current AWS account.
- Email addresses, account IDs, AWS credentials, and subscription ARNs must not be committed.
- A subscription matches only URL-encoded S3 object keys beginning with `results/{userId}/`.
- SNS filter-policy changes can take time to propagate; the live test waits before relying on isolation.
- The repository and portfolio materials remain after grading; teardown concerns AWS resources only.

## Review Focus

- A malformed or cross-user `userId` must make the subscription script exit before any AWS call; Task 3 adds this regression test.
- A missing Academy session or non-`voclabs` identity must stop the script with a safe message; Task 3 tests the rejected identity.
- The bucket notification must preserve both existing Lambda triggers while adding SNS; Task 1 asserts all three configurations.
- The topic policy must not permit another bucket or account to publish; Task 1 pins both `aws:SourceArn` and `aws:SourceAccount`.
- An unconfirmed email subscription must not block or alter pipeline completion; Task 4's live test records a terminal S3 result independently of email confirmation.

---

## File map

| File | Responsibility |
|---|---|
| `infra/lib/media-pipeline-stack.ts` | Define the SNS topic, topic policy, S3 result notification, dependency, and stack output. |
| `infra/test/media-pipeline-stack.test.ts` | Prove least-privilege SNS wiring and preservation of existing triggers. |
| `scripts/subscribe-user-notifications.sh` | Validate the operator/session/user, create an email subscription, and attach the payload filter without persisting the email. |
| `scripts/tests/test_subscribe_user_notifications.py` | Exercise the script with a fake AWS CLI and no real account. |
| `docs/plans/08-notifications.md` | Record scope, commands, live evidence, and outcome notes for the team. |
| `docs/media_pipeline.md` | Document the operator-confirmed notification flow and limitation. |
| `docs/decisions.md` | Record the fallback from automatic signup subscription to an operator-run script. |
| `infra/README.md`, `SETUP.md`, `.env.example` | Explain topic output, confirmation, filtering, and safe local values. |
| `ROADMAP.md` | Mark Phase 8 in progress/done and update Fahad's coordination block only. |

### Task 1: Add least-privilege S3-to-SNS infrastructure

**Files:**
- Modify: `infra/test/media-pipeline-stack.test.ts`
- Modify: `infra/lib/media-pipeline-stack.ts`

**Interfaces:**
- Consumes: `MediaPipelineStackProps.owner`, the existing `mediaBucket`, `account`, and `prefix` values.
- Produces: one `AWS::SNS::Topic` named `mp-{owner}-results`, one `AWS::SNS::TopicPolicy`, an S3 `TopicConfiguration` filtered to `results/`, and the `ResultsTopicArn` CloudFormation output.

- [ ] **Step 1: Write failing CDK tests**

Add tests named:

- `creates one results topic with an owner-scoped name` asserting one `AWS::SNS::Topic` with `TopicName: "mp-testuser-results"`;
- `allows only this media bucket and account to publish results` asserting `Principal.Service: "s3.amazonaws.com"`, `Action: "sns:Publish"`, `aws:SourceArn` for `mp-testuser-media-123456789012`, and `aws:SourceAccount: "123456789012"`;
- `publishes result objects to SNS without removing Lambda triggers` asserting the bucket has two Lambda configurations plus one topic configuration with `Event: "s3:ObjectCreated:*"` and prefix `results/`;
- extend `does not create IAM roles or a NAT gateway` so the new resources do not change either zero count.

- [ ] **Step 2: Run the CDK test and verify the new assertions fail**

Run from the repository root:

```bash
python lambdas/validate/build_package.py --offline-local
python lambdas/analyze/build_package.py --offline-local
npm test --prefix infra
```

Expected: the new SNS resource assertions fail because no topic exists.

- [ ] **Step 3: Implement SNS resources and notification wiring**

In `infra/lib/media-pipeline-stack.ts`:

- import `aws-cdk-lib/aws-sns`;
- create `sns.CfnTopic` with topic name `${prefix}-results`;
- create `sns.CfnTopicPolicy` with exactly one allow statement for S3 publish, restricted with `ArnEquals` `aws:SourceArn` and `StringEquals` `aws:SourceAccount`;
- append one `topicConfigurations` entry to the existing bucket `notificationConfiguration`, filtered to prefix `results/`;
- make the bucket depend on the topic policy so CloudFormation can validate the notification destination;
- output the topic ARN as `ResultsTopicArn`.

- [ ] **Step 4: Run infrastructure verification**

Run:

```bash
npm run verify --prefix infra
```

Expected: all CDK tests pass, synthesis succeeds, and the template checker reports no IAM role or NAT Gateway.

- [ ] **Step 5: Commit the infrastructure slice**

```bash
git add infra/lib/media-pipeline-stack.ts infra/test/media-pipeline-stack.test.ts
git commit -m "feat: publish completed results to SNS"
```

### Task 2: Specify the guarded subscription-script contract

**Files:**
- Create: `scripts/tests/test_subscribe_user_notifications.py`
- Modify: `.github/workflows/ci.yml` only if the existing script-test discovery does not pick up the new file automatically.

**Interfaces:**
- Consumes: `scripts/subscribe-user-notifications.sh` through `bash`, `MP_OWNER`, `AWS_REGION`, an interactive email line on standard input, and a positional UUID `userId`.
- Produces: exit code `0` after a safely pre-filtered subscription request or confirmed-subscription update; exit code `2` for local validation/session errors; no email in standard output or standard error.

- [ ] **Step 1: Add failing script tests with a fake AWS executable**

Create tests named:

- `test_rejects_invalid_user_id_before_aws_call` using `../other-user`;
- `test_requires_a_voclabs_identity` with a fake non-Academy caller ARN;
- `test_new_subscription_stops_for_confirmation_before_filtering` using UUID `550e8400-e29b-41d4-a716-446655440000` and asserting the subscribe request already includes `FilterPolicyScope=MessageBody` and the exact result prefix, then stops for confirmation;
- `test_pending_subscription_is_reused_without_filter_calls` so repeated setup does not create duplicates or mutate a subscription that is still pending;
- `test_does_not_echo_email_or_write_a_tracked_file` asserting the supplied email is absent from output and the repository remains unchanged.

The fake CLI must return:

- a caller identity ARN containing `assumed-role/voclabs/`;
- stack output topic ARN `arn:aws:sns:us-east-1:123456789012:mp-fahad-results`;
- a synthetic confirmed subscription returned by the list call so fail-closed attribute updates can be asserted separately from creation.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
python -m unittest scripts.tests.test_subscribe_user_notifications -v
```

Expected: FAIL because `scripts/subscribe-user-notifications.sh` does not exist.

- [ ] **Step 3: Commit the executable contract tests**

```bash
git add scripts/tests/test_subscribe_user_notifications.py .github/workflows/ci.yml
git commit -m "test: define notification subscription safeguards"
```

### Task 3: Implement the user-filtered email subscription script

**Files:**
- Create: `scripts/subscribe-user-notifications.sh`
- Modify: `scripts/tests/test_subscribe_user_notifications.py` only to correct test-fixture mistakes, not weaken assertions.

**Interfaces:**
- Consumes: `subscribe-user-notifications.sh <userId>`, `MP_OWNER`, optional `AWS_REGION` defaulting to `us-east-1`, and one interactively entered email address.
- Produces: a pending-confirmation instruction or confirmed-subscription success message; an SNS subscription with `FilterPolicyScope=MessageBody` and nested S3 object-key prefix filtering.

- [ ] **Step 1: Implement local validation and Academy preflight**

The script must:

- enable `set -euo pipefail`;
- require exactly one positional UUID matching lowercase canonical UUID syntax;
- validate `MP_OWNER` with the existing 2–20 lowercase naming rule;
- read the email with `read -r -p` rather than requiring it on the command line;
- reject an empty or obviously malformed email locally;
- call `aws sts get-caller-identity` and require the ARN to contain `assumed-role/voclabs/`;
- avoid printing the email, account ID, caller ARN, or AWS credentials.

- [ ] **Step 2: Implement topic discovery and subscription creation**

The script must:

- read `ResultsTopicArn` from stack `MediaPipeline-${MP_OWNER}` using `cloudformation describe-stacks`;
- build AWS CLI input JSON and the nested payload filter in a `mktemp -d` directory with mode `0700` and `trap` cleanup;
- call `aws sns list-subscriptions-by-topic` into the private temporary directory and locate an existing subscription for the entered email without putting the email in a command argument;
- if a confirmed matching subscription exists, reuse its ARN rather than creating a duplicate;
- if only a pending match exists, explain that the operator must confirm the email and rerun the script;
- if no match exists, call `aws sns subscribe` with protocol `email`, `--return-subscription-arn`, the exact payload filter and `MessageBody` scope in the temporary input file, then stop for confirmation;
- when a confirmed ARN is available, first install a deny-all attribute filter, switch the scope to `MessageBody`, and only then install the nested policy whose leaf matches `results/${USER_ID}/` under `Records → s3 → object → key`; this order fails closed if any later call fails;
- never place the endpoint or filter in a tracked file.

- [ ] **Step 3: Run all script and Python checks**

Run:

```bash
python -m unittest discover -s scripts/tests -v
ruff check scripts
ruff format --check scripts
```

Expected: all script tests pass and Python formatting/linting is clean.

- [ ] **Step 4: Commit the implementation**

```bash
git add scripts/subscribe-user-notifications.sh scripts/tests/test_subscribe_user_notifications.py
git commit -m "feat: add filtered email subscription setup"
```

### Task 4: Document, synthesize, and live-verify Phase 8

**Files:**
- Create: `docs/plans/08-notifications.md`
- Modify: `docs/media_pipeline.md`
- Modify: `docs/decisions.md`
- Modify: `infra/README.md`
- Modify: `SETUP.md`
- Modify: `.env.example`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: `ResultsTopicArn`, `scripts/subscribe-user-notifications.sh <userId>`, a confirmed email subscription, and two real test-user UUIDs.
- Produces: reproducible Phase 8 instructions and sanitized evidence that Alice receives only Alice's result event.

- [ ] **Step 1: Write the phase plan and decision record**

Create `docs/plans/08-notifications.md` from the repository template with:

- owner Fahad, target 2026-11-10, and status tasks;
- the reason signup cannot manage SNS with `myS3Role`;
- the operator-confirmed fallback and its security tradeoff;
- exact deployment, confirmation, isolation-test, and cleanup steps;
- a warning that SNS policy changes may need propagation time.

Append decision `D19: Operator-confirmed SNS subscriptions in the Academy sandbox` to `docs/decisions.md`; it must state that automatic signup subscription is deferred because the runtime role cannot manage SNS.

- [ ] **Step 2: Update user and architecture documentation**

Update:

- `docs/media_pipeline.md` with S3 → SNS and the confirmation/filter flow;
- `infra/README.md` with the topic output and base-stack behavior;
- `SETUP.md` with the safe operator commands and two-user proof;
- `.env.example` to remove `MP_EMAIL`, because the script reads the email interactively and the repository does not need a persistent email variable;
- only Fahad's `ROADMAP.md` current-focus block, plus Phase 8's plan link and status.

- [ ] **Step 3: Run the complete local verification available in this environment**

Run:

```bash
python -m unittest discover -s lambdas/validate/tests -v
python -m unittest discover -s lambdas/analyze/tests -v
python -m unittest discover -s scripts/tests -v
python scripts/validate_contracts.py
npm run verify --prefix infra
npm run lint --prefix frontend
npm run format:check --prefix frontend
npm test --prefix frontend -- --run
npm run build --prefix frontend
git diff --check
```

Expected: all local checks pass. Backend Maven verification is deferred to GitHub CI if Maven Central remains unreachable.

- [ ] **Step 4: Deploy and verify with an active Academy session**

Perform the live check without recording secrets or identifiers:

1. Deploy the base stack and confirm `ResultsTopicArn` exists.
2. Create/confirm Alice and Bob subscriptions, rerunning the script after confirmation to apply filters.
3. Wait up to 15 minutes for SNS filter-policy propagation.
4. Upload one image as Alice and confirm Alice's job reaches `COMPLETE` or `FLAGGED` even if email is still pending.
5. Confirm Alice receives the S3 event and Bob does not.
6. Upload one image as Bob and confirm the reverse.
7. Record only sanitized screenshots and outcome notes—no email, account ID, user UUID, topic ARN, presigned URL, or credential.

- [ ] **Step 5: Mark Phase 8 complete and commit documentation**

Check acceptance criteria, add the sanitized live-test result to the phase outcome notes, set Phase 8 to ✅, and update Fahad's next step to Phase 9.

```bash
git add docs/plans/08-notifications.md docs/media_pipeline.md docs/decisions.md infra/README.md SETUP.md .env.example ROADMAP.md
git commit -m "docs: close Phase 8 notifications"
```

- [ ] **Step 6: Push a PR and require green CI before merge**

Before pushing:

```bash
git fetch origin
git rebase origin/main
git diff --stat origin/main...HEAD
```

Expected: Phase 5–7 files remain preserved except for intentional documentation additions. Push `feat/demo-first-completion`, open a Phase 8 PR, and merge only after `backend`, `frontend`, and `verify` jobs pass.

## Self-review result

- Spec coverage: Phase 8 infrastructure, guarded subscription, confirmation, two-user isolation, documentation, and live evidence are all assigned.
- Step scan: each step produces one testable artifact or verification result.
- Type consistency: stack output is consistently `ResultsTopicArn`; the script interface is consistently `<userId>` plus interactive email.
- Review focus: invalid user IDs, wrong AWS identity, preserved triggers, least-privilege policy, and pending confirmation each have an owning test or live check.
- Proportion: implementation details are limited to fixed interfaces and security values; script bodies remain for the implementer.
