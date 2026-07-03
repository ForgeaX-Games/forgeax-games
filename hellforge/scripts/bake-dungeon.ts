// Bake the Slagdeep Hollow dungeon into an editable scene pack.
//
//   bun scripts/bake-dungeon.ts
//
// Runs src/dungeon-layout.ts at the fixed DUNGEON_SEED and writes
// scenes/slagdeep-hollow.pack.json — the scene the editor lists next to
// rogue-encampment. The runtime (src/dungeon.ts) re-runs the SAME layout
// for walkability/monster spawns and instantiates this pack at
// DUNGEON_ORIGIN, so geometry and gameplay grids can never drift apart.
//
// Re-run after ANY change to dungeon-layout.ts (seed, generator, decor).
// All GUIDs below are fixed constants so re-baking doesn't churn identity.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DUNGEON_SCENE_GUID, DUNGEON_SEED, generateLayout, quatY, type GeoKind } from '../src/dungeon-layout';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Engine builtin cube mesh (same GUID every pack uses — see AGENTS.md).
const CUBE_GUID = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';

// Fixed material GUIDs (generated once; NEVER regenerate).
const MATS: Record<GeoKind, {
  guid: string; name: string;
  base: [number, number, number, number]; rough: number;
  emissive?: [number, number, number]; ei?: number;
}> = {
  floorA:    { guid: '3f7a9c21-1b6e-4a02-8f3d-6c2e91b0a4d1', name: 'DenFloorA', base: [0.16, 0.13, 0.14, 1], rough: 0.9 },
  floorB:    { guid: '84d2f0b5-7e19-4c68-b2a7-0d5c3e8f16a2', name: 'DenFloorB', base: [0.13, 0.11, 0.13, 1], rough: 0.9 },
  wall:      { guid: 'c1e85d73-2f4a-4b90-a6c8-9b7e0d241f83', name: 'DenWall', base: [0.24, 0.17, 0.15, 1], rough: 0.9 },
  torchPost: { guid: '5b09e6f4-8d31-4e57-92ab-4f8c1a6d0e74', name: 'DenTorchPost', base: [0.2, 0.13, 0.08, 1], rough: 0.9 },
  flame:     { guid: 'a76c3e18-0b5f-4d29-8e61-7d3a9f0c25b5', name: 'DenFlame', base: [1, 0.5, 0.12, 1], rough: 0.9, emissive: [1, 0.45, 0.10], ei: 2.2 },
  brazier:   { guid: '29f4b8a6-6c07-4f83-b1d5-5e9c2a7f38c6', name: 'DenBrazier', base: [0.45, 0.08, 0.03, 1], rough: 0.9, emissive: [1, 0.12, 0.03], ei: 1.2 },
  rubble:    { guid: 'e83a1d59-9f62-4a14-87c3-2b0e6d8f41d7', name: 'DenRubble', base: [0.30, 0.26, 0.25, 1], rough: 0.9 },
  bone:      { guid: '60d7f2c4-3a85-4c96-9e07-8c4b1e5a72e8', name: 'DenBone', base: [0.62, 0.56, 0.44, 1], rough: 0.7 },
  slag:      { guid: 'b52e8a07-4d93-4e60-a3f9-1a6d0c9b53f9', name: 'DenSlag', base: [0.40, 0.06, 0.02, 1], rough: 0.5, emissive: [1, 0.10, 0.02], ei: 1.0 },
};

const layout = generateLayout(DUNGEON_SEED);

// refs[0] = cube mesh; refs[1..] = materials in GeoKind order below.
const kinds = Object.keys(MATS) as GeoKind[];
const refs = [CUBE_GUID, ...kinds.map((k) => MATS[k].guid)];
const matIdx = (k: GeoKind): number => 1 + kinds.indexOf(k);

const counters: Partial<Record<GeoKind, number>> = {};
const entities = layout.geometry.map((g, i) => {
  const n = (counters[g.kind] = (counters[g.kind] ?? 0) + 1);
  const t: Record<string, number> = {
    posX: +g.x.toFixed(4), posY: +g.y.toFixed(4), posZ: +g.z.toFixed(4),
    scaleX: +g.sx.toFixed(4), scaleY: +g.sy.toFixed(4), scaleZ: +g.sz.toFixed(4),
  };
  if (g.rotY !== undefined) {
    const q = quatY(g.rotY);
    t.quatX = +q[0].toFixed(6); t.quatY = +q[1].toFixed(6); t.quatZ = +q[2].toFixed(6); t.quatW = +q[3].toFixed(6);
  }
  return {
    localId: i,
    components: {
      Name: { value: `Den_${g.kind}_${n}` },
      Transform: t,
      MeshFilter: { assetHandle: 0 },
      MeshRenderer: { materials: [matIdx(g.kind)] },
    },
  };
});

const pack = {
  schemaVersion: '1.0.0',
  kind: 'internal-text-package',
  assets: [
    {
      guid: DUNGEON_SCENE_GUID,
      kind: 'scene',
      payload: { kind: 'scene', entities },
      refs,
    },
    ...kinds.map((k) => {
      const m = MATS[k];
      const paramValues: Record<string, unknown> = { baseColor: m.base, metallic: 0.02, roughness: m.rough };
      if (m.emissive) { paramValues.emissive = m.emissive; paramValues.emissiveIntensity = m.ei; }
      return {
        guid: m.guid,
        kind: 'material',
        payload: {
          kind: 'material',
          passes: [{ name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 }],
          paramValues,
        },
        refs: [],
      };
    }),
  ],
};

const out = join(gameRoot, 'scenes', 'slagdeep-hollow.pack.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');
console.log(`baked ${entities.length} entities (${layout.roomCount} rooms, seed ${DUNGEON_SEED}) → ${out}`);
