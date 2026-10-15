# Phase 04: Validate Stage

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner(s):** Fahad (Lambda), Efren (CI + close-out) · **Target:** 2026-10-16 · **Planned on:** 2026-10-14

## Goal

The first real pipeline stage: check every upload's type and size, make a thumbnail, write status, and hand off to Analyze through S3. Invalid files end as `FAILED` with a safe reason.

Most of this phase was delivered early, together with Phase 2, in PR #1 (Fahad). This plan records that work and closes the remaining gap: Python linting in CI.

## Scope

**In:**
- Validate Lambda (`lambdas/validate/`): magic-byte format check, size and pixel limits, EXIF-stripping JPEG thumbnail, conditional status writes, Analyze manifest (PR #1)
- Ruff lint + format check for `lambdas/` and `scripts/` in CI

**Out:**
- The Analyze stage itself (Phase 5)
- Watchdog for stuck jobs (Phase 6)

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Pillow packaging | Bundled into the function package by `build_package.py` (manylinux wheels), not a separate layer | One artifact per deploy; it fits well within Lambda's size limit. Revisit a layer for ONNX Runtime in Phase 5 |
| Idempotency | ETag-bound reads and conditional writes | See D13 and D15 |
| Python lint | Ruff, one root `ruff.toml` (rules E, F, I, B, UP; line length 100); version pinned in `requirements-dev.txt` | One fast tool for lint and format; the config covers every Python folder, including future Lambdas |

## Tasks

- [x] Validate Lambda with tests (Fahad, PR #1)
- [x] Live check in a sandbox: valid PNG and JPEG reach `READY_FOR_ANALYSIS`; a fake `.jpg` ends as `FAILED` (Efren, 2026-10-14)
- [x] Add Ruff config, fix the findings, format, add the CI step (Efren)

## Acceptance criteria

- [x] A valid upload produces a thumbnail and a `READY_FOR_ANALYSIS` status, plus the Analyze manifest
- [x] An invalid upload ends as `FAILED` with a stable code and a user-safe message
- [x] pytest runs in CI using the `docs/contracts/` examples
- [x] Ruff lint and format checks pass in CI

## Test / demo steps

1. `ruff check lambdas scripts && ruff format --check lambdas scripts`
2. `python -m unittest discover -s lambdas/validate/tests -v`
3. Live: `scripts/checkpoint-smoke-test.sh <image>`, or upload through the React page (Phase 3).

## Open questions

- `scripts/tests/test_checkpoint_smoke_test.py::test_ready_status_waits_until_both_artifacts_are_visible` fails on Windows (it passes in CI on Linux). It probably comes from how its bash stub runs under Git Bash. Low priority.

## Progress log

- 2026-10-13 Fahad: Validate Lambda delivered in PR #1 (see the Phase 2 plan for details).
- 2026-10-14 Efren: Confirmed live in Efren's sandbox: valid images reach `READY_FOR_ANALYSIS`, a fake `.jpg` ends as `FAILED`/`UNSUPPORTED_FORMAT`. Added Ruff (config, auto-fixes and formatting only; no logic changes) and the CI step. Next: CI green, then close the phase.
- 2026-10-14 Efren: PR #12 opened; CI green with the new Ruff step. Next: Fahad reviews #11 and #12; after merging, mark Phases 3 and 4 ✅ and write the Oct 19 demo script.

## Outcome notes

Delivered ahead of its own phase as part of the M2 vertical slice. The only extra work was the linter.
