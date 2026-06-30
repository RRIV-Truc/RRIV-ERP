#!/usr/bin/env python3
"""Phục hồi CN đã xóa nhầm + chỉ ẩn KH khỏi nhân sự Viện.

Chạy: python scripts/restore_vien_cn.py [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

DEFAULT_XLSX = Path(
    r"g:\My Drive\Chuyen doi so PTN\RRIV-ERP\danh sách nhan su Vien 24.6.xlsx"
)

# Import helpers từ import_vien_personnel
from import_vien_personnel import (  # noqa: E402
    find_existing_employee,
    make_code,
    next_free_code,
    parse_excel,
    code_taken_by_other,
)


def is_cn_position(position: str) -> bool:
    p = (position or "").lower()
    return "cn khai thác" in p or "cn chế biến" in p or "cn cạo" in p


def is_kh_position(position: str) -> bool:
    return "khoán hộ" in (position or "").lower()


def restore_cn_from_excel(db, people: list[dict], dry_run: bool) -> tuple[int, int]:
    created = updated = 0
    dl3_name = "Trung tâm nghiên cứu phát triển Giống cao su"
    for p in people:
        if not is_cn_position(p.get("position", "")):
            continue
        if is_kh_position(p.get("position", "")):
            continue
        if p.get("department_id") != "dl-3":
            continue

        code = make_code(p["department_id"], p["stt"])
        meta = {
            "listStt": p["stt"],
            "orderByDept": {p["department_id"]: p["stt"], "vien-06": p["stt"]},
            "source": "excel-vien-24.6",
            "restored_cn": True,
        }
        team_id = team_name = None
        if p["stt"] >= 40:
            team_id = "team-lk"
            team_name = "Trạm Lai Khê"

        patch = {
            "full_name": p["name"],
            "gender": p["gender"],
            "date_of_birth": p["dob"],
            "department_id": "dl-3",
            "department_name": dl3_name,
            "position_name": p["position"],
            "employment_status": "active",
            "disabled": False,
            "metadata": meta,
            "team_id": team_id,
            "team_name": team_name,
        }
        if p.get("cccd"):
            patch["national_id"] = p["cccd"]

        if dry_run:
            print(f"  [restore] {code} {p['name'][:28]}")
            created += 1
            continue

        existing = find_existing_employee(db, p, code)
        if existing:
            ec = (existing.get("employee_code") or "").upper()
            if ec.startswith("LK-"):
                continue  # không ghi đè CN/KH sản xuất
            eid = existing["id"]
            if not code_taken_by_other(db, code, eid):
                patch["employee_code"] = code
            db.table("employee").update(patch).eq("id", eid).execute()
            updated += 1
        else:
            insert_code = next_free_code(db, code)
            row = {
                **patch,
                "employee_code": insert_code,
                "national_id": p.get("cccd") or f"MIG-{insert_code}",
                "id": str(uuid.uuid4()),
            }
            db.table("employee").insert(row).execute()
            created += 1
    return created, updated


def fix_lk_worker_flags(db, dry_run: bool) -> tuple[int, int]:
    """Bỏ cờ production trên LK-CN; chỉ giữ KH ẩn khỏi nhân sự Viện."""
    cn_n = kh_n = 0
    res = db.table("employee").select("id, employee_code, metadata").or_(
        "employee_code.like.LK-CN-%,employee_code.like.LK-KH-%"
    ).execute()
    for e in res.data or []:
        code = (e.get("employee_code") or "").upper()
        meta = dict(e.get("metadata") or {})
        if code.startswith("LK-KH-"):
            meta["institute_hr"] = False
            meta["hr_scope"] = "production_kh"
            kh_n += 1
            if not dry_run:
                db.table("employee").update({
                    "metadata": meta,
                    "team_name": "Trạm Lai Khê",
                }).eq("id", e["id"]).execute()
        elif code.startswith("LK-CN-"):
            meta.pop("institute_hr", None)
            meta.pop("hr_scope", None)
            cn_n += 1
            if not dry_run:
                db.table("employee").update({
                    "metadata": meta,
                    "team_name": "Trạm Lai Khê",
                }).eq("id", e["id"]).execute()
    return cn_n, kh_n


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.xlsx.is_file():
        print(f"Không tìm thấy: {args.xlsx}")
        sys.exit(1)

    import os
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL / SUPABASE_KEY")
        sys.exit(1)

    _, people = parse_excel(args.xlsx)
    db = create_client(url, key)

    print("=== Phục hồi CN Viện ===")
    created, updated = restore_cn_from_excel(db, people, args.dry_run)
    cn_fix, kh_fix = fix_lk_worker_flags(db, args.dry_run)
    print(
        f"Hoàn tất. CN Excel tạo: {created} | cập nhật: {updated} | "
        f"LK-CN bỏ cờ ẩn: {cn_fix} | LK-KH giữ ẩn: {kh_fix}"
    )


if __name__ == "__main__":
    main()
