// Surface-material spec guard (N4 #15): shared-material roughness A/B + den
// floor pattern variant.
//
// Reads the COMMITTED GLBs + packs and pins:
//   1. the four GLB materials land on their target roughnessFactor (±0.01);
//   2. the AI props keep their metallic-roughness texture — the roughness
//      scalar MULTIPLIES the texture (engine shader), no texture was edited;
//   3. prop-den-floor-c.glb exists, matches floor-b geometry, and its albedo
//      is strictly dimmer than floor-b's (den must never brighten);
//   4. the baked den pack references BOTH floor-b and floor-c as shared
//      materials (per-group material GUID count ≤ variant count — no
//      per-entity clone); walls share a single material GUID.
//
// Re-bake to fix stale packs:
//   bun scripts/make-surface-variants.ts
//   bun scripts/bake-ground.ts
//   bun scripts/bake-dungeon.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';

import { measureGlbBBox } from '../scripts/lib/scene-authoring';
import {
  FLOOR_VARIANT_SOURCE, FLOOR_VARIANT_STEM, SURFACE_ROUGHNESS,
} from '../scripts/lib/surface-spec';

const propsDir = join(import.meta.dir, '..', 'assets', '3d', 'props', 'meshes');
const packPath = join(import.meta.dir, '..', 'assets', 'scenes', 'slagdeep-hollow.pack.json');

// ── GLB helpers (JSON chunk + BIN slice) ──────────────────────────────────

interface GltfJson {
  bufferViews?: Array<{ byteOffset: number; byteLength: number }>;
  images?: Array<{ mimeType?: string; bufferView?: number }>;
  materials?: Array<{
    pbrMetallicRoughness?: {
      roughnessFactor?: number;
      metallicRoughnessTexture?: unknown;
    };
  }>;
}

function splitGlb(glb: Buffer): { json: GltfJson; bin: Buffer } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLen)) as GltfJson;
  const jsonPad = (4 - (jsonLen % 4)) % 4;
  const binOff = 20 + jsonLen + jsonPad;
  const binLen = dv.getUint32(binOff, true);
  const bin = glb.subarray(binOff + 8, binOff + 8 + binLen);
  return { json, bin };
}

function readGlb(stem: string): { json: GltfJson; bin: Buffer } {
  return splitGlb(readFileSync(join(propsDir, `${stem}.glb`)));
}

function roughnessOf(stem: string): number | undefined {
  return readGlb(stem).json.materials?.[0]?.pbrMetallicRoughness?.roughnessFactor;
}

function hasMrTexture(stem: string): boolean {
  return readGlb(stem).json.materials?.[0]?.pbrMetallicRoughness?.metallicRoughnessTexture !== undefined;
}

/** Mean per-channel brightness of the GLB's base_color (image 0). */
async function meanAlbedoBrightness(stem: string): Promise<number> {
  const { json, bin } = readGlb(stem);
  const img = json.images?.[0];
  if (img?.bufferView == null) throw new Error(`${stem}: no base_color image`);
  const bv = json.bufferViews?.[img.bufferView];
  if (!bv) throw new Error(`${stem}: image bufferView missing`);
  const bytes = bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += data[i * 3]! + data[i * 3 + 1]! + data[i * 3 + 2]!;
  }
  return s / (n * 3);
}

function readMeta(stem: string): { subAssets?: Array<{ kind: string; guid: string }> } {
  return JSON.parse(readFileSync(join(propsDir, `${stem}.glb.meta.json`), 'utf8'));
}

function matGuidOf(stem: string): string {
  const meta = readMeta(stem);
  const mat = meta.subAssets?.find((s) => s.kind === 'material');
  if (!mat) throw new Error(`${stem}: no material sub-asset in sidecar`);
  return mat.guid;
}

// ── pack helpers ──────────────────────────────────────────────────────────

interface PackEntity {
  components: {
    Name?: { value?: string };
    MeshRenderer?: { materials?: number[] };
  };
}

function loadPack(): { refs: string[]; entities: PackEntity[] } {
  const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
    assets: Array<{ kind: string; refs?: string[]; payload?: { entities?: PackEntity[] } }>;
  };
  const scene = pack.assets.find((a) => a.kind === 'scene');
  const refs = scene?.refs ?? [];
  const entities = scene?.payload?.entities ?? [];
  if (entities.length < 1) throw new Error('slagdeep pack: no entities');
  return { refs, entities };
}

/** Material GUIDs referenced by entities whose Name starts with `prefix`. */
function materialGuidKinds(prefix: RegExp): Map<string, number> {
  const { refs, entities } = loadPack();
  const kinds = new Map<string, number>();
  for (const e of entities) {
    const name = e.components.Name?.value ?? '';
    if (!prefix.test(name)) continue;
    const mats = e.components.MeshRenderer?.materials;
    if (!mats || mats.length < 1) continue;
    const guid = refs[mats[0]!];
    if (guid !== undefined) kinds.set(guid, (kinds.get(guid) ?? 0) + 1);
  }
  return kinds;
}

// ── tests ─────────────────────────────────────────────────────────────────

const floorBMatGuid = matGuidOf(FLOOR_VARIANT_SOURCE);
const floorCMatGuid = matGuidOf(FLOOR_VARIANT_STEM);
const wallMatGuid = matGuidOf('prop-den-wall');

describe('surface materials (N4 #15)', () => {
  test('four GLBs land on their target roughnessFactor', () => {
    const targets: Array<[string, number]> = [
      ['prop-ground', SURFACE_ROUGHNESS.ground],
      ['prop-path', SURFACE_ROUGHNESS.path],
      ['prop-den-floor-b', SURFACE_ROUGHNESS.floorB],
      ['prop-den-wall', SURFACE_ROUGHNESS.wall],
    ];
    for (const [stem, target] of targets) {
      expect(Math.abs((roughnessOf(stem) ?? -1) - target)).toBeLessThan(0.01);
    }
  });

  test('floor variants keep the MR texture (scalar multiplies, no texture edit)', () => {
    for (const stem of ['prop-path', 'prop-den-floor-b', 'prop-den-wall', FLOOR_VARIANT_STEM]) {
      expect(hasMrTexture(stem)).toBe(true);
    }
    expect(Math.abs((roughnessOf(FLOOR_VARIANT_STEM) ?? -1) - SURFACE_ROUGHNESS.floorC)).toBeLessThan(0.01);
  });

  test('floor-c is derived from floor-b: same geometry, strictly dimmer albedo', async () => {
    const b = measureGlbBBox(join(propsDir, `${FLOOR_VARIANT_SOURCE}.glb`));
    const c = measureGlbBBox(join(propsDir, `${FLOOR_VARIANT_STEM}.glb`));
    expect(c.size[0]).toBe(b.size[0]);
    expect(c.size[1]).toBe(b.size[1]);
    expect(c.size[2]).toBe(b.size[2]);

    const bMean = await meanAlbedoBrightness(FLOOR_VARIANT_SOURCE);
    const cMean = await meanAlbedoBrightness(FLOOR_VARIANT_STEM);
    // ≤ is the hard constraint; 0.95 guards against "equal" (must read dimmer)
    expect(cMean).toBeLessThanOrEqual(bMean);
    expect(cMean).toBeLessThan(bMean * 0.95);
  });

  test('floor-c sidecar exposes mesh + material (bake/fix-prop-materials ingest)', () => {
    const meta = readMeta(FLOOR_VARIANT_STEM);
    const kinds = (meta.subAssets ?? []).map((s) => s.kind);
    expect(kinds).toContain('mesh');
    expect(kinds).toContain('material');
  });

  test('den pack: floor tiles use BOTH floor-b and floor-c shared materials', () => {
    const floorKinds = materialGuidKinds(/^Den_floor[AB]_/);
    // per-group material GUID kinds ≤ pool variants (2) — no per-entity clone
    expect(floorKinds.size).toBe(2);
    expect(floorKinds.get(floorBMatGuid) ?? 0).toBeGreaterThan(0);
    expect(floorKinds.get(floorCMatGuid) ?? 0).toBeGreaterThan(0);
  });

  test('den pack: wall tiles share the single wall material GUID', () => {
    const wallKinds = materialGuidKinds(/^Den_wall_/);
    expect(wallKinds.size).toBe(1);
    expect(wallKinds.get(wallMatGuid) ?? 0).toBeGreaterThan(0);
  });
});
