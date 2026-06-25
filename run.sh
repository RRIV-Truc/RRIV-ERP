#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Thiếu file .env — copy từ .env.example và điền SUPABASE_URL, SUPABASE_KEY"
  exit 1
fi

python3 -m pip install -r requirements.txt -q
export PORT="${PORT:-8080}"
export FLASK_DEBUG="${FLASK_DEBUG:-1}"

echo "RRIV ERP: http://localhost:${PORT}"
python3 app.py
