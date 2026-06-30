#!/usr/bin/env python3
"""Chuẩn hóa mã NV + STT Trạm Lai Khê → VIEN-06-XXX (theo Excel Viện).

- LK-CN-* → VIEN-06-{STT Excel} (giữ UUID có phân công sản xuất)
- Trùng tên với bản VIEN-06-*: xóa bản VIEN (không có phân công)
- Cập nhật id phân công cạo mủ (nhúng mã cũ LK-CN-*)
- Chỉ xử lý team-lk

Chạy: python scripts/normalize_lk_employee_codes.py [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from import_vien_personnel import DEFAULT_XLSX, make_code, parse_excel  # noqa: E402

TEAM_LK = "team-lk"
DL3 = "dl-3"
DL3_NAME = "Trung tâm nghiên cứu phát triển Giống cao su"
EXTRA_STT_START = 91


def norm_name(s: str) -> str:
    s = re.sub(r"\s+", " ", (s or "").strip().lower())
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def build_excel_map() -> dict[str, dict]:
    _, people = parse_excel(DEFAULT_XLSX)
    out: dict[str, dict] = {}
    for p in people:
        if p.get("department_id") != DL3:
            continue
        key = norm_name(p["name"])
        if key not in out or p["stt"] < out[key]["stt"]:
            out[key] = p
    return out


def employee_meta(stt: int, source: str = "excel-vien-24.6") -> dict:
    return {
        "listStt": stt,
        "orderByDept": {DL3: stt, "vien-06": stt},
        "source": source,
    }


def count_refs(db, worker_id: str) -> dict[str, int]:
    counts = {}
    for table in (
        "section_worker_assignments",
        "field_worker_weighings",
        "worker_factory_allocations",
    ):
        res = (
            db.table(table)
            .select("id", count="exact")
            .eq("worker_id", worker_id)
            .execute()
        )
        counts[table] = res.count or 0
    return counts


def load_team_lk(db) -> list[dict]:
    return (
        db.table("employee")
        .select(
            "id, employee_code, full_name, position_name, metadata, work_group_id"
        )
        .eq("team_id", TEAM_LK)
        .execute()
        .data
        or []
    )


def plan_migrations(rows: list[dict], excel: dict[str, dict]) -> tuple[list, list, list]:
    """Returns (code_updates, delete_ids, meta_updates)."""
    by_code = {r["employee_code"]: r for r in rows if r.get("employee_code")}
    code_updates: list[dict] = []
    delete_ids: list[str] = []
    meta_updates: list[dict] = []
    extra_stt = EXTRA_STT_START

    for r in rows:
        code = r.get("employee_code") or ""
        meta = dict(r.get("metadata") or {})

        if code.startswith("VIEN-06-"):
            ex = excel.get(norm_name(r["full_name"]))
            if ex:
                stt = ex["stt"]
                new_meta = {**meta, **employee_meta(stt)}
                if meta.get("listStt") != stt or not meta.get("orderByDept"):
                    meta_updates.append({"id": r["id"], "metadata": new_meta})
            continue

        if not code.startswith("LK-CN-"):
            continue

        ex = excel.get(norm_name(r["full_name"]))
        if ex:
            stt = ex["stt"]
            target = make_code(DL3, stt)
            source = "excel-vien-24.6"
        else:
            stt = extra_stt
            target = make_code(DL3, stt)
            source = "production-laikhe-extra"
            extra_stt += 1

        if target == code:
            new_meta = {**meta, **employee_meta(stt, source)}
            if meta.get("listStt") != stt:
                meta_updates.append({"id": r["id"], "metadata": new_meta})
            continue

        victim = by_code.get(target)
        if victim and victim["id"] != r["id"]:
            delete_ids.append(victim["id"])
            print(
                f"  [dup-del] {victim['employee_code']} {victim['full_name'][:30]} "
                f"→ giữ {code}"
            )

        code_updates.append({
            "id": r["id"],
            "old_code": code,
            "new_code": target,
            "stt": stt,
            "source": source,
            "full_name": r["full_name"],
        })

    delete_ids = list(dict.fromkeys(delete_ids))
    return code_updates, delete_ids, meta_updates


def update_assignment_ids(db, code_map: dict[str, str], dry_run: bool) -> int:
    if not code_map:
        return 0
    res = (
        db.table("section_worker_assignments")
        .select("*")
        .like("id", "%LK-CN-%")
        .execute()
    )
    n = 0
    for row in res.data or []:
        old_id = row["id"]
        new_id = old_id
        for old, new in code_map.items():
            new_id = new_id.replace(old, new)
        if new_id == old_id:
            continue
        n += 1
        if dry_run:
            print(f"  [assign-id] {old_id} → {new_id}")
        else:
            new_row = {k: v for k, v in row.items() if k != "created_at"}
            new_row["id"] = new_id
            db.table("section_worker_assignments").delete().eq("id", old_id).execute()
            db.table("section_worker_assignments").insert(new_row).execute()
    return n


def update_harvest_warnings(db, code_map: dict[str, str], dry_run: bool) -> int:
    n = 0
    for old, new in code_map.items():
        res = (
            db.table("harvest_worker_warnings")
            .select("id")
            .eq("id_nhan_vien", old)
            .execute()
        )
        for row in res.data or []:
            n += 1
            if dry_run:
                print(f"  [warning] {old} → {new}")
            else:
                db.table("harvest_worker_warnings").update({"id_nhan_vien": new}).eq(
                    "id", row["id"]
                ).execute()
    return n


def delete_duplicates(db, ids: list[str], dry_run: bool) -> int:
    n = 0
    for eid in ids:
        refs = count_refs(db, eid)
        if any(refs.values()):
            print(f"  [skip-del] {eid} còn FK: {refs}")
            continue
        n += 1
        if dry_run:
            print(f"  [delete] employee {eid}")
        else:
            db.table("employee").delete().eq("id", eid).execute()
    return n


def apply_code_updates(db, updates: list[dict], dry_run: bool) -> int:
    n = 0
    for u in updates:
        meta = employee_meta(u["stt"], u["source"])
        patch = {
            "employee_code": u["new_code"],
            "metadata": meta,
            "team_id": TEAM_LK,
            "team_name": "Trạm Lai Khê",
            "department_id": DL3,
            "department_name": DL3_NAME,
        }
        n += 1
        if dry_run:
            print(
                f"  [code] {u['old_code']} → {u['new_code']} "
                f"STT={u['stt']} {u['full_name'][:28]}"
            )
        else:
            db.table("employee").update(patch).eq("id", u["id"]).execute()
    return n


def apply_meta_updates(db, updates: list[dict], dry_run: bool) -> int:
    n = 0
    for u in updates:
        n += 1
        if dry_run:
            print(f"  [meta] {u['id'][:8]}… listStt={u['metadata'].get('listStt')}")
        else:
            db.table("employee").update({"metadata": u["metadata"]}).eq(
                "id", u["id"]
            ).execute()
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
    print("=== Chuẩn hóa mã NV Trạm Lai Khê ===")

    excel = build_excel_map()
    rows = load_team_lk(db)
    code_updates, delete_ids, meta_updates = plan_migrations(rows, excel)

    code_map = {u["old_code"]: u["new_code"] for u in code_updates}

    print(f"NV team-lk: {len(rows)} | đổi mã: {len(code_updates)} | xóa trùng: {len(delete_ids)}")

    a1 = update_assignment_ids(db, code_map, args.dry_run)
    a2 = update_harvest_warnings(db, code_map, args.dry_run)
    d = delete_duplicates(db, delete_ids, args.dry_run)
    c = apply_code_updates(db, code_updates, args.dry_run)
    m = apply_meta_updates(db, meta_updates, args.dry_run)

    print(
        f"Hoàn tất. assign-id: {a1} | warnings: {a2} | xóa trùng: {d} | "
        f"đổi mã: {c} | meta STT: {m}"
    )


if __name__ == "__main__":
    main()
