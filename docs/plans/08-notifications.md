# Phase 8 — Notifications

- **Owner:** Fahad
- **Target:** 2026-11-10
- **Planned:** 2026-11-10
- **Status:** In progress — implementation and local verification complete; live AWS proof pending

## Goal

Send an SNS email notification when a user's final result is written, while ensuring that each confirmed subscriber receives events only for `results/{userId}/`.

## Scope

- Create one results SNS topic and a least-privilege topic policy for S3.
- Add the existing media bucket's `results/` notification without disturbing either Lambda trigger.
- Provide an operator-run subscription script that validates the Academy identity and installs a per-user message-body filter.
- Document confirmation, verification, privacy, and cost behavior.

Out of scope: automatic subscription during signup, custom HTML email content, SES, and application-held SNS credentials.

## Decisions

- Use the Roadmap fallback: an operator with temporary Academy credentials manages demo subscriptions because the deployed backend and Lambda roles cannot manage SNS.
- Filter the nested S3 event body on the exact prefix `results/{userId}/`.
- Prompt for the email address interactively; never store it in `.env`, command history, output, or the repository.
- Keep the low-volume SNS topic deployed with the portfolio stack; costly EC2, RDS, and ALB resources remain on-demand.

## Tasks

- [x] Add the SNS topic, S3-only topic policy, `results/` notification, and stack output.
- [x] Preserve and test both existing S3-to-Lambda notifications.
- [x] Add a safe, idempotent subscription helper with unit tests.
- [x] Update architecture, security, setup, and decision documentation.
- [ ] Deploy in an active Academy lab and record sanitized two-user isolation evidence.

## Acceptance criteria

- [x] Infrastructure tests prove one topic, a source-restricted policy, and all three bucket notifications.
- [x] Script tests prove identity validation, exact per-user filtering, confirmed-subscription reuse, and no email persistence.
- [ ] A confirmed user receives an event for their own completed job.
- [ ] That user receives no event for a second user's completed job.

## Live test and demo

1. Start the Academy lab and verify `aws sts get-caller-identity` contains `assumed-role/voclabs/`.
2. Deploy with `MP_OWNER=<owner> scripts/deploy-checkpoint.sh` and upload the trusted Analyze model assets if the stack is new.
3. Create two users. Copy each `user.id` UUID from the signup response; do not commit it.
4. Run `scripts/subscribe-user-notifications.sh <user-id>` for each user. Enter the matching email only at the hidden prompt.
5. Do not process uploads while subscriptions are being configured. Confirm both AWS Subscription Confirmation emails, then rerun the command for each user so the filter is reapplied to the confirmed subscription.
6. Continue to hold uploads for up to 15 minutes while the SNS filter policy takes effect.
7. Complete one upload as each user. Verify each inbox receives only its matching `results/{userId}/...` S3 event.
8. Save screenshots with account IDs, emails, tokens, presigned URLs, and credentials redacted.

## Progress log

- 2026-11-10 Fahad: implemented and locally verified the SNS infrastructure and subscription helper. Next: deploy with fresh Academy credentials and capture the two-user isolation proof.

## Outcome notes

Pending the live two-user AWS check. Do not mark Phase 8 done until both live acceptance criteria pass.
