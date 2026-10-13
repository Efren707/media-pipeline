# Phase 02: Infrastructure Foundation

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner:** Fahad · **Target:** 2026-10-14 · **Planned on:** 2026-10-13

## Goal

Deploy a private media bucket and a placeholder-to-working Validate Lambda from one repeatable CDK command without creating IAM roles or a NAT Gateway.

## Scope

**In:**
- TypeScript CDK project
- Private encrypted S3 bucket and upload-prefix event
- Imported `lambda-run-role`
- Validate Lambda packaging and log group
- CI synthesis and forbidden-resource checks
- Manual deployment, smoke-test, and guarded teardown scripts

**Out:**
- Analyze Lambda, SNS subscriptions, CloudFront, EC2, ALB, and RDS

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Resource definitions | L1 S3 notification plus explicit Lambda permission | Avoids hidden custom-resource roles |
| Object encryption | SSE-S3 | Supported without KMS permissions |
| Lambda package | Python 3.12 manylinux x86_64 build directory | Reproducible Pillow binary packaging |
| Retention | Demo objects expire after 30 days | Limits cost and privacy exposure while source code remains permanent |

## Tasks

- [x] Scaffold TypeScript CDK app
- [x] Configure bucket privacy, TLS-only access, encryption, CORS, and lifecycle
- [x] Import `lambda-run-role` without policy mutation
- [x] Add S3 upload-prefix notification and Lambda invoke permission
- [x] Add CDK assertions and forbidden-resource scan
- [x] Add deployment, smoke-test, and guarded teardown scripts
- [ ] Deploy into Fahad's active Academy sandbox and run smoke test
- [ ] Deploy into Efren's active Academy sandbox and run smoke test

## Acceptance criteria

- [x] TypeScript compilation succeeds
- [x] CDK assertion tests pass
- [x] Synthesized template contains no `AWS::IAM::Role` or NAT Gateway
- [ ] `cdk deploy` succeeds in both sandboxes
- [ ] Uploading one valid test image invokes the Lambda

## Test / demo steps

1. Export `MP_OWNER` and load active Academy credentials.
2. Run `scripts/deploy-checkpoint.sh`.
3. Run `scripts/checkpoint-smoke-test.sh path/to/test.jpg`.
4. Show the original, status, thumbnail, and Analyze manifest keys in S3.

## Open questions

- Do both Academy accounts permit the explicit TLS-only S3 bucket policy?

## Progress log

- 2026-10-13 Fahad: Local build, CDK tests, synth, and policy scan pass. Next: live sandbox deploy and smoke test.
- 2026-10-13 review follow-up: Added ETag-bound downloads, a pre-output `VALIDATING` claim, conditional artifact/status writes, malformed-image handling, terminal-state protection, clean-checkout build ordering, and smoke-test polling coverage. Local regression suite is passing; live deploy remains next.

## Outcome notes

Local verification is complete. Live AWS verification requires an active Academy session and temporary credentials.
