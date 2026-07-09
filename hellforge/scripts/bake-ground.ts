// bake-ground.ts — 50×50m tiled ground plane with AI dirt/path PBR (from prop-path
// textures). Replaces the plain CUBE Ground with prop-ground.glb + sidecar.
//
// Run from hellforge game root:
//   cd packages/games/hellforge
//   bun scripts/bake-ground.ts [scene-pack.json]
//
// UV repeat = groundSize / tileSize (~25× for 2m path tiles on 50m field).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cookExternalAssetFields } from '../../../marketplace/plugins/wb-ai-asset/server/external-meta-cook.ts';
import {
  readPack, writePack, findSceneAsset, ensureRefGuid, readPropAssets,
} from './lib/scene-authoring.ts';
const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packPath = process.argv[2] ?? join(gameRoot, 'assets', 'scenes', 'rogue-encampment.pack.json');

const GROUND_SIZE = 50;   // metres (matches original Ground scale x/z)
const TILE_SIZE = 2;      // prop-path natural tile width ≈ 2m
const UV_REPEAT = GROUND_SIZE / TILE_SIZE;

const meshesDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');

/** Write a minimal GLB with non-interleaved bufferViews (forgeax parseGlb rejects
 *  gltf-transform's interleaved byteStride layout). The base-color PNG is embedded
 *  in the BIN chunk. A `samplers` entry with wrapS/wrapT = REPEAT (10497) is
 *  REQUIRED: the engine's glTF importer resolves `textures[i].sampler` to build the
 *  WebGPU sampler, so a sampler-less texture silently fails to bind → the ground
 *  renders as the flat white baseColorFactor. REPEAT (not clamp) also lets the
 *  UV 0–25 tiling actually repeat the tile across the 50 m plane. Mirrors the
 *  pipeline-generated prop-path.glb structure (sampler + texCoord:0). */
function buildGroundGlb(outPath: string): Buffer {
  const h = GROUND_SIZE / 2;
  const pos = new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]);
  const uv = new Float32Array([0, 0, UV_REPEAT, 0, UV_REPEAT, UV_REPEAT, 0, UV_REPEAT]);
  const nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  // Winding must be CCW when viewed from +Y (the up-facing normal): the engine's
  // glTF importer ignores `doubleSided`, so every mesh renders back-face-culled.
  // The naive [0,1,2,0,2,3] winds CW-from-above (geometric front faces DOWN), so
  // the top-down camera sees the culled back face → the ground never draws
  // ("地板空白"). [0,2,1,0,3,2] flips it front-up.
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2]);
  const png = readFileSync(join(meshesDir, 'prop-path.base_color.png'));

  const posBytes = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
  const uvBytes = Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength);
  const nrmBytes = Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength);
  const idxBytes = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
  const bin = Buffer.concat([posBytes, uvBytes, nrmBytes, idxBytes, png]);

  const posOff = 0;
  const uvOff = posOff + posBytes.length;
  const nrmOff = uvOff + uvBytes.length;
  const idxOff = nrmOff + nrmBytes.length;
  const imgOff = idxOff + idxBytes.length;

  const gltf = {
    asset: { version: '2.0', generator: 'hellforge-bake-ground' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvBytes.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes.length, target: 34963 },
      { buffer: 0, byteOffset: imgOff, byteLength: png.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-h, 0, -h], max: [h, 0, h] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: 6, type: 'SCALAR' },
    ],
    images: [{ mimeType: 'image/png', bufferView: 4 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [{ sampler: 0, source: 0 }],
    materials: [{
      name: 'ground',
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0, texCoord: 0 },
        metallicFactor: 0,
        roughnessFactor: 0.96,
      },
    }],
    meshes: [{
      name: 'ground',
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    nodes: [{ name: 'ground', mesh: 0 }],
    scenes: [{ name: 'scene', nodes: [0] }],
    scene: 0,
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonChunk = Buffer.alloc(jsonStr.length + jsonPad, 0x20);
  jsonChunk.write(jsonStr, 'utf8');
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = bin.length + binPad === bin.length ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);

  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(totalLen);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4; // magic glTF
  out.writeUInt32LE(2, o); o += 4;          // version
  out.writeUInt32LE(totalLen, o); o += 4;
  out.writeUInt32LE(jsonChunk.length, o); o += 4;
  out.write('JSON', o, 4, 'ascii'); o += 4;
  jsonChunk.copy(out, o); o += jsonChunk.length;
  out.writeUInt32LE(binChunk.length, o); o += 4;
  out.write('BIN\x00', o, 4, 'ascii'); o += 4;
  binChunk.copy(out, o);

  writeFileSync(outPath, out);
  return out;
}

// No .glb.wb.json sidecar: prop-ground is a procedural mesh, not a wb-ai-asset
// product. A non-conformant sidecar (deps missing `hash`) crashes the plugin's
// listAssets — which has no per-asset isolation — and nukes the whole library.
// The engine and readPropAssets both ingest prop-ground via .glb.meta.json alone.

function patchGroundEntity(packPath: string): void {
  const { bbox, meshGuid, materialGuid } = readPropAssets(meshesDir, 'prop-ground');
  if (!meshGuid) throw new Error('prop-ground: no mesh in sidecar — cook failed?');

  const pack = readPack(packPath);
  const scene = findSceneAsset(pack);
  const ground = scene.payload.entities.find(
    (e) => e.components.Name?.value === 'Ground',
  );
  if (!ground) throw new Error('Ground entity not found in pack');

  const t = ground.components.Transform!;
  // Keep horizontal centre; plane top just below y=0 (walkable) to avoid z-fight.
  const curPos = (t.pos as number[] | undefined) ?? [0, 0, 0];
  t.pos = [curPos[0] ?? 0, -0.01, curPos[2] ?? 0];
  t.scale = [1, 1, 1];
  t.quat = [0, 0, 0, 1];

  ground.components.MeshFilter = { assetHandle: ensureRefGuid(scene, meshGuid) };
  ground.components.MeshRenderer = {
    materials: [materialGuid ? ensureRefGuid(scene, materialGuid) : ensureRefGuid(scene, meshGuid)],
  };

  writePack(packPath, pack);
  console.log(
    `  Ground → prop-ground mesh (${bbox.size.map((v) => +v.toFixed(1)).join('×')}m native), pos=(${t.pos[0].toFixed(2)},0,${t.pos[2].toFixed(2)})`,
  );
}

// ── main ────────────────────────────────────────────────────────────────────
const glbPath = join(meshesDir, 'prop-ground.glb');
console.log(`bake-ground: ${GROUND_SIZE}m plane, UV 0–${UV_REPEAT} (≈${TILE_SIZE}m tiles)`);

const glbBytes = buildGroundGlb(glbPath);
console.log(`  wrote ${glbPath} (${(glbBytes.length / 1e6).toFixed(1)} MB)`);

const contentHash = `sha256:${createHash('sha256').update(glbBytes).digest('hex')}`;
const meta = await cookExternalAssetFields(new Uint8Array(glbBytes), contentHash, 'prop-ground.glb');
if (!meta) throw new Error('cookExternalAssetFields returned null');
writeFileSync(`${glbPath}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
console.log(`  sidecar: ${meta.subAssets.length} subAssets [${meta.subAssets.map((s) => s.kind).join(', ')}]`);

patchGroundEntity(packPath);
console.log(`bake-ground done → ${packPath.split('/').pop()}`);
