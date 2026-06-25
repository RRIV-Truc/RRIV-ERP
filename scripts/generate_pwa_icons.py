"""Sinh icon PWA từ static/logo.png — chạy: python scripts/generate_pwa_icons.py"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "static" / "logo.png"
OUT_DIR = ROOT / "static"

SIZES = {
    "favicon-32.png": 32,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "apple-touch-icon.png": 180,
}


def make_icon(img: Image.Image, size: int) -> Image.Image:
    w, h = img.size
    scale = min(size / w, size / h) * 0.88
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return canvas.convert("RGB")


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Không tìm thấy {SRC}")

    img = Image.open(SRC).convert("RGBA")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, size in SIZES.items():
        out = OUT_DIR / name
        make_icon(img, size).save(out, "PNG", optimize=True)
        print(f"wrote {out} ({size}px)")


if __name__ == "__main__":
    main()
