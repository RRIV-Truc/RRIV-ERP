#!/usr/bin/env python3
"""Đọc data/tsc-drc-conversion-latex.tsv → SQL + JSON tra cứu nhanh."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TSV = ROOT / "data" / "tsc-drc-conversion-latex.tsv"
OUT_SQL = ROOT / "supabase" / "seed-tsc-drc-conversion-latex.sql"
OUT_JSON = ROOT / "static" / "data" / "tsc-drc-latex.json"


def parse_num(s: str) -> float:
    return float(s.strip().replace(",", "."))


def load_pairs() -> list[tuple[float, float]]:
    pairs: list[tuple[float, float]] = []
    for line in TSV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        cells = re.split(r"\t+", line)
        if len(cells) % 2 != 0:
            raise ValueError(f"Odd cell count: {line[:80]}")
        for i in range(0, len(cells), 2):
            pairs.append((parse_num(cells[i]), parse_num(cells[i + 1])))
    # dedupe by TSC (last wins)
    seen: dict[float, float] = {}
    for tsc, drc in pairs:
        seen[round(tsc, 1)] = drc
    return sorted(seen.items(), key=lambda x: x[0])


def main() -> None:
    pairs = load_pairs()
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    json_data = [{"tsc": t, "drc": d} for t, d in pairs]
    OUT_JSON.write_text(json.dumps(json_data, ensure_ascii=False), encoding="utf-8")

    lines = [
        "-- Bảng quy đổi TSC → DRC (mủ nước) — Viện RRIV",
        "-- Nguồn: data/tsc-drc-conversion-latex.tsv",
        f"-- {len(pairs)} điểm, TSC {pairs[0][0]:.1f} – {pairs[-1][0]:.1f}",
        "-- quy_kho_kg = kg_tuoi * drc / 100",
        "",
        "DELETE FROM tsc_drc_conversion WHERE material_type = 'latex';",
        "",
        "INSERT INTO tsc_drc_conversion (material_type, tsc_pct, drc_pct, sort_order) VALUES",
    ]
    value_lines = []
    for i, (tsc, drc) in enumerate(pairs, start=1):
        value_lines.append(f"  ('latex', {tsc:.1f}, {drc:.1f}, {i})")
    lines.append(",\n".join(value_lines) + ";")

    OUT_SQL.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Pairs: {len(pairs)}")
    print(f"SQL: {OUT_SQL}")
    print(f"JSON: {OUT_JSON}")


if __name__ == "__main__":
    main()
