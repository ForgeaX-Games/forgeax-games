// bake-sky.ts — procedural HELLISH equirectangular HDR sky for Hellforge.
// Dark smoke-ceiling zenith → bright lava-glow horizon band → dark nadir, with a
// seamless fbm cloud layer and bright HDR lava hotspots (values > 1 so they glow
// through the game's ACES tonemap and drive a warm IBL key).
//
// Drop-in: overwrites assets/sky.hdr in place — same path, same GUID
// (c4061caa via sky.hdr.meta.json), so installHdrSky needs zero changes. The
// engine loads EquirectAsset and projects internally (Skylight + SkyboxBackground).
//
// Run from repo root or anywhere:
//   bun run packages/games/hellforge/scripts/bake-sky.ts
// Output format matches the previous asset: new-RLE Radiance HDR, -Y 512 +X 1024.
// (Visible sky-dome GLB bake removed — Play uses native SkyboxBackground.)

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1024;
const H = 512;
const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(gameRoot, 'assets', 'sky.hdr');

// ── value noise (hash → trilinear), fbm made SEAMLESS in longitude ──────────
// Longitude u is sampled on a circle (cos/sin) so u=0 and u=1 land on the same
// point — no vertical seam where the panorama wraps.
function hash3(ix: number, iy: number, iz: number): number {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (iz | 0) * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = smooth(fx), v = smooth(fy), w = smooth(fz);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c000 = hash3(ix, iy, iz), c100 = hash3(ix + 1, iy, iz);
  const c010 = hash3(ix, iy + 1, iz), c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1), c101 = hash3(ix + 1, iy, iz + 1);
  const c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}
/** fbm periodic in u (circle sampling), stretched in v so clouds read as bands. */
function fbm(u: number, v: number, octaves: number, baseRadius: number, vFreq: number): number {
  const ang = 2 * Math.PI * u;
  const cx = Math.cos(ang), sy = Math.sin(ang);
  let amp = 0.5, radius = baseRadius, vf = vFreq, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(cx * radius + 13.7, sy * radius + 47.3, v * vf + 91.1);
    norm += amp;
    amp *= 0.5; radius *= 2; vf *= 2;
  }
  return sum / norm;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
function sstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ── latitude gradient (v: 0 = zenith top … 0.5 = horizon … 1 = nadir) ───────
type RGB = [number, number, number];
const KEYS: Array<[number, RGB]> = [
  [0.00, [0.07, 0.018, 0.010]],  // zenith — dark ember red (bright enough clouds read)
  [0.22, [0.22, 0.055, 0.022]],  // upper sky — smoky red-brown
  [0.40, [0.75, 0.22, 0.06]],    // mid — ember warmth building
  [0.50, [2.8, 0.78, 0.14]],     // HORIZON lava band — bright HDR glow
  [0.57, [1.0, 0.27, 0.06]],     // just below horizon
  [0.72, [0.16, 0.045, 0.02]],   // lower — darkening (ground covers this)
  [1.00, [0.03, 0.01, 0.006]],   // nadir — near black
];
function gradient(v: number): RGB {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [v0, c0] = KEYS[i]!, [v1, c1] = KEYS[i + 1]!;
    if (v <= v1) {
      const t = sstep(v0, v1, v);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return KEYS[KEYS.length - 1]![1];
}

// ── hell sky color at (u, v) ────────────────────────────────────────────────
function skyColor(u: number, v: number): RGB {
  const base = gradient(v);

  // Cloud layer: two seamless fbm octave-sets — broad formations + finer wisps —
  // combined for structure. High = lava-lit breaks (brighten toward gold),
  // low = dense smoke (darken toward oxblood). Sharp smoothstep = defined edges.
  const broad = fbm(u, v, 5, 2.2, 2.6);
  const fine = fbm(u + 19.4, v, 4, 5.0, 6.5);
  const cloud = sstep(0.34, 0.72, broad * 0.7 + fine * 0.3);
  // Pole fade: equirect longitude lines converge at the zenith/nadir, so full-
  // contrast clouds there pinch into an artificial starburst. Fade the cloud
  // modulation toward both poles so the caps read as smooth smoke.
  const poleFade = sstep(0.02, 0.17, v) * sstep(0.02, 0.17, 1 - v);
  const cloudMul = 1 + (0.28 + 2.05 * cloud - 1) * poleFade; // →1 (base) at poles

  let r = base[0] * cloudMul;
  let g = base[1] * cloudMul;
  let b = base[2] * cloudMul;

  // Bright cloud breaks skew warmer (lava light spilling through) — lift G a bit
  // so the brightest parts read gold-orange, not just brighter red.
  const breakGlow = sstep(0.62, 0.95, cloud) * poleFade;
  g += base[1] * breakGlow * 1.4;

  // Lava hotspots: finer noise, gated to a wide band around the horizon, squared
  // for sparse bright cracks. Additive warm HDR → bloom + strong warm IBL key.
  const horizonMask = Math.exp(-Math.pow((v - 0.5) / 0.20, 2)); // peak at horizon, wide
  const hotN = sstep(0.60, 0.90, fbm(u + 5.2, v, 5, 5.0, 6.0));
  const hot = Math.pow(hotN, 2) * horizonMask;
  r += 5.0 * hot;
  g += 1.5 * hot;
  b += 0.22 * hot;

  // Distant eruption glow — a soft broad warm light source at one longitude
  // near the horizon, so the IBL has a clear directional key (not flat ambient).
  const du = Math.min(Math.abs(u - 0.62), 1 - Math.abs(u - 0.62)); // wrapped dist
  const erupt = Math.exp(-Math.pow(du / 0.16, 2)) * Math.exp(-Math.pow((v - 0.52) / 0.10, 2));
  r += 3.0 * erupt;
  g += 0.9 * erupt;
  b += 0.12 * erupt;

  // Faint high-altitude ash haze desaturates the very top a touch (keeps it from
  // going pure black — reads as smoke, not void).
  const haze = sstep(0.0, 0.25, 0.25 - v) * 0.012;
  r += haze; g += haze * 0.5; b += haze * 0.4;

  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

// ── float → RGBE ────────────────────────────────────────────────────────────
function frexp(value: number): [number, number] {
  if (value === 0 || !isFinite(value)) return [value, 0];
  let e = Math.floor(Math.log2(Math.abs(value))) + 1;
  let m = value / Math.pow(2, e);
  while (Math.abs(m) >= 1) { m /= 2; e++; }
  while (Math.abs(m) < 0.5) { m *= 2; e--; }
  return [m, e];
}
function toRgbe(r: number, g: number, b: number, out: Uint8Array, o: number): void {
  const v = Math.max(r, g, b);
  if (v < 1e-32) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
  const [m, e] = frexp(v);
  const f = (m * 256) / v;
  out[o] = Math.min(255, Math.max(0, Math.floor(r * f)));
  out[o + 1] = Math.min(255, Math.max(0, Math.floor(g * f)));
  out[o + 2] = Math.min(255, Math.max(0, Math.floor(b * f)));
  out[o + 3] = Math.min(255, Math.max(0, e + 128));
}

// ── generate + encode (new-RLE, per-channel literal dumps ≤128) ─────────────
const headerStr = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`;
const chunks = Math.ceil(W / 128);
const scanlineBytes = 4 + 4 * (chunks + W);
const buf = Buffer.alloc(headerStr.length + H * scanlineBytes);
let off = buf.write(headerStr, 0, 'latin1');

const row = new Uint8Array(W * 4); // RGBE for one scanline
for (let y = 0; y < H; y++) {
  const v = (y + 0.5) / H;
  for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W;
    const [r, g, b] = skyColor(u, v);
    toRgbe(r, g, b, row, x * 4);
  }
  // scanline header
  buf[off++] = 2; buf[off++] = 2; buf[off++] = (W >> 8) & 0xff; buf[off++] = W & 0xff;
  // 4 channels, literal-dump RLE
  for (let ch = 0; ch < 4; ch++) {
    let x = 0;
    while (x < W) {
      const n = Math.min(128, W - x);
      buf[off++] = n;
      for (let k = 0; k < n; k++) buf[off++] = row[(x + k) * 4 + ch]!;
      x += n;
    }
  }
}

writeFileSync(outPath, buf);
console.log(`[bake-sky] wrote ${outPath} — ${W}×${H} hellish equirect HDR (IBL), ${buf.length} bytes`);
