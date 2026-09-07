#!/usr/bin/env python3
from __future__ import annotations
import os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL_FILES = [
    ROOT / "supabase" / "schema-spm-gv.sql",
    ROOT / "supabase" / "patch-spm-gv-v2.sql",
]


def load_dotenv() -> None:
    try:
        from dotenv import load_dotenv as _load
        _load(ROOT / ".env")
    except ImportError:
        pass


def project_ref_from_url(url: str):
    import re
    m = re.search(r"https://([a-z0-9]+)\.supabase\.co", url or "")
    return m.group(1) if m else None


def build_database_url() -> str:
    from urllib.parse import quote_plus
    direct = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if direct:
        return direct.strip()
    password = os.getenv("SUPABASE_DB_PASSWORD")
    ref = os.getenv("SUPABASE_PROJECT_REF") or project_ref_from_url(os.getenv("SUPABASE_URL", ""))
    if password and ref:
        region = os.getenv("SUPABASE_DB_REGION", "ap-southeast-1")
        host = os.getenv("SUPABASE_DB_POOLER_HOST") or ("aws-1-%s.pooler.supabase.com" % region)
        return "postgresql://postgres.%s:%s@%s:6543/postgres?sslmode=require" % (
            ref, quote_plus(password), host
        )
    return ""


def main() -> None:
    load_dotenv()
    dsn = build_database_url()
    if not dsn:
        print("Missing DATABASE_URL")
        sys.exit(1)
    import psycopg2
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    for path in SQL_FILES:
        sql = path.read_text(encoding="utf-8")
        print(">>", path.name)
        cur.execute(sql)
        print("   OK")
    conn.close()


if __name__ == "__main__":
    main()
