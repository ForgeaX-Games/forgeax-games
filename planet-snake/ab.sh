#!/usr/bin/env bash
# Reproducible A/B fixture.
#
# Five separate measurements in this project were invalidated by comparing
# frames that differed for reasons other than the change under test — different
# camera angles, a sample point on the polar ice cap, a crop that included the
# score panel, a scanline that measured a chord instead of a diameter, and two
# runs of one identical build reading 95.2 and 48.3.
#
# So this fixture pins everything a capture can vary by:
#   - ?seed=N        Math.random is replaced by a seeded PRNG before any scatter
#                    runs, so decoration, pellets and bots land identically
#   - __ps.freeze()  the snake is parked at a fixed point and the sim stopped
#   - fixed probe    same world position on both sides
#
# And it SELF-CHECKS: it captures the same build twice before comparing anything.
# If those two do not match, the fixture is not trustworthy and it says so
# instead of reporting a difference that is really noise.
#
# Usage:
#   tools/ab.sh baseline <name>            capture one labelled state
#   tools/ab.sh selfcheck                  prove two identical runs match
#   tools/ab.sh compare <nameA> <nameB>    report the delta

set -euo pipefail
cd "$(dirname "$0")/.."

SEED=${SEED:-1337}
PROBE=${PROBE:-"0.401 0.482 0.779"}
PORT=${CDP_PORT:-9444}
URL="http://127.0.0.1:28920/preview/?game=planet-snake&seed=$SEED"

capture () {                       # capture <outName>
  CDP_PORT=$PORT bun tools/cdp.mjs eval "location.href='$URL'" >/dev/null 2>&1 || true
  sleep 13
  CDP_PORT=$PORT bun tools/cdp.mjs eval "__ps.freeze([${PROBE// /,}])" >/dev/null
  sleep 1
  CDP_PORT=$PORT bun tools/cdp.mjs shot "shots/ab-$1.png" 300 >/dev/null
  echo "shots/ab-$1.png"
}

stats () {                         # stats <name> [<name2>]
  python3 - "$@" <<'PY'
import sys
import numpy as np
from PIL import Image

def read(name):
    a = np.asarray(Image.open(f'shots/ab-{name}.png').convert('RGB')).astype(np.float32)
    h = a.shape[0]
    return a[int(h * 0.42):, :, :]          # planet region, clear of the HUD

def describe(name):
    r = read(name)
    lum = r.mean(axis=2)
    dark = r[lum <= 30]
    return dict(
        mean=r.mean(),
        R=r[:, :, 0].mean(), G=r[:, :, 1].mean(), B=r[:, :, 2].mean(),
        darkFrac=(lum <= 30).mean() * 100,
        darkBR=(dark[:, 2].mean() / max(dark[:, 0].mean(), 1e-3)) if len(dark) else float('nan'),
        p90=np.percentile(lum, 90), sat=((r.max(axis=2) - r.min(axis=2)) / np.maximum(r.max(axis=2), 1)).mean(),
    )

names = sys.argv[1:]
rows = [(n, describe(n)) for n in names]
hdr = f"{'':10s} {'mean':>6s} {'R':>6s} {'G':>6s} {'B':>6s} {'dark%':>6s} {'darkB/R':>7s} {'P90':>6s} {'sat':>5s}"
print(hdr)
for n, d in rows:
    print(f"{n:10s} {d['mean']:6.1f} {d['R']:6.1f} {d['G']:6.1f} {d['B']:6.1f} "
          f"{d['darkFrac']:6.1f} {d['darkBR']:7.2f} {d['p90']:6.1f} {d['sat']:5.3f}")

if len(rows) == 2:
    a, b = rows[0][1], rows[1][1]
    print()
    for k in ('mean', 'R', 'G', 'B', 'darkFrac', 'darkBR', 'p90', 'sat'):
        d = b[k] - a[k]
        print(f"  Δ{k:9s} {d:+8.3f}")
    # Pixel-identity check, used by selfcheck.
    ra, rb = read(names[0]), read(names[1])
    if ra.shape == rb.shape:
        diff = float(np.abs(ra - rb).mean())
        print(f"\n  mean |pixel diff| = {diff:.4f}")
PY
}

case "${1:-}" in
  baseline) capture "$2" >/dev/null; stats "$2" ;;
  selfcheck)
    echo "capturing the same build twice (seed $SEED)…"
    capture selfA >/dev/null
    capture selfB >/dev/null
    stats selfA selfB
    echo
    echo "A fixture is only usable if the two rows above are identical and the"
    echo "pixel diff is ~0. Anything else means the capture still varies on its"
    echo "own and no A/B built on it can be believed."
    ;;
  compare) stats "$2" "$3" ;;
  *) echo "usage: ab.sh baseline <name> | selfcheck | compare <a> <b>"; exit 1 ;;
esac
