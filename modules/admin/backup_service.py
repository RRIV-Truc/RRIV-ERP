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
from typing import Any, Optional
from urllib.parse import quote_plus


def project_ref_from_url(url: str) -> str | None:
    m = re.search(r"https://([a-z0-9]+)\.supabase\.co", url or "")
    return m.group(1) if m else None


def _ensure_sslmode(dsn: str) -> str:
    if "sslmode=" in dsn:
        return dsn
    sep = "&" if "?" in dsn else "?"
    return dsn + sep + "sslmode=require"


def _conn_label(target: dict[str, Any]) -> str:
    if target.get("dsn"):
        return re.sub(r":([^:@/]+)@", ":***@", target["dsn"])
    return "{user}@{host}:{port}/{dbname}".format(
        user=target.get("user", "?"),
        host=target.get("host", "?"),
        port=target.get("port", "?"),
        dbname=target.get("dbname", "postgres"),
    )


def connection_targets() -> list[dict[str, Any]]:
    """Danh sách cách kết nối — ưu tiên pooler 6543 (IPv4, giống apply_supabase_schema)."""
    targets: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(target: dict[str, Any]) -> None:
        key = _conn_label(target)
        if key in seen:
            return
        seen.add(key)
        targets.append(target)

    for env_name in ("DATABASE_URL", "SUPABASE_DB_URL"):
        raw = (os.getenv(env_name) or "").strip()
        if raw:
            add({"dsn": _ensure_sslmode(raw), "via": env_name})

    password = os.getenv("SUPABASE_DB_PASSWORD")
    ref = os.getenv("SUPABASE_PROJECT_REF") or project_ref_from_url(
        os.getenv("SUPABASE_URL", "")
    )
    if password and ref:
        region = os.getenv("SUPABASE_DB_REGION", "ap-southeast-1")
        pooler_host = f"aws-0-{region}.pooler.supabase.com"
        add({
            "host": pooler_host,
            "port": 6543,
            "user": f"postgres.{ref}",
            "password": password,
            "dbname": "postgres",
            "via": "pooler-tx-6543",
        })
        add({
            "host": pooler_host,
            "port": 5432,
            "user": f"postgres.{ref}",
            "password": password,
            "dbname": "postgres",
            "via": "pooler-session-5432",
        })
        add({
            "host": f"db.{ref}.supabase.co",
            "port": 5432,
            "user": "postgres",
            "password": password,
            "dbname": "postgres",
            "via": "direct",
        })

    return targets


def find_pg_dump() -> str | None:
    found = shutil.which("pg_dump")
    if found:
        return found
    for ver in ("17", "16", "15", "14", "13"):
        candidate = Path(rf"C:\Program Files\PostgreSQL\{ver}\bin\pg_dump.exe")
        if candidate.exists():
            return str(candidate)
    return None


def _connect_psycopg2(target: dict[str, Any]):
    import psycopg2

    if target.get("dsn"):
        return psycopg2.connect(_ensure_sslmode(target["dsn"]), connect_timeout=20)
    return psycopg2.connect(
        host=target["host"],
        port=target["port"],
        user=target["user"],
        password=target["password"],
        dbname=target["dbname"],
        sslmode="require",
        connect_timeout=20,
    )


def _dump_with_pg_dump(target: dict[str, Any], pg_dump: str) -> bytes:
    import tempfile

    if target.get("dsn"):
        dsn = _ensure_sslmode(target["dsn"])
    else:
        pwd = quote_plus(target["password"])
        dsn = _ensure_sslmode(
            "postgresql://{user}:{pwd}@{host}:{port}/{dbname}".format(
                user=target["user"],
                pwd=pwd,
                host=target["host"],
                port=target["port"],
                dbname=target["dbname"],
            )
        )

    with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        proc = subprocess.run(
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
            text=True,
        )
        if proc.stderr:
            print(f"[backup] pg_dump stderr: {proc.stderr[:500]}")
        return Path(tmp_path).read_bytes()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _sql_literal(cur, value) -> str:
    if value is None:
        return "NULL"
    return cur.mogrify("%s", (value,)).decode("utf-8")


def _dump_with_psycopg2(target: dict[str, Any]) -> bytes:
    conn = _connect_psycopg2(target)
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


def _gzip_sql(raw: bytes) -> tuple[bytes, str]:
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    filename = f"rriv-data-{stamp}.sql.gz"
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(raw)
    return buf.getvalue(), filename


def _run_backup(use_pg_dump: bool) -> tuple[bytes, str]:
    targets = connection_targets()
    if not targets:
        raise RuntimeError(
            "Thiếu SUPABASE_DB_PASSWORD hoặc DATABASE_URL trên Render."
        )

    pg_dump = find_pg_dump() if use_pg_dump else None
    if pg_dump:
        for target in targets:
            try:
                raw = _dump_with_pg_dump(target, pg_dump)
                return _gzip_sql(raw)
            except Exception as exc:
                print(f"[backup] pg_dump via {target.get('via', '?')} failed: {exc}")

    last_err: Exception | None = None
    for target in targets:
        try:
            raw = _dump_with_psycopg2(target)
            print(f"[backup] OK via {target.get('via', _conn_label(target))}")
            return _gzip_sql(raw)
        except Exception as exc:
            last_err = exc
            print(f"[backup] psycopg2 via {target.get('via', '?')} failed: {exc}")

    raise RuntimeError(
        "Không kết nối được Supabase DB. Kiểm tra SUPABASE_DB_PASSWORD trên Render "
        "và Supabase → Database → Network (tắt giới hạn IP hoặc cho phép mọi IP)."
    ) from last_err


def create_backup_bytes() -> tuple[bytes, str]:
    """API / Render — psycopg2, nhiều kiểu kết nối."""
    return _run_backup(use_pg_dump=False)


def create_backup_bytes_local() -> tuple[bytes, str]:
    """CLI máy local — thử pg_dump trước."""
    return _run_backup(use_pg_dump=True)


def save_backup_to_local_dir(content: bytes, filename: str) -> Optional[str]:
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
