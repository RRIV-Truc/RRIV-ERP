"""
Chuyển KML (Google My Maps) → GeoJSON cho app Vườn cây RRIV.

File KML gốc có thể là NetworkLink trỏ tới Google Maps — script sẽ tải dữ liệu thật.
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

import geopandas as gpd
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_KML = ROOT / "Bản sao của Map Viện NC Cao Su - TN.kml"
DEFAULT_LAYER = "lai_khe_8_25.KML"
DEFAULT_OUT = ROOT / "static" / "geojson" / "vien_nc_cao_su_tn.geojson"
CACHE_KML = ROOT / "data" / "vien_nc_cao_su_tn.kml"

NETWORK_LINK_RE = re.compile(r"<href><!\[CDATA\[(.*?)\]\]></href>", re.I)
TAG_RE = re.compile(r"<[^>]+>")


def drop_z(geom):
    if geom is None or geom.is_empty:
        return geom
    return transform(lambda x, y, z=None: (x, y), geom)


def parse_description(desc: str) -> dict:
    if not desc:
        return {}
    text = TAG_RE.sub("\n", desc)
    props = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if " " not in line:
            continue
        key, _, value = line.partition(" ")
        key = key.strip()
        value = value.strip()
        if key:
            props[key] = value
    return props


def resolve_kml_source(kml_path: Path, download: bool) -> Path:
    text = kml_path.read_text(encoding="utf-8")
    match = NETWORK_LINK_RE.search(text)
    if not match:
        return kml_path

    url = match.group(1).strip()
    if not download and CACHE_KML.is_file():
        return CACHE_KML

    CACHE_KML.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 RRIV-ERP"})
    data = urllib.request.urlopen(req, timeout=120).read()
    CACHE_KML.write_bytes(data)
    print(f"Downloaded KML: {len(data):,} bytes -> {CACHE_KML}")
    return CACHE_KML


def normalize_properties(row) -> dict:
    parsed = parse_description(str(row.get("description") or ""))
    name = str(row.get("Name") or parsed.get("Ten_lo_moi") or "").strip()

    props = {
        "Ma_lo": name,
        "Ten_lo_moi": parsed.get("Ten_lo_moi") or name,
        "Nam_trong": parsed.get("Nam_trong", ""),
        "Giong": parsed.get("Giong", ""),
        "giong": parsed.get("Giong", ""),
        "Dientich": parsed.get("Dien_tich_2025", ""),
        "Dtich2026_ha": parsed.get("Dien_tich_2025", ""),
        "Dien_tich_2025": parsed.get("Dien_tich_2025", ""),
        "ID_lo": parsed.get("ID_lo", ""),
        "khu_vuc": parsed.get("khu_vuc", ""),
        "Hien_trang": parsed.get("Hien_trang", ""),
        "phan_loai": parsed.get("phan_loai", ""),
        "Tuoi_cao": parsed.get("tuoi_cao", ""),
        "Nam_mo_cao": parsed.get("nam_cao_up", ""),
        "Nong_truong": parsed.get("khu_vuc", "Lai Khê"),
        "source_layer": DEFAULT_LAYER,
    }
    props.update({k: v for k, v in parsed.items() if k not in props})
    return props


def convert(kml_path: Path, out_path: Path, layer: str = DEFAULT_LAYER) -> dict:
    gdf = gpd.read_file(kml_path, layer=layer)
    gdf = gdf[gdf.geometry.notna()]
    gdf = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    gdf["geometry"] = gdf.geometry.apply(drop_z)

    features = []
    for _, row in gdf.iterrows():
        props = normalize_properties(row)
        geom = json.loads(gpd.GeoSeries([row.geometry], crs=gdf.crs).to_json())["features"][0]["geometry"]
        features.append({"type": "Feature", "properties": props, "geometry": geom})

    collection = {
        "type": "FeatureCollection",
        "name": "vien_nc_cao_su_tn",
        "metadata": {
            "source": str(kml_path.name),
            "layer": layer,
            "description": "Map Viện NC Cao su - TN (chuyển từ KML)",
        },
        "features": features,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
    print(f"GeoJSON: {len(features)} lô -> {out_path} ({out_path.stat().st_size:,} bytes)")
    return collection


def main():
    parser = argparse.ArgumentParser(description="KML → GeoJSON cho RRIV Vườn cây")
    parser.add_argument("--kml", type=Path, default=DEFAULT_KML)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--layer", default=DEFAULT_LAYER)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()

    if not args.kml.is_file():
        raise SystemExit(f"Không tìm thấy file KML: {args.kml}")

    source = resolve_kml_source(args.kml, download=not args.no_download)
    convert(source, args.out, layer=args.layer)


if __name__ == "__main__":
    main()
