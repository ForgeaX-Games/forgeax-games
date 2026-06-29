#!/usr/bin/env python3
"""Build table wood background from an AI-generated tile (tile + stretch to viewport)."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "source"
DEFAULT_GEN = ROOT / "assets" / "source" / "table_wood_tile_gen.png"

TILE_PX = 512
BG_W, BG_H = 2400, 1600


def build(src: Path) -> None:
    img = Image.open(src).convert("RGB")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    tile = img.crop((left, top, left + side, top + side)).resize(
        (TILE_PX, TILE_PX), Image.Resampling.LANCZOS
    )

    tile_path = OUT / "table_wood_tile.png"
    tile.save(tile_path, optimize=True)
    print(f"  tile {tile_path.name} {tile.size[0]}x{tile.size[1]}")

    cols = (BG_W + TILE_PX - 1) // TILE_PX
    rows = (BG_H + TILE_PX - 1) // TILE_PX
    canvas = Image.new("RGB", (cols * TILE_PX, rows * TILE_PX))
    for y in range(rows):
        for x in range(cols):
            canvas.paste(tile, (x * TILE_PX, y * TILE_PX))

    bg = canvas.resize((BG_W, BG_H), Image.Resampling.LANCZOS)
    bg_path = OUT / "table_wood_bg.png"
    bg.save(bg_path, optimize=True)
    print(f"  bg   {bg_path.name} {bg.size[0]}x{bg.size[1]}")


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_GEN
    if not src.is_file():
        print(f"missing source image: {src}", file=sys.stderr)
        sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    build(src)


if __name__ == "__main__":
    main()
