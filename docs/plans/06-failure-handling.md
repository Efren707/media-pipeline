# Phase 6: Failure Handling & Retries

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner(s):** Efren · **Target:** 2026-11-11 · **Planned on:** 2026-11-09

## Goal

Every job ends in a final state the user can see. Today a job that runs out of Lambda retries, times out, runs out of memory, or never gets uploaded stays `QUEUED`, `VALIDATING`, `READY_FOR_ANALYSIS` or `ANALYZING` forever. This phase makes those jobs end in `FAILED` with a clear reason.

## Starting point (already done in Phases 4–5)

- Both Lambdas separate **permanent** errors (`PermanentValidationError`, `PermanentAnalysisError`), which write `FAILED` with a safe code and message right away, from **temporary** errors, which are raised so Lambda's async retry runs (`retryAttempts: 2`, about 1 and 2 minutes apart).
- Status changes use conditional S3 writes (`If-Match` / `If-None-Match`, D15), and final states are never overwritten.

## Scope

**In:**
- A read-time watchdog in the Spring Boot API: when `GET /api/jobs/{id}` reads a job that has been in a non-final state longer than its limit, the API conditionally writes `FAILED` and returns it.
- Two new error codes: `UPLOAD_NOT_RECEIVED` (stuck in `QUEUED`) and `PROCESSING_TIMEOUT` (stuck in a processing state).
- Configurable limits (`mp.stale-after.*`), so the demo can use a short limit.
- JUnit tests for stale, fresh, final, and lost-race cases.
- A forced-failure demo for each stage.

**Out (deferred or not doing):**
- Lambda async failure destinations and a "failure recorder" Lambda (see D18).
- A scheduled background sweep; the check runs only when a job is read.
- Bulk-upload throttling behavior (Phase 11).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where stuck jobs are detected | Spring Boot API, when a job is read | Matches the roadmap; free; no new AWS resources; unit-testable (D18) |
| Write safety | `If-Match` on the ETag that was read | The watchdog can never overwrite a `COMPLETE`/`FLAGGED` that lands at the same moment |
| Late Lambda after watchdog | `FAILED` wins | The Lambda's own `If-Match` write fails and it stops; an orphan `results/` object is harmless |
| Default limits | `QUEUED` 15 min; processing states 15 min | Above the worst case: presign TTL is 5 min; Analyze takes 3 × 120 s plus about 3 min of retry delay, roughly 9.5 min |

## Tasks
- [x] `StatusStore`: read status together with its ETag; add `replaceIfMatch` (Efren)
- [x] `StaleJobPolicy` + `mp.stale-after.queued` / `mp.stale-after.processing` properties (Efren)
- [x] `JobService.findJob`: apply the watchdog before building the response (Efren)
- [x] JUnit tests: stale → `FAILED`; fresh → unchanged; final → unchanged; ETag conflict → re-read (Efren)
- [x] Update `docs/media_pipeline.md` §9 with the new error codes (Efren)
- [x] Live forced-failure demo in the sandbox (Efren); UI screenshots optional

## Acceptance criteria
- [x] A job whose upload never arrives shows `FAILED / UPLOAD_NOT_RECEIVED` once its limit passes.
- [x] A job whose Lambda keeps failing shows `FAILED / PROCESSING_TIMEOUT` once its limit passes.
- [x] Bad input still fails immediately with its specific code (regression check).
- [x] The watchdog never changes a `COMPLETE`, `FLAGGED` or `FAILED` job.
- [ ] Backend tests, Python tests and CI are green.

## Test / demo steps
1. Start the API with a short limit: `MP_STALE_AFTER_QUEUED=1m MP_STALE_AFTER_PROCESSING=1m`.
2. **Upload never arrives:** call `POST /api/uploads` and don't PUT the file. After 1 minute, `GET /api/jobs/{id}` returns `FAILED / UPLOAD_NOT_RECEIVED`.
3. **Analyze keeps failing:** temporarily rename `models/squeezenet1.1-7.onnx` in the bucket, then upload a photo. Analyze retries and the job stays `ANALYZING`. After the limit the UI shows `FAILED / PROCESSING_TIMEOUT`. Restore the model.
4. **Bad input:** upload `not-an-image.jpg` and confirm it fails immediately with `UNSUPPORTED_FORMAT`.

## Open questions
- Should the UI show a friendlier message for each new code? The default message is probably enough.

## Progress log
- 2026-11-09 Efren: planned Phase 6 (read-time backend watchdog, D18). Implemented the watchdog with 6 new JUnit tests; `mvnw verify` passes (21 tests, Spotless clean). Next: live forced-failure demo.
- 2026-11-09 Efren: live demo in `MediaPipeline-efren` with 1-minute limits. An upload that was never sent became `FAILED / UPLOAD_NOT_RECEIVED`. With the model parked, Analyze failed with `AccessDenied` (missing key without `s3:ListBucket`, D15), Lambda retried, and the watchdog wrote `FAILED / PROCESSING_TIMEOUT` to S3. Model restored. Lambda code is unchanged, so immediate `UNSUPPORTED_FORMAT` (verified earlier the same day) still applies. Remaining: CI green on the PR.
