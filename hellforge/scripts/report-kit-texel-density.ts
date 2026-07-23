// report-kit-texel-density.ts — mechanical texel-density + tangent gate for kit GLBs.
//
// Density formula (see ./lib/texel-density.ts):
//   per triangle: density = sqrt( (texW * texH * uvArea) / worldArea )  (px/m)
//   module value: world-area-weighted mean over triangles using albedo W×H.
//
// Band: [MIN_PX_PER_M, MAX_PX_PER_M] inclusive (Meshy 2k albedo allowed).
// Fails nonzero if any module is outside the band or missing TANGENT when
// normalTexture is present.
//
//   cd packages/games/hellforge
//   bun scripts/report-kit-texel-density.ts
//
// Writes assets/kit/texel-density-report.json and prints a summary to stdout.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProvenanceDoc } from './bake-kit-antechamber.ts';
import {
  triangleTexelDensityPxPerM,
  weightedMeanDensity,
  type DensitySample,
  type Vec2,
  type Vec3,
} from './lib/texel-density.ts';

/**
 * Inclusive band for PR1 kit modules.
 * Interim procedural (~128² on 2 m faces) sat near 64 px/m.
 * Meshy 2048² albedo on the same faces lands ~440–730 px/m — allow up to 768.
 */
export const MIN_PX_PER_M = 64;
export const MAX_PX_PER_M = 768;

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(gameRoot, 'assets', 'kit');
const provenancePath = join(kitRoot, 'provenance.json');
const reportPath = join(kitRoot, 'texel-density-report.json');

type GlTFJson = {
  buffers?: Array<{ byteLength: number }>;
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    normalized?: boolean;
  }>;
  images?: Array<{
    mimeType?: string;
    bufferView?: number;
    name?: string;
  }>;
  textures?: Array<{ source?: number }>;
  materials?: Array<{
    normalTexture?: { index?: number };
    pbrMetallicRoughness?: { baseColorTexture?: { index?: number } };
  }>;
  meshes?: Array<{
    name?: string;
    primitives?: Array<{
      attributes?: {
        POSITION?: number;
        TEXCOORD_0?: number;
        TANGENT?: number;
        NORMAL?: number;
      };
      indices?: number;
      material?: number;
    }>;
  }>;
};

export type ModuleReport = {
  id: string;
  path: string;
  albedoSize: [number, number] | null;
  densityPxPerM: number | null;
  triangleCount: number;
  sampledTriangles: number;
  worldAreaM2: number;
  hasNormalTexture: boolean;
  hasTangent: boolean;
  inBand: boolean;
  errors: string[];
};

export type TexelDensityReport = {
  schemaVersion: 1;
  kit: 'boss-antechamber';
  generatedAt: string;
  formula: string;
  bandPxPerM: { min: number; max: number };
  modules: ModuleReport[];
  ok: boolean;
};

function parseGlb(buf: Buffer): { json: GlTFJson; bin: Buffer } {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('not a GLB');
  }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GlTFJson;
  const binChunkStart = 20 + jsonLen;
  if (binChunkStart + 8 > buf.length) throw new Error('GLB missing BIN chunk');
  const binLen = buf.readUInt32LE(binChunkStart);
  const bin = buf.subarray(binChunkStart + 8, binChunkStart + 8 + binLen);
  return { json, bin };
}

function pngSize(png: Buffer): [number, number] | null {
  if (png.length < 24) return null;
  if (png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return null;
  // IHDR: length(4) + type(4) + width(4) + height(4)
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (w <= 0 || h <= 0) return null;
  return [w, h];
}

/** Read width/height from a JPEG SOF0/SOF2 marker (Meshy kit exports use JPEG). */
function jpegSize(jpeg: Buffer): [number, number] | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = jpeg[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    if (i + 3 >= jpeg.length) return null;
    const segLen = jpeg.readUInt16BE(i + 2);
    if (segLen < 2) return null;
    // SOF0 / SOF1 / SOF2 (baseline / extended / progressive)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (i + 8 >= jpeg.length) return null;
      const h = jpeg.readUInt16BE(i + 5);
      const w = jpeg.readUInt16BE(i + 7);
      if (w <= 0 || h <= 0) return null;
      return [w, h];
    }
    i += 2 + segLen;
  }
  return null;
}

function imageSize(bytes: Buffer): [number, number] | null {
  return pngSize(bytes) ?? jpegSize(bytes);
}

function componentBytes(componentType: number): number {
  switch (componentType) {
    case 5120: case 5121: return 1; // BYTE / UNSIGNED_BYTE
    case 5122: case 5123: return 2; // SHORT / UNSIGNED_SHORT
    case 5125: case 5126: return 4; // UNSIGNED_INT / FLOAT
    default: throw new Error(`unsupported componentType ${componentType}`);
  }
}

function typeComponents(type: string): number {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    default: throw new Error(`unsupported accessor type ${type}`);
  }
}

function readAccessorFloats(json: GlTFJson, bin: Buffer, accessorIndex: number): Float32Array {
  const acc = json.accessors?.[accessorIndex];
  if (!acc || acc.bufferView === undefined) throw new Error(`accessor ${accessorIndex} missing`);
  const bv = json.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error(`bufferView ${acc.bufferView} missing`);
  const comps = typeComponents(acc.type);
  const cBytes = componentBytes(acc.componentType);
  const stride = bv.byteStride ?? comps * cBytes;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float32Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    const off = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const o = off + c * cBytes;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = bin.readFloatLE(o); break;
        case 5125: v = bin.readUInt32LE(o); break;
        case 5123: v = bin.readUInt16LE(o); break;
        case 5121: v = bin.readUInt8(o); break;
        case 5122: v = bin.readInt16LE(o); break;
        case 5120: v = bin.readInt8(o); break;
        default: throw new Error(`unsupported componentType ${acc.componentType}`);
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

function readIndices(json: GlTFJson, bin: Buffer, accessorIndex: number): Uint32Array {
  const acc = json.accessors?.[accessorIndex];
  if (!acc || acc.bufferView === undefined) throw new Error(`index accessor ${accessorIndex} missing`);
  const bv = json.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error(`bufferView ${acc.bufferView} missing`);
  const cBytes = componentBytes(acc.componentType);
  const stride = bv.byteStride ?? cBytes;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Uint32Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    switch (acc.componentType) {
      case 5125: out[i] = bin.readUInt32LE(o); break;
      case 5123: out[i] = bin.readUInt16LE(o); break;
      case 5121: out[i] = bin.readUInt8(o); break;
      default: throw new Error(`unsupported index componentType ${acc.componentType}`);
    }
  }
  return out;
}

function imageBytes(json: GlTFJson, bin: Buffer, imageIndex: number): Buffer | null {
  const img = json.images?.[imageIndex];
  if (!img || img.bufferView === undefined) return null;
  const bv = json.bufferViews?.[img.bufferView];
  if (!bv) return null;
  const start = bv.byteOffset ?? 0;
  return bin.subarray(start, start + bv.byteLength);
}

function albedoSizeForMaterial(json: GlTFJson, bin: Buffer, materialIndex: number | undefined): [number, number] | null {
  if (materialIndex === undefined) return null;
  const mat = json.materials?.[materialIndex];
  const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (texIndex === undefined) return null;
  const source = json.textures?.[texIndex]?.source;
  if (source === undefined) return null;
  const bytes = imageBytes(json, bin, source);
  if (!bytes) return null;
  return imageSize(bytes);
}

function analyzeModule(id: string, relPath: string, absPath: string): ModuleReport {
  const errors: string[] = [];
  const buf = readFileSync(absPath);
  const { json, bin } = parseGlb(buf);

  const mats = json.materials ?? [];
  const hasNormalTexture = mats.some((m) => m.normalTexture !== undefined);

  let primCount = 0;
  let withTangent = 0;
  const samples: DensitySample[] = [];
  let triangleCount = 0;
  let albedoSize: [number, number] | null = null;

  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      primCount++;
      if (prim.attributes?.TANGENT !== undefined) withTangent++;

      const posAcc = prim.attributes?.POSITION;
      const uvAcc = prim.attributes?.TEXCOORD_0;
      if (posAcc === undefined || uvAcc === undefined || prim.indices === undefined) {
        errors.push(`${id}: primitive missing POSITION/TEXCOORD_0/indices`);
        continue;
      }

      const size = albedoSizeForMaterial(json, bin, prim.material);
      if (size) albedoSize = size;
      if (!size) {
        errors.push(`${id}: missing albedo texture size`);
        continue;
      }

      const pos = readAccessorFloats(json, bin, posAcc);
      const uv = readAccessorFloats(json, bin, uvAcc);
      const idx = readIndices(json, bin, prim.indices);

      for (let t = 0; t + 2 < idx.length; t += 3) {
        triangleCount++;
        const i0 = idx[t]!, i1 = idx[t + 1]!, i2 = idx[t + 2]!;
        const p0: Vec3 = [pos[i0 * 3]!, pos[i0 * 3 + 1]!, pos[i0 * 3 + 2]!];
        const p1: Vec3 = [pos[i1 * 3]!, pos[i1 * 3 + 1]!, pos[i1 * 3 + 2]!];
        const p2: Vec3 = [pos[i2 * 3]!, pos[i2 * 3 + 1]!, pos[i2 * 3 + 2]!];
        const u0: Vec2 = [uv[i0 * 2]!, uv[i0 * 2 + 1]!];
        const u1: Vec2 = [uv[i1 * 2]!, uv[i1 * 2 + 1]!];
        const u2: Vec2 = [uv[i2 * 2]!, uv[i2 * 2 + 1]!];

        const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
        const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        const worldArea = 0.5 * Math.hypot(cx, cy, cz);

        const d = triangleTexelDensityPxPerM(p0, p1, p2, u0, u1, u2, size[0], size[1]);
        if (d !== null && worldArea > 0) {
          samples.push({ densityPxPerM: d, worldAreaM2: worldArea });
        }
      }
    }
  }

  const hasTangent = !hasNormalTexture || (primCount > 0 && withTangent >= primCount);
  if (hasNormalTexture && !hasTangent) {
    errors.push(`${id}: normalTexture present but TANGENT missing`);
  }

  const densityPxPerM = weightedMeanDensity(samples);
  const worldAreaM2 = samples.reduce((s, x) => s + x.worldAreaM2, 0);

  if (densityPxPerM === null) {
    errors.push(`${id}: could not estimate texel density`);
  }

  const inBand = densityPxPerM !== null
    && densityPxPerM >= MIN_PX_PER_M
    && densityPxPerM <= MAX_PX_PER_M;

  if (densityPxPerM !== null && !inBand) {
    errors.push(
      `${id}: density ${densityPxPerM.toFixed(2)} px/m outside [${MIN_PX_PER_M}, ${MAX_PX_PER_M}]`,
    );
  }

  return {
    id,
    path: relPath,
    albedoSize,
    densityPxPerM,
    triangleCount,
    sampledTriangles: samples.length,
    worldAreaM2,
    hasNormalTexture,
    hasTangent,
    inBand,
    errors,
  };
}

function main(): void {
  if (!existsSync(provenancePath)) {
    console.error(`missing ${provenancePath}`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(provenancePath, 'utf8')) as ProvenanceDoc;
  const modules: ModuleReport[] = [];

  for (const row of doc.modules) {
    const abs = join(kitRoot, row.path);
    if (!existsSync(abs)) {
      modules.push({
        id: row.id,
        path: row.path,
        albedoSize: null,
        densityPxPerM: null,
        triangleCount: 0,
        sampledTriangles: 0,
        worldAreaM2: 0,
        hasNormalTexture: false,
        hasTangent: false,
        inBand: false,
        errors: [`${row.id}: file missing`],
      });
      continue;
    }
    modules.push(analyzeModule(row.id, row.path, abs));
  }

  const allErrors = modules.flatMap((m) => m.errors);
  const report: TexelDensityReport = {
    schemaVersion: 1,
    kit: 'boss-antechamber',
    generatedAt: new Date().toISOString(),
    formula:
      'density_tri = sqrt((texW*texH*uvArea)/worldArea) px/m; '
      + 'module = area-weighted mean over triangles (albedo size)',
    bandPxPerM: { min: MIN_PX_PER_M, max: MAX_PX_PER_M },
    modules,
    ok: allErrors.length === 0,
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const m of modules) {
    const dens = m.densityPxPerM === null ? 'n/a' : `${m.densityPxPerM.toFixed(2)} px/m`;
    const size = m.albedoSize ? `${m.albedoSize[0]}×${m.albedoSize[1]}` : '?';
    const band = m.inBand ? 'in-band' : 'OUT';
    const tan = m.hasTangent ? 'TANGENT=ok' : 'TANGENT=MISSING';
    console.log(`  ${m.id}  ${dens}  albedo=${size}  ${band}  ${tan}`);
  }
  console.log(`wrote ${reportPath}`);

  if (!report.ok) {
    console.error('report-kit-texel-density FAILED:');
    for (const e of allErrors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `report-kit-texel-density OK — ${modules.length} modules in [${MIN_PX_PER_M}, ${MAX_PX_PER_M}] px/m`,
  );
}

main();
