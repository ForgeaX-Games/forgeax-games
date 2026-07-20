// bake-select-ring.ts — delicate gothic forge-gold select pedestal ring.
// Used by hero-preview as the CharSelect / CharList foot halo.
//
//   cd packages/games/hellforge
//   bun scripts/bake-select-ring.ts
//
// Thin multi-band annulus + 12 razor spikes + inter-spike serrations +
// filigree ticks/chevrons (ClaudeCraft plaque language, not a fat disc).

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cookExternalAssetFields } from '../../../marketplace/plugins/wb-ai-asset/server/external-meta-cook.ts';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(gameRoot, 'assets', '3d', 'props', 'meshes', 'prop-select-ring.glb');

const SEGMENTS = 192;
const MAJOR_SPIKES = 12;
const MINOR_PER_GAP = 3; // serrations between major spikes

/** Major spike envelope — needle peaks, deep valleys (power ↑ = sharper). */
function majorEnvelope(theta: number): number {
  const u = ((theta / (Math.PI * 2)) * MAJOR_SPIKES) % 1;
  const tri = u < 0.5 ? u * 2 : (1 - u) * 2;
  return Math.pow(tri, 3.8);
}

/** Fine saw between majors. */
function minorSerration(theta: number): number {
  const cell = (theta / (Math.PI * 2)) * MAJOR_SPIKES;
  const local = cell % 1;
  // skip near major peaks so serrations sit in the valleys
  if (local < 0.12 || local > 0.88) return 0;
  const u = ((local - 0.12) / 0.76) * MINOR_PER_GAP;
  const frac = u % 1;
  const tri = frac < 0.5 ? frac * 2 : (1 - frac) * 2;
  return Math.pow(tri, 2.6) * 0.35;
}

function outerR(theta: number): number {
  // Crown starts just outside ring ③ — keep spikes slender (not a fat flange).
  const base = 0.84;
  const major = 0.14 * majorEnvelope(theta);
  const minor = 0.032 * minorSerration(theta);
  return base + major + minor;
}

type Band = { r0: (t: number) => number; r1: (t: number) => number; y: number };

function pushBand(
  band: Band,
  positions: number[], normals: number[], uvs: number[], indices: number[],
): void {
  const vertBase = positions.length / 3;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const ri = band.r0(t);
    const ro = band.r1(t);
    positions.push(c * ri, band.y, s * ri, c * ro, band.y, s * ro);
    normals.push(0, 1, 0, 0, 1, 0);
    const u = i / SEGMENTS;
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const a = vertBase + i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
}

/** Thin radial tick (inward from rOuter toward center). */
function pushTick(
  theta: number, rOuter: number, len: number, halfW: number, y: number,
  positions: number[], normals: number[], uvs: number[], indices: number[],
): void {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const tx = -s;
  const tz = c;
  const rIn = rOuter - len;
  const base = positions.length / 3;
  const pts: Array<[number, number]> = [
    [c * rIn + tx * halfW, s * rIn + tz * halfW],
    [c * rIn - tx * halfW, s * rIn - tz * halfW],
    [c * rOuter - tx * halfW, s * rOuter - tz * halfW],
    [c * rOuter + tx * halfW, s * rOuter + tz * halfW],
  ];
  for (const [x, z] of pts) {
    positions.push(x, y, z);
    normals.push(0, 1, 0);
  }
  uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Small chevron / arrowhead at a major spike tip. */
function pushChevron(
  theta: number, rTip: number, y: number,
  positions: number[], normals: number[], uvs: number[], indices: number[],
): void {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const tx = -s;
  const tz = c;
  const tipR = rTip + 0.010;
  const baseR = rTip - 0.042;
  const wing = 0.020;
  const base = positions.length / 3;
  positions.push(
    c * tipR, y, s * tipR,
    c * baseR + tx * wing, y, s * baseR + tz * wing,
    c * (baseR + 0.018), y, s * (baseR + 0.018),
    c * baseR - tx * wing, y, s * baseR - tz * wing,
  );
  for (let n = 0; n < 4; n++) normals.push(0, 1, 0);
  uvs.push(0.5, 1, 0, 0, 0.5, 0.2, 1, 0);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildRingGlb(): Buffer {
  // Three concentric rings with deliberate weight contrast + a separate spiked crown.
  //   inner  — hairline (~8 mm)
  //   mid    — medium plaque (~18 mm)  ← primary read
  //   outer  — fine accent (~10 mm)
  //   crown  — spiked gothic edge (variable, sits outside the three rings)
  const bands: Band[] = [
    { r0: () => 0.595, r1: () => 0.603, y: 0.010 },          // ① hairline
    { r0: () => 0.655, r1: () => 0.673, y: 0.013 },          // ② medium (contrast bulk)
    { r0: () => 0.720, r1: () => 0.730, y: 0.011 },          // ③ fine accent
    { r0: () => 0.805, r1: outerR, y: 0.014 },               // spiked crown (not one of the 3)
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const band of bands) pushBand(band, positions, normals, uvs, indices);

  // Major spike chevrons
  for (let k = 0; k < MAJOR_SPIKES; k++) {
    const t = (k / MAJOR_SPIKES) * Math.PI * 2;
    pushChevron(t, outerR(t), 0.020, positions, normals, uvs, indices);
  }

  // Filigree ticks: bridge the gap between mid (②) and fine (③) rings
  for (let k = 0; k < MAJOR_SPIKES; k++) {
    for (const frac of [0.28, 0.72]) {
      const t = ((k + frac) / MAJOR_SPIKES) * Math.PI * 2;
      pushTick(t, 0.720, 0.042, 0.0045, 0.015, positions, normals, uvs, indices);
    }
  }

  // Tiny diamond nodes on the medium ring (②) at majors — heavier than hairlines
  for (let k = 0; k < MAJOR_SPIKES; k++) {
    const t = (k / MAJOR_SPIKES) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const r = 0.664;
    const size = 0.014;
    const y = 0.017;
    const base = positions.length / 3;
    const tx = -s;
    const tz = c;
    positions.push(
      c * (r + size), y, s * (r + size),
      c * r + tx * size, y, s * r + tz * size,
      c * (r - size), y, s * (r - size),
      c * r - tx * size, y, s * r - tz * size,
    );
    for (let n = 0; n < 4; n++) normals.push(0, 1, 0);
    uvs.push(0.5, 1, 1, 0.5, 0.5, 0, 0, 0.5);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const pos = new Float32Array(positions);
  const nrm = new Float32Array(normals);
  const uv = new Float32Array(uvs);
  const idx = new Uint32Array(indices);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]!); maxX = Math.max(maxX, pos[i]!);
    minY = Math.min(minY, pos[i + 1]!); maxY = Math.max(maxY, pos[i + 1]!);
    minZ = Math.min(minZ, pos[i + 2]!); maxZ = Math.max(maxZ, pos[i + 2]!);
  }

  const posBytes = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
  const uvBytes = Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength);
  const nrmBytes = Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength);
  const idxBytes = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
  const bin = Buffer.concat([posBytes, uvBytes, nrmBytes, idxBytes]);

  const posOff = 0;
  const uvOff = posOff + posBytes.length;
  const nrmOff = uvOff + uvBytes.length;
  const idxOff = nrmOff + nrmBytes.length;

  const gltf = {
    asset: { version: '2.0', generator: 'hellforge-bake-select-ring' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvBytes.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3',
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      },
      { bufferView: 1, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: nrm.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    materials: [{
      name: 'select-ring-gold',
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [0.88, 0.72, 0.29, 1],
        metallicFactor: 0.4,
        roughnessFactor: 0.38,
      },
      emissiveFactor: [1.0, 0.55, 0.12],
    }],
    meshes: [{
      name: 'select-ring',
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    nodes: [{ name: 'select-ring', mesh: 0 }],
    scenes: [{ name: 'scene', nodes: [0] }],
    scene: 0,
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonChunk = Buffer.alloc(jsonStr.length + jsonPad, 0x20);
  jsonChunk.write(jsonStr, 'utf8');
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

const glb = buildRingGlb();
writeFileSync(outPath, glb);
console.log(`wrote ${outPath} (${(glb.length / 1024).toFixed(1)} KB)`);

const contentHash = `sha256:${createHash('sha256').update(glb).digest('hex')}`;
const meta = await cookExternalAssetFields(new Uint8Array(glb), contentHash, 'prop-select-ring.glb');
if (!meta) throw new Error('cookExternalAssetFields returned null');
writeFileSync(`${outPath}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
const mesh = meta.subAssets.find((s) => s.kind === 'mesh');
console.log(`sidecar: mesh=${mesh?.guid}`);
console.log('bake-select-ring done — update SELECT_RING_MESH_GUID in hero-preview.ts if guid changed');
