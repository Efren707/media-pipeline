# Phase 5: Analyze Stage

**Roadmap:** [ROADMAP.md](../../ROADMAP.md) · **Owner:** Fahad · **Target:** 2026-11-09 · **Planned on:** 2026-11-09

## Goal

Complete the smallest secure, demonstrable AWS pipeline: upload → validate → thumbnail → classify → final labels/moderation status.

## Scope

**In:**

- SqueezeNet 1.1 inference with ONNX Runtime
- immutable result JSON and `COMPLETE`/`FLAGGED` status
- source ETag, user/job identity, and terminal-state protections
- API result retrieval and a final-result React dashboard
- Academy-compatible CDK using the existing `lambda-run-role`

**Out (deferred):**

- RDS, JWT login, gallery search, SNS email, ALB, and CloudFront
- general NSFW detection; this release uses a documented restricted-label review policy

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Model | SqueezeNet 1.1 ONNX | Small enough for Lambda and sufficient for an explainable class demo |
| Moderation | Restricted ImageNet labels | Honest, testable behavior without claiming unsupported NSFW coverage |
| Model source | Fixed private S3 keys | Manifests and users cannot select executable/model data |
| Delivery | Local API/UI plus AWS S3/Lambdas | Meets the end-to-end goal without late RDS/networking risk |

## Completed locally

- [x] Analyze core and secure S3 handler
- [x] Lambda packaging and CDK event wiring
- [x] API result scoping and final React states
- [x] Python, frontend, contract, CDK, synth, and forbidden-resource checks
- [ ] Backend Maven verification (runs in GitHub CI; Maven Central is unavailable in the current workspace)

## AWS Academy deployment checklist

1. Start the Academy lab and load its temporary AWS credentials.
2. Prepare a SqueezeNet 1.1 opset-7 ONNX file and a matching 1,000-line ImageNet label file.
3. Deploy and capture the bucket name:

   ```bash
   export MP_OWNER=fahad
   scripts/deploy-checkpoint.sh
   export MEDIA_BUCKET="mp-${MP_OWNER}-media-$(aws sts get-caller-identity --query Account --output text)"
   ```

4. Upload only the trusted assets to the fixed keys:

   ```bash
   aws s3 cp path/to/squeezenet1.1-7.onnx "s3://${MEDIA_BUCKET}/models/squeezenet1.1-7.onnx" --sse AES256
   aws s3 cp path/to/imagenet-labels.txt "s3://${MEDIA_BUCKET}/models/imagenet-labels.txt" --sse AES256
   ```

5. Run the API and UI in separate terminals:

   ```bash
   MP_MEDIA_BUCKET="$MEDIA_BUCKET" AWS_REGION=us-east-1 ./backend/mvnw -f backend/pom.xml spring-boot:run
   npm run dev --prefix frontend
   ```

6. Open `http://localhost:5173`, upload a JPEG/PNG/WebP, and wait for `Analysis complete` or `Needs review`.

## Demo evidence checklist

- [ ] CloudFormation stack resources show the private bucket plus Validate and Analyze Lambdas
- [ ] Valid image reaches `COMPLETE`, displays a thumbnail and top labels
- [ ] Restricted-label test reaches `FLAGGED` and displays its review category
- [ ] Invalid or mislabeled file reaches `FAILED` with a safe error
- [ ] S3 shows matching `status/`, `thumbnails/`, `stage/analyze/`, and `results/` objects
- [ ] CloudWatch logs show the job ID without credentials, URLs, or image content
- [ ] Record a backup screen capture after the live walkthrough works

## Remaining risks

- A model/label mismatch produces incorrect label names; use the pair from the same model distribution.
- The Academy session can expire during deployment; start with a fresh session and keep the demo recording.
- The model may cold-start slowly; the Lambda has 120 seconds, 3,008 MB memory, and 2 GB temporary storage.

## Progress log

- 2026-11-09 Fahad: implemented and locally verified the deadline-rescue vertical slice; live Academy deployment and screenshots remain.

## Outcome notes

The portfolio repository remains permanent after grading. Optional AWS teardown removes deployed resources only.
