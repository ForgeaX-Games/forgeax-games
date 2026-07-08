// bake-sky.ts — procedural HELLISH equirectangular HDR sky for Hellforge.
// Dark smoke-ceiling zenith → bright lava-glow horizon band → dark nadir, with a
// seamless fbm cloud layer and bright HDR lava hotspots (values > 1 so they glow
// through the game's ACES tonemap and drive a warm IBL key).
//
// Drop-in: overwrites assets/sky.hdr in place — same path, same GUID
// (c4061caa via sky.hdr.meta.json), so installHdrSky needs zero changes. The
// image importer re-cooks the new bytes (equirect → rgba16float → cubemap).
//
// Run from repo root or anywhere:
//   bun run packages/games/hellforge/scripts/bake-sky.ts
// Output format matches the previous asset: new-RLE Radiance HDR, -Y 512 +X 1024.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { cookExternalAssetFields } from '../../../marketplace/plugins/wb-ai-asset/server/external-meta-cook.ts';

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

// ══════════════════════════════════════════════════════════════════════════
// VISIBLE SKY DOME — the engine build doesn't render SkyboxBackground, so the
// only way to SEE the sky (not just light with it) is a giant inverted sphere
// with an emissive equirect texture, recentred on the camera each frame. Same
// skyColor() as the IBL HDR, so the lit sky and the visible sky match.
// ══════════════════════════════════════════════════════════════════════════

const PNG_W = 2048;
const PNG_H = 1024;
const EXPOSURE = 0.5;     // linear→display scale before clamp (tune for punch)
const skyDir = join(gameRoot, 'assets', '3d', 'sky');
const domePath = join(skyDir, 'sky-dome.glb');
mkdirSync(skyDir, { recursive: true });

// ── tonemap sky → sRGB 8-bit RGB (emissive texture is treated as sRGB) ──────
const srgb = (x: number): number => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const pngRgb = Buffer.alloc(PNG_W * PNG_H * 3);
for (let y = 0; y < PNG_H; y++) {
  const v = (y + 0.5) / PNG_H;
  for (let x = 0; x < PNG_W; x++) {
    const u = (x + 0.5) / PNG_W;
    const [r, g, b] = skyColor(u, v);
    const o = (y * PNG_W + x) * 3;
    pngRgb[o] = Math.round(255 * clamp01(srgb(clamp01(r * EXPOSURE))));
    pngRgb[o + 1] = Math.round(255 * clamp01(srgb(clamp01(g * EXPOSURE))));
    pngRgb[o + 2] = Math.round(255 * clamp01(srgb(clamp01(b * EXPOSURE))));
  }
}

// ── minimal PNG encoder (RGB8, single IDAT, zlib) ───────────────────────────
const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const png = encodePng(PNG_W, PNG_H, pngRgb);

// ── inverted UV sphere (radius 1; scaled in-engine). Front faces point INWARD
//    so the engine's back-face cull keeps them visible from the centre. UVs are
//    equirect (u around, v top→bottom) matching the PNG. ──────────────────────
const STACKS = 48;
const SLICES = 96;
const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
for (let i = 0; i <= STACKS; i++) {
  const vv = i / STACKS, phi = Math.PI * vv;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  for (let j = 0; j <= SLICES; j++) {
    const uu = j / SLICES, theta = 2 * Math.PI * uu;
    const x = sp * Math.cos(theta), y = cp, z = sp * Math.sin(theta);
    pos.push(x, y, z);
    nrm.push(-x, -y, -z);
    uv.push(uu, vv);
  }
}
const rowLen = SLICES + 1;
for (let i = 0; i < STACKS; i++) {
  for (let j = 0; j < SLICES; j++) {
    const a = i * rowLen + j, b = a + 1, c = a + rowLen, d = c + 1;
    idx.push(a, d, b, a, c, d); // inward-facing winding
  }
}

// ── assemble GLB (non-interleaved bufferViews; emissive texture material) ───
function buildDomeGlb(imagePng: Buffer): Buffer {
  const posA = new Float32Array(pos), uvA = new Float32Array(uv), nrmA = new Float32Array(nrm), idxA = new Uint32Array(idx);
  const posB = Buffer.from(posA.buffer, posA.byteOffset, posA.byteLength);
  const uvB = Buffer.from(uvA.buffer, uvA.byteOffset, uvA.byteLength);
  const nrmB = Buffer.from(nrmA.buffer, nrmA.byteOffset, nrmA.byteLength);
  const idxB = Buffer.from(idxA.buffer, idxA.byteOffset, idxA.byteLength);
  const bin = Buffer.concat([posB, uvB, nrmB, idxB, imagePng]);
  const posOff = 0, uvOff = posB.length, nrmOff = uvOff + uvB.length, idxOff = nrmOff + nrmB.length, imgOff = idxOff + idxB.length;
  const gltf = {
    asset: { version: '2.0', generator: 'hellforge-bake-sky' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posB.length, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvB.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmB.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxB.length, target: 34963 },
      { buffer: 0, byteOffset: imgOff, byteLength: imagePng.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: nrm.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    images: [{ mimeType: 'image/png', bufferView: 4 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 33071 }],
    textures: [{ sampler: 0, source: 0 }],
    materials: [{
      name: 'sky-dome',
      // baseColorTexture is the proven path (the ground uses it); emissiveTexture
      // is a bonus glow where the shader honours it. Both point at the one image.
      emissiveFactor: [1, 1, 1],
      emissiveTexture: { index: 0, texCoord: 0 },
      pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 0 }, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
    }],
    meshes: [{ name: 'sky-dome', primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 }, indices: 3, material: 0 }] }],
    nodes: [{ name: 'sky-dome', mesh: 0 }],
    scenes: [{ name: 'scene', nodes: [0] }],
    scene: 0,
  };
  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonChunk = Buffer.alloc(jsonStr.length + jsonPad, 0x20); jsonChunk.write(jsonStr, 'utf8');
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = binPad === 0 ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);
  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(totalLen);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4;
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(totalLen, o); o += 4;
  out.writeUInt32LE(jsonChunk.length, o); o += 4;
  out.write('JSON', o, 4, 'ascii'); o += 4;
  jsonChunk.copy(out, o); o += jsonChunk.length;
  out.writeUInt32LE(binChunk.length, o); o += 4;
  out.write('BIN\x00', o, 4, 'ascii'); o += 4;
  binChunk.copy(out, o);
  return out;
}

const domeGlb = buildDomeGlb(png);
writeFileSync(domePath, domeGlb);

const contentHash = `sha256:${createHash('sha256').update(domeGlb).digest('hex')}`;
const meta = await cookExternalAssetFields(new Uint8Array(domeGlb), contentHash, 'sky-dome.glb');
if (!meta) throw new Error('cookExternalAssetFields returned null for sky-dome.glb');
writeFileSync(`${domePath}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

// GUIDs are content-derived → emit them as a TS constant so main.ts stays in
// sync across re-bakes without hand-editing.
const guidOf = (kind: string): string => (meta.subAssets as Array<{ kind: string; guid: string }>).find((s) => s.kind === kind)?.guid ?? '';
const genTs =
  '// AUTO-GENERATED by scripts/bake-sky.ts — do not edit by hand.\n' +
  '// Sub-asset GUIDs of the baked sky-dome GLB (content-derived; re-bake updates).\n' +
  `export const SKY_DOME_MESH_GUID = '${guidOf('mesh')}';\n` +
  `export const SKY_DOME_MATERIAL_GUID = '${guidOf('material')}';\n`;
writeFileSync(join(gameRoot, 'src', 'sky-dome.gen.ts'), genTs, 'utf8');
console.log(`[bake-sky] wrote ${domePath} — ${STACKS}×${SLICES} inverted dome + ${PNG_W}×${PNG_H} PNG, ${(domeGlb.length / 1e6).toFixed(1)} MB`);
console.log(`[bake-sky] cooked meta: ${meta.subAssets.map((s: { kind: string }) => s.kind).join(', ')} → src/sky-dome.gen.ts`);
