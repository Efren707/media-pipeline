#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: MP_OWNER=fahad scripts/checkpoint-smoke-test.sh path/to/test.jpg" >&2
  exit 2
fi

: "${MP_OWNER:?Export MP_OWNER first, for example: export MP_OWNER=fahad}"
if [[ ! "$MP_OWNER" =~ ^[a-z0-9][a-z0-9-]{1,19}$ ]]; then
  echo "MP_OWNER must contain 2-20 lowercase letters, numbers, or hyphens." >&2
  exit 2
fi

IMAGE_PATH="$1"
if [[ ! -f "$IMAGE_PATH" ]]; then
  echo "Image not found: $IMAGE_PATH" >&2
  exit 2
fi

EXTENSION="${IMAGE_PATH##*.}"
EXTENSION="${EXTENSION,,}"
case "$EXTENSION" in
  jpg|jpeg) CONTENT_TYPE="image/jpeg" ;;
  png) CONTENT_TYPE="image/png" ;;
  webp) CONTENT_TYPE="image/webp" ;;
  *) echo "Use a JPEG, PNG, or WebP test image." >&2; exit 2 ;;
esac

DEMO_USER="${MP_DEMO_USER:-demo-user}"
if [[ ! "$DEMO_USER" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
  echo "MP_DEMO_USER contains unsupported characters." >&2
  exit 2
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="mp-${MP_OWNER}-media-${ACCOUNT_ID}"
JOB_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
UPLOAD_KEY="uploads/${DEMO_USER}/${JOB_ID}.${EXTENSION}"
STATUS_KEY="status/${DEMO_USER}/${JOB_ID}.json"
THUMBNAIL_KEY="thumbnails/${DEMO_USER}/${JOB_ID}.jpg"
MANIFEST_KEY="stage/analyze/${DEMO_USER}/${JOB_ID}.json"
TEMP_DIRECTORY="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIRECTORY"' EXIT

aws s3 cp "$IMAGE_PATH" "s3://${BUCKET}/${UPLOAD_KEY}" \
  --content-type "$CONTENT_TYPE" \
  --sse AES256

echo "Uploaded job ${JOB_ID}; waiting for validation..."
for _ in $(seq 1 30); do
  if aws s3 cp "s3://${BUCKET}/${STATUS_KEY}" "$TEMP_DIRECTORY/status.json" \
    --only-show-errors >/dev/null 2>&1; then
    STATE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["state"])' "$TEMP_DIRECTORY/status.json")"
    if [[ "$STATE" == "READY_FOR_ANALYSIS" ]]; then
      aws s3api head-object --bucket "$BUCKET" --key "$THUMBNAIL_KEY" >/dev/null
      aws s3api head-object --bucket "$BUCKET" --key "$MANIFEST_KEY" >/dev/null
      echo "PASS: ${JOB_ID} reached READY_FOR_ANALYSIS and produced both outputs."
      exit 0
    fi
    if [[ "$STATE" == "FAILED" ]]; then
      echo "FAIL: validation rejected the upload:" >&2
      python3 -m json.tool "$TEMP_DIRECTORY/status.json" >&2
      exit 1
    fi
  fi
  sleep 2
done

echo "FAIL: job did not reach a final checkpoint state within 60 seconds." >&2
exit 1
