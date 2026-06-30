#!/usr/bin/env python3
"""Normalize UI assets to 1 design-unit = 1 pixel (see design/ui-final-guide.md)."""
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "assets" / "source"

# filename → (width, height) target design size
SPECS: dict[str, tuple[int, int]] = {
    "main_board_bg.png": (900, 650),
    "wall_grid_outline.png": (400, 400),
    "score_box_bg.png": (160, 60),
    "pattern_slot_empty.png": (70, 70),
    "floor_slot_empty.png": (50, 50),
    "arrow_right_icon.png": (24, 18),
    "factory-plate.png": (160, 160),
    "tile-first-player.png": (48, 48),
    "tile-blue-star.png": (48, 48),
    "tile-orange-flower.png": (48, 48),
    "tile-red-diamond.png": (48, 48),
    "tile-cyan-swirl.png": (48, 48),
    "tile-dark-cross.png": (48, 48),
}


def resize_to(path: Path, size: tuple[int, int]) -> None:
    img = Image.open(path).convert("RGBA")
    if img.size == size:
        print(f"  ok {path.name} {size[0]}x{size[1]}")
        return
    out = img.resize(size, Image.Resampling.LANCZOS)
    out.save(path, "PNG")
    print(f"  {path.name} {img.size[0]}x{img.size[1]} → {size[0]}x{size[1]}")


def main() -> None:
    print("Normalizing assets →", OUT)
    for name, size in SPECS.items():
        p = OUT / name
        if not p.exists():
            print(f"  skip missing {name}")
            continue
        resize_to(p, size)
    print("done")


if __name__ == "__main__":
    main()
