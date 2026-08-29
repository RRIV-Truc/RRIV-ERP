"""Backup PostgreSQL Supabase — dùng cho script CLI và API admin."""
from __future__ import annotations

import gzip
import io
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
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


def _pooler_hosts(region: str) -> list[str]:
    hosts: list[str] = []
    custom = (os.getenv("SUPABASE_DB_POOLER_HOST") or "").strip()
    if custom:
        hosts.append(custom.rstrip("/"))
    for idx in range(4):
        hosts.append(f"aws-{idx}-{region}.pooler.supabase.com")
    # giữ thứ tự, bỏ trùng
    out: list[str] = []
    for h in hosts:
        if h not in out:
            out.append(h)
    return out


def _on_render_or_ipv4_only() -> bool:
    return bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))


def connection_targets() -> list[dict[str, Any]]:
    """Ưu tiên DATABASE_URL / pooler IPv4. Render không dùng direct (IPv6)."""
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
        for pooler_host in _pooler_hosts(region):
            add({
                "host": pooler_host,
                "port": 6543,
                "user": f"postgres.{ref}",
                "password": password,
                "dbname": "postgres",
                "via": f"pooler-tx-{pooler_host}",
            })
            add({
                "host": pooler_host,
                "port": 5432,
                "user": f"postgres.{ref}",
                "password": password,
                "dbname": "postgres",
                "via": f"pooler-session-{pooler_host}",
            })
        if not _on_render_or_ipv4_only():
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


def _rest_config() -> tuple[str, str]:
    base = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if not base or not key:
        raise RuntimeError("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_KEY cho backup REST.")
    return base, key


def _rest_request(
    path: str,
    *,
    headers: dict[str, str] | None = None,
    accept: str = "application/json",
) -> tuple[int, dict[str, str], bytes]:
    base, key = _rest_config()
    url = f"{base}/rest/v1{path}"
    req_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": accept,
    }
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, resp_headers, body
    except urllib.error.HTTPError as exc:
        body = exc.read()
        raise RuntimeError(f"REST {path} failed ({exc.code}): {body[:300]!r}") from exc


def _rest_table_names() -> list[str]:
    _, _, body = _rest_request("/", accept="application/openapi+json")
    spec = json.loads(body.decode("utf-8"))
    names: list[str] = []
    for path in spec.get("paths", {}):
        if path.startswith("/") and path.count("/") == 1:
            name = path[1:]
            if name:
                names.append(name)
    return sorted(set(names))


def _rest_sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        encoded = json.dumps(value, ensure_ascii=False).replace("'", "''")
        return f"'{encoded}'::jsonb"
    text = str(value).replace("'", "''")
    return f"'{text}'"


def _dump_with_rest_api() -> bytes:
    base, key = _rest_config()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = io.StringIO()
    out.write("-- RRIV ERP — backup Supabase qua REST API (public schema)\n")
    out.write(f"-- Generated: {now}\n\n")
    out.write("SET client_encoding = 'UTF8';\n\n")

    page_size = 500
    tables = _rest_table_names()
    print(f"[backup] REST: {len(tables)} tables")

    for table in tables:
        quoted = f'"{table}"'
        path = f"/{quote_plus(table)}?select=*"
        offset = 0
        row_count = 0
        cols: list[str] | None = None
        table_started = False

        while True:
            headers = {
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page_size - 1}",
                "Prefer": "count=exact",
            }
            _, resp_headers, body = _rest_request(path, headers=headers)
            rows = json.loads(body.decode("utf-8"))
            if not isinstance(rows, list):
                break
            if not rows:
                if not table_started:
                    out.write(f"\n-- Table: {table} (0 rows)\n")
                break

            if not table_started:
                out.write(f"\n-- Table: {table}\n")
                table_started = True

            if cols is None:
                cols = list(rows[0].keys())
                col_sql = ", ".join(f'"{c}"' for c in cols)

            for row in rows:
                vals = ", ".join(_rest_sql_literal(row.get(c)) for c in cols)
                out.write(
                    f'INSERT INTO public.{quoted} ({col_sql}) VALUES ({vals});\n'
                )
            row_count += len(rows)

            content_range = resp_headers.get("content-range", "")
            if "/" in content_range:
                try:
                    total = int(content_range.rsplit("/", 1)[1])
                except ValueError:
                    total = None
            else:
                total = None

            if total is not None and row_count >= total:
                break
            if len(rows) < page_size:
                break
            offset += page_size

        if table_started and row_count:
            out.write(f"-- End {table}: {row_count} rows\n")

    print("[backup] OK via REST API")
    return out.getvalue().encode("utf-8")


def _run_backup(use_pg_dump: bool) -> tuple[bytes, str]:
    targets = connection_targets()
    has_rest = bool(
        (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
        and (os.getenv("SUPABASE_URL") or "").strip()
    )
    if not targets and not has_rest:
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

    service_key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    if service_key and os.getenv("SUPABASE_URL"):
        try:
            raw = _dump_with_rest_api()
            return _gzip_sql(raw)
        except Exception as exc:
            print(f"[backup] REST fallback failed: {exc}")
            last_err = exc

    raise RuntimeError(
        "Không kết nối được Supabase DB. Trên Render: thêm DATABASE_URL "
        "(Supabase → Connect → Transaction pooler, copy nguyên URI). "
        "Hoặc thêm SUPABASE_DB_POOLER_HOST nếu host không phải aws-0."
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
