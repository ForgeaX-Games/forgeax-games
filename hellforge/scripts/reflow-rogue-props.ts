// reflow-rogue-props.ts — upgrade rogue-encampment.pack.json mesh references
// from the builtin CUBE to the generated prop GLBs (wb-ai-asset stage 1).
//
//   bun scripts/reflow-rogue-props.ts
//
// rogue-encampment is hand-maintained (no layout generator), so this reflow
// preserves every entity's Transform / Name / Light components untouched and
// ONLY rewrites the scene `refs` table + each entity's MeshFilter.assetHandle
// and MeshRenderer.materials index. Idempotent: re-running on an already-
// reflowed pack re-resolves the same prop GUIDs (deterministic sidecars).
//
// New refs layout: [propGuids..., CUBE_GUID(fallback), ...oldMaterialGuids].
// Ground (no prop mapping) → CUBE; Sun/CampfireLight/Torch*Light (no
// MeshFilter) → untouched. Materials shift by propGuids.length + 1 (CUBE slot).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CUBE_GUID = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPropMeshGuid(stem: string): string {
  const sidecarPath = join(gameRoot, 'assets', '3d', 'props', 'meshes', `${stem}.glb.meta.json`);
  try {
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as { subAssets?: Array<{ guid: string }> };
    const guid = sidecar.subAssets?.[0]?.guid;
    if (!guid) {
      console.warn(`  ⚠ ${stem}: sidecar has no subAssets[0].guid — CUBE fallback`);
      return CUBE_GUID;
    }
    return guid;
  } catch (e) {
    console.warn(`  ⚠ ${stem}: cannot read sidecar (${(e as Error).message}) — CUBE fallback`);
    return CUBE_GUID;
  }
}

// Order matters: longer/more-specific patterns first (CampfireBase before
// CampfireGlow/Log; DeadTree.*Branch/Trunk before generic; Hut.*Roof/Wall
// before generic; Torch.*Glow/Post before generic).
const NAME_TO_PROP: ReadonlyArray<{ match: RegExp; stem: string }> = [
  { match: /CampfireBase/, stem: 'prop-campfire-base' },
  { match: /CampfireGlow/, stem: 'prop-campfire-glow' },
  { match: /CampfireLog/, stem: 'prop-campfire-log' },
  { match: /DeadTree.*Branch/, stem: 'prop-deadtree-branch' },
  { match: /DeadTree.*Trunk/, stem: 'prop-deadtree-trunk' },
  { match: /GateColumn/, stem: 'prop-gate-column' },
  { match: /GateLintel/, stem: 'prop-gate-lintel' },
  { match: /Hut.*Roof/, stem: 'prop-hut-roof' },
  { match: /Hut.*Wall/, stem: 'prop-hut-wall' },
  { match: /Torch.*Glow/, stem: 'prop-torch-glow' },
  { match: /Torch.*Post/, stem: 'prop-torch-post' },
  { match: /Boulder/, stem: 'prop-boulder' },
  { match: /Crate/, stem: 'prop-crate' },
  { match: /EmberCrack/, stem: 'prop-embercrack' },
  { match: /Fence/, stem: 'prop-fence' },
  { match: /^Path/, stem: 'prop-path' },
];

function propStemForName(name: string): string | null {
  for (const { match, stem } of NAME_TO_PROP) {
    if (match.test(name)) return stem;
  }
  return null;
}

const packPath = join(gameRoot, 'assets', 'scenes', 'rogue-encampment.pack.json');
const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
  assets: Array<{ kind: string; refs: string[]; payload: { entities: Array<{ components: Record<string, Record<string, unknown>> }> } }>;
};
const scene = pack.assets.find((a) => a.kind === 'scene');
if (!scene) throw new Error('rogue-encampment.pack.json: no scene asset');

const oldRefs = scene.refs;
if (oldRefs[0] !== CUBE_GUID) {
  console.warn(`  ⚠ refs[0] is not CUBE_GUID (already reflowed?) — proceeding anyway`);
}
const oldMaterialGuids = oldRefs.slice(1);

const entities = scene.payload.entities;

// Pass 1: resolve prop GUID per entity (CUBE for unmapped / no-MeshFilter).
const propGuidOrder: string[] = [];
const entityPropGuid: string[] = [];
for (const e of entities) {
  const c = e.components;
  if (!c.MeshFilter) {
    entityPropGuid.push(CUBE_GUID);
    continue;
  }
  const name = (c.Name?.value as string) ?? '';
  const stem = propStemForName(name);
  const guid = stem ? readPropMeshGuid(stem) : CUBE_GUID;
  if (!stem) console.warn(`  ⚠ "${name}": no prop mapping — CUBE fallback`);
  entityPropGuid.push(guid);
  if (guid !== CUBE_GUID && !propGuidOrder.includes(guid)) propGuidOrder.push(guid);
}

// New refs: [propGuids..., CUBE_GUID, ...oldMaterialGuids].
// propIdx = propGuidOrder.indexOf(guid); cubeIdx = propGuidOrder.length;
// newMatIdx = oldMatIdx + propGuidOrder.length  (old refs[1..] = materials, new refs[N+1..]).
const cubeIdx = propGuidOrder.length;
const newRefs = [...propGuidOrder, CUBE_GUID, ...oldMaterialGuids];
const matOffset = propGuidOrder.length;

// Pass 2: rewrite assetHandle + materials index.
entities.forEach((e, i) => {
  const c = e.components;
  if (c.MeshFilter) {
    const g = entityPropGuid[i];
    c.MeshFilter.assetHandle = g === CUBE_GUID ? cubeIdx : propGuidOrder.indexOf(g);
  }
  if (c.MeshRenderer?.materials) {
    const oldMats = c.MeshRenderer.materials as number[];
    c.MeshRenderer.materials = oldMats.map((idx) => idx + matOffset);
  }
});

scene.refs = newRefs;
writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
console.log(
  `reflowed ${entities.length} entities: ${propGuidOrder.length} prop GUIDs + CUBE(fallback @${cubeIdx}) + ${oldMaterialGuids.length} materials → ${newRefs.length} refs`,
);
