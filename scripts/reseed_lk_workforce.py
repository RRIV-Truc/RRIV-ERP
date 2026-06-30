#!/usr/bin/env python3
"""Khôi phục 49 CN/KH Lai Khê từ seed-laikhe-workforce.sql (upsert theo employee_code).

Chạy: python scripts/reseed_lk_workforce.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

SEED = ROOT / "supabase" / "seed-laikhe-workforce.sql"
NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
DL3 = "Trung tâm nghiên cứu phát triển Giống cao su"


def parse_lk_rows() -> list[dict]:
    text = SEED.read_text(encoding="utf-8")
    rows = []
    pat = re.compile(
        r"\(uuid_generate_v5\([^,]+,\s*'lk:([^']+)'\),\s*"
        r"'(LK-(?:CN|KH)-\d+)',\s*'([^']+)',\s*"
        r"'([^']+)',\s*'([^']+)',\s*"
        r"'dl-3',\s*'[^']+',\s*'team-lk',\s*'[^']+',\s*"
        r"'([^']+)',\s*'active',\s*'(wg-lk-(?:cn|kh))',\s*'user',\s*'(\{[^']+\})'\)"
    )
    for m in pat.finditer(text):
        lk_key, code, name, nid, username, position, wg, meta_s = m.groups()
        meta = json.loads(meta_s.replace("'", '"'))
        rows.append({
            "id": str(uuid.uuid5(NS, f"lk:{lk_key}")),
            "employee_code": code,
            "full_name": name,
            "national_id": nid,
            "username": username,
            "department_id": "dl-3",
            "department_name": DL3,
            "team_id": "team-lk",
            "team_name": "Trạm Lai Khê",
            "position_name": position,
            "employment_status": "active",
            "work_group_id": wg,
            "erp_role": "user",
            "metadata": meta,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL / SUPABASE_KEY")
        sys.exit(1)

    rows = parse_lk_rows()
    print(f"Parsed {len(rows)} LK workers from seed")
    if not rows:
        print("Không parse được — kiểm tra seed-laikhe-workforce.sql")
        sys.exit(1)

    db = create_client(url, key)
    cn = kh = 0
    for row in rows:
        code = row["employee_code"]
        meta = dict(row["metadata"])
        if code.startswith("LK-KH-"):
            meta["institute_hr"] = False
            meta["hr_scope"] = "production_kh"
            kh += 1
        else:
            meta.pop("institute_hr", None)
            meta.pop("hr_scope", None)
            cn += 1
        row["metadata"] = meta
        eid = row.pop("id")
        patch = {**row}

        if args.dry_run:
            print(f"  {code} {patch['full_name'][:25]}")
            continue

        by_code = db.table("employee").select("id").eq("employee_code", code).limit(1).execute()
        if by_code.data:
            db.table("employee").update(patch).eq("employee_code", code).execute()
            continue
        by_id = db.table("employee").select("id").eq("id", eid).limit(1).execute()
        if by_id.data:
            db.table("employee").update({**patch, "employee_code": code}).eq("id", eid).execute()
        else:
            db.table("employee").insert({**patch, "id": eid}).execute()
    print(f"Hoàn tất. LK-CN: {cn} | LK-KH: {kh}")


if __name__ == "__main__":
    main()
