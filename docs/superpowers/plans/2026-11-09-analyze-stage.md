# Analyze Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, testable Analyze Lambda and the smallest end-to-end application changes needed to show final image labels and moderation state.

**Architecture:** S3 manifests trigger a second Lambda. The Lambda performs conditional status transitions, downloads one immutable source version, runs an injected analyzer, writes one immutable result, and finishes the status as `COMPLETE` or `FLAGGED`. CDK uses the existing Academy role and L1 S3 notification wiring.

**Tech Stack:** Python 3.12, boto3, Pillow, NumPy, ONNX Runtime, AWS CDK/TypeScript, Spring Boot/Java 21, React/TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-09-deadline-rescue-analyze-design.md`

## Global Constraints

- Analyze may call only S3 and CloudWatch Logs.
- Use `lambda-run-role`; synthesize no `AWS::IAM::Role` or NAT Gateway.
- User/job identity comes from the event key and must match every manifest key.
- Source reads are ETag-bound; results and status transitions are conditional and idempotent.
- Model and label paths are fixed environment configuration, never user input.
- The moderation claim is restricted-label moderation, not comprehensive NSFW detection.

## Review Focus

- Malformed or cross-user manifest keys must fail without reading another user's source.
- Duplicate S3 events must not duplicate or replace a result.
- A stale manifest/source ETag must not analyze replacement bytes.
- A watchdog `FAILED` or completed terminal status must not be regressed.
- A model/runtime failure must raise for Lambda retry rather than publish a false permanent result.

---

### Task 1: Contracts and Analyze Core

**Files:**
- Create: `lambdas/analyze/src/analysis.py`
- Create: `lambdas/analyze/tests/test_analysis.py`
- Create: `lambdas/analyze/requirements.txt`
- Modify: `docs/contracts/result.example.json`
- Modify: `scripts/validate_contracts.py`

**Interfaces:**
- Produces: `AnalysisResult`, `LabelScore`, and `analyze_image(image_bytes, model) -> AnalysisResult` for the handler.

- [x] Write failing tests for ranked top-five labels, confidence filtering, and restricted-label moderation.
- [x] Run the new tests and confirm failure because the module does not exist.
- [x] Implement the minimal analysis types, ONNX preprocessing/inference adapter, and policy evaluation.
- [x] Run the analysis tests and the existing Python suite.
- [x] Update the result contract and validator, then re-run contract validation.

### Task 2: Secure S3 Analyze Handler

**Files:**
- Create: `lambdas/analyze/src/handler.py`
- Create: `lambdas/analyze/tests/test_handler.py`
- Create: `lambdas/analyze/README.md`

**Interfaces:**
- Consumes: `analysis.analyze_image` and Validate's manifest/status schemas.
- Produces: Lambda `handler(event, context)` plus `results/` and terminal `status/` objects.

- [x] Write failing tests for the happy path and `FLAGGED` result.
- [x] Add failing security tests for cross-user manifests, stale ETags, duplicate events, and terminal states.
- [x] Implement key parsing, manifest validation, conditional status claims, ETag-bound reads, immutable result writes, and terminal status updates.
- [x] Run Analyze tests and the full Python suite.

### Task 3: Packaging and CDK Wiring

**Files:**
- Create: `lambdas/analyze/build_package.py`
- Modify: `infra/lib/media-pipeline-stack.ts`
- Modify: `infra/test/media-pipeline-stack.test.ts`
- Modify: `infra/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: the Analyze Lambda handler artifact.
- Produces: `stage/analyze/` S3 notification, Analyze Lambda, log group, outputs, and fixed model configuration.

- [x] Add failing CDK assertions for the second Lambda, fixed environment keys, and analyze-prefix notification.
- [x] Run CDK tests and confirm the new assertions fail.
- [x] Add packaging and the Analyze CDK resources using the existing role and L1 notification configuration.
- [x] Run TypeScript build, CDK tests, synth, and the forbidden-resource check.

### Task 4: API and React Final Results

**Files:**
- Modify: `backend/src/main/java/com/mediapipeline/backend/jobs/JobDtos.java`
- Modify: `backend/src/main/java/com/mediapipeline/backend/jobs/JobService.java`
- Modify: `backend/src/main/java/com/mediapipeline/backend/jobs/StatusStore.java`
- Modify: `backend/src/test/java/com/mediapipeline/backend/jobs/JobControllerTest.java`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/JobCard.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: terminal status and result JSON from Analyze.
- Produces: authenticated-user-scoped labels/moderation data in the job response and visible final states.

- [x] Add failing backend tests for returned labels and rejection of cross-user result keys.
- [x] Implement result retrieval under the authenticated user's prefix.
- [x] Add frontend tests for continued polling through `READY_FOR_ANALYSIS` and final labels/flagged rendering.
- [x] Implement the final-state timeline and result display.
- [x] Run backend verification when Maven is available, then frontend lint, format, tests, and build.

### Task 5: End-to-End Verification and Documentation

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `docs/media_pipeline.md`
- Create: `docs/plans/05-analyze-stage.md`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: reproducible deployment steps and final-demo evidence checklist.

- [x] Run all locally available checks from a clean tree.
- [x] Confirm the synthesized template contains two Lambdas, no IAM role, and no NAT Gateway.
- [x] Document model asset setup and a valid/flagged/invalid demo sequence.
- [x] Record any live AWS items that still require an active Academy session.

