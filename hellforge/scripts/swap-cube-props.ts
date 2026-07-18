// swap-cube-props.ts — replace the camp's remaining plain-CUBE structural
// elements (torch posts, gate columns, dead-tree trunks, paths) with existing
// AI prop assets, and give the ground a dedicated dirt material.
//
// Posts / pillars / trunks are VISIBLE FROM ALL SIDES (no invisible depth
// axis), so they get UNIFORM scaling to the original height (zero UV stretch).
// Paths are flat top-visible strips → tileGrid (depth-squash Y, uniform top,
// unstretched path texture, tiled along the length).
//
//   bun scripts/swap-cube-props.ts [scene-pack.json]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPack, writePack, findSceneAsset, ensureRefGuid,
  readPropAssets, tileGrid, quatFromRotYDeg,
  type Pack, type SceneAsset, type Entity,
} from './lib/scene-authoring';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const propsDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');
const packPath = process.argv[2] ?? join(gameRoot, 'assets', 'scenes', 'rogue-encampment.pack.json');

// Y-rotation (deg) from a quat, assuming a pure-Y rotation (true for every
// camp structural entity we touch here).
const rotYDegFromQuat = (t: Entity['components']['Transform']): number =>
  (Math.atan2(t.quat[1], t.quat[3]) * 2 * 180) / Math.PI;

// Entities → uniform-scaled AI prop (visible from all sides: posts/pillars/trunks).
const UNIFORM_SWAPS: Record<string, string> = {
  TorchGateL_Post: 'prop-torch-post',
  TorchGateR_Post: 'prop-torch-post',
  TorchHut1_Post: 'prop-torch-post',
  TorchHut2_Post: 'prop-torch-post',
  TorchHut3F_Post: 'prop-torch-post',
  TorchHut3R_Post: 'prop-torch-post',
  GateColumnL: 'prop-torch-post',
  GateColumnR: 'prop-torch-post',
  DeadTree1_Trunk: 'prop-deadtree-trunk',
  DeadTree2_Trunk: 'prop-deadtree-trunk',
  DeadTree3_Trunk: 'prop-deadtree-trunk',
  DeadTree4_Trunk: 'prop-deadtree-trunk',
};

// Entities → flattened AI prop (top-visible strip: paths).
const FLATTEN_SWAPS: Record<string, string> = {
  Path_1: 'prop-path', Path_2: 'prop-path', Path_3: 'prop-path',
  Path_4: 'prop-path', Path_5: 'prop-path', Path_6: 'prop-path',
};

const pack = readPack(packPath);
const scene = findSceneAsset(pack);
const ents = scene.payload.entities;
let nextId = ents.reduce((m, e) => Math.max(m, e.localId), -1);

// ── dedicated ground dirt material (only the Ground entity uses it) ──────────
const GROUND_MAT_GUID = 'a5102010-0000-4000-8000-000000000099';
if (!pack.assets.some((a) => a.guid === GROUND_MAT_GUID)) {
  pack.assets.push({
    guid: GROUND_MAT_GUID,
    kind: 'material',
    payload: {
      kind: 'material',
      passes: [{ name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 }],
      paramValues: { baseColor: [0.40, 0.32, 0.24, 1], metallic: 0.0, roughness: 0.96 },
    },
    refs: [],
  });
}
const groundMatIdx = ensureRefGuid(scene, GROUND_MAT_GUID);

let uniform = 0, flatten = 0, ground = 0, missing = 0;
const remove = new Set<Entity>();
const newEnts: Entity[] = [];

for (const e of ents) {
  const name = (e.components.Name?.value as string) ?? '';
  const t = e.components.Transform!;
  const matIdx = (stem: string) => {
    const a = readPropAssets(propsDir, stem);
    return a.materialGuid ? ensureRefGuid(scene, a.materialGuid) : groundMatIdx;
  };
  const meshIdx = (stem: string) => {
    const a = readPropAssets(propsDir, stem);
    return a.meshGuid ? ensureRefGuid(scene, a.meshGuid) : null;
  };

  if (name === 'Ground') {
    const a = readPropAssets(propsDir, 'prop-ground');
    if (a.meshGuid) {
      const t = e.components.Transform!;
      t.pos = [t.pos?.[0] ?? 0, -0.01, t.pos?.[2] ?? 0];
      t.scale = [1, 1, 1];
      e.components.MeshFilter = { assetHandle: ensureRefGuid(scene, a.meshGuid) };
      e.components.MeshRenderer = {
        materials: [a.materialGuid ? ensureRefGuid(scene, a.materialGuid) : groundMatIdx],
      };
      ground++;
    } else {
      e.components.MeshRenderer = { materials: [groundMatIdx] };
      ground++;
    }
    continue;
  }

  if (name in UNIFORM_SWAPS) {
    const stem = UNIFORM_SWAPS[name];
    const a = readPropAssets(propsDir, stem);
    if (!a.meshGuid) { missing++; continue; }
    const us = a.bbox.size[1] > 0 ? t.scale[1] / a.bbox.size[1] : 1; // uniform to original height
    e.components.MeshFilter = { assetHandle: ensureRefGuid(scene, a.meshGuid) };
    e.components.MeshRenderer = { materials: [matIdx(stem)] };
    t.scale = [+us.toFixed(4), +us.toFixed(4), +us.toFixed(4)];
    uniform++;
    continue;
  }

  if (name in FLATTEN_SWAPS) {
    const stem = FLATTEN_SWAPS[name];
    const a = readPropAssets(propsDir, stem);
    if (!a.meshGuid) { missing++; continue; }
    const rotYDeg = rotYDegFromQuat(t);
    const segs = tileGrid(
      { pos: [t.pos[0], t.pos[1], t.pos[2]], size: [t.scale[0], t.scale[1], t.scale[2]], rotYDeg },
      a.bbox,
    );
    remove.add(e);
    for (let j = 0; j < segs.length; j++) {
      const s = segs[j];
      const q = quatFromRotYDeg(s.rotYDeg);
      newEnts.push({
        localId: ++nextId,
        components: {
          Name: { value: `${name}__t${j}` },
          Transform: {
            pos: [s.pos[0], s.pos[1], s.pos[2]],
            scale: [s.scale[0], s.scale[1], s.scale[2]],
            quat: [+q[0].toFixed(6), +q[1].toFixed(6), +q[2].toFixed(6), +q[3].toFixed(6)],
          },
          MeshFilter: { assetHandle: ensureRefGuid(scene, a.meshGuid) },
          MeshRenderer: { materials: [matIdx(stem)] },
        },
      });
    }
    flatten++;
    continue;
  }
}

scene.payload.entities = ents.filter((e) => !remove.has(e)).concat(newEnts);
writePack(packPath, pack);
console.log(
  `swap-cube-props → ${packPath.split('/').pop()}: ${uniform} uniform (posts/pillars/trunks), ` +
  `${flatten} flattened (paths), ${ground} ground re-materialized, ${missing} missing — ` +
  `entities now ${scene.payload.entities.length}`,
);
