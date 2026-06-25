#!/usr/bin/env python3
"""Tạo file backup SQL gộp schema + seed Supabase (lưu về máy / khôi phục)."""
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "supabase" / "backups"

SCHEMA_PARTS = [
    "schema.sql",
    "schema-harvest-production.sql",
    "schema-tsc-drc.sql",
    "schema-rbac.sql",
]

SEED_PARTS = [
    "seed.sql",
    "seed-tsc-drc-conversion-latex.sql",
    "seed-demo-harvest.sql",
]

PATCH_PARTS = [
    "patch_fix_user_login_view.sql",
    "patch_restore_admin_roles.sql",
    "patch_rbac_user_accounts_columns.sql",
    "patch-section-assignment-roles.sql",
    "seed-tapping-sections-example.sql",
]

def _read(name: str) -> str:
    p = ROOT / "supabase" / name
    if not p.exists():
        return f"-- [MISSING] {name}\n"
    return p.read_text(encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    out = OUT_DIR / f"rriv-supabase-backup-{today}.sql"
    latest = OUT_DIR / "rriv-supabase-backup-latest.sql"

    lines = [
        "-- ============================================================\n",
        "-- RRIV-ERP — BACKUP SUPABASE (schema + seed)\n",
        f"-- Ngày tạo: {today}\n",
        "-- Dùng: Supabase → SQL Editor → dán/chạy toàn bộ (DB mới)\n",
        "-- Hoặc lưu file này về máy làm bản sao an toàn.\n",
        "-- ============================================================\n\n",
        "-- PHẦN 1: SCHEMA\n",
    ]

    for name in SCHEMA_PARTS:
        lines.append(f"\n-- ========== {name} ==========\n")
        lines.append(_read(name))

    lines.append("\n\n-- PHẦN 2: DỮ LIỆU MẪU / SEED\n")
    for name in SEED_PARTS:
        lines.append(f"\n-- ========== {name} ==========\n")
        lines.append(_read(name))

    lines.append("\n\n-- PHẦN 3: PATCH (chỉ chạy khi nâng cấp DB cũ, không cần trên DB mới)\n")
    for name in PATCH_PARTS:
        lines.append(f"\n-- ========== {name} ==========\n")
        lines.append(_read(name))

    content = "".join(lines)
    out.write_text(content, encoding="utf-8")
    latest.write_text(content, encoding="utf-8")
    print(f"Backup: {out}")
    print(f"Latest: {latest}")
    print(f"Size:   {out.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
