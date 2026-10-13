# Validate Lambda

The S3-triggered first stage of the pipeline. It accepts only objects under `uploads/`, verifies the true image format and decoded size, creates a metadata-free JPEG thumbnail, and writes status and Analyze-stage manifest JSON.

## Local tests

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

## Build for Lambda

From `infra/`, `npm run build:lambda` downloads a Python 3.12 manylinux x86_64 Pillow wheel and creates `lambdas/validate/dist/`. CDK packages that directory.

For an offline syntax/synthesis check on a compatible x86_64 Linux machine:

```bash
python build_package.py --offline-local
```

The normal deployment build is preferred because it explicitly selects a Lambda-compatible wheel.
