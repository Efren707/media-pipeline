# Phase 10: Cloud deployment

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner(s):** Efren · **Target:** Nov 13 · **Planned on:** 2026-11-10

## Goal
Run the whole app on AWS for the demo: Spring Boot and the React build on one `t3.micro`, a private RDS PostgreSQL, and the existing S3/Lambda/SNS pipeline. Classmates reach it at a public HTTPS CloudFront address during the demo (D23); the operator also keeps the SSH tunnel. No database port and no direct app port is public. It must be quick to bring up at the start of a session and tear down at the end (D22). This follows the approved [demo-first completion spec](../superpowers/specs/2026-11-10-demo-first-completion-design.md#phase-10-single-host-aws-deployment).

## Scope
**In:**
- Opt-in CDK `withServer`: one EC2 `t3.micro` on Amazon Linux 2023 with the `myS3Role` instance profile and the `vockey` key pair. Its security group allows SSH (22) from one `/32` only.
- With `withServer` + `withDb`: RDS is `PubliclyAccessible: false`, and port 5432 accepts connections only from the EC2 security group. The laptop `/32` rule is used only without the server.
- User data installs only Java 21 and Nginx. It holds no secrets, because user data shows up in the template and the console.
- `deploy/`: the Nginx site (serves `/`, proxies `/api` to `127.0.0.1:8080`) and a systemd unit (non-root `mp` user, `EnvironmentFile=/etc/media-pipeline.env`).
- Scripts: `deploy-demo.sh`, `demo-status.sh`, `stop-demo.sh`, `destroy-demo.sh` (see Tasks).
- Opt-in CDK `public` (D23, requires `withServer`): a CloudFront distribution with the EC2 public DNS name as an HTTP origin, HTTPS for viewers (HTTP redirects), `/api/*` uncached with all viewer headers forwarded except `Host`, `/assets/*` cached, the rest uncached. The server security group opens port 80 only to the CloudFront origin-facing managed prefix list. The bucket CORS adds `https://<distribution>.cloudfront.net`. Output: `PublicUrl`.

**Out (deferred or not doing):**
- ALB, Auto Scaling, a custom domain and an ACM certificate (D22, D23). The ROADMAP §10 wording is updated.
- Completion emails for classmates. SNS subscriptions stay operator-created for our demo accounts (D19).
- CI/CD to EC2. Deploys run from a laptop with active Academy credentials.

## Decisions
| Decision | Choice | Why |
|---|---|---|
| Shape | One EC2 behind an SSH tunnel (D22) | Cheapest at about $0.03/h with RDS, no public ports, and the fewest moving parts before Nov 16. An ALB would add about $0.02/h and more setup. |
| AMI | CloudFormation parameter of type `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>`, default `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64` | Always gets the current AL2023 and puts no AMI ID in git. Probe: readable from the lab login, 2026-11-10. |
| Identity on EC2 | Instance profile `myS3Role`; no AWS keys on the host | Sandbox rule. S3 access comes from the role (the probe found the `myS3Role` instance profile). |
| Key pair | Parameter `keyName`, default `vockey`; the private key (`labsuser.pem`) stays outside the repo | Academy provides `vockey` (probe). Nothing secret gets committed. |
| Build | Build the JAR and `dist/` on the laptop (`./mvnw package`, `npm run build`), then copy them with `scp` | The instance needs no Maven/npm and no internet for dependencies. Matches the spec's mitigation. |
| Secrets | `MP_JWT_SECRET`, DB URL/user/password written to `/etc/media-pipeline.env` (`0600`, root) over SSH from `.env` | Never in user data, the template, git or logs (spec). The RDS password stays a `NoEcho` parameter (D20). |
| Tunnel | `ssh -i labsuser.pem -L 8088:localhost:80 ec2-user@<ip>`, browse `http://localhost:8088` | Local 8080 is taken on Efren's laptop. 8088 works on both laptops. |
| Public access | CloudFront in front of EC2, opt-in `-c public=true` (D23) | HTTPS on `*.cloudfront.net` with no domain, about $0 at class scale, AWS-native. Probe: CloudFront actions allowed by the IAM simulator, managed policies and prefix list readable (2026-11-10). |
| Port 80 source | Managed prefix list `com.amazonaws.global.cloudfront.origin-facing`, ID resolved by `deploy-demo.sh` and passed as `-c cloudfrontPrefixList=pl-...` | Only CloudFront can reach Nginx; no ID hardcoded in git. The list counts as about 55 rules against the 60-rule security group quota, so it fits next to the SSH rule. |
| Teardown | `destroy-demo.sh` = redeploy without `withServer`/`withDb` (removes EC2 + RDS; S3/Lambda/SNS stay) after typed confirmation | Same pattern as Phase 7. The cheap pipeline stays deployed between sessions. |

## Tasks
- [x] CDK `withServer` (+ private RDS when combined): EC2, security groups, instance profile, AMI/key parameters, user data, `ServerPublicIp` output; tests check no `AWS::IAM::Role`, no `0.0.0.0/0` ingress, no 80/8080/5432 open to any CIDR when the server exists, RDS private (Efren)
- [x] `deploy/nginx.conf`, `deploy/media-pipeline.service` (Efren)
- [ ] `scripts/deploy-demo.sh`: check the `voclabs` identity, build and test, deploy with `withServer`+`withDb` and the caller's `/32`, wait for SSH and cloud-init, `scp` the JAR, `dist/` and env file, enable and restart the service, run a health check through SSH, print the tunnel command. Python unit tests in `scripts/tests/` cover argument and identity guards (Efren)
- [ ] `scripts/demo-status.sh` (stack, EC2 and RDS state, rough cost per hour while running, no secrets), `stop-demo.sh` (stop EC2 + RDS), `destroy-demo.sh` (typed confirmation, then a teardown check that no instance or DB remains) (Efren)
- [ ] CDK `public` (D23): distribution, port 80 from the prefix list, bucket CORS origin, `PublicUrl` output; tests check no `AWS::IAM::Role`, no `0.0.0.0/0` ingress, port 80 only from a prefix list, and that `public` without `withServer` fails (Efren)
- [ ] `deploy-demo.sh --public`: resolve the prefix list ID, wait for the distribution to deploy, check `PublicUrl/api/jobs` returns 401 and `http://` redirects to `https://`; `destroy-demo.sh` waits for the distribution to be deleted (Efren)
- [ ] Docs: infra README, SETUP.md (download `labsuser.pem`, tunnel), `media_pipeline.md` deployment section (Efren)
- [ ] Live check in a fresh lab session; sanitized evidence in the Progress log; teardown verified (Efren)

## Acceptance criteria
- [ ] Through the tunnel, a fresh browser can sign up, log in, upload, watch the status change, see the result in the gallery, and find it by label.
- [ ] There are no AWS credentials on the instance (`~/.aws` absent; S3 works via `myS3Role`).
- [ ] From outside, only port 22 from the deployer's `/32` is reachable. RDS isn't publicly accessible.
- [ ] Secrets appear in neither the synthesized template, user data, script output nor app logs.
- [ ] After `destroy-demo.sh`, no EC2 instance or DB instance from the stack remains.
- [ ] From a classmate's device (phone on cellular), `https://<id>.cloudfront.net` supports signup, login, upload, the status change, the gallery and label search. The JWT `Authorization` header reaches Spring through CloudFront.
- [ ] Port 80 on the instance's public IP isn't reachable from the laptop; only CloudFront can reach it.
- [ ] After `destroy-demo.sh`, no CloudFront distribution from the stack remains.
- [ ] CDK tests, script tests, linters and CI pass.

## Test / demo steps
1. Start the lab, refresh credentials, and download `labsuser.pem` (AWS Details → Download PEM) to `~/.ssh/`. Never put it in the repo.
2. `scripts/deploy-demo.sh`. It prints the tunnel command when the health check passes.
3. Run the tunnel and open `http://localhost:8088`. Sign up as alice, upload, then search.
4. `ssh ... 'ls ~/.aws; sudo ss -tlnp'`: no `~/.aws`, and Spring is bound to `127.0.0.1:8080` only.
5. `nc -vz <ip> 80` and `nc -vz <db-endpoint> 5432` from the laptop both fail.
6. `scripts/deploy-demo.sh --public`, then open the printed `PublicUrl` on a phone on cellular data: sign up as carol, upload, search. `curl -I http://<id>.cloudfront.net` returns a redirect to HTTPS, and `nc -vz <ip> 80` from the laptop still fails.
7. `scripts/destroy-demo.sh`, then `scripts/demo-status.sh` shows no EC2/RDS.

## Open questions
- Does `stop-demo.sh` add enough over destroy? RDS restarts take about 5 minutes, and a stopped RDS still bills storage and restarts itself after 7 days. Proposal: keep it, but recommend destroy at session end.
- ~~Does the Academy SCP allow `ec2:RunInstances` for `t3.micro` with an instance profile?~~ Yes: `run-instances --dry-run` with `vockey`, `myS3Role`, IMDSv2 and the SSM AMI returned "would have succeeded" (2026-11-10). A real CloudFormation launch is still checked in the live task.

- Does CloudFront forward the `Authorization` header with the managed `CachingDisabled` + `AllViewerExceptHostHeader` policies? Check in the first live run; if not, use a custom cache policy with `Authorization` in the key and a TTL of 0.
- Should signups or uploads be capped per user while the URL is public (moderation already flags NSFW images)? Proposal: a per-user upload cap if time allows; otherwise bring the server up only for the demo window.

## Progress log
- 2026-11-10 Efren: planned Phase 10 from the demo-first spec (D22). Probes: key pair `vockey` exists, instance profile `myS3Role` exists, default VPC present, and the AL2023 SSM public parameter is readable. Next: CDK `withServer`.
- 2026-11-10 Efren: CDK `withServer` (+ private RDS) with 29 CDK tests; `run-instances --dry-run` confirmed the launch permissions. Added `deploy/nginx.conf`, `deploy/media-pipeline.service`, `scripts/install-demo-app.sh` (the core of `deploy-demo.sh`: waits for cloud-init, copies the app over scp, sends the env file over SSH stdin as root 0600, health-checks `/api/jobs` → 401). When `withServer` is set, the stack adds `http://localhost:8088` to the bucket CORS. Live run: `cdk deploy -c withServer=true -c sshCidr=<ip>/32 -c withDb=true` (about 6 min), then install, then tunnel. Results: full flow through the tunnel (signup, S3 PUT, COMPLETE with thumbnail, label search); :80/:8080 blocked from the internet; RDS `PubliclyAccessible: false` and 5432 blocked from the laptop; no `~/.aws` on the host, which uses `instance-profile/myS3Role`; Spring bound to `127.0.0.1:8080`; env file `root:root 600`; no secrets in the journal. Efren chose to keep the SSH tunnel (no public port). Torn down at the end of the session. Next: wrap the steps into `deploy-demo.sh` plus the status, stop and destroy scripts.
- 2026-11-10 Efren: merged #28 (CDK opt-in server + private RDS, Nginx/systemd, install script, tunnel CORS origin) with CI green. Teardown verified: instance terminated, no DB instances, stack outputs back to bucket/Lambdas/SNS. Efren chose to keep the SSH tunnel over a public port (D22 stands). Next: `deploy-demo.sh` and the status, stop and destroy scripts, docs, then a fresh-session live run.
- 2026-11-10 Efren: the professor wants classmates to use the live site, so we compared SSH tunnel, open port 80, Cloudflare Quick Tunnel, CloudFront, ALB over HTTP and ALB + HTTPS. Chose CloudFront in front of the EC2 (D23). Probes: IAM simulator allows the CloudFront create/update/delete actions for `voclabs`; managed cache and origin-request policies and the CloudFront origin-facing prefix list are readable. Next: CDK `public`.

## Outcome notes
