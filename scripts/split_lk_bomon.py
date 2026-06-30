#!/usr/bin/env python3
"""Tách NV VIEN-06-001..029 tại Trạm Lai Khê → Bộ môn Giống.

Chạy: python scripts/split_lk_bomon.py [--dry-run] [--max-stt 29]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

BOMON_ID = "bomon-giong"
BOMON_NAME = "Bộ môn Giống"
LK_ID = "team-lk"
LK_NAME = "Trạm Lai Khê"


def parse_vien06_stt(code: str) -> int | None:
    m = re.match(r"^VIEN-06-(\d+)$", (code or "").upper())
    return int(m.group(1)) if m else None


def restore_bomon_team(db, dry_run: bool) -> None:
    row = {
        "id": BOMON_ID,
        "name": BOMON_NAME,
        "department": "dl-3",
        "metadata": {"order": 0, "org_unit": "discipline"},
    }
    if dry_run:
        print(f"  [team] khôi phục {BOMON_NAME}")
    else:
        db.table("category_teams").upsert(row).execute()


def split_lk_to_bomon(db, dry_run: bool, max_stt: int) -> int:
    res = (
        db.table("employee")
        .select("id, employee_code, full_name, team_id")
        .eq("team_id", LK_ID)
        .like("employee_code", "VIEN-06-%")
        .execute()
    )
    n = 0
    for e in res.data or []:
        stt = parse_vien06_stt(e.get("employee_code") or "")
        if stt is None or stt > max_stt:
            continue
        n += 1
        if dry_run:
            print(f"  [bomon] {e['employee_code']} {e['full_name'][:28]}")
        else:
            db.table("employee").update({
                "team_id": BOMON_ID,
                "team_name": BOMON_NAME,
            }).eq("id", e["id"]).execute()
    return n


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-stt", type=int, default=29)
    args = parser.parse_args()

    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL / SUPABASE_KEY")
        sys.exit(1)

    db = create_client(url, key)
    print(f"=== Tách VIEN-06-001..{args.max_stt:03d} → {BOMON_NAME} ===")
    restore_bomon_team(db, args.dry_run)
    moved = split_lk_to_bomon(db, args.dry_run, args.max_stt)
    print(f"Hoàn tất. Chuyển sang {BOMON_NAME}: {moved}")


if __name__ == "__main__":
    main()
