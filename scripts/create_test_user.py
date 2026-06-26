#!/usr/bin/env python3
"""Tạo tài khoản thử nghiệm trên Supabase."""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(ROOT / ".env")

USERNAME = "rriv.tminh"
PASSWORD = "123456"
FULL_NAME = "Trần Minh"
DEPARTMENT_ID = "dl-3"
DEPARTMENT_NAME = "Trung tâm nghiên cứu phát triển Giống cao su"
POSITION_NAME = "Phó giám đốc Trung tâm nghiên cứu phát triển giống"
EMPLOYEE_CODE = "RRIV-TMINH"
EMPLOYEE_ID = str(uuid.uuid5(uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "rriv:tminh"))
EMAIL = f"{USERNAME}@rriv.org.vn"


def main() -> None:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL hoặc SUPABASE_KEY trong .env")
        sys.exit(1)

    db = create_client(url, key)

    employee = {
        "id": EMPLOYEE_ID,
        "employee_code": EMPLOYEE_CODE,
        "full_name": FULL_NAME,
        "national_id": "MIG-TMINH-0001",
        "username": USERNAME,
        "department_id": DEPARTMENT_ID,
        "department_name": DEPARTMENT_NAME,
        "position_name": POSITION_NAME,
        "company_email": EMAIL,
        "employment_status": "active",
        "erp_role": "manager",
        "metadata": {"source": "create_test_user"},
    }
    db.table("employee").upsert(employee).execute()

    account = {
        "username": USERNAME,
        "password": PASSWORD,
        "display_name": FULL_NAME,
        "email": EMAIL,
        "role": "manager",
        "department": DEPARTMENT_NAME,
        "employee_id": EMPLOYEE_ID,
    }
    db.table("user_accounts").upsert(account).execute()

    login = (
        db.table("user_login_view")
        .select("username, display_name, department, role")
        .eq("username", USERNAME)
        .limit(1)
        .execute()
    )
    print("Đã tạo tài khoản:")
    print(f"  Đăng nhập: {USERNAME}")
    print(f"  Mật khẩu:  {PASSWORD}")
    print(f"  Họ tên:     {FULL_NAME}")
    print(f"  Chức vụ:    {POSITION_NAME}")
    print(f"  Đơn vị:     {DEPARTMENT_NAME}")
    if login.data:
        print(f"  Xác nhận DB: {login.data[0]}")


if __name__ == "__main__":
    main()
