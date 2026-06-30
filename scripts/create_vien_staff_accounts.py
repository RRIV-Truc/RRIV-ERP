#!/usr/bin/env python3
"""Tạo tài khoản đăng nhập rriv.* cho nhân sự Viện — mặc định vai trò Staff_Viewer (chỉ xem).

Cấu trúc username: rriv.{viết tắt họ+tên đệm}{tên thường}
  Ví dụ: Nguyễn Thanh Trúc → rriv.nttruc

Chạy:
  python scripts/create_vien_staff_accounts.py --dry-run
  python scripts/create_vien_staff_accounts.py
  python scripts/create_vien_staff_accounts.py --password "123456"
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

DEFAULT_PASSWORD = "123456"
STAFF_VIEWER_ROLE = "Staff_Viewer"
SKIP_USERNAMES = frozenset({"rriv.nttruc"})


def remove_accents(text: str) -> str:
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.replace("đ", "d").replace("Đ", "D")


def username_from_full_name(full_name: str) -> str:
    parts = [p for p in re.split(r"\s+", (full_name or "").strip()) if p]
    if not parts:
        return ""
    if len(parts) == 1:
        slug = re.sub(r"[^a-z0-9]", "", remove_accents(parts[0]).lower())
        return f"rriv.{slug}" if slug else ""
    given = parts[-1]
    initials = "".join(remove_accents(p)[0] for p in parts[:-1] if p).lower()
    given_norm = re.sub(r"[^a-z0-9]", "", remove_accents(given).lower())
    if not given_norm:
        return ""
    return f"rriv.{initials}{given_norm}"


def ensure_staff_viewer_role(db) -> int:
    db.table("system_role").upsert({
        "id": 6,
        "role_name": STAFF_VIEWER_ROLE,
        "description": "Nhân viên - Chỉ xem dữ liệu, không chỉnh sửa",
    }).execute()
    res = db.table("system_role").select("id").eq("role_name", STAFF_VIEWER_ROLE).limit(1).execute()
    return int(res.data[0]["id"])


def username_taken(db, username: str, employee_id: str | None = None) -> bool:
    q = db.table("employee").select("id").eq("username", username)
    if employee_id:
        q = q.neq("id", employee_id)
    if q.limit(1).execute().data:
        return True
    return bool(db.table("user_accounts").select("username").eq("username", username).limit(1).execute().data)


def unique_username(db, base: str, employee_id: str | None = None) -> str:
    if not username_taken(db, base, employee_id):
        return base
    for n in range(2, 100):
        candidate = f"{base}{n}"
        if not username_taken(db, candidate, employee_id):
            return candidate
    return f"{base}-{uuid.uuid4().hex[:4]}"


def is_institute_employee(row: dict) -> bool:
    meta = row.get("metadata") or {}
    if meta.get("hr_scope") == "production_kh":
        return False
    code = str(row.get("employee_code") or "").upper()
    if code.startswith("LK-KH-"):
        return False
    pos = str(row.get("position_name") or "").lower()
    if "khoán hộ" in pos:
        return False
    return True


def sync_system_role(db, username: str, role_id: int) -> None:
    db.table("user_system_role").delete().eq("username", username).execute()
    db.table("user_system_role").insert({
        "username": username,
        "system_role_id": role_id,
        "assigned_by": "create_vien_staff_accounts",
    }).execute()


def main() -> None:
    import os
    from supabase import create_client

    parser = argparse.ArgumentParser(description="Tạo tài khoản rriv.* cho nhân sự Viện")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ in, không ghi DB")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Mật khẩu mặc định")
    parser.add_argument("--only-missing", action="store_true", default=True,
                        help="Chỉ tạo cho NV chưa có tài khoản (mặc định bật)")
    parser.add_argument("--reset-passwords", action="store_true",
                        help="Đặt lại mật khẩu mặc định cho mọi tài khoản rriv.* đã có")
    args = parser.parse_args()

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL / SUPABASE_KEY trong .env")
        sys.exit(1)

    db = create_client(url, key)

    if args.reset_passwords:
        accts = db.table("user_accounts").select("username").like("username", "rriv.%").execute()
        reset_n = 0
        if not args.dry_run:
            for row in accts.data or []:
                uname = row.get("username")
                if not uname or uname in SKIP_USERNAMES:
                    continue
                db.table("user_accounts").update({"password": args.password}).eq("username", uname).execute()
                reset_n += 1
        else:
            reset_n = sum(
                1 for row in (accts.data or [])
                if row.get("username") and row.get("username") not in SKIP_USERNAMES
            )
        print(f"{'[DRY-RUN] ' if args.dry_run else ''}Mật khẩu → {args.password} cho {reset_n} tài khoản rriv.*")
        return

    viewer_role_id = ensure_staff_viewer_role(db) if not args.dry_run else 6

    res = db.table("employee").select(
        "id, full_name, username, employee_code, department_name, employment_status, disabled, metadata, national_id"
    ).execute()
    rows = [r for r in (res.data or []) if is_institute_employee(r)]
    rows = [r for r in rows if r.get("employment_status") != "resigned" and not r.get("disabled")]

    created = updated = skipped = errors = 0
    samples: list[str] = []

    for row in rows:
        name = (row.get("full_name") or "").strip()
        if not name:
            skipped += 1
            continue

        eid = row["id"]
        existing_user = (row.get("username") or "").strip().lower()
        if existing_user in SKIP_USERNAMES:
            skipped += 1
            continue

        base = username_from_full_name(name)
        if not base:
            skipped += 1
            continue

        if existing_user.startswith("rriv.") and args.only_missing:
            acct = db.table("user_accounts").select("username").eq("username", existing_user).limit(1).execute()
            if acct.data:
                skipped += 1
                continue
            username = existing_user
        else:
            username = unique_username(db, base, eid) if not args.dry_run else base

        email = f"{username}@rriv.org.vn"
        meta = dict(row.get("metadata") or {})
        meta["systemRoleId"] = viewer_role_id

        if args.dry_run:
            samples.append(f"  {name:30s} → {username}")
            created += 1
            continue

        try:
            db.table("employee").update({
                "username": username,
                "erp_role": "user",
                "company_email": email,
                "metadata": meta,
            }).eq("id", eid).execute()

            acct_exists = db.table("user_accounts").select("username").eq("username", username).limit(1).execute()
            if acct_exists.data:
                db.table("user_accounts").update({
                    "password": args.password,
                    "display_name": name,
                    "email": email,
                    "role": "user",
                    "department": row.get("department_name") or "",
                    "employee_id": eid,
                }).eq("username", username).execute()
                updated += 1
            else:
                db.table("user_accounts").insert({
                    "username": username,
                    "password": args.password,
                    "display_name": name,
                    "email": email,
                    "role": "user",
                    "department": row.get("department_name") or "",
                    "employee_id": eid,
                }).execute()
                created += 1

            sync_system_role(db, username, viewer_role_id)
            if len(samples) < 15:
                samples.append(f"  {name:30s} → {username}")
        except Exception as exc:
            errors += 1
            print(f"Lỗi [{name}]: {exc}")

    print(f"\n{'[DRY-RUN] ' if args.dry_run else ''}Kết quả:")
    print(f"  Nhân sự xử lý: {len(rows)}")
    print(f"  Tạo mới:       {created}")
    print(f"  Cập nhật:      {updated}")
    print(f"  Bỏ qua:        {skipped}")
    print(f"  Lỗi:           {errors}")
    print(f"  Mật khẩu:      {args.password}")
    print(f"  Vai trò:       {STAFF_VIEWER_ROLE} (chỉ xem)")
    if samples:
        print("\nVí dụ:")
        print("\n".join(samples))
        if created > len(samples):
            print(f"  ... và {created - len(samples)} người khác")


if __name__ == "__main__":
    main()
