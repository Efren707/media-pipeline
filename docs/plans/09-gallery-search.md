# Phase 9: Status dashboard, gallery & search

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner(s):** Efren · **Target:** Nov 12 · **Planned on:** 2026-11-10

## Goal
After login, a user sees all of their uploads in one gallery, including live status for jobs still in progress, and can find a processed image by typing one of its labels. This follows the approved [demo-first completion spec](../superpowers/specs/2026-11-10-demo-first-completion-design.md#phase-9-gallery-and-label-search).

## Scope
**In:**
- `GET /api/jobs?label=&limit=`: lists the signed-in user's jobs from `status/{userId}/`, newest first, with thumbnails, results and errors.
- A case-insensitive label filter on the server, applied in Spring Boot over the bounded set (D21).
- A new contract, `docs/contracts/api/job-list.response.json`, with matching updates to `media_pipeline.md`.
- A React gallery that loads after login, polls jobs that are still in progress, has a debounced label search, and shows empty, error and retry states.

**Out (deferred or not doing):**
- An RDS jobs/labels index and cursor pagination, left as a portfolio follow-up (D21).
- Deleting or renaming jobs, and full-size image views.

## Decisions
| Decision | Choice | Why |
|---|---|---|
| Search backing | Filter S3 status/result JSON in Spring Boot (D21) | Free and needs no schema change. RDS stays opt-in, so the app runs without a database. |
| Bound | Scan at most 100 valid jobs, then sort, filter, and apply `limit` (default 25, max 100). Return `truncated: true` beyond 100 | Keeps each request bounded with no cursor API before the deadline. |
| User scope | The prefix comes only from the JWT `sub` (the `CurrentUser` id), never from request input | Same isolation rule as `GET /api/jobs/{id}` (Phase 7). |
| Reuse | Reuse the per-job path in `JobService`: identity check, watchdog (D18), result check, presigned thumbnail | One code path, so list and detail can't drift apart. |
| Bad objects | Skip malformed or identity-mismatched status files. Log only the job ID | One bad file mustn't break the gallery, and logs stay free of URLs and user data. |
| Caching | `Cache-Control: no-store` | The response contains presigned URLs. |

## Tasks
- [x] Contract: `job-list.response.json` and its example, plus `media_pipeline.md` API section (Efren)
- [x] Backend: `StatusStore` paged listing of `status/{userId}/`; `JobService.listJobs(userId, label, limit)`; `GET /api/jobs` with param validation (400 on bad `limit`); tests for ordering, label filter, limit/truncation, malformed/mismatched skip, watchdog applied, Alice cannot see Bob (Efren)
- [x] Frontend: `listJobs()` in `api.ts`; `Gallery` grid that reuses `JobCard`; load on login; merge newly uploaded jobs; poll non-terminal items; debounced search; empty/error/retry states; clear the gallery on logout; tests (Efren)
- [ ] Live check in an Academy lab, with sanitized evidence in the Progress log (Efren)

## Acceptance criteria
- [ ] Refreshing the page after login restores Alice's jobs, newest first.
- [ ] Searching a label shown on an image returns that image and leaves out images without it.
- [ ] Alice's list never contains Bob's jobs, and she can't fetch Bob's job by ID (still 404).
- [ ] Failed and flagged jobs are clearly marked without showing internal error details.
- [ ] Without a token, `GET /api/jobs` returns 401.
- [ ] Backend, frontend and CDK tests, linters and CI are green.

## Test / demo steps
1. Run the backend and frontend locally against the sandbox bucket. With `MP_WITH_DB=true`, RDS also works. Use Docker Postgres for a $0 run.
2. Sign up as `alice` and upload three images: two different subjects and one invalid file.
3. Watch the cards go from QUEUED to COMPLETE/FAILED without reloading.
4. Reload the page. The gallery comes back. Type a label from one image and only matching cards remain.
5. Sign up as `bob` in a private window. His gallery is empty. `curl -H "Authorization: Bearer <bob>" /api/jobs` returns only Bob's jobs.
6. `curl /api/jobs` with no token returns 401.

## Open questions
- Should the search also match the moderation verdict (e.g. `flagged`)? Proposal: no, labels only. Show the verdict as a badge.

## Progress log
- 2026-11-10 Efren: planned Phase 9 from the demo-first spec. S3 filtering over the bounded set recorded as D21; ROADMAP §9 wording updated. Next: contract + backend PR.

## Outcome notes
