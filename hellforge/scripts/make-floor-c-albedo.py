#!/usr/bin/env python3
"""Derive the den floor-c grime albedo from prop-den-floor-b's base_color.

Usage (from hellforge root):
  python3 scripts/make-floor-c-albedo.py <src-jpg> <dst-jpg>

Reads the source JPEG, desaturates / darkens / shifts hue (params mirrored in
scripts/lib/surface-spec.ts FLOOR_VARIANT_ALBEDO), writes the variant JPEG
(quality 90, deterministic), and prints both mean brightness values.

Hard gate: the variant's mean brightness must be ≤ the source's — the den must
never brighten (N4 #15 hard constraint). Exits non-zero when violated.
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image

DESATURATE = 0.6
BRIGHTNESS = 0.82
HUE_SHIFT = 8  # PIL H channel 0-255 (~360°): +8 ≈ +11°


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert("RGB")
    h, s, v = im.convert("HSV").split()
    h = h.point(lambda x: (x + HUE_SHIFT) % 256)
    s = s.point(lambda x: int(x * DESATURATE))
    v = v.point(lambda x: int(x * BRIGHTNESS))
    out = Image.merge("HSV", (h, s, v)).convert("RGB")

    base_mean = float(np.asarray(im, dtype=np.float32).mean())
    var_mean = float(np.asarray(out, dtype=np.float32).mean())
    print(
        f"  floor-b base_color mean={base_mean:.2f} → floor-c mean={var_mean:.2f} "
        f"(Δ {var_mean - base_mean:+.2f}, must be ≤ 0)"
    )
    if var_mean > base_mean:
        print(
            "  FAIL: floor-c albedo brighter than floor-b — den must not brighten",
            file=sys.stderr,
        )
        sys.exit(1)

    out.save(dst, format="JPEG", quality=90, optimize=True)
    print(f"  wrote {dst}")


if __name__ == "__main__":
    main()
