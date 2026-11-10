# Phase 7: Auth & users

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner(s):** Both · **Target:** Nov 1 · **Planned on:** 2026-11-09

## Goal
Replace the Phase 3 demo user with real accounts. Users sign up and log in through Spring Security with a JWT, user records live in PostgreSQL (RDS on AWS), and every upload, status and result stays scoped to the caller's own `{userId}` S3 prefix.

## Scope
**In:**
- Prove RDS PostgreSQL works in the sandbox (create, connect, stop, delete)
- An opt-in RDS instance in the CDK stack (L1 constructs, default VPC, smallest size)
- `users` table with Flyway migrations
- `POST /api/auth/signup` and `POST /api/auth/login` returning a JWT; all `/api/jobs/**` endpoints require one
- A JWT-backed `CurrentUser` replacing `DemoCurrentUser`
- React login/signup pages, token in `sessionStorage`, sent as `Authorization: Bearer`
- Backend tests on a real Postgres via Testcontainers

**Out (deferred or not doing):**
- SNS email subscription at signup (Phase 8)
- Label indexing/search tables (Phase 9)
- EC2 → RDS networking for the deployed backend (Phase 10)
- Password reset, email verification, refresh tokens, roles/admin
- Secrets Manager (costs money; the DB password comes from `.env`)

## Decisions
| Decision | Choice | Why |
|---|---|---|
| Auth mechanism | Spring Security + self-issued JWT (D5) | Cognito is blocked. Use `spring-boot-starter-oauth2-resource-server` with an HS256 `JwtEncoder`/`JwtDecoder` instead of a third-party JWT library. |
| Signing key | `MP_JWT_SECRET` (≥ 32 bytes) from `.env`; the app refuses to start without it outside tests | Never committed; one shared secret is enough for a single backend. |
| Token lifetime | 60 min access token, no refresh token | Covers a demo session; re-login is acceptable. |
| Token transport | `Authorization: Bearer`, stored in `sessionStorage` | Stateless and no CSRF handling. Works the same behind CloudFront in Phase 10. React's escaping limits the XSS exposure. |
| Passwords | BCrypt (Spring Security default `PasswordEncoder`) | Standard salted hashing, with nothing extra to configure. |
| `userId` | Server-generated UUID; the username is a separate unique column | Satisfies the `CurrentUser` id rule (letters, digits, `-`). Keeps usernames out of S3 keys and the Phase 8 SNS filter. |
| Schema | Flyway migrations (`V1__users.sql`), `ddl-auto=validate` | Repeatable on Testcontainers, local runs and RDS. |
| RDS provisioning | L1 `CfnDBInstance` in `MediaPipeline-<owner>`, created only with `-c withDb=true` | The default deploy stays Lambda-only and free. Destroying the DB at `/wrap-up` avoids the storage cost while it's stopped. |
| RDS size | `db.t3.micro`, PostgreSQL, 20 GB gp2, single-AZ, no backups (`BackupRetentionPeriod: 0`), deletion policy `Delete` | Cost rules; class data is disposable. |
| RDS network | Default VPC. Publicly accessible, with a security group allowing 5432 only from `-c dbClientCidr=<my-ip>/32` | Lets a laptop backend reach it until Phase 10 moves the backend to EC2 (which then gets its own SG rule). No NAT. |
| DB credentials | Master password passed as a `NoEcho` CfnParameter from `.env` (`MP_DB_PASSWORD`) | Keeps the plaintext out of the synthesized template and the repo. |
| Local/test DB | Testcontainers PostgreSQL | Real Postgres behavior for free. Needs Docker Desktop locally; GitHub CI has Docker. |

## Tasks
- [ ] **Sandbox probe:** create, connect to, stop and delete a `db.t3.micro` Postgres via the CLI. Record the result in SETUP.md §4's service table (currently "not tested yet"). (Both)
- [ ] **Infra:** opt-in RDS (`withDb` context): DB subnet group on the default VPC subnets, security group, `CfnDBInstance`, `NoEcho` password parameter, endpoint output. `cdk synth` must still contain no `AWS::IAM::Role`. Add CDK tests for both flag states. (Both)
- [ ] **Backend data layer:** Postgres driver, Spring Data JPA, Flyway `V1__users.sql` (`id uuid pk`, `username unique`, `password_hash`, `created_at`), and a Testcontainers base test. (Both)
- [ ] **Backend auth:** `SecurityConfig` (stateless, JWT resource server, `/api/auth/**` open, everything else authenticated); `AuthController` signup/login with validation (username pattern, password ≥ 8); `JwtCurrentUser` replaces `DemoCurrentUser`; drop `mp.demo-user-id`; 401/409 errors through `ApiErrorHandler`. (Both)
- [ ] **Backend isolation tests:** user A can't read user B's job status or result (404, not 403, so job IDs don't leak); unauthenticated requests get 401. (Both)
- [ ] **Frontend:** login and signup pages, an auth context holding the token in `sessionStorage`, a fetch wrapper adding the Bearer header and sending a 401 back to login, a logout button. (Both)
- [ ] **Docs:** `docs/media_pipeline.md` (auth flow + `users` table), SETUP.md (new `.env` keys: `MP_JWT_SECRET`, `MP_DB_PASSWORD`, `MP_DB_URL`; deploy with/without DB; Docker requirement), decisions.md entries for anything that changes from this table. (Both)
- [ ] **Live check:** deploy with `withDb=true`, run the backend locally against RDS, then run the demo steps below, capture evidence, and destroy the DB. (Both)

## Acceptance criteria
- [ ] Two users can sign up and log in, and each sees only their own uploads (roadmap "done when").
- [ ] Every `/api/jobs/**` endpoint returns 401 without a valid token; S3 keys come only from the token's `userId`.
- [ ] Passwords are stored only as BCrypt hashes; no secret or DB password is in the repo or the synthesized template.
- [ ] The default `cdk deploy` creates no RDS; `withDb=true` creates exactly one `db.t3.micro`, and `cdk synth` has no `AWS::IAM::Role`.
- [ ] Backend tests (including Testcontainers), frontend tests, CDK tests, linters and CI are green.

## Test / demo steps
1. `cdk deploy -c withDb=true -c dbClientCidr=<my-ip>/32 --parameters DbPassword=$MP_DB_PASSWORD`, and copy the `DbEndpoint` output into `MP_DB_URL`.
2. Start the backend and frontend locally against RDS.
3. Sign up as `alice`, upload a photo, and wait for `COMPLETED`.
4. In a private window, sign up as `bob`. Bob's dashboard is empty. Calling Alice's job ID with Bob's token returns 404.
5. Call `curl /api/jobs/...` with no token and get 401.
6. Check S3: Alice's objects are under `uploads/<alice-uuid>/` only.
7. Run `/wrap-up`: redeploy without `withDb` (or `cdk destroy`) and confirm no DB instance is left.

## Open questions
- Does the Academy sandbox let us create RDS subnet groups and security groups in the default VPC? The probe task answers this. Fallback #6 (built-in demo accounts) applies if RDS is blocked.
- Do we keep jobs already created under the `demo-user` prefix? Proposal: no, they're test data.

## Progress log
- 2026-11-09 Efren: plan drafted.

## Outcome notes
