// Bake the Boss antechamber quality room from the modular kit.
//
//   bun scripts/bake-antechamber.ts
//   bun scripts/validate-scene-pack.ts assets/scenes/boss-antechamber.pack.json --allow-missing-veyra
//
// Pack is LOCAL to the room centre. Runtime parents it at DUNGEON_ORIGIN + bossAt.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANTECHAMBER_SCENE_GUID,
  buildAntechamberLayout,
} from '../src/antechamber-layout';
import { DUNGEON_SEED, quatY } from '../src/dungeon-layout';
import { resolveDungeonLayout } from '../src/dungeon-pipeline';
import { readPropAssets, remindReload, writePack } from './lib/scene-authoring';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitDir = join(gameRoot, 'assets', 'kit', 'modules');
const propsDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');

const den = resolveDungeonLayout(DUNGEON_SEED);
const layout = buildAntechamberLayout({
  widthM: den.bossSize.w,
  depthM: den.bossSize.h,
  doorTowardX: den.entry.x - den.bossAt.x,
  doorTowardZ: den.entry.z - den.bossAt.z,
});

const moduleIds = [
  'kit-floor', 'kit-wall', 'kit-corner', 'kit-doorframe',
  'kit-pillar', 'kit-trim', 'kit-rubble',
] as const;

type KitAssets = {
  meshGuid: string;
  materialGuid: string;
  bbox: ReturnType<typeof readPropAssets>['bbox'];
};

const kit: Record<string, KitAssets> = {};
for (const id of moduleIds) {
  const a = readPropAssets(kitDir, id);
  if (!a.meshGuid || !a.materialGuid) {
    throw new Error(`${id}: missing mesh/material GUID in kit sidecar`);
  }
  kit[id] = { meshGuid: a.meshGuid, materialGuid: a.materialGuid, bbox: a.bbox };
}

// N4 #17B: den-prop accents — camp scatter assets, dungeon-ified by scale.
const PROP_STEMS: Record<string, string> = {
  'den-log': 'prop-campfire-log',
  'den-boulder': 'prop-boulder',
  'den-fence': 'prop-fence',
};
const propAssets: Record<string, KitAssets> = {};
for (const id of Object.keys(PROP_STEMS)) {
  const a = readPropAssets(propsDir, PROP_STEMS[id]!);
  if (!a.meshGuid || !a.materialGuid) {
    throw new Error(`${id}: missing mesh/material GUID in prop sidecar`);
  }
  propAssets[id] = { meshGuid: a.meshGuid, materialGuid: a.materialGuid, bbox: a.bbox };
}

const refs: string[] = [];
const meshIdx = new Map<string, number>();
const matIdx = new Map<string, number>();
const ensure = (guid: string, map: Map<string, number>): number => {
  const hit = map.get(guid);
  if (hit !== undefined) return hit;
  const i = refs.length;
  refs.push(guid);
  map.set(guid, i);
  return i;
};
for (const id of moduleIds) {
  const k = kit[id]!;
  ensure(k.meshGuid, meshIdx);
  ensure(k.materialGuid, matIdx);
}
for (const id of Object.keys(PROP_STEMS)) {
  const k = propAssets[id]!;
  ensure(k.meshGuid, meshIdx);
  ensure(k.materialGuid, matIdx);
}

let nextLocalId = 0;
// N4 #17B height discipline (owner contract): stone ≤0.55 m / wood ≤0.50 m —
// enforced on the ACTUAL baked transform (bbox·scale), same thresholds as #17A.
const PROP_TOP_LIMITS: Record<string, number> = {
  'kit-rubble': 0.55,   // stone discipline (top @0.7 = 0.449 m)
  'den-boulder': 0.55,
  'den-log': 0.5,
  'den-fence': 0.55,
};
const entities = layout.pieces.map((p) => {
  const k = kit[p.moduleId] ?? propAssets[p.moduleId];
  if (!k) throw new Error(`bake-antechamber: no asset for moduleId ${p.moduleId}`);
  const q = quatY(p.rotY);
  // Bottom-align using mesh bbox (floors already authored with top at y=0).
  const y = p.moduleId === 'kit-floor'
    ? p.y
    : p.y - k.bbox.min[1] * p.sy;
  const limit = PROP_TOP_LIMITS[p.moduleId];
  if (limit !== undefined) {
    const top = y + (k.bbox.min[1] + k.bbox.size[1]) * p.sy;
    if (top > limit) {
      throw new Error(
        `bake-antechamber: ${p.name} top ${top.toFixed(3)}m > ${limit}m (${p.moduleId} height discipline)`,
      );
    }
  }
  return {
    localId: nextLocalId++,
    components: {
      Name: { value: p.name },
      Transform: {
        pos: [p.x, +y.toFixed(4), p.z],
        scale: [p.sx, p.sy, p.sz],
        quat: [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)],
      },
      MeshFilter: { assetHandle: meshIdx.get(k.meshGuid)! },
      MeshRenderer: { materials: [matIdx.get(k.materialGuid)!] },
    },
  };
});

const pack = {
  schemaVersion: '1.0.0',
  kind: 'internal-text-package',
  assets: [
    {
      guid: ANTECHAMBER_SCENE_GUID,
      kind: 'scene',
      payload: { kind: 'scene', entities },
      refs,
    },
  ],
};

const out = join(gameRoot, 'assets', 'scenes', 'boss-antechamber.pack.json');
mkdirSync(dirname(out), { recursive: true });
writePack(out, pack);

console.log(
  `baked antechamber ${entities.length} entities `
  + `(${layout.tilesX}×${layout.tilesZ} tiles, seed ${DUNGEON_SEED}) → ${out}`,
);
console.log(
  `  door toward entry Δ=(${(den.entry.x - den.bossAt.x).toFixed(1)}, `
  + `${(den.entry.z - den.bossAt.z).toFixed(1)}); `
  + `probe blockers=${layout.probeBlockers.length}; light seats=${layout.lightSeats.length}`,
);
remindReload(out);
