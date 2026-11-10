# infra/

TypeScript AWS CDK app for the sandbox-compatible Media Pipeline. The current checkpoint stack deploys:

- one private, SSE-S3-encrypted media bucket;
- a TLS-only bucket policy, narrow CORS configuration, and 30-day demo-data lifecycle;
- the Python 3.12 Validate and Analyze Lambdas using the existing `lambda-run-role`;
- prefix-scoped S3 event notifications for `uploads/` and `stage/analyze/`;
- explicit S3 invoke permissions and one-week CloudWatch log groups.

It deliberately creates no IAM role and no NAT Gateway.

## Local verification

```bash
cd infra
npm ci
MP_OWNER=local \
CDK_DEFAULT_ACCOUNT=123456789012 \
CDK_DEFAULT_REGION=us-east-1 \
npm run verify
```

`npm run verify` builds both Lambda packages before testing and synthesis, which makes it safe on a clean checkout. The normal builds download Python 3.12 manylinux x86_64 wheels. The Analyze package includes ONNX Runtime, NumPy and Pillow but not the model binary. The `--offline-local` option creates source-only assets for local CDK tests and synthesis; do not deploy those offline assets.

From the repository root, CI also runs:

```bash
python3 scripts/validate_contracts.py
python3 -m unittest discover -s lambdas/validate/tests -v
python3 -m unittest discover -s lambdas/analyze/tests -v
python3 -m unittest discover -s scripts/tests -v
```

## AWS Academy deployment

Start the lab, load the temporary credentials, and run from the repository root:

```bash
export MP_OWNER=fahad
scripts/deploy-checkpoint.sh
scripts/checkpoint-smoke-test.sh path/to/test.jpg
```

Do not run a normal `cdk bootstrap`. The deployment script creates the account-specific assets bucket and the app uses `CliCredentialsStackSynthesizer`.

Before testing Analyze, upload the trusted model and ImageNet label file to the fixed private keys printed in the Lambda configuration:

```bash
aws s3 cp path/to/squeezenet1.1-7.onnx "s3://$MEDIA_BUCKET/models/squeezenet1.1-7.onnx"
aws s3 cp path/to/imagenet-labels.txt "s3://$MEDIA_BUCKET/models/imagenet-labels.txt"
```

The browser and manifests cannot choose these keys. Do not place model files under `uploads/`.

## Optional PostgreSQL (Phase 7)

The database is opt-in, so a normal deploy stays S3 + Lambda only and costs nothing while idle. To include it:

```bash
# .env: MP_DB_PASSWORD=<16+ letters and digits>
MP_WITH_DB=true scripts/deploy-checkpoint.sh
```

This adds one `db.t3.micro` PostgreSQL 18 instance (`mp-<owner>-db`, 20 GB gp2, single-AZ, encrypted, no backups) in the default VPC, plus a security group that opens port 5432 to your current public IP (`/32`) only. The password is a `NoEcho` CloudFormation parameter, so it never appears in the template. The `DbEndpoint` output is the host for `MP_DB_URL`.

**Cost:** about $0.017/hour while running, plus storage while stopped. At `/wrap-up`, redeploy **without** `MP_WITH_DB`; that deletes the instance and its data (`DeletionPolicy: Delete`, no final snapshot). If your IP changes, rerun the deploy with `MP_WITH_DB=true` to update the security group.

Synth acknowledges two CloudFormation validator warnings on purpose: the public endpoint (W9011, needed until the backend runs on EC2 in Phase 10) and the parameter-based password (W1011, since SSM write access is unproven in the sandbox).

## Optional resource teardown

The guarded teardown script removes the deployed checkpoint stack and demo data only. It never removes the repository:

```bash
scripts/destroy-checkpoint-resources.sh 'destroy MediaPipeline-fahad'
```
