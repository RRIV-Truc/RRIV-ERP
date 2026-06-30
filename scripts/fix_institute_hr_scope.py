#!/usr/bin/env python3
"""Phân tách nhân sự Viện vs KH sản xuất Lai Khê (KHÔNG xóa CN).

- Bộ môn Giống (bomon-giong): VIEN-06-001..029
- Trạm Lai Khê (team-lk): VIEN-06-030+ và CN/KH sản xuất
- LK-KH-*: chỉ quản lý sản xuất (ẩn khỏi module Nhân sự Viện)

Chạy: python scripts/fix_institute_hr_scope.py [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

import re

LK_INSTITUTE_STAFF = [
    "Nguyễn Thị Ngọc Tuyết",
]


def is_kh_position(name: str | None) -> bool:
    return "khoán hộ" in (name or "").lower()


def mark_kh_workers_only(db, dry_run: bool) -> int:
    """Chỉ đánh dấu KH (LK-KH-* hoặc chức vụ Khoán hộ)."""
    res = db.table("employee").select("id, employee_code, position_name, metadata").or_(
        "employee_code.like.LK-KH-%"
    ).execute()
    n = 0
    for e in res.data or []:
        meta = dict(e.get("metadata") or {})
        meta["institute_hr"] = False
        meta["hr_scope"] = "production_kh"
        n += 1
        if dry_run:
            print(f"  [kh] {e['employee_code']}")
        else:
            db.table("employee").update({
                "metadata": meta,
                "team_name": "Trạm Lai Khê",
            }).eq("id", e["id"]).execute()
    return n


def clear_cn_production_flags(db, dry_run: bool) -> int:
    res = db.table("employee").select("id, employee_code, metadata").like(
        "employee_code", "LK-CN-%"
    ).execute()
    n = 0
    for e in res.data or []:
        meta = dict(e.get("metadata") or {})
        if "institute_hr" not in meta and "hr_scope" not in meta:
            continue
        meta.pop("institute_hr", None)
        meta.pop("hr_scope", None)
        n += 1
        if dry_run:
            print(f"  [cn-restore-flag] {e['employee_code']}")
        else:
            db.table("employee").update({"metadata": meta}).eq("id", e["id"]).execute()
    return n


def assign_lk_institute_staff(db, dry_run: bool) -> int:
    n = 0
    for name in LK_INSTITUTE_STAFF:
        if dry_run:
            print(f"  [team-lk] {name}")
            n += 1
            continue
        db.table("employee").update({
            "team_id": "team-lk",
            "team_name": "Trạm Lai Khê",
            "department_id": "dl-3",
            "department_name": "Trung tâm nghiên cứu phát triển Giống cao su",
        }).eq("full_name", name).execute()
        n += 1
    return n


def parse_vien06_stt(code: str) -> int | None:
    m = re.match(r"^VIEN-06-(\d+)$", (code or "").upper())
    return int(m.group(1)) if m else None


def upsert_bomon_team(db, dry_run: bool) -> None:
    row = {
        "id": "bomon-giong",
        "name": "Bộ môn Giống",
        "department": "dl-3",
        "metadata": {"order": 0, "org_unit": "discipline"},
    }
    if dry_run:
        print("  [team] bomon-giong ← Bộ môn Giống")
    else:
        db.table("category_teams").upsert(row).execute()


def assign_bomon_and_lk(db, dry_run: bool, max_bomon_stt: int = 29) -> tuple[int, int]:
    """Gán NV dl-3 chưa có trạm: VIEN-06-001..029 → Bộ môn, còn lại → Trạm LK."""
    res = (
        db.table("employee")
        .select("id, full_name, position_name, team_id, employee_code, metadata")
        .eq("department_id", "dl-3")
        .execute()
    )
    bomon_n = lk_n = 0
    known_teams = {
        "bomon-giong", "team-lk", "tram-suoi-kiet", "tram-csd-giong",
        "tram-tay-nguyen", "tram-phu-yen",
    }
    for e in res.data or []:
        meta = e.get("metadata") or {}
        if meta.get("hr_scope") == "production_kh":
            continue
        code = (e.get("employee_code") or "").upper()
        if code.startswith("LK-KH-"):
            continue
        if e.get("team_id") in known_teams:
            continue
        if is_kh_position(e.get("position_name")):
            continue
        stt = parse_vien06_stt(code)
        if stt is not None and stt <= max_bomon_stt:
            bomon_n += 1
            tid, tname = "bomon-giong", "Bộ môn Giống"
        else:
            lk_n += 1
            tid, tname = "team-lk", "Trạm Lai Khê"
        if dry_run:
            print(f"  [{tid}] {code or e['full_name'][:30]}")
        else:
            db.table("employee").update({
                "team_id": tid,
                "team_name": tname,
            }).eq("id", e["id"]).execute()
    return bomon_n, lk_n


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
    print("=== Phân tách nhân sự Viện (chỉ KH) ===")
    upsert_bomon_team(db, args.dry_run)
    cn_flags = clear_cn_production_flags(db, args.dry_run)
    kh = mark_kh_workers_only(db, args.dry_run)
    lk = assign_lk_institute_staff(db, args.dry_run)
    bomon, unteamed_lk = assign_bomon_and_lk(db, args.dry_run)
    print(
        f"Hoàn tất. LK-CN bỏ cờ ẩn: {cn_flags} | KH ẩn: {kh} | "
        f"NV trạm LK (tên): {lk} | Bộ môn (chưa trạm): {bomon} | "
        f"LK (chưa trạm): {unteamed_lk}"
    )


if __name__ == "__main__":
    main()
