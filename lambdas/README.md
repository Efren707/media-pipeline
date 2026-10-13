# lambdas/

Python 3.12 Lambda functions, one folder per pipeline stage. All of them run as **`lambda-run-role`**, which can only read and write S3 and write logs (see [SETUP.md §4](../SETUP.md#4-sandbox-test-results-tested-2026-09-30)).

Functions:
- `validate/`: implemented checkpoint stage; checks key syntax, byte size, true file format and decoded dimensions, generates a metadata-free thumbnail, writes status, and creates the next-stage manifest
- `analyze/`: tagging and moderation with a self-hosted ONNX model (weights loaded from S3), then write `results/{user}/{job}.json`

Rules:
- S3 is the only AWS service these functions may call.
- Heavy dependencies go in a Lambda layer.
