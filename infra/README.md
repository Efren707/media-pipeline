# infra/

TypeScript AWS CDK app for the sandbox-compatible Media Pipeline. The current checkpoint stack deploys:

- one private, SSE-S3-encrypted media bucket;
- a TLS-only bucket policy, narrow CORS configuration, and 30-day demo-data lifecycle;
- the Python 3.12 Validate Lambda using the existing `lambda-run-role`;
- an `uploads/`-only S3 event notification and explicit Lambda permission;
- a one-week CloudWatch log group.

It deliberately creates no IAM role and no NAT Gateway.

## Local verification

```bash
cd infra
npm ci
python ../lambdas/validate/build_package.py --offline-local
npm run build
npm test

MP_OWNER=local \
CDK_DEFAULT_ACCOUNT=123456789012 \
CDK_DEFAULT_REGION=us-east-1 \
npx cdk synth --quiet

npm run check:template
```

## AWS Academy deployment

Start the lab, load the temporary credentials, and run from the repository root:

```bash
export MP_OWNER=fahad
scripts/deploy-checkpoint.sh
scripts/checkpoint-smoke-test.sh path/to/test.jpg
```

Do not run a normal `cdk bootstrap`. The deployment script creates the account-specific assets bucket and the app uses `CliCredentialsStackSynthesizer`.

## Optional resource teardown

The guarded teardown script removes the deployed checkpoint stack and demo data only. It never removes the repository:

```bash
scripts/destroy-checkpoint-resources.sh 'destroy MediaPipeline-fahad'
```
