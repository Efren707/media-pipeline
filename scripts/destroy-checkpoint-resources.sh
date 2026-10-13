#!/usr/bin/env bash
set -euo pipefail

: "${MP_OWNER:?Export MP_OWNER first, for example: export MP_OWNER=fahad}"
if [[ ! "$MP_OWNER" =~ ^[a-z0-9][a-z0-9-]{1,19}$ ]]; then
  echo "MP_OWNER must contain 2-20 lowercase letters, numbers, or hyphens." >&2
  exit 2
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="mp-${MP_OWNER}-media-${ACCOUNT_ID}"
STACK="MediaPipeline-${MP_OWNER}"
EXPECTED_CONFIRMATION="destroy ${STACK}"

export CDK_DEFAULT_ACCOUNT="$ACCOUNT_ID"
export CDK_DEFAULT_REGION="${AWS_REGION:-us-east-1}"

if [[ "${1:-}" != "$EXPECTED_CONFIRMATION" ]]; then
  echo "This removes deployed checkpoint resources and demo data, but never source code." >&2
  echo "Run again with the exact confirmation argument:" >&2
  echo "  scripts/destroy-checkpoint-resources.sh '${EXPECTED_CONFIRMATION}'" >&2
  exit 2
fi

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
aws s3 rm "s3://${BUCKET}" --recursive --only-show-errors || true

cd "$REPOSITORY_ROOT/infra"
npx cdk destroy "$STACK" --force

echo "Removed deployed checkpoint resources. Project files and the reusable CDK assets bucket remain."
