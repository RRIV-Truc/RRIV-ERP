#!/usr/bin/env python3
"""Liệt kê phòng ban / tổ / nhân sự trên Supabase."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def main() -> None:
    from supabase import create_client

    db = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    depts = db.table("category_departments").select("id,name,dept_type,metadata,active").execute()
    teams = db.table("category_teams").select("id,name,department,metadata").execute()
    emps = db.table("employee").select("id,department_id,department_name").execute()

    counts: dict[str, int] = {}
    name_counts: dict[str, int] = {}
    for e in emps.data or []:
        did = e.get("department_id") or e.get("department_name") or "?"
        counts[did] = counts.get(did, 0) + 1
        dn = e.get("department_name") or "?"
        name_counts[dn] = name_counts.get(dn, 0) + 1

    out = {"departments": [], "teams": teams.data or [], "employee_by_dept_id": counts, "employee_by_dept_name": name_counts}
    for d in sorted(depts.data or [], key=lambda x: (x.get("metadata") or {}).get("order", 999)):
        d = dict(d)
        d["employee_count"] = counts.get(d["id"], 0)
        out["departments"].append(d)

    path = ROOT / "data" / "vien-org-audit.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {path}")
    for d in out["departments"]:
        print(f"  {d['id']:12} {d['employee_count']:3} NV  {d['name']}")


if __name__ == "__main__":
    main()
