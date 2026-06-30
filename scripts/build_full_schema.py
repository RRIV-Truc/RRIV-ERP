#!/usr/bin/env python3
"""Gộp 3 file SQL thành supabase/rriv_full_schema.sql (dán 1 lần vào SQL Editor)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = ["schema.sql", "schema-harvest-production.sql", "seed.sql", "schema-rbac.sql"]
out = ROOT / "supabase" / "rriv_full_schema.sql"
chunks = []
for name in PARTS:
    p = ROOT / "supabase" / name
    chunks.append(f"-- ========== {name} ==========\n")
    chunks.append(p.read_text(encoding="utf-8"))
    chunks.append("\n")
out.write_text("".join(chunks), encoding="utf-8")
print(out)
print("bytes:", out.stat().st_size)
