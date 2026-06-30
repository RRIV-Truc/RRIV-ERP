#!/usr/bin/env python3
"""
Áp dụng schema RRIV ERP lên Supabase PostgreSQL.

Cần một trong các biến môi trường trong .env:
  DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@...pooler.supabase.com:6543/postgres
  hoặc
  SUPABASE_DB_PASSWORD=[mật khẩu Database Settings]

Chạy: python scripts/apply_supabase_schema.py
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL_FILES = [
    ROOT / "supabase" / "schema.sql",
    ROOT / "supabase" / "schema-harvest-production.sql",
    ROOT / "supabase" / "seed.sql",
]


def load_dotenv() -> None:
    try:
        from dotenv import load_dotenv as _load

        _load(ROOT / ".env")
    except ImportError:
        pass


def project_ref_from_url(url: str) -> str | None:
    m = re.search(r"https://([a-z0-9]+)\.supabase\.co", url or "")
    return m.group(1) if m else None


def build_database_url() -> str:
    direct = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
    if direct:
        return direct.strip()

    password = os.getenv("SUPABASE_DB_PASSWORD")
    ref = os.getenv("SUPABASE_PROJECT_REF") or project_ref_from_url(
        os.getenv("SUPABASE_URL", "")
    )
    if password and ref:
        # Session pooler (IPv4) — phổ biến trên Supabase
        region = os.getenv("SUPABASE_DB_REGION", "ap-southeast-1")
        return (
            f"postgresql://postgres.{ref}:{password}"
            f"@aws-0-{region}.pooler.supabase.com:6543/postgres"
        )
    return ""


def run_sql_files(dsn: str) -> None:
    try:
        import psycopg2
    except ImportError:
        print("Cài psycopg2-binary: pip install psycopg2-binary")
        sys.exit(1)

    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()

    for path in SQL_FILES:
        if not path.exists():
            print(f"Không tìm thấy: {path}")
            sys.exit(1)
        sql = path.read_text(encoding="utf-8")
        print(f">> {path.name} ({len(sql)} chars)...")
        try:
            cur.execute(sql)
            print(f"   OK {path.name}")
        except Exception as e:
            print(f"   FAIL {path.name}: {e}")
            conn.close()
            sys.exit(1)

    cur.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """
    )
    tables = [r[0] for r in cur.fetchall()]
    print(f"\nDone. {len(tables)} tables in public schema:")
    for t in tables:
        print(f"  - {t}")

    conn.close()


def main() -> None:
    load_dotenv()
    dsn = build_database_url()
    if not dsn:
        sys.stderr.write(
            "Missing DB connection. Add to .env:\n"
            "  SUPABASE_DB_PASSWORD=...  (Supabase Dashboard -> Settings -> Database)\n"
            "  or DATABASE_URL=postgresql://...\n"
        )
        sys.exit(1)

    safe = re.sub(r":([^:@/]+)@", ":***@", dsn)
    print(f"Connecting: {safe}\n")
    run_sql_files(dsn)


if __name__ == "__main__":
    main()
