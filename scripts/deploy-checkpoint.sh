#!/usr/bin/env bash
set -euo pipefail

: "${MP_OWNER:?Export MP_OWNER first, for example: export MP_OWNER=fahad}"
if [[ ! "$MP_OWNER" =~ ^[a-z0-9][a-z0-9-]{1,19}$ ]]; then
  echo "MP_OWNER must contain 2-20 lowercase letters, numbers, or hyphens." >&2
  exit 2
fi

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGION="${AWS_REGION:-us-east-1}"
ASSETS_BUCKET="media-pipeline-cdk-assets-${ACCOUNT_ID}"

export AWS_REGION="$REGION"
export CDK_DEFAULT_ACCOUNT="$ACCOUNT_ID"
export CDK_DEFAULT_REGION="$REGION"

if ! aws s3api head-bucket --bucket "$ASSETS_BUCKET" >/dev/null 2>&1; then
  aws s3 mb "s3://${ASSETS_BUCKET}" --region "$REGION"
fi

aws s3api put-public-access-block \
  --bucket "$ASSETS_BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
aws s3api put-bucket-encryption \
  --bucket "$ASSETS_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

cd "$REPOSITORY_ROOT/infra"
npm ci
npm run verify
npx cdk deploy "MediaPipeline-${MP_OWNER}" --require-approval never

echo "Checkpoint infrastructure deployed."
echo "Media bucket: mp-${MP_OWNER}-media-${ACCOUNT_ID}"
