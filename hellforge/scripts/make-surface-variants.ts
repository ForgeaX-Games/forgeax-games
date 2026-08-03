// make-surface-variants.ts — N4 #15: shared-material roughness A/B + den floor
// pattern variant.
//
//   bun scripts/make-surface-variants.ts
//
// All three steps are deterministic and idempotent (re-runs converge, outputs
// overwritten):
//
//   1. Roughness A/B on the shared-prop GLBs (targets in lib/surface-spec.ts):
//      prop-path 0.85 (trampled-earth sheen), prop-den-floor-b 0.78 (slick
//      stone), prop-den-wall 0.93 (rough rock). These GLBs carry a
//      metallic-roughness texture; per glTF the scalar MULTIPLIES the texture
//      (engine shader: a = max(roughness, .04) × tex[G]), so only the
//      roughnessFactor is edited — textures untouched.
//      prop-ground is VERIFIED only: scripts/bake-ground.ts owns its writer
//      (same spec constant, so re-running bake-ground converges too).
//
//   2. Derives prop-den-floor-c.glb from prop-den-floor-b.glb: identical
//      geometry, base_color re-textured (desaturate/darken/hue via
//      scripts/make-floor-c-albedo.py). Hard gate: the variant's mean albedo
//      must be ≤ floor-b's (the den never brightens) or the script fails.
//
//   3. Re-cooks .glb.meta.json sidecars. floor-b / wall / path REUSE their
//      existing sub-asset GUIDs (kit-meta existingMeta, same rule as the
//      wb-ai-asset engine import) so every scene-pack ref keeps resolving; the
//      new floor-c gets fresh deterministic GUIDs. AI-asset .glb.wb.json
//      contentHash / size are synced (the fields importToEngine writes).
//
// Then re-bake the packs:
//   bun scripts/bake-ground.ts          # rewrites prop-ground.glb + camp pack
//   bun scripts/bake-dungeon.ts         # mixes floor-c into the den pack

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cookKitMeta, type KitExternalMeta } from './lib/kit-meta';
import {
  FLOOR_VARIANT_SOURCE, FLOOR_VARIANT_STEM, SURFACE_ROUGHNESS,
} from './lib/surface-spec';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const meshesDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');

// Roughness targets keyed by the GLBs this script edits.
const ROUGH_TARGETS: Record<string, number> = {
  'prop-path': SURFACE_ROUGHNESS.path,
  'prop-den-floor-b': SURFACE_ROUGHNESS.floorB,
  'prop-den-wall': SURFACE_ROUGHNESS.wall,
};
const EDITED_STEMS = Object.keys(ROUGH_TARGETS);
const GROUND_STEM = 'prop-ground';

// ── GLB chunk I/O (raw JSON-chunk edit; BIN bytes preserved) ─────────────

interface GltfJson {
  buffers?: Array<{ byteLength: number }>;
  bufferViews?: Array<{ byteOffset: number; byteLength: number }>;
  images?: Array<{ mimeType?: string; bufferView?: number }>;
  materials?: Array<{ pbrMetallicRoughness?: { roughnessFactor?: number } }>;
}

interface GlbParts { json: GltfJson; bin: Buffer; }

function readGlb(path: string): GlbParts {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = dv.getUint32(12, true);
  if (jsonLen <= 0 || 20 + jsonLen > buf.length) throw new Error(`${path}: bad JSON chunk`);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)) as GltfJson;
  const jsonPad = (4 - (jsonLen % 4)) % 4;
  const binOff = 20 + jsonLen + jsonPad;
  const binLen = dv.getUint32(binOff, true);
  const bin = buf.subarray(binOff + 8, binOff + 8 + binLen);
  return { json, bin };
}

function writeGlb(path: string, json: GltfJson, bin: Buffer): void {
  const jsonStr = JSON.stringify(json);
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
  writeFileSync(path, out);
}

// ── steps ─────────────────────────────────────────────────────────────────

/** Set materials[0] roughnessFactor in place. Returns false when unchanged. */
function editRoughness(stem: string, target: number): boolean {
  const path = join(meshesDir, `${stem}.glb`);
  const { json, bin } = readGlb(path);
  const pbr = json.materials?.[0]?.pbrMetallicRoughness;
  if (!pbr) throw new Error(`${stem}: materials[0].pbrMetallicRoughness missing — cannot set roughness`);
  if (pbr.roughnessFactor === target) return false;
  const before = pbr.roughnessFactor;
  pbr.roughnessFactor = target;
  writeGlb(path, json, bin);
  console.log(`  ${stem}.glb roughness ${before ?? 'unset'} → ${target}`);
  return true;
}

function verifyGroundRoughness(): void {
  const { json } = readGlb(join(meshesDir, `${GROUND_STEM}.glb`));
  const r = json.materials?.[0]?.pbrMetallicRoughness?.roughnessFactor;
  if (r !== SURFACE_ROUGHNESS.ground) {
    throw new Error(
      `prop-ground roughness ${r} ≠ ${SURFACE_ROUGHNESS.ground} — run scripts/bake-ground.ts (it owns prop-ground.glb)`,
    );
  }
  console.log(`  prop-ground.glb roughness ${r} ✓ (writer: bake-ground.ts)`);
}

/** Derive prop-den-floor-c.glb: same geometry/BIN views, base_color re-textured. */
function deriveFloorVariant(): void {
  const srcPath = join(meshesDir, `${FLOOR_VARIANT_SOURCE}.glb`);
  const outPath = join(meshesDir, `${FLOOR_VARIANT_STEM}.glb`);
  const { json, bin } = readGlb(srcPath);
  const images = json.images ?? [];
  const views = json.bufferViews ?? [];
  if (images.length < 1 || images[0]?.bufferView == null) {
    throw new Error(`${FLOOR_VARIANT_SOURCE}: no base_color image (images[0].bufferView)`);
  }
  if ((json.buffers ?? []).length !== 1) {
    throw new Error(`${FLOOR_VARIANT_SOURCE}: multi-buffer GLB unsupported`);
  }

  // Geometry views = views not referenced by any image; must sit contiguously
  // from BIN start (every hellforge prop GLB does).
  const imgViewIdx = new Set(images.map((i) => i.bufferView!));
  const dataViews = views
    .map((bv, i) => ({ bv, i }))
    .filter(({ i }) => !imgViewIdx.has(i))
    .sort((a, b) => a.bv.byteOffset - b.bv.byteOffset);
  let cursor = 0;
  const parts: Buffer[] = [];
  for (const { bv } of dataViews) {
    if (bv.byteOffset !== cursor) {
      throw new Error(`${FLOOR_VARIANT_SOURCE}: geometry views not contiguous from BIN start — unsupported layout`);
    }
    parts.push(Buffer.from(bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength)));
    cursor += bv.byteLength;
  }

  // Re-texture base_color (image 0) via PIL, re-embed in its slot.
  const bv0 = views[images[0]!.bufferView!]!;
  const baseColor = bin.subarray(bv0.byteOffset, bv0.byteOffset + bv0.byteLength);
  const tmpSrc = join(tmpdir(), 'hf-floor-b-basecolor.jpg');
  const tmpDst = join(tmpdir(), 'hf-floor-c-basecolor.jpg');
  writeFileSync(tmpSrc, baseColor);
  const py = spawnSync('python3', [
    join(gameRoot, 'scripts', 'make-floor-c-albedo.py'), tmpSrc, tmpDst,
  ], { encoding: 'utf8' });
  if (py.status !== 0) {
    throw new Error(
      `make-floor-c-albedo.py failed (exit ${py.status ?? 'null'}):\n${py.stderr?.trim() || py.stdout?.trim()}`,
    );
  }
  process.stdout.write(py.stdout ?? '');

  for (const [i, img] of images.entries()) {
    const v = views[img.bufferView!]!;
    const bytes = i === 0
      ? readFileSync(tmpDst)
      : Buffer.from(bin.subarray(v.byteOffset, v.byteOffset + v.byteLength));
    v.byteOffset = cursor;
    v.byteLength = bytes.length;
    parts.push(bytes);
    cursor += bytes.length;
  }

  const binOut = Buffer.concat(parts);
  json.buffers![0]!.byteLength = binOut.length;
  writeGlb(outPath, json, binOut);
  console.log(
    `  ${FLOOR_VARIANT_STEM}.glb derived from ${FLOOR_VARIANT_SOURCE} (geometry untouched, base_color re-textured, ${binOut.length} B)`,
  );
}

function readMeta(stem: string): KitExternalMeta | null {
  const p = join(meshesDir, `${stem}.glb.meta.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as KitExternalMeta;
  } catch {
    return null;
  }
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function cookSidecar(stem: string, bytes: Buffer, existingMeta: KitExternalMeta | null): void {
  const contentHash = `sha256:${sha256Hex(bytes)}`;
  const meta = cookKitMeta(
    new Uint8Array(bytes),
    contentHash,
    `${stem}.glb`,
    existingMeta ? { existingMeta } : undefined,
  );
  if (!meta) throw new Error(`${stem}: cookKitMeta failed`);
  writeFileSync(join(meshesDir, `${stem}.glb.meta.json`), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  const mode = existingMeta ? 'GUIDs reused (scene packs stay valid)' : 'fresh GUIDs';
  console.log(`  sidecar: ${stem}.glb.meta.json — ${mode} (${meta.subAssets.length} subAssets)`);
}

/** Sync the AI-asset wb.json contentHash/size (fields importToEngine writes). */
function syncWbSidecar(stem: string, bytes: Buffer): void {
  const wbPath = join(meshesDir, `${stem}.glb.wb.json`);
  if (!existsSync(wbPath)) return;
  const wb = JSON.parse(readFileSync(wbPath, 'utf8')) as {
    contentHash?: string; size?: number;
    custom?: { engineImport?: { importedAt?: string; sourceHash?: string } };
  };
  const contentHash = `sha256:${sha256Hex(bytes)}`;
  wb.contentHash = contentHash;
  wb.size = bytes.length;
  wb.custom = { ...(wb.custom ?? {}) };
  wb.custom.engineImport = {
    sourceHash: contentHash,
    importedAt: wb.custom.engineImport?.importedAt ?? new Date().toISOString(),
  };
  writeFileSync(wbPath, `${JSON.stringify(wb, null, 2)}\n`, 'utf8');
  console.log(`  wb.json: ${stem}.glb.wb.json contentHash/size synced`);
}

function verifyTargets(): void {
  for (const [stem, target] of Object.entries(ROUGH_TARGETS)) {
    const { json } = readGlb(join(meshesDir, `${stem}.glb`));
    const r = json.materials?.[0]?.pbrMetallicRoughness?.roughnessFactor;
    if (r !== target) throw new Error(`${stem}: roughness ${r} ≠ target ${target}`);
  }
  const { json } = readGlb(join(meshesDir, `${FLOOR_VARIANT_STEM}.glb`));
  const r = json.materials?.[0]?.pbrMetallicRoughness?.roughnessFactor;
  if (r !== SURFACE_ROUGHNESS.floorC) {
    throw new Error(`${FLOOR_VARIANT_STEM}: roughness ${r} ≠ target ${SURFACE_ROUGHNESS.floorC}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────
console.log('make-surface-variants:');

// 1. Roughness A/B.
verifyGroundRoughness();
for (const stem of EDITED_STEMS) editRoughness(stem, ROUGH_TARGETS[stem]!);

// 2. Floor variant (derived from the now-roughness-edited floor-b).
deriveFloorVariant();
editRoughness(FLOOR_VARIANT_STEM, SURFACE_ROUGHNESS.floorC); // explicit, idempotent

// 3. Sidecars: reuse GUIDs for edited AI props, fresh for the new variant.
for (const stem of [...EDITED_STEMS, FLOOR_VARIANT_STEM]) {
  const bytes = readFileSync(join(meshesDir, `${stem}.glb`));
  const oldMeta = readMeta(stem);
  cookSidecar(stem, bytes, EDITED_STEMS.includes(stem) ? oldMeta : null);
  syncWbSidecar(stem, bytes);
}

verifyTargets();
console.log('make-surface-variants done — now run bake-ground.ts (ground) and bake-dungeon.ts (den).');
