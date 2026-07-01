#!/usr/bin/env python3
"""Tạo env.cloudrun.yaml từ .env — dùng cho gcloud run deploy."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "env.cloudrun.yaml"

# Biến cần cho ERP + Phòng họp trên Cloud Run
ENV_KEYS = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "SUPABASE_SERVICE_KEY",
    "PUBLIC_BASE_URL",
    "FIREBASE_DATABASE_URL",
    "FIREBASE_STORAGE_BUCKET",
    "MEETING_DOCS_BUCKET",
    "MEETING_DOCS_MAX_MB",
    "EMAIL_SENDER",
    "EMAIL_PASSWORD",
    "OPENWEATHER_API_KEY",
    "MAPBOX_TOKEN",
    "VOICERSS_API_KEY",
    "RESPONSIVEVOICE_KEY",
]


def load_dotenv() -> None:
    try:
        from dotenv import load_dotenv as _load

        _load(ROOT / ".env")
    except ImportError:
        pass


def yaml_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def main() -> None:
    load_dotenv()
    project = os.getenv("FIREBASE_PROJECT", "rriv-erp").strip() or "rriv-erp"

    env: dict[str, str] = {"FLASK_DEBUG": "0"}

    for key in ENV_KEYS:
        val = (os.getenv(key) or "").strip()
        if val:
            env[key] = val

    if not env.get("PUBLIC_BASE_URL"):
        env["PUBLIC_BASE_URL"] = f"https://{project}.web.app"

    if not env.get("FIREBASE_STORAGE_BUCKET"):
        env["FIREBASE_STORAGE_BUCKET"] = f"{project}.firebasestorage.app"

    if not env.get("MEETING_DOCS_BUCKET"):
        env["MEETING_DOCS_BUCKET"] = "meeting-docs"

    sa_path = (os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH") or "").strip()
    if sa_path and not os.path.isabs(sa_path):
        sa_path = str(ROOT / sa_path)
    if sa_path and os.path.isfile(sa_path):
        with open(sa_path, encoding="utf-8") as fh:
            env["FIREBASE_SERVICE_ACCOUNT"] = json.dumps(json.load(fh), separators=(",", ":"))
    elif (os.getenv("FIREBASE_SERVICE_ACCOUNT") or "").strip():
        raw = os.getenv("FIREBASE_SERVICE_ACCOUNT", "").strip()
        try:
            env["FIREBASE_SERVICE_ACCOUNT"] = json.dumps(json.loads(raw), separators=(",", ":"))
        except json.JSONDecodeError:
            env["FIREBASE_SERVICE_ACCOUNT"] = raw

    missing = []
    if not env.get("SUPABASE_URL"):
        missing.append("SUPABASE_URL")
    if not env.get("SUPABASE_KEY"):
        missing.append("SUPABASE_KEY")
    if not env.get("FIREBASE_DATABASE_URL"):
        missing.append("FIREBASE_DATABASE_URL")
    if not env.get("FIREBASE_SERVICE_ACCOUNT"):
        missing.append("FIREBASE_SERVICE_ACCOUNT hoặc FIREBASE_SERVICE_ACCOUNT_PATH")

    if missing:
        print("Thiếu biến bắt buộc trong .env:", ", ".join(missing), file=sys.stderr)
        sys.exit(1)

    lines = [f"{k}: {yaml_quote(v)}" for k, v in env.items()]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Đã ghi {OUT.name} ({len(env)} biến)")
    print(f"PUBLIC_BASE_URL = {env['PUBLIC_BASE_URL']}")


if __name__ == "__main__":
    main()
