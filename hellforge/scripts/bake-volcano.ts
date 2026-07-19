// bake-volcano.ts — irregular low-poly lava cones for the encampment horizon.
// Mesh-only GLBs (no embedded 8MB slag PNGs). Runtime paints them with the
// shared prop-den-slag material (熔渣/熔岩质感). Writes src/volcano-assets.ts.
//
//   cd packages/games/hellforge && bun scripts/bake-volcano.ts

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cookExternalAssetFields } from '../../../marketplace/plugins/wb-ai-asset/server/external-meta-cook.ts';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const meshesDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');
const VARIANT_COUNT = 8;

/** Shared 熔渣 material from prop-den-slag.glb.meta.json — lava albedo + emission. */
const SLAG_MATERIAL_GUID = '31bd7990-9af5-7b87-5d71-cb5a6bea3ad4';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type MeshData = {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
};

/** Irregular cone / truncated cone — unit height 1, base radius ~0.5. */
function buildIrregularCone(seed: number, kind: 'peak' | 'blunt' | 'ridge'): MeshData {
  const rng = mulberry32(seed);
  const segs = 7 + Math.floor(rng() * 6);
  const rings = kind === 'ridge' ? 4 : 3 + Math.floor(rng() * 3);
  const tipY = 1;
  const baseY = 0;
  const tipOx = (rng() - 0.5) * (kind === 'ridge' ? 0.35 : 0.22);
  const tipOz = (rng() - 0.5) * (kind === 'ridge' ? 0.12 : 0.22);
  const baseRx = kind === 'ridge' ? 0.75 + rng() * 0.45 : 0.42 + rng() * 0.28;
  const baseRz = kind === 'ridge' ? 0.28 + rng() * 0.22 : 0.42 + rng() * 0.28;
  const topScale = kind === 'blunt' ? 0.18 + rng() * 0.16 : 0.02 + rng() * 0.06;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const y = tipY + (baseY - tipY) * t;
    const flare = t * t;
    const rx = (topScale + (baseRx - topScale) * flare) * (0.88 + rng() * 0.24);
    const rz = (topScale + (baseRz - topScale) * flare) * (0.88 + rng() * 0.24);
    const ox = tipOx * (1 - t);
    const oz = tipOz * (1 - t);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2 + (rng() - 0.5) * 0.08;
      const jitter = 1 + (rng() - 0.5) * (0.08 + 0.22 * t);
      const x = ox + Math.cos(a) * rx * jitter;
      const z = oz + Math.sin(a) * rz * jitter;
      positions.push(x, y, z);
      uvs.push((s / segs) * (1.4 + rng() * 1.2), t * (1.8 + rng() * 1.4));
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const i0 = r * segs + s;
      const i1 = r * segs + s1;
      const i2 = (r + 1) * segs + s;
      const i3 = (r + 1) * segs + s1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  if (kind === 'blunt') {
    const center = positions.length / 3;
    positions.push(tipOx * 0.15, baseY + 0.01, tipOz * 0.15);
    uvs.push(0.5, 0.5);
    const baseStart = rings * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      indices.push(center, baseStart + s1, baseStart + s);
    }
  }

  const pos = new Float32Array(positions);
  const uv = new Float32Array(uvs);
  const idx = new Uint32Array(indices);
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
    const ax = pos[a * 3]!, ay = pos[a * 3 + 1]!, az = pos[a * 3 + 2]!;
    const bx = pos[b * 3]!, by = pos[b * 3 + 1]!, bz = pos[b * 3 + 2]!;
    const cx = pos[c * 3]!, cy = pos[c * 3 + 1]!, cz = pos[c * 3 + 2]!;
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [a, b, c]) {
      nrm[v * 3]! += nx;
      nrm[v * 3 + 1]! += ny;
      nrm[v * 3 + 2]! += nz;
    }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const len = Math.hypot(nrm[i]!, nrm[i + 1]!, nrm[i + 2]!) || 1;
    nrm[i]! /= len;
    nrm[i + 1]! /= len;
    nrm[i + 2]! /= len;
  }
  return { pos, nrm, uv, idx };
}

function buildVolcanoGlb(mesh: MeshData, outPath: string): Buffer {
  const posBytes = Buffer.from(mesh.pos.buffer, mesh.pos.byteOffset, mesh.pos.byteLength);
  const uvBytes = Buffer.from(mesh.uv.buffer, mesh.uv.byteOffset, mesh.uv.byteLength);
  const nrmBytes = Buffer.from(mesh.nrm.buffer, mesh.nrm.byteOffset, mesh.nrm.byteLength);
  const idxBytes = Buffer.from(mesh.idx.buffer, mesh.idx.byteOffset, mesh.idx.byteLength);
  const bin = Buffer.concat([posBytes, uvBytes, nrmBytes, idxBytes]);

  let o = 0;
  const posOff = o; o += posBytes.length;
  const uvOff = o; o += uvBytes.length;
  const nrmOff = o; o += nrmBytes.length;
  const idxOff = o;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.pos.length; i += 3) {
    minX = Math.min(minX, mesh.pos[i]!); maxX = Math.max(maxX, mesh.pos[i]!);
    minY = Math.min(minY, mesh.pos[i + 1]!); maxY = Math.max(maxY, mesh.pos[i + 1]!);
    minZ = Math.min(minZ, mesh.pos[i + 2]!); maxZ = Math.max(maxZ, mesh.pos[i + 2]!);
  }

  // Placeholder material — runtime replaces with prop-den-slag (lava).
  const gltf = {
    asset: { version: '2.0', generator: 'hellforge-bake-volcano' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvBytes.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes.length, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: mesh.pos.length / 3, type: 'VEC3',
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      },
      { bufferView: 1, componentType: 5126, count: mesh.uv.length / 2, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: mesh.nrm.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: mesh.idx.length, type: 'SCALAR' },
    ],
    materials: [{
      name: 'volcano-stub',
      pbrMetallicRoughness: {
        baseColorFactor: [0.25, 0.12, 0.08, 1],
        metallicFactor: 0.05,
        roughnessFactor: 0.95,
      },
      emissiveFactor: [0.45, 0.12, 0.02],
    }],
    meshes: [{
      name: 'volcano',
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    nodes: [{ name: 'volcano', mesh: 0 }],
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
  let w = 0;
  out.writeUInt32LE(0x46546c67, w); w += 4;
  out.writeUInt32LE(2, w); w += 4;
  out.writeUInt32LE(totalLen, w); w += 4;
  out.writeUInt32LE(jsonChunk.length, w); w += 4;
  out.write('JSON', w, 4, 'ascii'); w += 4;
  jsonChunk.copy(out, w); w += jsonChunk.length;
  out.writeUInt32LE(binChunk.length, w); w += 4;
  out.write('BIN\x00', w, 4, 'ascii'); w += 4;
  binChunk.copy(out, w);
  writeFileSync(outPath, out);
  return out;
}

const kinds: Array<'peak' | 'blunt' | 'ridge'> = [
  'peak', 'peak', 'blunt', 'ridge', 'peak', 'blunt', 'ridge', 'peak',
];

const variants: Array<{ name: string; mesh: string; material: string; kind: string }> = [];

for (let i = 0; i < VARIANT_COUNT; i++) {
  const name = `prop-volcano-${String(i + 1).padStart(2, '0')}`;
  const glbPath = join(meshesDir, `${name}.glb`);
  const kind = kinds[i]!;
  const mesh = buildIrregularCone(0x70c0 + i * 97, kind);
  const glbBytes = buildVolcanoGlb(mesh, glbPath);
  console.log(`  wrote ${name}.glb (${(glbBytes.length / 1024).toFixed(1)} KB) kind=${kind}`);

  const contentHash = `sha256:${createHash('sha256').update(glbBytes).digest('hex')}`;
  const meta = await cookExternalAssetFields(new Uint8Array(glbBytes), contentHash, `${name}.glb`);
  if (!meta) throw new Error(`cook failed: ${name}`);
  writeFileSync(`${glbPath}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  const meshGuid = meta.subAssets.find((s) => s.kind === 'mesh')?.guid;
  if (!meshGuid) throw new Error(`${name}: missing mesh guid`);
  variants.push({ name, mesh: meshGuid, material: SLAG_MATERIAL_GUID, kind });
  console.log(`    mesh=${meshGuid}`);
}

const tsPath = join(gameRoot, 'src', 'volcano-assets.ts');
const body = `// AUTO-GENERATED by scripts/bake-volcano.ts — do not edit by hand.
// Irregular cone meshes + shared prop-den-slag lava material.

export type VolcanoVariant = {
  name: string;
  mesh: string;
  material: string;
  kind: string;
};

export const VOLCANO_VARIANTS: readonly VolcanoVariant[] = ${JSON.stringify(variants, null, 2)} as const;

/** Shared 熔渣/lava material (prop-den-slag). */
export const SLAG_MATERIAL_GUID = '${SLAG_MATERIAL_GUID}';
`;
writeFileSync(tsPath, body, 'utf8');
console.log(`bake-volcano done → ${VARIANT_COUNT} variants, wrote ${tsPath}`);
