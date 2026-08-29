#!/usr/bin/env python3
"""CLI — backup Supabase về máy (dùng chung logic với nút admin trên hub)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from modules.admin.backup_service import create_backup_bytes, save_backup_to_local_dir  # noqa: E402


def main() -> None:
    try:
        content, filename = create_backup_bytes()
    except RuntimeError as exc:
        sys.stderr.write(str(exc) + "\n")
        sys.stderr.write(
            "Thêm SUPABASE_DB_PASSWORD vào .env "
            "(Supabase → Settings → Database).\n"
        )
        sys.exit(1)

    saved = save_backup_to_local_dir(content, filename)
    if saved:
        print(f"Backup: {saved}")
        return

    out_dir = ROOT / "supabase" / "backups" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / filename
    dest.write_bytes(content)
    latest = out_dir / "rriv-data-latest.sql.gz"
    latest.write_bytes(content)
    print(f"Backup: {dest}")
    print(f"Latest: {latest}")
    print(f"Size:   {dest.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
