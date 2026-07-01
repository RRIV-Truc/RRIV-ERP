#!/usr/bin/env python3
"""Áp schema + patch Phòng họp lên Supabase (chạy một lần hoặc khi có patch mới)."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL_FILES = [
    ROOT / "supabase" / "schema-meetings.sql",
    ROOT / "supabase" / "patch-meeting-documents-20260701.sql",
    ROOT / "supabase" / "patch-meeting-document-shares-20260702.sql",
    ROOT / "supabase" / "seed-phonghop-rbac.sql",
    ROOT / "supabase" / "patch-phonghop-hub-enabled.sql",
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
        except Exception as exc:
            print(f"   FAIL {path.name}: {exc}")
            conn.close()
            sys.exit(1)

    cur.execute(
        "SELECT COUNT(*) FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_name = 'meetings'"
    )
    n = cur.fetchone()[0]
    print(f"\nDone. Bảng meetings: {'OK' if n else 'THIẾU'}")
    conn.close()


def main() -> None:
    load_dotenv()
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    ref = os.getenv("SUPABASE_PROJECT_REF") or project_ref_from_url(supabase_url)
    dsn = build_database_url()
    if not dsn:
        sys.stderr.write(
            "Thiếu kết nối Postgres Supabase.\n\n"
            "Cách 1 — thêm vào file .env (cùng thư mục dự án):\n"
            "  SUPABASE_DB_PASSWORD=mat_khau_database\n"
            f"  (project ref: {ref or 'chưa có SUPABASE_URL'})\n\n"
            "Lấy mật khẩu: Supabase Dashboard → Project Settings → Database\n"
            "  → Database password (Reset nếu quên)\n\n"
            "Cách 2 — dán full connection string:\n"
            "  DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@...\n"
            "  (Dashboard → Database → Connection string → Session pooler)\n\n"
            "Cách 3 — không cần .env: Supabase → SQL Editor → chạy file:\n"
            "  supabase/apply-phonghop-combined.sql\n"
        )
        sys.exit(1)

    safe = re.sub(r":([^:@/]+)@", ":***@", dsn)
    print(f"Phòng họp — apply schema Supabase\nConnecting: {safe}\n")
    run_sql_files(dsn)
    print(
        "\nTiếp theo trên Supabase Dashboard → Storage:\n"
        "  • Tạo bucket private tên: meeting-docs\n"
        "  • Policies: service role upload/read (server Flask dùng SUPABASE_SERVICE_KEY)\n"
    )


if __name__ == "__main__":
    main()
