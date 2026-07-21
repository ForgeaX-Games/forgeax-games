// Generates assets/scene.pack.json — Collider/RigidBody authored in scene (editable in ✎ Edit).

import { writeFileSync } from 'node:fs';

import { join, dirname } from 'node:path';

import { fileURLToPath } from 'node:url';

import { randomUUID } from 'node:crypto';



const here = dirname(fileURLToPath(import.meta.url));

const SCENE_GUID = 'c7e4a1b2-3d5f-4a8e-9c1b-2f6e8d4a7b30';



const MESH_CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';

const MESH_CYL = 'ab20af21-0764-55be-a7f2-b80ab3d46a0a';

const MESH_SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';



const MATS = {

  floorWood: { color: [0.52, 0.36, 0.2, 1], roughness: 0.88 },

  dirt: { color: [0.44, 0.3, 0.18, 1], roughness: 0.94 },

  grass: { color: [0.28, 0.52, 0.22, 1], roughness: 0.9 },

  stone: { color: [0.5, 0.5, 0.46, 1], roughness: 0.78 },

  sand: { color: [0.72, 0.62, 0.4, 1], roughness: 0.86 },

  rock: { color: [0.4, 0.38, 0.35, 1], roughness: 0.82 },

  bark: { color: [0.34, 0.22, 0.12, 1], roughness: 0.92 },

  foliage: { color: [0.2, 0.48, 0.16, 1], roughness: 0.88 },

  marker: { color: [0.92, 0.78, 0.18, 1], roughness: 0.55 },

  playerBody: { color: [0.12, 0.42, 0.82, 1], roughness: 0.62 },

  playerSkin: { color: [0.9, 0.7, 0.55, 1], roughness: 0.72 },

  playerPants: { color: [0.18, 0.22, 0.38, 1], roughness: 0.7 },

};



for (const k of Object.keys(MATS)) {

  MATS[k].guid = randomUUID();

}



const matIndex = Object.fromEntries(Object.keys(MATS).map((k, i) => [k, i + 3]));

const HALF_W = 5;

const FLOOR_TOP = 0;

const SLAB_TH = 0.12;

/** Cuboid collider on unit cube — world size = Transform.scale (engine multiplies both). */
const SHAPE_CUBOID = 0;
const SHAPE_SPHERE = 1;
const SHAPE_CAPSULE = 2;
const BODY_KINEMATIC = 2;

function colCuboid(friction = 0.85) {
  return {
    Collider: {
      shape: SHAPE_CUBOID,
      halfExtents: [0.5, 0.5, 0.5],
      friction,
      restitution: 0,
    },
  };
}

function colSphere(friction = 0.9) {
  return {
    Collider: {
      shape: SHAPE_SPHERE,
      radius: 0.5,
      friction,
      restitution: 0,
    },
  };
}

function pushEntity(components) {
  const localId = id++;
  entities.push({
    localId,
    components: { Entity: { self: localId }, ...components },
  });
  return localId;
}

let id = 0;
const entities = [];

function mesh(name, pos, scale, mat, meshRef = 0) {
  pushEntity({
    Name: { value: name },
    Transform: { pos, quat: [0, 0, 0, 1], scale },
    MeshFilter: { assetHandle: meshRef },
    MeshRenderer: { materials: [matIndex[mat]] },
  });
}



function matAsset(key) {

  const m = MATS[key];

  return {

    guid: m.guid,

    kind: 'material',

    payload: {

      kind: 'material',

      passes: [

        { name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 },

        { name: 'ShadowCaster', shader: 'forgeax::default-shadow-caster', tags: { LightMode: 'ShadowCaster' }, passKind: 'shadow-caster' },

      ],

      paramValues: { baseColor: m.color, metallic: 0, roughness: m.roughness },

    },

    refs: [],

  };

}



function meshCol(name, pos, scale, mat, meshRef = 0) {
  pushEntity({
    Name: { value: name },
    Transform: { pos, quat: [0, 0, 0, 1], scale },
    MeshFilter: { assetHandle: meshRef },
    MeshRenderer: { materials: [matIndex[mat]] },
    ...colCuboid(),
  });
}



const WALK_W = HALF_W * 2;

/** Flat walk segment — mesh + Collider on same entity (what you see = what you stand on). */
function flatSpan(name, x0, x1, yTop, mat) {
  const len = x1 - x0;
  if (len <= 0.01) return;
  pushEntity({
    Name: { value: name },
    Transform: {
      pos: [(x0 + x1) * 0.5, yTop - SLAB_TH * 0.5, 0],
      quat: [0, 0, 0, 1],
      scale: [len, SLAB_TH, WALK_W],
    },
    MeshFilter: { assetHandle: 0 },
    MeshRenderer: { materials: [matIndex[mat]] },
    ...colCuboid(),
  });
}

/** Sloped walk segment — mesh + Collider on same entity. */
function rampSpan(name, x0, y0, x1, y1, mat) {
  if (x1 - x0 <= 0.01) return;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const halfA = angle * 0.5;
  pushEntity({
    Name: { value: name },
    Transform: {
      pos: [(x0 + x1) * 0.5, (y0 + y1) * 0.5, 0],
      quat: [0, 0, Math.sin(halfA), Math.cos(halfA)],
      scale: [len, SLAB_TH, WALK_W],
    },
    MeshFilter: { assetHandle: 0 },
    MeshRenderer: { materials: [matIndex[mat]] },
    ...colCuboid(),
  });
}

function colliderSolid(name, x, z, sx, sy, sz, yCenter) {
  pushEntity({
    Name: { value: name },
    Transform: { pos: [x, yCenter, z], quat: [0, 0, 0, 1], scale: [sx, sy, sz] },
    MeshFilter: { assetHandle: 0 },
    ...colCuboid(),
  });
}



function rock(name, x, z, r) {
  pushEntity({
    Name: { value: name },
    Transform: { pos: [x, FLOOR_TOP + r * 0.82, z], quat: [0, 0, 0, 1], scale: [r * 2, r * 2, r * 2] },
    MeshFilter: { assetHandle: 2 },
    MeshRenderer: { materials: [matIndex.rock] },
    ...colSphere(),
  });
}



function tree(name, x, z) {

  mesh(`${name}_Trunk`, [x, FLOOR_TOP + 0.9, z], [0.35, 1.8, 0.35], 'bark', 1);

  mesh(`${name}_Canopy`, [x, FLOOR_TOP + 2.2, z], [1.6, 1.6, 1.6], 'foliage', 2);

}



function markerPost(name, x, mat) {

  mesh(name, [x, FLOOR_TOP + 0.9, 6.5], [0.2, 1.8, 0.2], mat, 1);

  mesh(`${name}_Cap`, [x, FLOOR_TOP + 1.85, 6.5], [0.42, 0.18, 0.42], 'marker');

}



// ── Base decor (visual ground mesh added after track length is known) ───────────

mesh('Deco_FlatGrass', [-4, FLOOR_TOP + 0.02 - SLAB_TH * 0.5, 0], [8, SLAB_TH, 8], 'grass');



rock('FlatRockA', -6, -4.8, 0.5);

rock('FlatRockB', 4, 4.8, 0.45);

tree('FlatTreeL', -7.5, -5.5);

tree('FlatTreeR', 6, -5.5);

markerPost('MarkerFlat', -5, 'grass');



// ── Zone markers / props (walk mesh = Walk_* spine below) ───────────────────────

let cx = 10;
markerPost('MarkerLowStep', cx - 1, 'sand');
cx = 22;
markerPost('MarkerHighStep', cx - 1, 'dirt');
cx = 40;
rock('Ramp22Rock', cx - 2, 4.5, 0.45);
markerPost('MarkerRamp22', cx - 3, 'grass');
cx = 59;
markerPost('MarkerRamp40', cx - 2, 'sand');
cx = 77;
rock('Ramp58RockA', cx - 1, 5, 0.6);
rock('Ramp58RockB', cx + 1, -5, 0.5);
markerPost('MarkerRamp58', cx - 2, 'rock');
cx = 83;
meshCol('Wall', [cx + 1, FLOOR_TOP + 6.5 + 1.65, 0], [1.4, 3.3, 10], 'stone');
markerPost('MarkerWall', cx - 1, 'stone');
cx = 101;
tree('EndTree', cx + 1, 5.5);
markerPost('MarkerDownhill', cx - 4, 'grass');

// ── Walk spine: one entity per segment, mesh + Collider aligned ────────────────

flatSpan('Walk_Spawn', -8, 6, FLOOR_TOP, 'floorWood');
rampSpan('Walk_LowStep', 6, FLOOR_TOP + 0.02, 10, FLOOR_TOP + 0.22, 'stone');
flatSpan('Walk_Plateau1', 10, 16, FLOOR_TOP + 0.22, 'sand');
rampSpan('Walk_HighStep', 16, FLOOR_TOP + 0.22, 22, FLOOR_TOP + 0.718, 'stone');
flatSpan('Walk_Plateau2', 22, 28, FLOOR_TOP + 0.718, 'dirt');
rampSpan('Walk_Ramp22', 28, FLOOR_TOP + 0.718, 40, FLOOR_TOP + 2.0, 'grass');
flatSpan('Walk_Ramp22Top', 40, 48, FLOOR_TOP + 2.0, 'grass');
rampSpan('Walk_Ramp40', 48, FLOOR_TOP + 2.0, 59, FLOOR_TOP + 4.2, 'sand');
flatSpan('Walk_Ramp40Top', 59, 67, FLOOR_TOP + 4.2, 'sand');
rampSpan('Walk_Ramp58', 67, FLOOR_TOP + 4.2, 77, FLOOR_TOP + 6.5, 'rock');
flatSpan('Walk_WallRun', 77, 87, FLOOR_TOP + 6.5, 'stone');
rampSpan('Walk_RampDown', 87, FLOOR_TOP + 6.5, 101, FLOOR_TOP + 0.2, 'grass');
flatSpan('Walk_End', 101, 111, FLOOR_TOP + 0.2, 'grass');

// ── Under-track safety net (invisible) + side berms ───────────────────────────

const TRACK_START = -12;
const TRACK_END = 111;
const TRACK_LEN = TRACK_END - TRACK_START;
const TRACK_CENTER_X = (TRACK_START + TRACK_END) * 0.5;

colliderSolid('Col_SafetyNet', TRACK_CENTER_X, 0, TRACK_LEN + 16, 6, WALK_W + 4, FLOOR_TOP - 5);

mesh('Deco_BermL', [TRACK_CENTER_X, FLOOR_TOP + 0.04 - SLAB_TH * 0.5, -7.2], [TRACK_LEN, SLAB_TH, 2.2], 'dirt');
mesh('Deco_BermR', [TRACK_CENTER_X, FLOOR_TOP + 0.04 - SLAB_TH * 0.5, 7.2], [TRACK_LEN, SLAB_TH, 2.2], 'dirt');

for (let x = TRACK_START; x <= TRACK_END; x += 10) {

  mesh(`FenceL_${x}`, [x, FLOOR_TOP + 0.45, -6.2], [0.14, 0.9, 0.14], 'bark', 1);

  mesh(`FenceR_${x}`, [x, FLOOR_TOP + 0.45, 6.2], [0.14, 0.9, 0.14], 'bark', 1);

}



const CHAR_CAPSULE_CENTER = FLOOR_TOP + 0.42 + 0.45;

const playerId = pushEntity({
  Name: { value: 'Player' },
  Transform: { pos: [-4, CHAR_CAPSULE_CENTER, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
  RigidBody: { type: BODY_KINEMATIC, ccdEnabled: true },
  Collider: { shape: SHAPE_CAPSULE, radius: 0.42, halfHeight: 0.45, friction: 0.5, restitution: 0 },
  CharacterController: {
    offset: 0.01,
    maxSlopeClimbDeg: 45,
    minSlopeSlideDeg: 30,
    autoStepMaxHeight: 0.35,
    autoStepMinWidth: 0.15,
    snapToGroundDist: 0.12,
  },
});



function part(name, parent, pos, scale, mat, meshRef = 0) {
  const e = id++;
  pushEntity({
    Name: { value: name },
    Transform: { pos, quat: [0, 0, 0, 1], scale },
    MeshFilter: { assetHandle: meshRef },
    MeshRenderer: { materials: [matIndex[mat]] },
    ChildOf: { parent },
  });
  return e;
}



part('PlayerTorso', playerId, [0, 0.08, 0], [0.52, 0.62, 0.3], 'playerBody');

part('PlayerHead', playerId, [0, 0.62, 0], [0.38, 0.38, 0.38], 'playerSkin', 2);

part('PlayerArmL', playerId, [-0.38, 0.05, 0], [0.16, 0.52, 0.16], 'playerSkin');

part('PlayerArmR', playerId, [0.38, 0.05, 0], [0.16, 0.52, 0.16], 'playerSkin');

part('PlayerLegL', playerId, [-0.14, -0.52, 0], [0.2, 0.52, 0.2], 'playerPants');

part('PlayerLegR', playerId, [0.14, -0.52, 0], [0.2, 0.52, 0.2], 'playerPants');



pushEntity({
  Name: { value: 'Skylight' },
  Transform: { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
  Skylight: { color: [0.62, 0.68, 0.78], intensity: 0.35 },
});

pushEntity({
  Name: { value: 'Sun' },
  Transform: { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
  DirectionalLight: { direction: [-0.35, -1, -0.25], color: [1, 0.95, 0.88], intensity: 1.15 },
});



const refs = [MESH_CUBE, MESH_CYL, MESH_SPHERE, ...Object.keys(MATS).map((k) => MATS[k].guid)];



writeFileSync(

  join(here, '..', 'assets', 'scene.pack.json'),

  `${JSON.stringify(

    {

      schemaVersion: '1.0.0',

      kind: 'internal-text-package',

      assets: [

        { guid: SCENE_GUID, kind: 'scene', payload: { entities }, refs },

        ...Object.keys(MATS).map((k) => matAsset(k)),

      ],

    },

    null,

    2,

  )}\n`,

  'utf8',

);

console.log(`[build-scene-pack] wrote ${entities.length} entities`);


