#!/usr/bin/env bash
# Phase 10 (D22): install the built app on the demo EC2 over SSH.
# Usage: scripts/install-demo-app.sh <path-to-private-key>
# Needs: active Academy credentials, a stack deployed with withServer=true (and withDb=true),
# backend/target/*.jar and frontend/dist built. Secrets are read from .env and sent over SSH
# stdin into a root-only file; they are never printed, put in user data, or passed as arguments.
set -euo pipefail

KEY="${1:?usage: $0 <path-to-private-key>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${MP_OWNER:?MP_OWNER missing in .env}"
: "${MP_JWT_SECRET:?MP_JWT_SECRET missing in .env}"
: "${MP_DB_PASSWORD:?MP_DB_PASSWORD missing in .env}"

if ! aws sts get-caller-identity --query Arn --output text | grep -q 'assumed-role/voclabs/'; then
  echo "Not on the AWS Academy lab role. Start the lab and refresh credentials." >&2
  exit 1
fi

STACK="MediaPipeline-${MP_OWNER}"
output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
SERVER_IP="$(output ServerPublicIp)"
DB_HOST="$(output DbEndpoint)"
BUCKET="$(output MediaBucketName)"
if [[ -z "$SERVER_IP" || "$SERVER_IP" == "None" ]]; then
  echo "No ServerPublicIp output: deploy with -c withServer=true first." >&2
  exit 1
fi
if [[ -z "$DB_HOST" || "$DB_HOST" == "None" ]]; then
  echo "No DbEndpoint output: deploy with -c withDb=true too." >&2
  exit 1
fi

JAR="$(ls backend/target/backend-*.jar 2>/dev/null | grep -v plain | head -1 || true)"
[[ -f "$JAR" ]] || { echo "Build the backend first: (cd backend && ./mvnw package)" >&2; exit 1; }
[[ -f frontend/dist/index.html ]] || { echo "Build the frontend first: (cd frontend && npm run build)" >&2; exit 1; }

KNOWN_HOSTS="${TMPDIR:-/tmp}/mp-demo-known-hosts"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$KNOWN_HOSTS"
  -o ConnectTimeout=10 -o BatchMode=yes)
TARGET="ec2-user@${SERVER_IP}"

echo "Waiting for SSH and first-boot setup..."
for _ in $(seq 1 30); do
  if ssh "${SSH_OPTS[@]}" "$TARGET" 'cloud-init status --wait >/dev/null; true' 2>/dev/null; then
    break
  fi
  sleep 10
done
ssh "${SSH_OPTS[@]}" "$TARGET" 'cloud-init status' | grep -q 'status: done' || {
  echo "cloud-init did not finish cleanly on the server." >&2
  exit 1
}

echo "Copying the app..."
tar -C frontend/dist -czf "${TMPDIR:-/tmp}/mp-frontend.tgz" .
scp "${SSH_OPTS[@]}" -q "$JAR" "$TARGET:/tmp/backend.jar"
scp "${SSH_OPTS[@]}" -q "${TMPDIR:-/tmp}/mp-frontend.tgz" deploy/nginx.conf \
  deploy/media-pipeline.service "$TARGET:/tmp/"

echo "Writing the root-only environment file..."
printf '%s\n' \
  "MP_JWT_SECRET=${MP_JWT_SECRET}" \
  "MP_DB_URL=jdbc:postgresql://${DB_HOST}:5432/mediapipeline?sslmode=require" \
  "MP_DB_USER=mpadmin" \
  "MP_DB_PASSWORD=${MP_DB_PASSWORD}" \
  "MP_MEDIA_BUCKET=${BUCKET}" \
  "AWS_REGION=${AWS_REGION:-us-east-1}" |
  ssh "${SSH_OPTS[@]}" "$TARGET" \
    'sudo install -o root -g root -m 0600 /dev/stdin /etc/media-pipeline.env'

echo "Installing and starting..."
ssh "${SSH_OPTS[@]}" "$TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail
sudo install -o mp -g mp -m 0640 /tmp/backend.jar /opt/media-pipeline/backend.jar
sudo rm -rf /usr/share/nginx/media-pipeline/*
sudo tar -C /usr/share/nginx/media-pipeline -xzf /tmp/mp-frontend.tgz
sudo install -m 0644 /tmp/nginx.conf /etc/nginx/conf.d/media-pipeline.conf
# Ours is default_server and conf.d is included first, so it wins over the stock :80 block.
sudo install -m 0644 /tmp/media-pipeline.service /etc/systemd/system/media-pipeline.service
rm -f /tmp/backend.jar /tmp/mp-frontend.tgz /tmp/nginx.conf /tmp/media-pipeline.service
sudo nginx -t -q
sudo systemctl daemon-reload
sudo systemctl enable --now media-pipeline >/dev/null
sudo systemctl restart media-pipeline nginx
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/jobs || true)"
  [[ "$code" == "401" ]] && { echo "Health check: /api/jobs -> 401 (up, needs login)"; exit 0; }
  sleep 2
done
echo "Backend did not come up. Last log lines:" >&2
sudo journalctl -u media-pipeline -n 30 --no-pager | grep -viE 'password|secret|token' >&2
exit 1
REMOTE

cat <<EOF

The app is running. Open the tunnel (leave it running), then browse http://localhost:8088:

  ssh -i "$KEY" -o UserKnownHostsFile="$KNOWN_HOSTS" -N -L 8088:localhost:80 $TARGET

EOF
