# Analyze Lambda

The Analyze stage is invoked by S3 objects under `stage/analyze/`. It validates the manifest identity, conditionally claims the job as `ANALYZING`, downloads the exact source ETag validated by the previous stage, runs an ONNX classifier, and writes:

- `results/{userId}/{jobId}.json`
- terminal status `COMPLETE` or `FLAGGED`

The moderation result is a transparent restricted-label policy over classifier labels. It is intended for the class demonstration and is not described as general NSFW detection.

## Runtime configuration

| Variable | Purpose |
|---|---|
| `MEDIA_BUCKET_NAME` | Expected private media bucket |
| `EXPECTED_BUCKET_OWNER` | Prevents accidental cross-account S3 requests |
| `MODEL_KEY` | Fixed trusted key under `models/` |
| `LABELS_KEY` | Fixed trusted ImageNet label key under `models/` |
| `MODEL_VERSION` | Version recorded in every result |
| `MIN_LABEL_CONFIDENCE` | Minimum confidence returned to the user |
| `MODERATION_THRESHOLD` | Confidence required for a restricted label to flag a job |

The function uses the existing `lambda-run-role` and calls only S3 and CloudWatch Logs. It does not accept a model path from a manifest or user request.

## Local tests

```bash
python -m unittest discover -s lambdas/analyze/tests -v
```

Tests inject a small fake classifier. The real ONNX model and labels are deployment assets stored under the configured private `models/` keys.
