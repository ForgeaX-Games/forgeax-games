#!/usr/bin/env python3
"""Build a seamless, landmark-softened albedo for the camp ground plane.

Reads prop-path.base_color.png (path prop keeps the sharp original) and writes
prop-ground.base_color.png for bake-ground.ts to embed.

Usage (from hellforge root):
  python3 scripts/soften-ground-albedo.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MESHES = ROOT / "assets" / "3d" / "props" / "meshes"
SRC = MESHES / "prop-path.base_color.png"
DST = MESHES / "prop-ground.base_color.png"

BAND = 160  # edge crossfade width (px) — kills hard tile seams
BLUR = 1.4
CONTRAST = 0.78
LANDMARK = 0.72  # pull toward mean (1 = keep, 0 = flat mean)


def make_seamless(arr: np.ndarray, band: int) -> np.ndarray:
    """Force opposite edges toward their average so REPEAT wrap has no hard cut."""
    a = arr.astype(np.float32).copy()
    h, w = a.shape[:2]
    band = min(band, h // 4, w // 4)
    for i in range(band):
        t = (i + 0.5) / band
        s = t * t * (3.0 - 2.0 * t)  # smoothstep: 0 at edge → 1 interior
        avg_lr = 0.5 * (a[:, i] + a[:, w - 1 - i])
        a[:, i] = avg_lr * (1.0 - s) + a[:, i] * s
        a[:, w - 1 - i] = avg_lr * (1.0 - s) + a[:, w - 1 - i] * s
        avg_tb = 0.5 * (a[i] + a[h - 1 - i])
        a[i] = avg_tb * (1.0 - s) + a[i] * s
        a[h - 1 - i] = avg_tb * (1.0 - s) + a[h - 1 - i] * s
    # corners get double-processed — re-average the four corner patches lightly
    c = band // 2
    for y in range(c):
        for x in range(c):
            t = min((x + 0.5) / c, (y + 0.5) / c)
            s = t * t * (3.0 - 2.0 * t)
            samples = np.stack(
                [
                    arr[y, x],
                    arr[y, w - 1 - x],
                    arr[h - 1 - y, x],
                    arr[h - 1 - y, w - 1 - x],
                ]
            ).astype(np.float32)
            avg = samples.mean(axis=0)
            for yy, xx in (
                (y, x),
                (y, w - 1 - x),
                (h - 1 - y, x),
                (h - 1 - y, w - 1 - x),
            ):
                a[yy, xx] = avg * (1.0 - s) + a[yy, xx] * s
    return np.clip(a, 0, 255)


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"missing source albedo: {SRC}")

    im = Image.open(SRC).convert("RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=BLUR))
    im = ImageEnhance.Contrast(im).enhance(CONTRAST)

    arr = np.asarray(im, dtype=np.float32)
    mean = arr.mean(axis=(0, 1), keepdims=True)
    arr = mean + (arr - mean) * LANDMARK
    arr = make_seamless(arr, BAND)

    out = Image.fromarray(arr.astype(np.uint8), mode="RGB")
    out.save(DST, format="PNG", optimize=True)
    print(f"wrote {DST.relative_to(ROOT)} ({out.size[0]}×{out.size[1]}, seamless band={BAND})")


if __name__ == "__main__":
    main()
