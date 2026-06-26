#!/usr/bin/env bash
# Deploy RRIV-ERP: Firebase domain (*.web.app) + Cloud Run (Flask) + Supabase (DB)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT_ID="${FIREBASE_PROJECT:-rriv-erp}"
REGION="${CLOUD_RUN_REGION:-asia-southeast1}"
SERVICE="${CLOUD_RUN_SERVICE:-rriv-erp}"

if [ ! -f .env ]; then
  echo "Thiếu file .env — cần SUPABASE_URL và SUPABASE_KEY"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

for cmd in gcloud firebase; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Chưa cài $cmd. Chạy: npm install -g firebase-tools && cài Google Cloud SDK"
    exit 1
  fi
done

echo "==> Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE"
gcloud config set project "$PROJECT_ID"
firebase use "$PROJECT_ID"

echo "==> Deploy Flask lên Cloud Run (database vẫn ở Supabase)..."
ENV_VARS="SUPABASE_URL=${SUPABASE_URL},SUPABASE_KEY=${SUPABASE_KEY},FLASK_DEBUG=0"
if [ -n "${EMAIL_SENDER:-}" ]; then
  ENV_VARS="${ENV_VARS},EMAIL_SENDER=${EMAIL_SENDER}"
fi
if [ -n "${EMAIL_PASSWORD:-}" ]; then
  ENV_VARS="${ENV_VARS},EMAIL_PASSWORD=${EMAIL_PASSWORD}"
fi

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "$ENV_VARS"

echo "==> Deploy Firebase Hosting (domain web.app)..."
firebase deploy --only hosting

echo ""
echo "Xong! Mở: https://${PROJECT_ID}.web.app"
echo "Cloud Run: $(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
