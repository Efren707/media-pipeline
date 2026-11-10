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

# Phase 7: MP_WITH_DB=true adds RDS PostgreSQL. A later deploy without it DELETES the database.
DB_ARGS=()
if [[ "${MP_WITH_DB:-false}" == "true" ]]; then
  if [[ -z "${MP_DB_PASSWORD:-}" && -f "$REPOSITORY_ROOT/.env" ]]; then
    MP_DB_PASSWORD="$(sed -n 's/^MP_DB_PASSWORD=//p' "$REPOSITORY_ROOT/.env" | tr -d '\r')"
  fi
  : "${MP_DB_PASSWORD:?Set MP_DB_PASSWORD (16+ letters and digits) in .env}"
  CLIENT_IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
  DB_ARGS=(-c withDb=true -c "dbClientCidr=${CLIENT_IP}/32" --parameters "DbPassword=${MP_DB_PASSWORD}")
  echo "Including RDS; port 5432 open to ${CLIENT_IP}/32 only."
fi

cd "$REPOSITORY_ROOT/infra"
npm ci
npm run verify
npx cdk deploy "MediaPipeline-${MP_OWNER}" --require-approval never "${DB_ARGS[@]}"

echo "Checkpoint infrastructure deployed."
echo "Media bucket: mp-${MP_OWNER}-media-${ACCOUNT_ID}"
if [[ ${#DB_ARGS[@]} -gt 0 ]]; then
  echo "Database endpoint: see the DbEndpoint stack output. Stop or remove it at /wrap-up."
fi
