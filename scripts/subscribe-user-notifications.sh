#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <user-id>" >&2
  exit 2
}

fail() {
  echo "$1" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
USER_ID="$1"
if [[ ! "$USER_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  fail "User ID must be a canonical lowercase UUID."
fi

if [[ -z "${MP_OWNER:-}" ]]; then
  fail "Set MP_OWNER to your 2-20 character lowercase owner name."
fi
if [[ ! "$MP_OWNER" =~ ^[a-z0-9][a-z0-9-]{1,19}$ ]]; then
  fail "MP_OWNER must contain 2-20 lowercase letters, numbers, or hyphens."
fi

command -v aws >/dev/null 2>&1 || fail "AWS CLI is required."
command -v python >/dev/null 2>&1 || fail "Python is required."

REGION="${AWS_REGION:-us-east-1}"
if ! CALLER_ARN="$(
  aws sts get-caller-identity --query Arn --output text --region "$REGION" 2>/dev/null
)"; then
  fail "Start the AWS Academy lab and load its temporary voclabs credentials first."
fi
if [[ "$CALLER_ARN" != *":assumed-role/voclabs/"* ]]; then
  fail "Start the AWS Academy lab and load its temporary voclabs credentials first."
fi
unset CALLER_ARN

read -r -s -p "Notification email: " EMAIL
printf '\n' >&2
if [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  fail "Enter a valid email address."
fi

if ! TOPIC_ARN="$(
  aws cloudformation describe-stacks \
    --stack-name "MediaPipeline-${MP_OWNER}" \
    --query 'Stacks[0].Outputs[?OutputKey==`ResultsTopicArn`].OutputValue | [0]' \
    --output text \
    --region "$REGION" \
    2>/dev/null
)"; then
  fail "Could not read the results topic. Check the Academy session and deployed stack."
fi
if [[ -z "$TOPIC_ARN" || "$TOPIC_ARN" == "None" ]]; then
  fail "ResultsTopicArn is missing. Deploy the current Media Pipeline stack first."
fi

PRIVATE_DIR="$(mktemp -d)"
chmod 700 "$PRIVATE_DIR"
trap 'rm -rf -- "$PRIVATE_DIR"' EXIT

EMAIL_FILE="$PRIVATE_DIR/email"
SUBSCRIPTIONS_FILE="$PRIVATE_DIR/subscriptions.json"
USER_FILTER_FILE="$PRIVATE_DIR/user-filter.json"
printf '%s' "$EMAIL" > "$EMAIL_FILE"
chmod 600 "$EMAIL_FILE"

python - "$USER_ID" "$USER_FILTER_FILE" <<'PY'
import json
import sys
from pathlib import Path

user_id, output_path = sys.argv[1:]
policy = {
    "Records": {
        "s3": {"object": {"key": [{"prefix": f"results/{user_id}/"}]}}
    }
}
Path(output_path).write_text(
    json.dumps(policy, separators=(",", ":")), encoding="utf-8"
)
PY
chmod 600 "$USER_FILTER_FILE"

if ! aws sns list-subscriptions-by-topic \
  --topic-arn "$TOPIC_ARN" \
  --output json \
  --region "$REGION" \
  > "$SUBSCRIPTIONS_FILE" 2>/dev/null; then
  fail "Could not inspect email subscriptions. Check the Academy session and try again."
fi
chmod 600 "$SUBSCRIPTIONS_FILE"

SUBSCRIPTION_ARN="$(python - "$SUBSCRIPTIONS_FILE" "$EMAIL_FILE" <<'PY'
import json
import sys
from pathlib import Path

subscriptions = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
email = Path(sys.argv[2]).read_text(encoding="utf-8")
matches = [
    item
    for item in subscriptions.get("Subscriptions", [])
    if item.get("Protocol") == "email" and item.get("Endpoint") == email
]
confirmed = next(
    (
        item.get("SubscriptionArn", "")
        for item in matches
        if item.get("SubscriptionArn") not in {"PendingConfirmation", "pending confirmation", ""}
    ),
    "",
)
if confirmed:
    print(confirmed)
elif matches:
    print("PENDING")
PY
)"

if [[ "$SUBSCRIPTION_ARN" == "PENDING" ]]; then
  echo "The email subscription is awaiting confirmation. Confirm it, then run this command again."
  exit 0
fi

if [[ -z "$SUBSCRIPTION_ARN" ]]; then
  SUBSCRIBE_INPUT="$PRIVATE_DIR/subscribe.json"
  python - "$TOPIC_ARN" "$EMAIL_FILE" "$USER_FILTER_FILE" "$SUBSCRIBE_INPUT" <<'PY'
import json
import sys
from pathlib import Path

topic_arn = sys.argv[1]
email = Path(sys.argv[2]).read_text(encoding="utf-8")
filter_policy = Path(sys.argv[3]).read_text(encoding="utf-8")
Path(sys.argv[4]).write_text(
    json.dumps(
        {
            "TopicArn": topic_arn,
            "Protocol": "email",
            "Endpoint": email,
            "Attributes": {
                "FilterPolicy": filter_policy,
                "FilterPolicyScope": "MessageBody",
            },
            "ReturnSubscriptionArn": True,
        },
        separators=(",", ":"),
    ),
    encoding="utf-8",
)
PY
  chmod 600 "$SUBSCRIBE_INPUT"
  if ! aws sns subscribe \
    --cli-input-json "file://${SUBSCRIBE_INPUT}" \
    --region "$REGION" \
    >/dev/null 2>&1; then
    fail "Could not request the email subscription. Check the Academy session and try again."
  fi
  echo "Confirmation requested. Confirm the AWS email, then run this command again."
  exit 0
fi

DENY_INPUT="$PRIVATE_DIR/filter-deny-all.json"
SCOPE_INPUT="$PRIVATE_DIR/filter-scope.json"
POLICY_INPUT="$PRIVATE_DIR/filter-policy.json"
python - "$SUBSCRIPTION_ARN" "$USER_FILTER_FILE" "$DENY_INPUT" "$SCOPE_INPUT" "$POLICY_INPUT" <<'PY'
import json
import sys
from pathlib import Path

subscription_arn, filter_path, deny_path, scope_path, policy_path = sys.argv[1:]
filter_policy = Path(filter_path).read_text(encoding="utf-8")
Path(deny_path).write_text(
    json.dumps(
        {
            "SubscriptionArn": subscription_arn,
            "AttributeName": "FilterPolicy",
            "AttributeValue": json.dumps(
                {"__mp_never__": ["__mp_never__"]}, separators=(",", ":")
            ),
        },
        separators=(",", ":"),
    ),
    encoding="utf-8",
)
Path(scope_path).write_text(
    json.dumps(
        {
            "SubscriptionArn": subscription_arn,
            "AttributeName": "FilterPolicyScope",
            "AttributeValue": "MessageBody",
        },
        separators=(",", ":"),
    ),
    encoding="utf-8",
)
Path(policy_path).write_text(
    json.dumps(
        {
            "SubscriptionArn": subscription_arn,
            "AttributeName": "FilterPolicy",
            "AttributeValue": filter_policy,
        },
        separators=(",", ":"),
    ),
    encoding="utf-8",
)
PY
chmod 600 "$DENY_INPUT" "$SCOPE_INPUT" "$POLICY_INPUT"

if ! aws sns set-subscription-attributes \
  --cli-input-json "file://${DENY_INPUT}" \
  --region "$REGION" \
  2>/dev/null; then
  fail "Could not configure the user filter. State is unchanged; do not process uploads."
fi
if ! aws sns set-subscription-attributes \
  --cli-input-json "file://${SCOPE_INPUT}" \
  --region "$REGION" \
  2>/dev/null; then
  fail "Could not configure the user filter. Notifications remain blocked."
fi
if ! aws sns set-subscription-attributes \
  --cli-input-json "file://${POLICY_INPUT}" \
  --region "$REGION" \
  2>/dev/null; then
  fail "Could not configure the user filter. Notifications remain blocked."
fi

echo "Notification subscription is confirmed and filtered to this user."
