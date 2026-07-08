// fix-prop-materials.ts — re-link prop entities' MeshRenderer.materials to the
// prop's own material sub-asset GUID so the runtime loads the GLB material
// (which triggers texture cooking via the material→texture cross-edge) and the
// props stop rendering flat-shaded.
//
// Background: reflow-rogue-props.ts / bake-dungeon.ts rewrote MeshFilter to
// prop mesh GUIDs but left MeshRenderer.materials pointing at the ORIGINAL
// CUBE-scene material GUIDs (oldMaterialGuids), which are not in buildCatalog
// → loadByGuid<MaterialAsset> fails → no material → no texture cooking → flat.
//
// This script appends each prop's material GUID to the scene refs[] table and
// rewrites every prop entity's MeshRenderer.materials[0] to index it. CUBE /
// unmapped entities are left untouched (placeholder flat look is intended).
// Idempotent: re-running re-resolves the same GUIDs (deterministic sidecars).
//
//   bun scripts/fix-prop-materials.ts <scene-pack.json>

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findSceneAsset, readPack, writePack } from './lib/scene-authoring';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const propsDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');

// Build meshGuid → materialGuid by scanning every prop .glb.meta.json.
const meshToMaterial = new Map<string, string>();
for (const file of readdirSync(propsDir)) {
  if (!file.endsWith('.glb.meta.json')) continue;
  const meta = JSON.parse(readFileSync(join(propsDir, file), 'utf8')) as {
    subAssets?: Array<{ guid: string; kind: string }>;
  };
  const mesh = meta.subAssets?.find((s) => s.kind === 'mesh');
  const material = meta.subAssets?.find((s) => s.kind === 'material');
  if (mesh && material) meshToMaterial.set(mesh.guid, material.guid);
}

const packPath = process.argv[2] ?? join(gameRoot, 'assets', 'scenes', 'slagdeep-hollow.pack.json');
const pack = readPack(packPath);
const scene = findSceneAsset(pack);

const refs = scene.refs;
const entities = scene.payload.entities;

// Append prop material GUIDs (dedup) to refs[].
const appended: string[] = [];
function ensureRef(guid: string): number {
  const existing = refs.indexOf(guid);
  if (existing >= 0) return existing;
  refs.push(guid);
  appended.push(guid);
  return refs.length - 1;
}

let relinked = 0;
let skipped = 0;
for (const e of entities) {
  const c = e.components;
  if (!c.MeshFilter) continue;
  const meshIdx = c.MeshFilter.assetHandle as number;
  const meshGuid = refs[meshIdx];
  if (meshGuid === undefined) {
    skipped += 1;
    continue;
  }
  const materialGuid = meshToMaterial.get(meshGuid);
  if (materialGuid === undefined) {
    // CUBE / unmapped mesh — leave its material ref untouched.
    skipped += 1;
    continue;
  }
  const matIdx = ensureRef(materialGuid);
  if (!c.MeshRenderer) c.MeshRenderer = { materials: [matIdx] };
  else c.MeshRenderer.materials = [matIdx];
  relinked += 1;
}

writePack(packPath, pack);
console.log(
  `${packPath.split('/').pop()}: relinked ${relinked} prop entities' materials, skipped ${skipped} (CUBE/no-mesh), appended ${appended.length} material GUIDs → refs now ${refs.length}`,
);
