# Validate Lambda

The S3-triggered first stage of the pipeline. It accepts only objects under `uploads/`, verifies the true image format and decoded size, creates a metadata-free JPEG thumbnail, and writes status and Analyze-stage manifest JSON.

The source download uses its inspected ETag as an `If-Match` precondition. Before creating outputs, Validate conditionally claims a missing, `QUEUED`, or matching `VALIDATING` job. Thumbnail and manifest writes use create-only conditions, and the final status uses a compare-and-swap update. The manifest is written before `READY_FOR_ANALYSIS`, duplicate events accept only outputs from the same source, and later or terminal status is never overwritten.

## Local tests

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

The 16 tests include corrupt images, stale S3 events, first-upload behavior without `s3:ListBucket`, source changes during download, concurrent duplicate events, terminal-status protection, watchdog failure, and job-ID reuse.

## Build for Lambda

From `infra/`, `npm run build:lambda` downloads a Python 3.12 manylinux x86_64 Pillow wheel and creates `lambdas/validate/dist/`. CDK packages that directory.

For an offline syntax/synthesis check on a compatible x86_64 Linux machine:

```bash
python build_package.py --offline-local
```

The normal deployment build is preferred because it explicitly selects a Lambda-compatible wheel.
