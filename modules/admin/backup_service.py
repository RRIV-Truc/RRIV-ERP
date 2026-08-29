"""Backup PostgreSQL Supabase — dùng cho script CLI và API admin."""
from __future__ import annotations

import gzip
import io
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus


def project_ref_from_url(url: str) -> str | None:
    m = re.search(r"https://([a-z0-9]+)\.supabase\.co", url or "")
    return m.group(1) if m else None


def build_direct_db_url() -> str:
    password = os.getenv("SUPABASE_DB_PASSWORD")
    ref = os.getenv("SUPABASE_PROJECT_REF") or project_ref_from_url(
        os.getenv("SUPABASE_URL", "")
    )
    if password and ref:
        pwd = quote_plus(password)
        return f"postgresql://postgres:{pwd}@db.{ref}.supabase.co:5432/postgres"

    direct = (os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL") or "").strip()
    if direct and re.search(r"db\.[a-z0-9]+\.supabase\.co:5432", direct):
        return direct
    return ""


def find_pg_dump() -> str | None:
    found = shutil.which("pg_dump")
    if found:
        return found
    for ver in ("17", "16", "15", "14", "13"):
        candidate = Path(rf"C:\Program Files\PostgreSQL\{ver}\bin\pg_dump.exe")
        if candidate.exists():
            return str(candidate)
    return None


def _dump_with_pg_dump(dsn: str, pg_dump: str) -> bytes:
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        subprocess.run(
            [
                pg_dump,
                "--no-owner",
                "--no-acl",
                "--schema=public",
                "--format=plain",
                "--file",
                tmp_path,
                dsn,
            ],
            check=True,
            capture_output=True,
        )
        raw = Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    return raw


def _sql_literal(cur, value) -> str:
    if value is None:
        return "NULL"
    adapted = cur.mogrify("%s", (value,)).decode("utf-8")
    return adapted


def _dump_with_psycopg2(dsn: str) -> bytes:
    import psycopg2

    conn = psycopg2.connect(dsn)
    conn.set_client_encoding("UTF8")
    cur = conn.cursor()

    out = io.StringIO()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out.write("-- RRIV ERP — backup dữ liệu Supabase (public schema)\n")
    out.write(f"-- Generated: {now}\n\n")
    out.write("SET client_encoding = 'UTF8';\n\n")

    cur.execute(
        """
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
        """
    )
    tables = [r[0] for r in cur.fetchall()]

    for table in tables:
        cur.execute(f'SELECT COUNT(*) FROM public."{table}"')
        count = int(cur.fetchone()[0])
        out.write(f"\n-- Table: {table} ({count} rows)\n")
        if count == 0:
            continue

        cur.execute(f'SELECT * FROM public."{table}"')
        cols = [d[0] for d in cur.description]
        col_sql = ", ".join(f'"{c}"' for c in cols)

        while True:
            rows = cur.fetchmany(400)
            if not rows:
                break
            for row in rows:
                vals = ", ".join(_sql_literal(cur, v) for v in row)
                out.write(f'INSERT INTO public."{table}" ({col_sql}) VALUES ({vals});\n')

    cur.close()
    conn.close()
    return out.getvalue().encode("utf-8")


def create_backup_bytes() -> tuple[bytes, str]:
    """Tạo file .sql.gz — ưu tiên pg_dump, fallback psycopg2."""
    dsn = build_direct_db_url()
    if not dsn:
        raise RuntimeError(
            "Thiếu SUPABASE_DB_PASSWORD hoặc DATABASE_URL trực tiếp (db.*.supabase.co:5432)."
        )

    pg_dump = find_pg_dump()
    if pg_dump:
        raw = _dump_with_pg_dump(dsn, pg_dump)
    else:
        raw = _dump_with_psycopg2(dsn)

    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    filename = f"rriv-data-{stamp}.sql.gz"
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(raw)
    return buf.getvalue(), filename


def save_backup_to_local_dir(content: bytes, filename: str) -> Optional[str]:
    """Ghi file vào BACKUP_LOCAL_DIR nếu server chạy trên máy có thư mục đó."""
    target_dir = (os.getenv("BACKUP_LOCAL_DIR") or "").strip()
    if not target_dir:
        return None
    folder = Path(target_dir)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / filename
    dest.write_bytes(content)
    latest = folder / "rriv-data-latest.sql.gz"
    latest.write_bytes(content)
    return str(dest)
