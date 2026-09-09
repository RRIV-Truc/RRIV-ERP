# -*- coding: utf-8 -*-
"""Apply schema-spm-gv.sql once, then patch v2 (columns + Hi?n/KTC)."""
from __future__ import annotations

import os
from pathlib import Path

_APPLIED = False
ROOT = Path(__file__).resolve().parents[2]
SQL_PATH = ROOT / "supabase" / "schema-spm-gv.sql"
PATCH_FILES = [
    ROOT / "supabase" / "patch-spm-gv-v2.sql",
    ROOT / "supabase" / "patch-spm-gv-v3.sql",
    ROOT / "supabase" / "patch-spm-gv-v4.sql",
]


def _dsn() -> str:
    for key in ("DATABASE_URL", "SUPABASE_DB_URL"):
        raw = (os.getenv(key) or "").strip()
        if raw:
            if "sslmode=" not in raw:
                raw += ("&" if "?" in raw else "?") + "sslmode=require"
            return raw
    return ""


def _run_sql(sql: str) -> None:
    import psycopg2
    dsn = _dsn()
    if not dsn:
        raise RuntimeError("no dsn")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(sql)
    cur.close()
    conn.close()


def ensure_schema() -> None:
    global _APPLIED
    if _APPLIED:
        return
    try:
        from flask import current_app
        sb = current_app.config.get("SUPABASE_CLIENT")
        if sb is not None:
            sb.table("spm_gv_departments").select("id").limit(1).execute()
    except Exception:
        dsn = _dsn()
        if dsn and SQL_PATH.is_file():
            try:
                _run_sql(SQL_PATH.read_text(encoding="utf-8"))
                print("[spm_gv] schema applied")
            except Exception as exc:
                print(f"[spm_gv] schema apply skipped: {exc}")
    for path in PATCH_FILES:
        if not path.is_file():
            continue
        try:
            _run_sql(path.read_text(encoding="utf-8"))
            print("[spm_gv] applied", path.name)
        except Exception as exc:
            print(f"[spm_gv] {path.name} skipped: {exc}")
    _APPLIED = True
