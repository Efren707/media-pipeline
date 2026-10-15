# Phase 01: Design Finalization

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner(s):** Efren and Fahad · **Target:** 2026-10-13 · **Planned on:** 2026-10-13

## Goal

Replace the original unsupported architecture with one that deploys in the verified AWS Academy sandbox, and freeze the contracts needed for parallel Lambda, backend, frontend, and infrastructure work.

## Scope

**In:**
- S3 key layout and status state machine
- Validate-stage behavior and security rules
- API response examples
- Sandbox-compatible AWS architecture
- Checkpoint vertical-slice acceptance criteria

**Out (deferred or not doing):**
- Final ONNX model choice and moderation thresholds
- RDS schema and JWT implementation
- Full frontend design
- Production-scale operations outside the Academy sandbox

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Stage orchestration | S3 prefix events | Step Functions is blocked and Lambda can write S3 |
| Job status | User-scoped JSON in S3 | DynamoDB is unavailable to deployed roles |
| Image analysis | Self-hosted ONNX in Lambda | Rekognition is unavailable to deployed roles |
| CDK language | TypeScript | Reuses the Node toolchain and has strong CDK support |
| Checkpoint scope | Upload, validation, thumbnail, and status | Smallest end-to-end slice that proves the cloud design |
| Portfolio retention | Keep code permanently; deploy billable services on demand | Preserves resume value without consuming the lab budget continuously |

## Tasks

- [x] Reconcile `docs/media_pipeline.md` with sandbox findings (Fahad)
- [x] Define S3 keys and status transitions (Fahad)
- [x] Add status, result, and API response examples (Fahad)
- [x] Review and approve the design PR (Efren)
- [x] Record any review changes in `docs/decisions.md` (both)

## Acceptance criteria

- [x] No design path depends on a service blocked in `SETUP.md`
- [x] Every S3 prefix has one owner and purpose
- [x] Status transitions and safe failure codes are documented
- [x] Security controls are part of the design, not deferred
- [x] Example JSON files are valid and agree with the design
- [x] Both partners approve and merge the PR

## Test / demo steps

1. Run `python scripts/validate_contracts.py`.
2. Compare every contract field and state with `docs/media_pipeline.md`.
3. Confirm the infrastructure plan imports existing roles and synthesizes no IAM roles or NAT Gateway.

## Open questions

- Which ONNX tagging and moderation models meet Lambda size, cold-start, and accuracy limits?
- Is RDS creation and connection from `myS3Role` EC2 reliable in both partner sandboxes?

## Progress log

- 2026-10-13 Fahad: Reconciled the architecture, defined contracts, and prepared the secure M2 vertical-slice scaffold. Next: Efren review and sandbox deployment.
- 2026-10-14 Efren: Approved and merged PR #1; review follow-ups are recorded as D13–D15. Phase closed.

## Outcome notes

Approved and merged in PR #1 on 2026-10-13. Review changes are recorded in `docs/decisions.md` (D13–D15). The ONNX model choice and RDS questions above carry over to Phases 5 and 7. The original proposal remains useful as the problem statement; its initial AWS service choices were replaced by the verified sandbox-compatible design.
