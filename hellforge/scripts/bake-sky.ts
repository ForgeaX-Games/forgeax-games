// bake-sky.ts — Diablo / dungeon-exterior equirect sky for Hellforge.
// Art direction: ash-smoke vault, oxblood dusk, NEVER a bright Belfast sunset.
// Values stay mostly LDR (< 0.5) so ACES + IBL cannot bleach the camp hills.
// Blood moon is baked into the equirect (celestial, not camera-glued) — pure
// red disk + soft 辉光. Matches engine sampleSphericalMap + skybox Y-flip:
//   uv = atan2(z,x)/(2π)+0.5 , asin(y)/(π)+0.5  on dir=(Wx, -Wy, Wz)
// Camp DirectionalLight must use -moonWorldDir (see BLOOD_MOON_SUN_DIR).
//
// Drop-in: overwrites assets/sky.hdr in place — same path, same GUID
// (c4061caa via sky.hdr.meta.json), so installHdrSky needs zero changes.
//
//   bun run hellforge/scripts/bake-sky.ts   # from packages/games
// Output: new-RLE Radiance HDR, -Y 512 +X 1024.

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

// ── latitude gradient (v: 0 = zenith … 0.5 = horizon … 1 = nadir) ───────────
type RGB = [number, number, number];
// Art direction (主美): dungeon / Diablo outdoor vault — ash-smoke ceiling and
// dull blood dusk. NO bright Belfast sunset, NO HDR lava cracks that ACES bleaches.
const KEYS: Array<[number, RGB]> = [
  [0.00, [0.028, 0.012, 0.009]], // zenith — readable ash (not void black)
  [0.20, [0.06, 0.024, 0.015]],  // upper — dense smoke brown
  [0.38, [0.11, 0.038, 0.020]],  // mid — murky blood-brown
  [0.50, [0.18, 0.055, 0.028]],  // horizon — dull ember dusk (still LDR)
  [0.58, [0.11, 0.032, 0.016]],  // below horizon
  [0.75, [0.045, 0.016, 0.010]], // lower
  [1.00, [0.016, 0.007, 0.005]], // nadir
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

// ── blood moon (celestial UV → world look-dir; keep in sync with main.ts) ──
// v: 0 = zenith … 0.5 = horizon … 1 = nadir (file / bake space).
const BLOOD_MOON_U = 0.68;
const BLOOD_MOON_V = 0.36; // above horizon, in the smoke vault
const BLOOD_MOON_CORE_RAD = 0.028; // ~1.6°
const BLOOD_MOON_GLOW_RAD = 0.11;  // soft 辉光

/** World direction the player looks to see bake UV (skybox + sampleSphericalMap). */
function uvToWorldDir(u: number, v: number): [number, number, number] {
  const theta = (u - 0.5) * 2 * Math.PI;
  const elev = (v - 0.5) * Math.PI; // asin(-Wy) in sampleSphericalMap space
  const cosE = Math.cos(elev);
  const wy = -Math.sin(elev);
  const wx = cosE * Math.cos(theta);
  const wz = cosE * Math.sin(theta);
  return [wx, wy, wz];
}

const MOON_DIR = uvToWorldDir(BLOOD_MOON_U, BLOOD_MOON_V);
/** DirectionalLight.direction = light travel = −moon (copy into main SUN_LOOK.camp). */
export const BLOOD_MOON_SUN_DIR: [number, number, number] = [
  -MOON_DIR[0], -MOON_DIR[1], -MOON_DIR[2],
];

function bloodMoon(u: number, v: number): RGB {
  const d = uvToWorldDir(u, v);
  const dot = d[0]! * MOON_DIR[0]! + d[1]! * MOON_DIR[1]! + d[2]! * MOON_DIR[2]!;
  const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
  // Solid pure-red core.
  const core = sstep(BLOOD_MOON_CORE_RAD, BLOOD_MOON_CORE_RAD * 0.55, ang);
  // Soft red corona (辉光) — no green/blue wash.
  const glow = Math.exp(-Math.pow(ang / BLOOD_MOON_GLOW_RAD, 2));
  const r = 2.4 * core + 0.85 * glow * (1 - core * 0.85);
  return [r, 0.02 * glow, 0.01 * glow];
}

// ── hell sky color at (u, v) ────────────────────────────────────────────────
function skyColor(u: number, v: number): RGB {
  const base = gradient(v);

  // Soft smoke structure — darken into clouds, never blow out bright breaks.
  const broad = fbm(u, v, 5, 2.2, 2.6);
  const fine = fbm(u + 19.4, v, 4, 5.0, 6.5);
  const cloud = sstep(0.30, 0.68, broad * 0.7 + fine * 0.3);
  const poleFade = sstep(0.02, 0.17, v) * sstep(0.02, 0.17, 1 - v);
  // cloudMul ∈ ~[0.55, 1.08] — mostly darkens; tiny lift in thin spots.
  const cloudMul = 1 + (0.55 + 0.53 * cloud - 1) * poleFade;

  let r = base[0] * cloudMul;
  let g = base[1] * cloudMul;
  let b = base[2] * cloudMul;

  // Dim oxblood fill around the moon longitude (IBL key, not a second sun).
  const du = Math.min(Math.abs(u - BLOOD_MOON_U), 1 - Math.abs(u - BLOOD_MOON_U));
  const key = Math.exp(-Math.pow(du / 0.28, 2)) * Math.exp(-Math.pow((v - 0.48) / 0.16, 2));
  r += 0.10 * key;
  g += 0.015 * key;
  b += 0.008 * key;

  const moon = bloodMoon(u, v);
  r += moon[0]; g += moon[1]; b += moon[2];

  const haze = sstep(0.0, 0.22, 0.22 - v) * 0.008;
  r += haze; g += haze * 0.55; b += haze * 0.4;

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
console.log(
  `[bake-sky] blood moon UV=(${BLOOD_MOON_U}, ${BLOOD_MOON_V}) → SUN_LOOK.camp.direction = [`
    + `${BLOOD_MOON_SUN_DIR.map((x) => x.toFixed(4)).join(', ')}]`,
);
