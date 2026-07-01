#!/usr/bin/env python3
"""Gộp / đổi tên cây tổ chức Viện — bỏ trùng dl-* và vien-*.

Chạy: python scripts/consolidate_vien_org.py [--dry-run]
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

# Phòng ban chuẩn (id cố định dl-*)
CANONICAL_DEPTS = {
    "dl-1": {
        "name": "Ban Lãnh đạo Viện",
        "dept_type": "Ban Lãnh Đạo",
        "order": 1,
        "merge_ids": ["vien-01", "dl-1"],
    },
    "dl-6": {
        "name": "Phòng quản trị - tài chính kế toán",
        "dept_type": "Phòng Nghiệp Vụ",
        "order": 2,
        "merge_ids": ["vien-02", "vien-04", "dl-6"],
    },
    "dl-5": {
        "name": "Phòng khoa học công nghệ",
        "dept_type": "Phòng Nghiệp Vụ",
        "order": 3,
        "merge_ids": ["vien-03", "dl-5"],
    },
    "dl-2": {
        "name": "Trung tâm nghiên cứu phát triển sản phẩm mới",
        "dept_type": "Trung Tâm",
        "order": 4,
        "merge_ids": ["vien-05", "dl-2"],
    },
    "dl-3": {
        "name": "Trung tâm nghiên cứu phát triển Giống cao su",
        "dept_type": "Trung Tâm",
        "order": 5,
        "merge_ids": ["vien-06", "vien-08", "vien-09", "vien-10", "dl-3"],
    },
    "dl-4": {
        "name": "Trung tâm nghiên cứu ứng dụng nông nghiệp công nghệ cao",
        "dept_type": "Trung Tâm",
        "order": 6,
        "merge_ids": ["vien-07", "dl-4"],
    },
}

# Tổ / Trạm thuộc Trung tâm Giống (dl-3)
TEAMS = {
    "bomon-giong": {
        "name": "Bộ môn Giống",
        "department": "dl-3",
        "order": 0,
        "from_dept_ids": [],
    },
    "team-lk": {
        "name": "Trạm Lai Khê",
        "department": "dl-3",
        "order": 1,
        "from_dept_ids": [],
    },
    "tram-suoi-kiet": {
        "name": "Trạm Suối Kiết",
        "department": "dl-3",
        "order": 2,
        "from_dept_ids": ["vien-08"],
        "split": "first_half",
    },
    "tram-csd-giong": {
        "name": "Trạm CSD giống",
        "department": "dl-3",
        "order": 3,
        "from_dept_ids": ["vien-08"],
        "split": "second_half",
    },
    "tram-tay-nguyen": {
        "name": "Trạm Tây Nguyên",
        "department": "dl-3",
        "order": 4,
        "from_dept_ids": ["vien-09"],
    },
    "tram-phu-yen": {
        "name": "Trạm Phú Yên",
        "department": "dl-3",
        "order": 5,
        "from_dept_ids": ["vien-10"],
    },
}

RETIRE_IDS = [
    "vien-01", "vien-02", "vien-03", "vien-04", "vien-05",
    "vien-06", "vien-07", "vien-08", "vien-09", "vien-10",
]

ORDER_DEPT_MIGRATE = {
    "vien-01": "dl-1",
    "vien-02": "dl-6",
    "vien-03": "dl-5",
    "vien-04": "dl-6",
    "vien-05": "dl-2",
    "vien-06": "dl-3",
    "vien-07": "dl-4",
    "vien-08": "dl-3",
    "vien-09": "dl-3",
    "vien-10": "dl-3",
}


def merge_map() -> dict[str, str]:
    m: dict[str, str] = {}
    for target, cfg in CANONICAL_DEPTS.items():
        for src in cfg["merge_ids"]:
            m[src] = target
    return m


def upsert_canonical_depts(db, dry_run: bool) -> None:
    for dept_id, cfg in CANONICAL_DEPTS.items():
        row = {
            "id": dept_id,
            "name": cfg["name"],
            "ten": cfg["name"],
            "ten_phong_ban": cfg["name"],
            "dept_type": cfg["dept_type"],
            "active": True,
            "metadata": {
                "order": cfg["order"],
                "org_type": "vien",
                "canonical": True,
            },
        }
        if dry_run:
            print(f"  [dept] {dept_id} ← {cfg['name']}")
        else:
            db.table("category_departments").upsert(row).execute()


def upsert_teams(db, dry_run: bool) -> None:
    for team_id, cfg in TEAMS.items():
        row = {
            "id": team_id,
            "name": cfg["name"],
            "department": cfg["department"],
            "metadata": {"order": cfg["order"], "station": cfg["name"]},
        }
        if dry_run:
            print(f"  [team] {team_id} ← {cfg['name']}")
        else:
            db.table("category_teams").upsert(row).execute()


def move_employees(db, dry_run: bool) -> int:
    mapping = merge_map()
    moved = 0
    for src, target in mapping.items():
        if src == target:
            continue
        name = CANONICAL_DEPTS[target]["name"]
        if dry_run:
            res = (
                db.table("employee")
                .select("id", count="exact")
                .eq("department_id", src)
                .execute()
            )
            n = res.count or 0
            if n:
                print(f"  [move] {src} → {target}: {n} NV")
            moved += n
            continue
        res = (
            db.table("employee")
            .update({"department_id": target, "department_name": name})
            .eq("department_id", src)
            .execute()
        )
        moved += len(res.data or [])

    # NV gán theo department_name cũ (view category_personnel)
    for src, target in mapping.items():
        if src == target:
            continue
        old = db.table("category_departments").select("name").eq("id", src).limit(1).execute()
        if not old.data:
            continue
        old_name = old.data[0]["name"]
        name = CANONICAL_DEPTS[target]["name"]
        if not dry_run:
            db.table("employee").update({
                "department_id": target,
                "department_name": name,
            }).eq("department_name", old_name).execute()
    return moved


def employees_from_source_dept(db, src_dept: str) -> list[dict]:
    """NV còn ở src_dept hoặc đã chuyển dl-3 nhưng metadata.orderByDept giữ src."""
    direct = (
        db.table("employee")
        .select("id, full_name, metadata")
        .eq("department_id", src_dept)
        .order("full_name")
        .execute()
    )
    if direct.data:
        return direct.data
    moved = (
        db.table("employee")
        .select("id, full_name, metadata")
        .eq("department_id", "dl-3")
        .order("full_name")
        .execute()
    )
    out = []
    for e in moved.data or []:
        ob = (e.get("metadata") or {}).get("orderByDept") or {}
        if src_dept in ob:
            out.append(e)
    return out


def assign_teams(db, dry_run: bool) -> None:
    dl3_name = CANONICAL_DEPTS["dl-3"]["name"]

    # Trạm Lai Khê: NV seed team-lk hoặc mã LK-*
    lk = (
        db.table("employee")
        .select("id, employee_code, team_id")
        .eq("department_id", "dl-3")
        .execute()
    )
    for e in lk.data or []:
        code = (e.get("employee_code") or "").upper()
        if e.get("team_id") == "team-lk" or code.startswith("LK-"):
            if dry_run:
                print(f"  [team-lk] {code}")
            else:
                db.table("employee").update({
                    "team_id": "team-lk",
                    "team_name": "Trạm Lai Khê",
                }).eq("id", e["id"]).execute()

    for team_id, cfg in TEAMS.items():
        if team_id in ("team-lk", "bomon-giong"):
            continue
        for src_dept in cfg.get("from_dept_ids", []):
            rows = employees_from_source_dept(db, src_dept)
            if cfg.get("split") == "first_half":
                rows = rows[: (len(rows) + 1) // 2]
            elif cfg.get("split") == "second_half":
                rows = rows[(len(rows) + 1) // 2 :]
            for e in rows:
                if dry_run:
                    print(f"  [team] {e['full_name'][:30]} → {cfg['name']}")
                else:
                    db.table("employee").update({
                        "team_id": team_id,
                        "team_name": cfg["name"],
                        "department_id": "dl-3",
                        "department_name": dl3_name,
                    }).eq("id", e["id"]).execute()


def fix_dl4_from_giong(db, dry_run: bool) -> int:
    """Chuyển NV TT CG kỹ thuật (vien-07) khỏi dl-3 → dl-4."""
    dl4_name = CANONICAL_DEPTS["dl-4"]["name"]
    rows = employees_from_source_dept(db, "vien-07")
    if dry_run:
        print(f"  [dl-4] chuyển {len(rows)} NV từ dl-3 → dl-4")
        return len(rows)
    for e in rows:
        db.table("employee").update({
            "department_id": "dl-4",
            "department_name": dl4_name,
            "team_id": None,
            "team_name": None,
        }).eq("id", e["id"]).execute()
    if not dry_run:
        db.table("category_departments").upsert({
            "id": "dl-4",
            "name": dl4_name,
            "ten": dl4_name,
            "ten_phong_ban": dl4_name,
            "dept_type": "Trung Tâm",
            "active": True,
            "metadata": {
                "order": 6,
                "org_type": "vien",
                "canonical": True,
            },
        }).execute()
    return len(rows)


def fix_order_metadata(db, dry_run: bool) -> int:
    """Chuyển metadata.orderByDept từ vien-* sang dl-*."""
    res = db.table("employee").select("id, metadata").execute()
    updated = 0
    for e in res.data or []:
        meta = dict(e.get("metadata") or {})
        ob = dict(meta.get("orderByDept") or {})
        changed = False
        for old, new in ORDER_DEPT_MIGRATE.items():
            if old in ob and new not in ob:
                ob[new] = ob[old]
                changed = True
        if not changed:
            continue
        meta["orderByDept"] = ob
        updated += 1
        if dry_run:
            print(f"  [order] {e['id'][:8]}…")
        else:
            db.table("employee").update({"metadata": meta}).eq("id", e["id"]).execute()
    return updated


def retire_old_depts(db, dry_run: bool) -> None:
    for dept_id in RETIRE_IDS:
        if dry_run:
            print(f"  [retire] {dept_id}")
        else:
            db.table("category_departments").update({
                "active": False,
                "metadata": {"retired": True, "merged": True},
            }).eq("id", dept_id).execute()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--teams-only", action="store_true", help="Chỉ gán trạm (sau khi đã gộp PB)")
    parser.add_argument("--fix-dl4", action="store_true", help="Tách TT CG kỹ thuật (vien-07) → dl-4")
    parser.add_argument("--fix-order", action="store_true", help="Migrate orderByDept vien-* → dl-*")
    args = parser.parse_args()

    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL / SUPABASE_KEY")
        sys.exit(1)

    db = create_client(url, key)
    print("=== Gộp tổ chức Viện ===")
    if args.fix_order:
        n = fix_order_metadata(db, args.dry_run)
        print(f"Hoàn tất. NV cập nhật STT: {n}")
        return
    if args.fix_dl4:
        n = fix_dl4_from_giong(db, args.dry_run)
        print(f"Hoàn tất. NV chuyển sang dl-4: {n}")
        return
    if args.teams_only:
        assign_teams(db, args.dry_run)
        print("Hoàn tất gán trạm.")
        return
    upsert_canonical_depts(db, args.dry_run)
    upsert_teams(db, args.dry_run)
    moved = move_employees(db, args.dry_run)
    assign_teams(db, args.dry_run)
    retire_old_depts(db, args.dry_run)
    print(f"Hoàn tất. NV chuyển phòng ban (ước tính): {moved}")


if __name__ == "__main__":
    main()
