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
//
// De-stretch policy (per GeoKind): the layout emits box-fit non-uniform
// scales (walls `run × 3.2 × 2.4`, floors `w × 0.2 × d`, slag pools flat).
// Those scales look right on a builtin CUBE (parametric, no UV) but stretch
// a generated GLB. So:
//   • structural kinds (floor/wall/slag/torchPost) → builtin CUBE, keep the
//     layout's box transform. Collision is driven by the runtime grid, not
//     these transforms, so the thin slabs are gameplay-safe.
//   • decor kinds (brazier/rubble/bone) → generated GLB, uniform-scaled to
//     the layout's intended footprint (max(scale) / max(bbox)) and grounded.
//   • flame → generated GLB, layout transform kept (emissive tongue already
//     sits atop its torch post; X/Z are symmetric so it isn't stretched).
// Run `bun scripts/fix-prop-materials.ts scenes/slagdeep-hollow.pack.json`
// after this to relink GLB entities' materials to the prop sub-asset GUIDs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CUBE_GUID, readPropBBox, tileLinear,
} from './lib/scene-authoring';
import { DUNGEON_SCENE_GUID, DUNGEON_SEED, generateLayout, quatY, type GeoKind } from '../src/dungeon-layout';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const propsDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');

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

// Per-kind de-stretch policy.
//   "cube"   → builtin CUBE mesh, keep the layout's (box) transform.
//   "ground" → prop GLB, uniform scale = max(scale)/max(bbox), grounded posY.
//   "keep"   → prop GLB, keep the layout transform (already well-shaped).
//   "tile"   → prop GLB, uniform-scaled to the slot's HEIGHT and tiled along its
//              length so a long wall reads as repeated detailed segments instead
//              of one stretched GLB. A single-cell slot whose one segment would
//              overflow falls back to a box (no poke into adjacent cells).
const POLICY: Record<GeoKind, 'cube' | 'ground' | 'keep' | 'tile'> = {
  floorA: 'cube',
  floorB: 'cube',
  wall: 'tile',
  torchPost: 'cube',
  slag: 'cube',
  flame: 'keep',
  brazier: 'ground',
  rubble: 'ground',
  bone: 'ground',
};

// GeoKind → generated prop GLB stem (wb-ai-asset precise-lowpoly, stage 1).
// Each prop's mesh GUID is read at bake time from its `<stem>.glb.meta.json`
// sidecar (subAssets[0].guid, deterministic sha256(contentHash:sourceIndex)),
// so re-baking after a prop regen tracks the new GUID automatically. Falls back
// to CUBE_GUID (with a warning) when a sidecar is missing — the entity still
// renders as a cube, game never breaks.
const PROP_FOR_KIND: Record<GeoKind, string> = {
  floorA: 'prop-den-floor-a',
  floorB: 'prop-den-floor-b',
  wall: 'prop-den-wall',
  torchPost: 'prop-den-torch-post',
  flame: 'prop-den-flame',
  brazier: 'prop-den-brazier',
  rubble: 'prop-den-rubble',
  bone: 'prop-den-bone',
  slag: 'prop-den-slag',
};

function readPropMeshGuid(stem: string): string {
  const sidecarPath = join(propsDir, `${stem}.glb.meta.json`);
  try {
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as { subAssets?: Array<{ guid: string; kind: string }> };
    const mesh = sidecar.subAssets?.find((s) => s.kind === 'mesh');
    const guid = mesh?.guid;
    if (!guid) {
      console.warn(`  ⚠ ${stem}: sidecar has no mesh sub-asset — falling back to CUBE`);
      return CUBE_GUID;
    }
    return guid;
  } catch (e) {
    console.warn(`  ⚠ ${stem}: cannot read sidecar (${(e as Error).message}) — falling back to CUBE`);
    return CUBE_GUID;
  }
}

const layout = generateLayout(DUNGEON_SEED);
const kinds = Object.keys(MATS) as GeoKind[];
const propMeshGuid = kinds.map((k) => readPropMeshGuid(PROP_FOR_KIND[k]));
const propBBox = kinds.map((k) => readPropBBox(propsDir, PROP_FOR_KIND[k]));
const matGuid = kinds.map((k) => MATS[k].guid);

// refs layout: [CUBE_GUID, ...propMeshGuids, ...materialGuids].
// propIdx(kind) → prop mesh ref; cubeIdx → CUBE; matIdx(kind) → material.
const refs: string[] = [CUBE_GUID, ...propMeshGuid, ...matGuid];
const cubeIdx = 0;
const propIdx = (k: GeoKind): number => 1 + kinds.indexOf(k);
const matIdx = (k: GeoKind): number => 1 + kinds.length + kinds.indexOf(k);

const counters: Partial<Record<GeoKind, number>> = {};
let nextLocalId = 0;
const boxTransform = (g: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rotY?: number }): Record<string, number> => {
  const t: Record<string, number> = {
    posX: +g.x.toFixed(4), posY: +g.y.toFixed(4), posZ: +g.z.toFixed(4),
    scaleX: +g.sx.toFixed(4), scaleY: +g.sy.toFixed(4), scaleZ: +g.sz.toFixed(4),
  };
  if (g.rotY !== undefined) {
    const q = quatY(g.rotY);
    t.quatX = +q[0].toFixed(6); t.quatY = +q[1].toFixed(6); t.quatZ = +q[2].toFixed(6); t.quatW = +q[3].toFixed(6);
  }
  return t;
};

const entities = layout.geometry.flatMap((g) => {
  const policy = POLICY[g.kind];
  const n = (counters[g.kind] = (counters[g.kind] ?? 0) + 1);
  const makeEntity = (suffix: string, t: Record<string, number>, meshIdx: number) => ({
    localId: nextLocalId++,
    components: {
      Name: { value: `Den_${g.kind}_${n}${suffix}` },
      Transform: t,
      MeshFilter: { assetHandle: meshIdx },
      MeshRenderer: { materials: [matIdx(g.kind)] },
    },
  });

  if (policy === 'tile') {
    const bb = propBBox[kinds.indexOf(g.kind)];
    const us = g.sy > 0 && bb.size[1] > 0 ? g.sy / bb.size[1] : 1; // fit height
    const segLen = bb.size[0] * us;                                // panel length
    const slotLong = Math.max(g.sx, g.sz);
    if (segLen > slotLong) {
      // A single segment would overflow a 1-cell slot → box (no poke).
      return [makeEntity('', boxTransform(g), cubeIdx)];
    }
    const segs = tileLinear(
      { pos: [g.x, g.y, g.z], size: [g.sx, g.sy, g.sz], rotYDeg: g.rotY ?? 0 },
      bb,
    );
    return segs.map((s, j) => {
      const q = quatY(s.rotYDeg);
      return makeEntity(`__t${j}`, {
        posX: s.pos[0], posY: s.pos[1], posZ: s.pos[2],
        scaleX: s.scale[0], scaleY: s.scale[1], scaleZ: s.scale[2],
        quatX: +q[0].toFixed(6), quatY: +q[1].toFixed(6), quatZ: +q[2].toFixed(6), quatW: +q[3].toFixed(6),
      }, propIdx(g.kind));
    });
  }

  if (policy === 'cube') {
    return [makeEntity('', boxTransform(g), cubeIdx)];
  }

  if (policy === 'ground') {
    const bb = propBBox[kinds.indexOf(g.kind)];
    const bMax = Math.max(bb.size[0], bb.size[1], bb.size[2]);
    const sMax = Math.max(g.sx, g.sy, g.sz);
    const us = bMax > 0 ? sMax / bMax : 1;
    const us4 = +us.toFixed(4);
    const t: Record<string, number> = {
      posX: +g.x.toFixed(4), posY: +(-bb.min[1] * us).toFixed(4), posZ: +g.z.toFixed(4),
      scaleX: us4, scaleY: us4, scaleZ: us4,
    };
    if (g.rotY !== undefined) {
      const q = quatY(g.rotY);
      t.quatX = +q[0].toFixed(6); t.quatY = +q[1].toFixed(6); t.quatZ = +q[2].toFixed(6); t.quatW = +q[3].toFixed(6);
    }
    return [makeEntity('', t, propIdx(g.kind))];
  }

  // "keep" — layout transform is already well-shaped (e.g. flame tongue).
  return [makeEntity('', boxTransform(g), propIdx(g.kind))];
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

const out = join(gameRoot, 'assets', 'scenes', 'slagdeep-hollow.pack.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');

// Summary by policy so a re-bake shows what got de-stretched.
const byPolicy: Record<string, number> = { cube: 0, ground: 0, keep: 0, tile: 0 };
for (const g of layout.geometry) byPolicy[POLICY[g.kind]] = (byPolicy[POLICY[g.kind]] ?? 0) + 1;
let tileSegs = 0, tileBox = 0;
for (const g of layout.geometry) {
  if (POLICY[g.kind] !== 'tile') continue;
  const bb = propBBox[kinds.indexOf(g.kind)];
  const us = g.sy / bb.size[1];
  const segLen = bb.size[0] * us;
  if (segLen > Math.max(g.sx, g.sz)) tileBox++;
  else tileSegs++;
}
console.log(
  `baked ${entities.length} entities (${layout.roomCount} rooms, seed ${DUNGEON_SEED}) → ${out}`,
);
console.log(
  `  cube=${byPolicy.cube}  ground(decor)=${byPolicy.ground}  keep=${byPolicy.keep}  tile(wall GLB)=${byPolicy.tile} [${tileSegs} long→segmented, ${tileBox} 1-cell→box]`,
);
