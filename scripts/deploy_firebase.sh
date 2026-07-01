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

for cmd in gcloud firebase python3 python; do
  if command -v "$cmd" >/dev/null 2>&1; then
    PYTHON="$cmd"
    [ "$cmd" = "python3" ] || [ "$cmd" = "python" ] && break
  fi
done
if [ -z "${PYTHON:-}" ]; then
  echo "Chưa cài Python"
  exit 1
fi

for cmd in gcloud firebase; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Chưa cài $cmd. Chạy: npm install -g firebase-tools && cài Google Cloud SDK"
    exit 1
  fi
done

echo "==> Project: $PROJECT_ID | Region: $REGION | Service: $SERVICE"
gcloud config set project "$PROJECT_ID"
firebase use "$PROJECT_ID"

echo "==> Tạo env.cloudrun.yaml từ .env..."
"$PYTHON" scripts/build_cloudrun_env.py

echo "==> Deploy Flask lên Cloud Run (gồm module Phòng họp)..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file env.cloudrun.yaml \
  --timeout 120 \
  --memory 512Mi

echo "==> Deploy Firebase Hosting (domain web.app)..."
firebase deploy --only hosting

echo ""
echo "Xong!"
echo "  ERP Hub:    https://${PROJECT_ID}.web.app"
echo "  Phòng họp:  https://${PROJECT_ID}.web.app/app/phonghop"
echo "  Cloud Run:  $(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
