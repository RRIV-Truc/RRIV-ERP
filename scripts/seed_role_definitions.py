#!/usr/bin/env python3
"""Seed app_registry + role_definitions từ data/role-definitions-seed.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "role-definitions-seed.json"


def main() -> None:
    import os
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv(ROOT / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL / SUPABASE_KEY trong .env")
        sys.exit(1)

    payload = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    db = create_client(url, key)

    apps = payload.get("apps") or []
    roles = payload.get("roles") or []

    app_ok = 0
    for app in apps:
        row = {
            "app_id": app["app_id"],
            "name": app["name"],
            "scope_type": app.get("scope_type", "department"),
            "hub_enabled": bool(app.get("hub_enabled", False)),
            "assignable": bool(app.get("assignable", True)),
            "sort_order": int(app.get("sort_order", 100)),
            "metadata": app.get("metadata") or {},
        }
        try:
            db.table("app_registry").upsert(row).execute()
            app_ok += 1
        except Exception as exc:
            print(f"  app_registry {app['app_id']}: {exc} (bỏ qua — chạy migrate-role-definitions-erp.sql)")

    role_ok = 0
    for role in roles:
        app_id = role["app_id"]
        role_id = role["role_id"]
        doc_id = f"{app_id}_{role_id}"
        meta = {
            "app_id": app_id,
            "role_id": role_id,
            "role_name": role.get("role_name") or role_id,
            "description": role.get("description") or "",
            "scope_type": role.get("scope_type") or "",
            "scopeable": role.get("scopeable") or {},
            "sort_order": int(role.get("sort_order", 100)),
            "is_active": role.get("is_active", True),
            "permissions": role.get("permissions") or [],
        }
        row = {
            "id": doc_id,
            "role_id": doc_id,
            "name": role.get("role_name") or role_id,
            "permissions": role.get("permissions") or [],
            "metadata": meta,
        }
        extended = {
            **row,
            "app_id": app_id,
            "role_name": meta["role_name"],
            "description": meta["description"],
            "is_active": True,
            "scope_type": meta["scope_type"],
            "scopeable": meta["scopeable"],
            "sort_order": meta["sort_order"],
        }
        try:
            db.table("role_definitions").upsert(extended).execute()
            role_ok += 1
        except Exception:
            try:
                db.table("role_definitions").upsert(row).execute()
                role_ok += 1
            except Exception as exc:
                print(f"  role {doc_id}: {exc}")

    print(f"Đã seed app_registry: {app_ok}/{len(apps)}, role_definitions: {role_ok}/{len(roles)}")


if __name__ == "__main__":
    main()
