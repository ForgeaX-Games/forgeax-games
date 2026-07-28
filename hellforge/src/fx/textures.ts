// Procedural sprite-sheet generator registry (PR8 T2, CC0 upgrade T9a).
// Pure module — NO engine imports — so sheet bytes are unit-testable in bun.
//
// Sheet bytes are produced at runtime (contact-shadow.ts precedent) and fed
// to `allocSharedRef<'TextureAsset'>` by fx/sprite.ts. Procedural sheets are
// generated; CC0-backed sheets are fetched from the shipped pack at boot
// (see below). Provenance is mirrored into assets/vfx/provenance.json
// (textures.test.ts cross-checks the manifest covers every registry id).
//
// L2 route (plan §4 L2 / §7 T2, PR8 T9a): HYBRID — CC0 Kenney Particle Pack
// frames upgrade the flame/impact/smoke sheets at boot (loadPngSheet +
// upgradeSheetFromPng below, wired from main.ts via fx/texture-packs.ts);
// the remaining sheets stay procedural by design (glows/noise/residue). The
// procedural generators are the per-sheet FALLBACK (§9) and the bytes seen
// by unit tests + the dump script — in a browser the registry entry carries
// the pack bytes after the boot swap. CC0 provenance lives in
// assets/vfx/provenance.json (textures.test.ts cross-checks it 1:1).
//
// Atlas convention: `frames` cells in a `cols × rows` grid, each cell
// `frameW × frameH` px, atlas width = cols*frameW / height = rows*frameH.
// Cell (col 0, row 0) is the TOP-left cell — V=0 at image top, matching the
// HANDLE_QUAD UV convention and sprite.wgsl's flipbook math.

/** Deterministic PRNG (mulberry32) — sheet bytes must not depend on Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash → [0,1). 32-bit imul chain, deterministic per seed. */
function hash2i(ix: number, iy: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ Math.imul(ix, 374761393), 668265263);
  h = Math.imul(h ^ Math.imul(iy, 2246822519), 3266489917);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise 2D, smooth-interpolated lattice. Output [0,1]. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2i(ix, iy, seed);
  const b = hash2i(ix + 1, iy, seed);
  const c = hash2i(ix, iy + 1, seed);
  const d = hash2i(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Tileable value noise — lattice coords wrap at `period` so the sheet edges
 * match (the distortion sampler scrolls indefinitely).
 */
export function valueNoise2Tileable(x: number, y: number, period: number, seed: number): number {
  const p = Math.max(1, period | 0);
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const wrap = (v: number): number => ((v % p) + p) % p;
  const a = hash2i(wrap(ix), wrap(iy), seed);
  const b = hash2i(wrap(ix + 1), wrap(iy), seed);
  const c = hash2i(wrap(ix), wrap(iy + 1), seed);
  const d = hash2i(wrap(ix + 1), wrap(iy + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Fractal brownian motion over value noise, amplitude-normalised so the mean
 * sits at mid gray ≈ 0.5 (D3 "scale by mids" lesson — a skewed-mean noise
 * biases every distortion / erosion consumer).
 */
export function fbm2(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let ampSum = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(fx, fy, seed + i * 101) * amp;
    ampSum += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return ampSum > 0 ? sum / ampSum : 0;
}

/** Tileable fbm — octave i wraps at basePeriod * 2^i. */
export function fbm2Tileable(
  x: number, y: number, basePeriod: number, octaves: number, seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let ampSum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2Tileable(x, y, basePeriod * (1 << i), seed + i * 101) * amp;
    ampSum += amp;
    amp *= 0.5;
    x *= 2;
    y *= 2;
  }
  return ampSum > 0 ? sum / ampSum : 0;
}

// ── sheet spec / registry ───────────────────────────────────────────────────

export interface GeneratedSheet {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface SpriteSheetSpec {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
  readonly frameW: number;
  readonly frameH: number;
  /** Provenance — mirrored into assets/vfx/provenance.json. CC0-backed sheets
   * name the pack their boot upgrade loads; their generate() stays the
   * procedural fallback (see the file header). */
  readonly source: 'procedural' | 'kenney-particle-pack';
  readonly license: 'team-owned' | 'CC0-1.0';
  readonly attribution: string;
  /** What consumes this sheet (fire kit / frost kit / …). */
  readonly usage: string;
  /** Full-atlas RGBA bytes; deterministic per call (fixed internal seeds). */
  generate(): GeneratedSheet;
}

type SheetProvenance = Pick<SpriteSheetSpec, 'source' | 'license' | 'attribution'>;

const PROCEDURAL_PROVENANCE: SheetProvenance = {
  source: 'procedural',
  license: 'team-owned',
  attribution: '',
};

/** Kenney Particle Pack (CC0-1.0) — see assets/vfx/provenance.json. */
const KENNEY_PROVENANCE: SheetProvenance = {
  source: 'kenney-particle-pack',
  license: 'CC0-1.0',
  attribution: 'Kenney Vleugels (www.kenney.nl)',
};

function spec(
  s: Omit<SpriteSheetSpec, 'source' | 'license' | 'attribution'>,
  provenance: SheetProvenance = PROCEDURAL_PROVENANCE,
): SpriteSheetSpec {
  return { ...provenance, ...s };
}

function makeAtlas(cols: number, rows: number, frameW: number, frameH: number) {
  const width = cols * frameW;
  const height = rows * frameH;
  const data = new Uint8ClampedArray(width * height * 4);
  return { width, height, data };
}

// ── generators ──────────────────────────────────────────────────────────────

function generateGlow(): GeneratedSheet {
  const S = 128;
  const atlas = makeAtlas(1, 1, S, S);
  const c = (S - 1) * 0.5;
  const half = S * 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - c, y - c) / half;
      const t = Math.max(0, 1 - r);
      // Two-lobe radial falloff: hot tight core + wide soft halo (halo widened
      // — the old t²·0.4 lobe read as a pin-prick at ARPG distance).
      const v = Math.min(1, Math.pow(t, 5) + Math.pow(t, 1.6) * 0.5);
      const o = (y * S + x) * 4;
      atlas.data[o] = 255;
      atlas.data[o + 1] = 255;
      atlas.data[o + 2] = 255;
      atlas.data[o + 3] = Math.round(v * 255);
    }
  }
  return atlas;
}

function generateNoise(): GeneratedSheet {
  const S = 256;
  const atlas = makeAtlas(1, 1, S, S);
  const basePeriod = 8;
  let mean = 0;
  const values = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm2Tileable((x / S) * basePeriod, (y / S) * basePeriod, basePeriod, 4, 7331);
      values[y * S + x] = n;
      mean += n;
    }
  }
  mean /= S * S;
  // Mid-level: shift so the atlas mean sits exactly at 0.5 (see fbm2 note).
  const shift = 0.5 - mean;
  for (let i = 0; i < S * S; i++) {
    const v = Math.min(1, Math.max(0, values[i]! + shift));
    const b = Math.round(v * 255);
    const o = i * 4;
    atlas.data[o] = b;
    atlas.data[o + 1] = b;
    atlas.data[o + 2] = b;
    atlas.data[o + 3] = b;
  }
  return atlas;
}

function boxBlurAlpha(
  data: Uint8ClampedArray, width: number, height: number, passes: number,
): void {
  const src = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) src[i] = data[i * 4 + 3]!;
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            sum += cur[yy * width + xx]!;
            n++;
          }
        }
        next[y * width + x] = sum / n;
      }
    }
    cur = next;
  }
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = Math.round(cur[i]!);
}

function generateFlame(): GeneratedSheet {
  // 2×2 flipbook — 4 sway variants of a tongued flame. Alpha carries the
  // intensity structure (hot column / licking tongues / dim envelope), the
  // def's fire tint turns it into fire. Distortion adds wobble on top.
  const COLS = 2;
  const ROWS = 2;
  const W = 128;
  const H = 256;
  const atlas = makeAtlas(COLS, ROWS, W, H);
  const cx = (W - 1) * 0.5;
  for (let f = 0; f < COLS * ROWS; f++) {
    const col = f % COLS;
    const row = Math.floor(f / COLS);
    for (let y = 0; y < H; y++) {
      // ny: 0 at image top (flame tip) → 1 at bottom (flame base).
      const ny = y / (H - 1);
      // The tip sways (each frame a different lean) — the base stays planted.
      const sway = (fbm2(ny * 2.2, f * 0.9 + 0.3, 3, 8100) - 0.5) * 0.55 * (1 - ny * 0.55);
      // Teardrop half-width, slimmer than the old blob, → 0 at tip.
      const widthProfile = Math.pow(Math.max(0, 1 - Math.pow(1 - ny, 2.4)), 0.5) * 0.42;
      for (let x = 0; x < W; x++) {
        const nx = (x - cx) / (W * 0.5) - sway;
        const inside = widthProfile > 0 ? Math.max(0, 1 - (nx / widthProfile) * (nx / widthProfile)) : 0;
        // Rising tongue field — streaks that climb toward the tip.
        const tongue = fbm2(nx * 2.6 + 13.7, ny * 3.4 - f * 1.3, 4, 8200 + f * 97);
        const tongueMask = Math.min(1, Math.max(0, (tongue - 0.42) / 0.35));
        // Hot central column (the bright heart of the flame).
        const core = Math.exp(-(nx * nx) / (2 * 0.11 * 0.11));
        // Vertical gradient: bright base → transparent tip.
        const grad = Math.pow(ny, 1.05);
        const a = Math.min(1, inside * (0.30 + 0.55 * tongueMask + 0.50 * core) * grad * 1.25);
        const gx = col * W + x;
        const gy = row * H + y;
        const o = (gy * atlas.width + gx) * 4;
        atlas.data[o] = 255;
        atlas.data[o + 1] = 255;
        atlas.data[o + 2] = 255;
        atlas.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  return atlas;
}

function generateFireball(): GeneratedSheet {
  // Procedural fallback for 'fireball' — 2 tall tongue frames (same family as
  // generateFlame, 2×1 grid). Boot upgrades this to Kenney flame_05/06 (CC0).
  const COLS = 2;
  const ROWS = 1;
  const W = 128;
  const H = 256;
  const atlas = makeAtlas(COLS, ROWS, W, H);
  const cx = (W - 1) * 0.5;
  for (let f = 0; f < COLS * ROWS; f++) {
    const col = f % COLS;
    for (let y = 0; y < H; y++) {
      const ny = y / (H - 1);
      const sway = (fbm2(ny * 2.2, f * 1.7 + 0.6, 3, 8100) - 0.5) * 0.6 * (1 - ny * 0.5);
      const widthProfile = Math.pow(Math.max(0, 1 - Math.pow(1 - ny, 2.4)), 0.5) * 0.4;
      for (let x = 0; x < W; x++) {
        const nx = (x - cx) / (W * 0.5) - sway;
        const inside = widthProfile > 0 ? Math.max(0, 1 - (nx / widthProfile) * (nx / widthProfile)) : 0;
        const tongue = fbm2(nx * 2.6 + 13.7, ny * 3.4 - f * 1.9, 4, 8600 + f * 131);
        const tongueMask = Math.min(1, Math.max(0, (tongue - 0.42) / 0.35));
        const core = Math.exp(-(nx * nx) / (2 * 0.10 * 0.10));
        const grad = Math.pow(ny, 1.05);
        const a = Math.min(1, inside * (0.30 + 0.55 * tongueMask + 0.50 * core) * grad * 1.25);
        const gx = col * W + x;
        const o = (y * atlas.width + gx) * 4;
        atlas.data[o] = 255;
        atlas.data[o + 1] = 255;
        atlas.data[o + 2] = 255;
        atlas.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  return atlas;
}

function generateImpact(): GeneratedSheet {
  // 16-frame burst: frames 0–3 = hot mottled core flash (the punch), frames
  // 2–15 = expanding noise-eroded ring on top. The old all-hollow-ring sheet
  // read as a ripple, not a hit.
  const COLS = 4;
  const ROWS = 4;
  const F = 128;
  const atlas = makeAtlas(COLS, ROWS, F, F);
  const frames = COLS * ROWS;
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const col = f % COLS;
    const row = Math.floor(f / COLS);
    const radius = 0.12 + 0.72 * t;         // of half-extent
    const erosion = 0.15 + 0.75 * t;        // noise threshold rises with age
    // Hot core lives only in the first frames.
    const coreT = Math.max(0, 1 - f / 3.5);
    const coreR = 0.36 - t * 0.12;
    // Ring gate: the annulus fades in after the initial flash.
    const ringGate = Math.min(1, Math.max(0, (t - 0.08) / 0.12));
    const c = (F - 1) * 0.5;
    const half = F * 0.5;
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        const r = Math.hypot(x - c, y - c) / half;
        // Filled hot core with mottled fire texture.
        const core = Math.exp(-(r * r) / (2 * coreR * coreR)) * coreT;
        const mottle = 0.7 + 0.6 * fbm2((x / F) * 7, (y / F) * 7, 3, 300 + f * 11);
        // Blob ring: soft annulus peaking at `radius`.
        const d = Math.abs(r - radius);
        const ring = Math.exp(-(d * d) / (2 * 0.09 * 0.09)) * ringGate;
        const n = fbm2((x / F) * 6, (y / F) * 6, 4, 911);
        const keep = n > erosion * 0.85 ? 1 : Math.max(0, n / (erosion * 0.85));
        const fade = 1 - t * 0.55;
        const a = Math.min(1, (core * mottle + ring) * keep * fade * 1.25);
        const gx = col * F + x;
        const gy = row * F + y;
        const o = (gy * atlas.width + gx) * 4;
        atlas.data[o] = 255;
        atlas.data[o + 1] = 255;
        atlas.data[o + 2] = 255;
        atlas.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  return atlas;
}

function generateSpark(): GeneratedSheet {
  const W = 32;
  const H = 128;
  const atlas = makeAtlas(1, 1, W, H);
  const cx = (W - 1) * 0.5;
  for (let y = 0; y < H; y++) {
    const ny = y / (H - 1);
    // Streak envelope: fade both tips, brightest below centre (motion lead).
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, ny * 1.02)), 1.2);
    for (let x = 0; x < W; x++) {
      const nx = (x - cx) / (W * 0.5);
      // Hot hairline core + tight halo — the old single-wide-gaussian streak
      // read as a blurry smear at speed.
      const core = Math.exp(-(nx * nx) / (2 * 0.06 * 0.06));
      const halo = Math.exp(-(nx * nx) / (2 * 0.30 * 0.30)) * 0.35;
      const a = Math.min(1, (core + halo) * env);
      const o = (y * W + x) * 4;
      atlas.data[o] = 255;
      atlas.data[o + 1] = 255;
      atlas.data[o + 2] = 255;
      atlas.data[o + 3] = Math.round(a * 255);
    }
  }
  return atlas;
}

/** Point-in-convex-polygon via consistent cross-product signs. */
function insideConvex(px: number, py: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/** Min distance from point to polygon edges (for the bright rim). */
function edgeDist(px: number, py: number, poly: ReadonlyArray<readonly [number, number]>): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % poly.length]!;
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + abx * t), py - (ay + aby * t)));
  }
  return best;
}

function generateShard(): GeneratedSheet {
  const COLS = 2;
  const ROWS = 2;
  const F = 128;
  const atlas = makeAtlas(COLS, ROWS, F, F);
  const c = (F - 1) * 0.5;
  for (let f = 0; f < COLS * ROWS; f++) {
    const rand = mulberry32(4100 + f * 17);
    // Convex crystal: angles sorted, radii with small jitter around a circle.
    const nVerts = 5 + Math.floor(rand() * 3);
    const poly: Array<readonly [number, number]> = [];
    const start = rand() * Math.PI * 2;
    for (let i = 0; i < nVerts; i++) {
      const ang = start + (i / nVerts) * Math.PI * 2 + (rand() - 0.5) * 0.25;
      const r = F * (0.34 + rand() * 0.13);
      poly.push([c + Math.cos(ang) * r, c + Math.sin(ang) * r * 1.25]); // tall crystals
    }
    const col = f % COLS;
    const row = Math.floor(f / COLS);
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        let a = 0;
        if (insideConvex(x, y, poly)) {
          const rim = Math.exp(-edgeDist(x, y, poly) / 2.2);
          a = Math.min(1, 0.38 + rim * 0.85);
        }
        const gx = col * F + x;
        const gy = row * F + y;
        const o = (gy * atlas.width + gx) * 4;
        atlas.data[o] = 255;
        atlas.data[o + 1] = 255;
        atlas.data[o + 2] = 255;
        atlas.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  return atlas;
}

/** Distance from point to segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Midpoint-displacement lightning polyline, top → bottom. */
function boltPolyline(w: number, h: number, seed: number): Array<readonly [number, number]> {
  const rand = mulberry32(seed);
  let pts: Array<readonly [number, number]> = [
    [w * 0.5, 0],
    [w * 0.5, h - 1],
  ];
  for (let depth = 0; depth < 6; depth++) {
    const next: Array<readonly [number, number]> = [pts[0]!];
    const spread = w * 0.22 * Math.pow(0.55, depth);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[i + 1]!;
      const mx = (ax + bx) * 0.5 + (rand() - 0.5) * 2 * spread;
      const my = (ay + by) * 0.5;
      next.push([Math.max(1, Math.min(w - 2, mx)), my], [bx, by]);
    }
    pts = next;
  }
  return pts;
}

function generateBolt(): GeneratedSheet {
  const COLS = 2;
  const ROWS = 2;
  const W = 64;
  const H = 256;
  const atlas = makeAtlas(COLS, ROWS, W, H);
  for (let f = 0; f < COLS * ROWS; f++) {
    const pts = boltPolyline(W, H, 9200 + f * 31);
    const col = f % COLS;
    const row = Math.floor(f / COLS);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let d = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i]!;
          const [bx, by] = pts[i + 1]!;
          d = Math.min(d, segDist(x, y, ax, ay, bx, by));
        }
        // Hot core + soft glow falloff.
        const v = Math.min(1, Math.exp(-d / 0.9) + Math.exp(-d / 5.0) * 0.45);
        const gx = col * W + x;
        const gy = row * H + y;
        const o = (gy * atlas.width + gx) * 4;
        atlas.data[o] = 255;
        atlas.data[o + 1] = 255;
        atlas.data[o + 2] = 255;
        atlas.data[o + 3] = Math.round(v * 255);
      }
    }
  }
  return atlas;
}

function generateScorch(): GeneratedSheet {
  const S = 128;
  const atlas = makeAtlas(1, 1, S, S);
  const c = (S - 1) * 0.5;
  const half = S * 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - c, y - c) / half;
      const n = fbm2((x / S) * 5, (y / S) * 5, 4, 553);
      // Noise-eroded radial blob — ragged burnt edge, dense centre. Coverage
      // raised vs the old wash: ground residue must read from the ARPG camera.
      const a = Math.min(1, Math.max(0, (1 - r) * 1.6 - (1 - n) * 0.3 + 0.1));
      const o = (y * S + x) * 4;
      // Near-black warm residue, slightly warmer toward the centre.
      const warm = 1 - Math.min(1, r);
      atlas.data[o] = Math.round(26 + warm * 20);
      atlas.data[o + 1] = Math.round(18 + warm * 6);
      atlas.data[o + 2] = 10;
      atlas.data[o + 3] = Math.round(Math.min(0.9, a) * 255);
    }
  }
  return atlas;
}

function generateRing(): GeneratedSheet {
  // Nova shock annulus — ragged fiery edge, not a plain gaussian circle.
  // Angular fbm (sampled on a circle in noise space so it wraps seamlessly)
  // wobbles the ring radius and gates the alpha, breaking the edge into flame
  // tongues; a faint secondary inner rim adds depth. White rgb, alpha shaped;
  // fixed seeds keep the bytes deterministic.
  const S = 128;
  const atlas = makeAtlas(1, 1, S, S);
  const c = (S - 1) * 0.5;
  const half = S * 0.5;
  const r0 = 0.78;
  const w = 0.085;
  const r1 = 0.55;
  const w1 = 0.05;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - c, y - c) / half;
      const theta = Math.atan2(y - c, x - c);
      const tongue = fbm2(Math.cos(theta) * 2.2 + 5, Math.sin(theta) * 2.2 + 5, 3, 4700);
      const d = (r - (r0 + (tongue - 0.5) * 0.14)) / w;
      const main = Math.exp(-d * d) * (0.35 + 0.65 * tongue);
      const d1 = (r - r1) / w1;
      const inner = Math.exp(-d1 * d1) * 0.28;
      const a = Math.min(1, main + inner);
      const o = (y * S + x) * 4;
      atlas.data[o] = 255;
      atlas.data[o + 1] = 255;
      atlas.data[o + 2] = 255;
      atlas.data[o + 3] = Math.round(a * 255);
    }
  }
  return atlas;
}

function generateBeam(): GeneratedSheet {
  const W = 64;
  const H = 256;
  const atlas = makeAtlas(1, 1, W, H);
  const cx = (W - 1) * 0.5;
  for (let y = 0; y < H; y++) {
    // ny: 0 at image top (beam tip) → 1 at bottom (grounded base).
    const ny = y / (H - 1);
    // Vertical fade: bright base → transparent top.
    const grad = Math.pow(ny, 1.5);
    for (let x = 0; x < W; x++) {
      const nx = (x - cx) / (W * 0.5);
      // Vertical light rays — low y-frequency streaks so the pillar reads as
      // light, not fog. Mask multiplies the gaussian cross-section.
      const rays = fbm2(nx * 3.5 + 4.7, ny * 1.2, 3, 7100);
      const rayMask = 0.55 + 0.45 * Math.min(1, Math.max(0, (rays - 0.35) / 0.4));
      const cross = Math.exp(-(nx * nx) / (2 * 0.3 * 0.3));
      const a = Math.min(1, cross * rayMask * grad * 1.1);
      const o = (y * W + x) * 4;
      atlas.data[o] = 255;
      atlas.data[o + 1] = 255;
      atlas.data[o + 2] = 255;
      atlas.data[o + 3] = Math.round(a * 255);
    }
  }
  return atlas;
}

function generateSmoke(): GeneratedSheet {
  const COLS = 2;
  const ROWS = 2;
  const F = 128;
  const atlas = makeAtlas(COLS, ROWS, F, F);
  const c = (F - 1) * 0.5;
  const half = F * 0.5;
  for (let f = 0; f < COLS * ROWS; f++) {
    const seed = 6400 + f * 47;
    const col = f % COLS;
    const row = Math.floor(f / COLS);
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        const r = Math.hypot(x - c, y - c) / half;
        const n = fbm2((x / F) * 4, (y / F) * 4, 4, seed);
        const blob = Math.max(0, 1 - r * r);
        const a = Math.min(1, blob * Math.max(0, n * 1.6 - 0.45) * 1.35);
        // Soft gray body with subtle noise shading.
        const g = Math.round(150 + n * 70);
        const gx = col * F + x;
        const gy = row * F + y;
        const o = (gy * atlas.width + gx) * 4;
        atlas.data[o] = g;
        atlas.data[o + 1] = g;
        atlas.data[o + 2] = g;
        atlas.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  return atlas;
}

// ── registry ────────────────────────────────────────────────────────────────

export const SPRITE_SHEETS: readonly SpriteSheetSpec[] = [
  spec({
    id: 'glow', cols: 1, rows: 1, frames: 1, frameW: 128, frameH: 128,
    usage: 'additive hot-core glow layer (impacts, projectile bodies, loot beams)',
    generate: generateGlow,
  }),
  spec({
    id: 'noise', cols: 1, rows: 1, frames: 1, frameW: 256, frameH: 256,
    usage: 'tileable fbm — UV distortion input, bound on every sprite material',
    generate: generateNoise,
  }),
  spec({
    id: 'flame', cols: 2, rows: 2, frames: 4, frameW: 128, frameH: 256,
    usage: '4-frame tongued flame bodies (campfire / torch / brazier ambient fire)',
    // CC0-backed (T9a): kenney fire/flame frames replace this generator at
    // boot — the procedural teardrop was the human-flagged weak point (§9).
    generate: generateFlame,
  }, KENNEY_PROVENANCE),
  spec({
    id: 'fireball', cols: 2, rows: 1, frames: 2, frameW: 128, frameH: 256,
    usage: 'tall flame tongues — projectile flight bodies + trails (Magma Bolt)',
    // CC0-backed (T9a): kenney flame_05/06 tall tongues at boot.
    generate: generateFireball,
  }, KENNEY_PROVENANCE),
  spec({
    id: 'impact', cols: 4, rows: 4, frames: 16, frameW: 128, frameH: 128,
    usage: 'flipbook impact bursts (projectile hits, melee feedback)',
    // CC0-backed (T9a): kenney muzzle flash → fire burst → smoke dissolve.
    generate: generateImpact,
  }, KENNEY_PROVENANCE),
  spec({
    id: 'spark', cols: 1, rows: 1, frames: 1, frameW: 32, frameH: 128,
    usage: 'elongated spark streaks (fire sparks, ember accents)',
    generate: generateSpark,
  }),
  spec({
    id: 'shard', cols: 2, rows: 2, frames: 4, frameW: 128, frameH: 128,
    usage: 'frost crystal shards (Frost Fang trail, Shatter fragments)',
    generate: generateShard,
  }),
  spec({
    id: 'bolt', cols: 2, rows: 2, frames: 4, frameW: 64, frameH: 256,
    usage: 'lightning polylines (Arc Surge segments, arc hit feedback)',
    generate: generateBolt,
  }),
  spec({
    id: 'scorch', cols: 1, rows: 1, frames: 1, frameW: 128, frameH: 128,
    usage: 'ground scorch / burn residue decals (premult)',
    generate: generateScorch,
  }),
  spec({
    id: 'ring', cols: 1, rows: 1, frames: 1, frameW: 128, frameH: 128,
    usage: 'shockwave annulus (inferno-nova, impact rings)',
    generate: generateRing,
  }),
  spec({
    id: 'beam', cols: 1, rows: 1, frames: 1, frameW: 64, frameH: 256,
    usage: 'loot rarity beam pillar',
    generate: generateBeam,
  }),
  spec({
    id: 'smoke', cols: 2, rows: 2, frames: 4, frameW: 128, frameH: 128,
    usage: 'soft smoke puffs (ember aftermath, death dissolve wisp)',
    // CC0-backed (T9a): kenney realistic smoke puffs.
    generate: generateSmoke,
  }, KENNEY_PROVENANCE),
];

const BY_ID = new Map(SPRITE_SHEETS.map((s) => [s.id, s]));

export function spriteSheetById(id: string): SpriteSheetSpec | undefined {
  return BY_ID.get(id);
}

// ── runtime PNG route (PR8 T9a — plan §4 L2 / §7 T2) ───────────────────────
// CC0 pack frames fetched at boot, composited into a flipbook atlas on a 2d
// canvas, then swapped into the registry so every def/call site keeps working
// unchanged (SpriteSystem.textureFor uploads the bytes generate() returns on
// first use). Browser-only path — never called from bun tests, and the import
// itself stays pure (all DOM access is inside the function bodies).

export interface PngAtlasSpec {
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
}

/**
 * Fetch single-frame PNGs and pack them into one flipbook atlas. Frame f
 * lands at cell (f % cols, floor(f / cols)) — row-major, cell (0,0) at the
 * TOP-left (V=0 at image top, the atlas convention in the file header). One
 * cell = one source image at native size; all sources must share pixel dims.
 * Throws on ANY failure (fetch, decode, mixed dims, no 2d context) — the
 * caller falls back to the procedural sheet.
 */
export async function loadPngSheet(
  urls: readonly string[],
  atlas: PngAtlasSpec,
): Promise<GeneratedSheet> {
  if (urls.length !== atlas.frames) {
    throw new Error(`expected ${atlas.frames} frame urls, got ${urls.length}`);
  }
  if (atlas.frames > atlas.cols * atlas.rows) {
    throw new Error(`${atlas.frames} frames do not fit a ${atlas.cols}x${atlas.rows} grid`);
  }
  const bitmaps = await Promise.all(urls.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
    return createImageBitmap(await res.blob());
  }));
  const frameW = bitmaps[0]!.width;
  const frameH = bitmaps[0]!.height;
  for (const b of bitmaps) {
    if (b.width !== frameW || b.height !== frameH) {
      throw new Error(`mixed frame dims: ${frameW}x${frameH} vs ${b.width}x${b.height}`);
    }
  }
  const width = atlas.cols * frameW;
  const height = atlas.rows * frameH;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context for atlas composition');
  bitmaps.forEach((b, f) => {
    ctx.drawImage(b, (f % atlas.cols) * frameW, Math.floor(f / atlas.cols) * frameH);
    b.close();
  });
  // getImageData un-premultiplies → straight RGBA, the same shape the
  // procedural generators return (sprite.wgsl multiplies tex.rgb * a itself).
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

/**
 * Swap a registry sheet's generate() for loaded PNG bytes — the registry
 * stays the SSOT, so frameW/frameH re-derive from the loaded atlas and the
 * declared dims keep matching the bytes. Returns false for an unknown id.
 */
export function upgradeSheetFromPng(id: string, sheet: GeneratedSheet): boolean {
  const entry = BY_ID.get(id);
  if (!entry) return false;
  const mutable = entry as { -readonly [K in keyof SpriteSheetSpec]: SpriteSheetSpec[K] };
  mutable.generate = () => sheet;
  mutable.frameW = sheet.width / entry.cols;
  mutable.frameH = sheet.height / entry.rows;
  return true;
}
