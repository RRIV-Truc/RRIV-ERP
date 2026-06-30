#!/usr/bin/env python3
"""Sửa trùng Bộ môn Giống → chuyển NV sang Trạm Lai Khê + chuẩn hóa mã VIEN-06-0XX.

Chạy: python scripts/fix_bomon_to_lk.py [--dry-run]
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

DL3_NAME = "Trung tâm nghiên cứu phát triển Giống cao su"

# Mã Excel gốc theo department_id (dl-3 = sheet TT Giống → 06)
DEPT_CODE_SUFFIX = {
    "dl-1": "01",
    "dl-5": "03",
    "dl-6": "02",
    "dl-2": "05",
    "dl-3": "06",
    "dl-4": "07",
}


def canonical_code(dept_id: str, stt: int) -> str:
    suffix = DEPT_CODE_SUFFIX.get(dept_id, dept_id.split("-")[1])
    return f"VIEN-{suffix}-{stt:03d}"


def parse_stt_from_code(code: str) -> int | None:
    m = re.match(r"^VIEN-\d+-(\d+)$", code or "")
    if not m:
        return None
    return int(m.group(1))


def move_bomon_to_lk(db, dry_run: bool) -> int:
    res = (
        db.table("employee")
        .select("id, full_name, employee_code")
        .eq("team_id", "bomon-giong")
        .execute()
    )
    n = 0
    for e in res.data or []:
        n += 1
        if dry_run:
            print(f"  [bomon→lk] {e.get('employee_code')} {e['full_name'][:28]}")
        else:
            db.table("employee").update({
                "team_id": "team-lk",
                "team_name": "Trạm Lai Khê",
            }).eq("id", e["id"]).execute()
    if not dry_run:
        db.table("category_teams").update({
            "name": "Bộ môn Giống (đã gộp)",
            "metadata": {"retired": True, "merged_into": "team-lk"},
        }).eq("id", "bomon-giong").execute()
    return n


def fix_unassigned_teams(db, dry_run: bool) -> int:
    """Gán trạm cho NV dl-3 chưa có team (tránh node Bộ môn Giống trùng)."""
    res = (
        db.table("employee")
        .select("id, employee_code, metadata")
        .eq("department_id", "dl-3")
        .is_("team_id", "null")
        .execute()
    )
    n = 0
    for e in res.data or []:
        code = e.get("employee_code") or ""
        if code.startswith("VIEN-09-") or code.startswith("VIEN-9-"):
            tid, tname = "tram-tay-nguyen", "Trạm Tây Nguyên"
        elif code.startswith("VIEN-10-"):
            tid, tname = "tram-phu-yen", "Trạm Phú Yên"
        else:
            tid, tname = "team-lk", "Trạm Lai Khê"
        n += 1
        if dry_run:
            print(f"  [assign] {code} → {tname}")
        else:
            db.table("employee").update({
                "team_id": tid,
                "team_name": tname,
            }).eq("id", e["id"]).execute()
    return n


def fix_vien_codes(db, dry_run: bool) -> int:
    """VIEN-3-19 → VIEN-06-019; VIEN-06-3 → VIEN-06-003 (chỉ thêm số 0, không đổi phòng)."""
    res = (
        db.table("employee")
        .select("id, employee_code")
        .like("employee_code", "VIEN-%")
        .execute()
    )
    n = 0
    for e in res.data or []:
        code = e.get("employee_code") or ""
        new_code = None
        m3 = re.match(r"^VIEN-3-(\d+)$", code)
        if m3:
            new_code = f"VIEN-06-{int(m3.group(1)):03d}"
        else:
            m = re.match(r"^VIEN-(\d+)-(\d+)$", code)
            if m and len(m.group(2)) < 3:
                new_code = f"VIEN-{m.group(1)}-{int(m.group(2)):03d}"
        if not new_code or new_code == code:
            continue
        n += 1
        if dry_run:
            print(f"  [code] {code} → {new_code}")
        else:
            clash = (
                db.table("employee")
                .select("id")
                .eq("employee_code", new_code)
                .neq("id", e["id"])
                .limit(1)
                .execute()
            )
            if clash.data:
                print(f"  [skip clash] {code} → {new_code}")
                continue
            db.table("employee").update({"employee_code": new_code}).eq("id", e["id"]).execute()
    return n


def delete_vien3_duplicates(db, dry_run: bool) -> int:
    """Xóa bản ghi trùng VIEN-3-XXX khi đã có VIEN-06-XXX cùng STT."""
    res = (
        db.table("employee")
        .select("id, employee_code, full_name")
        .like("employee_code", "VIEN-3-%")
        .execute()
    )
    n = 0
    for e in res.data or []:
        stt = parse_stt_from_code(e.get("employee_code") or "")
        if stt is None:
            continue
        canon = f"VIEN-06-{stt:03d}"
        dup = (
            db.table("employee")
            .select("id")
            .eq("employee_code", canon)
            .limit(1)
            .execute()
        )
        if not dup.data:
            continue
        n += 1
        if dry_run:
            print(f"  [del dup] {e['employee_code']} (→ {canon})")
        else:
            db.table("employee").delete().eq("id", e["id"]).execute()
    return n


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

    db = create_client(url, key)
    print("=== Bộ môn Giống → Trạm Lai Khê + mã NV ===")
    m1 = move_bomon_to_lk(db, args.dry_run)
    m2 = fix_unassigned_teams(db, args.dry_run)
    m3 = fix_vien_codes(db, args.dry_run)
    m4 = delete_vien3_duplicates(db, args.dry_run)
    print(f"Hoàn tất. bomon→LK: {m1} | gán trạm: {m2} | sửa mã: {m3} | xóa trùng: {m4}")


if __name__ == "__main__":
    main()
