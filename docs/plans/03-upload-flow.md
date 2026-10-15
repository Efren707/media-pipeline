# Phase 03: Upload Flow

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner:** Efren · **Target:** 2026-10-17 · **Planned on:** 2026-10-14

## Goal

A user picks an image in the browser and it reaches S3 through a presigned URL. Validate then runs, and the page shows the job moving from `QUEUED` to `READY_FOR_ANALYSIS` with its thumbnail. This is the user-facing half of the M2 checkpoint demo (Oct 19).

## Scope

**In:**
- Spring Boot skeleton (Java 21, Maven wrapper, Spotless) in `backend/`
- `POST /api/uploads`: checks type and size, generates the job ID, writes `QUEUED` status, returns a presigned PUT URL
- `GET /api/jobs/{jobId}`: returns the caller's status with a short-lived thumbnail URL
- React skeleton (Vite, TypeScript, Prettier + oxlint) in `frontend/`
- Upload page: pick a file, upload it, poll status, show the thumbnail
- Backend tests and frontend build added to CI

**Out (deferred):**
- Real accounts, signup and JWT (Phase 7). Phase 3 uses one configured demo user.
- `GET /api/jobs` list and gallery (Phase 9)
- Stuck-job watchdog (Phase 6)
- Running the backend on EC2 or the frontend on CloudFront (Phase 10). Both run locally for M2 against the deployed bucket.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| User identity before Phase 7 | A `CurrentUser` interface; the Phase 3 implementation returns a configured `mp.demo-user-id` (default `demo-user`) | The API must never take the user prefix from the request (design §7). Phase 7 swaps in a JWT-backed implementation without touching the endpoints |
| Upload method | Presigned **PUT** for one exact key, 5-minute expiry, `Content-Type` and `Content-Length` signed | Matches the design and the existing bucket CORS rule. Signing the length stops the browser sending a different size than the backend approved |
| Size and type check | The request body carries `contentType` and `sizeBytes`; the backend rejects anything outside JPEG/PNG/WebP or over 10 MiB before signing | Fails fast for the user. Validate still re-checks the real bytes, so this is a convenience, not the security boundary |
| `QUEUED` write | Backend writes `status/{userId}/{jobId}.json` with `If-None-Match: *` *before* returning the URL, with `sourceKey` set and `sourceETag: null` | Validate already claims `QUEUED` → `VALIDATING` and binds the ETag (D15). Writing first means no upload can arrive before its status exists |
| AWS credentials | SDK v2 default chain: `AWS_PROFILE=sandbox` locally, `myS3Role` on EC2 later | No keys in config or code |
| Bucket name | `MP_MEDIA_BUCKET` environment variable, taken from the stack output `MediaBucketName` | Avoids hardcoding an account ID |
| Local dev wiring | Vite dev server on `:5173` proxies `/api` to Spring Boot on `:8080` | No backend CORS needed. The bucket CORS already allows `http://localhost:5173` |
| Frontend language | TypeScript | Same toolchain as `infra/`, and catches contract mismatches at build time |
| Frontend linter | oxlint (the current Vite template default) instead of ESLint, plus Prettier | Comes with the template and covers the React hook rules with zero config (D16) |
| Spring Boot | 4.1.1 with Jackson 3; google-java-format pinned to 1.28.0 | 1.37 fails to run on JDK 21 |

## Tasks

- [x] Backend skeleton: Spring Boot, Maven wrapper, Spotless, context test, CI job (Efren)
- [x] `POST /api/uploads` with tests: validation, `QUEUED` write, presigned PUT (Efren)
- [x] `GET /api/jobs/{jobId}` with tests: user scoping, 404, thumbnail URL, response mapping (Efren)
- [x] Frontend skeleton: Vite + React + TS, Prettier + oxlint, `/api` proxy, CI build (Efren)
- [x] Upload page: file picker, client-side checks, PUT to S3, status polling, thumbnail (Efren)
- [x] Contracts: add `docs/contracts/api/create-upload.request.json` and update `docs/media_pipeline.md` §7 (Efren)

## Acceptance criteria

- [x] Uploading creates `uploads/{user}/{job}.{ext}` and a `QUEUED` status before the upload
- [x] The page shows the job reaching `READY_FOR_ANALYSIS` and displays the thumbnail
- [x] A non-image or oversized file is refused by the API with a clear message, and never gets a URL
- [x] A file that passes the API check but isn't a real image ends as `FAILED` with a safe reason shown on the page
- [x] Responses match the examples in `docs/contracts/api/`. The client never sees `userId`, `sourceKey` or `sourceETag`
- [ ] Backend tests, Spotless, frontend lint and build pass in CI

## Test / demo steps

1. Make sure `MediaPipeline-efren` is deployed (Phase 2).
2. Run `AWS_PROFILE=sandbox MP_MEDIA_BUCKET=<MediaBucketName output> ./mvnw spring-boot:run` in `backend/`.
3. Run `npm run dev` in `frontend/` and open `http://localhost:5173`.
4. Upload a JPEG and watch it go `QUEUED` → `VALIDATING` → `READY_FOR_ANALYSIS`, then the thumbnail appears.
5. Upload a `.txt` renamed to `.jpg` and watch it end as `FAILED` with `UNSUPPORTED_FORMAT`.

If port 8080 is taken, run the backend with `SERVER_PORT=8081` and the frontend with `MP_API_URL=http://localhost:8081 npm run dev`.

## Open questions

- ~~Does the SDK v2 presigner sign `Content-Length`?~~ Yes. A unit test checks `X-Amz-SignedHeaders=content-length;content-type;host`, and live, a PUT whose body doesn't match the approved size gets a 403 from S3.
- Does a presigned URL signed with temporary Academy credentials stop working when the lab session ends, even within its 5 minutes? It shouldn't matter for the demo, but it's worth knowing.

## Progress log

- 2026-10-14 Efren: Plan drafted. Built the backend (2 endpoints, 12 tests) and the frontend upload page; added both CI jobs and the request contract. Tested live against the sandbox through the API: a valid JPEG went `QUEUED` → `READY_FOR_ANALYSIS` with a thumbnail URL, a fake `.jpg` ended as `FAILED`/`UNSUPPORTED_FORMAT`, a mismatched size got a 403 from S3, and the CORS preflight from `localhost:5173` passed. Efren checked the React page in a browser and it works. Next: confirm CI is green after the push.
- 2026-10-14 Efren: Wrap-up. Phase 3 code is finished and pushed on `feat/backend-upload-flow`; the only open item is CI going green. Chose oxlint (D16). Next: open the PR, get it green, then move to Phase 4.

## Outcome notes
