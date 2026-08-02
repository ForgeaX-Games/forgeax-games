// Rebuild the Player as a proper little HUMANOID (head/torso/arms/legs).
// Replaces the old sphere-blob chibi parts under the Player root (localId 28).
// Limbs are single cuboids; main.ts rotates them around hip/shoulder pivots.
// Idempotent: refuses to run if PlayerTorso already exists.
import fs from 'node:fs';

const PACK = '.forgeax/games/paopaotang/assets/scene.pack.json';
const BASE = '.forgeax/games/paopaotang/assets/base-material.pack.json';
const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const scene = pack.assets.find((a) => a.kind === 'scene');
const nodes = scene.payload.entities;

if (nodes.some((n) => n.components.Name?.value === 'PlayerTorso')) {
  console.error('already rebuilt — refusing to run twice');
  process.exit(1);
}
// sanity: mesh ref indices must be what we think they are
if (scene.refs[0] !== CUBE || scene.refs[17] !== SPHERE) {
  console.error('ref layout changed — aborting'); process.exit(1);
}

// 1) drop every old Player* part (keep the Player root itself)
const before = nodes.length;
scene.payload.entities = nodes.filter((n) => {
  const nm = n.components.Name?.value ?? '';
  return !(nm.startsWith('Player') && nm !== 'Player');
});
const removed = before - scene.payload.entities.length;

// 2) new humanoid rig — all ChildOf Player root (28), rest pose, identity quat.
//    Mesh refs: cube=0 sphere=17. Mat refs: pink18 cream19 dark20 blush21 red9 blue7 white15.
//    Local Y: feet touch -0.75 (root sits at world y=0.75). Face is local -Z.
const MESH = { cube: 0, sphere: 17 };
const P = [ // [name, mesh, matRef, pos, scale]
  ['PlayerTorso',  'cube',   18, [0, -0.05, 0],        [0.50, 0.46, 0.30]],
  ['PlayerShorts', 'cube',    7, [0, -0.31, 0],        [0.52, 0.16, 0.32]],
  ['PlayerLegL',   'cube',    7, [-0.12, -0.51, 0],    [0.17, 0.42, 0.19]],
  ['PlayerLegR',   'cube',    7, [ 0.12, -0.51, 0],    [0.17, 0.42, 0.19]],
  ['PlayerFootL',  'cube',   20, [-0.12, -0.70, -0.04],[0.18, 0.10, 0.28]],
  ['PlayerFootR',  'cube',   20, [ 0.12, -0.70, -0.04],[0.18, 0.10, 0.28]],
  ['PlayerArmL',   'cube',   18, [-0.33, -0.07, 0],    [0.13, 0.40, 0.15]],
  ['PlayerArmR',   'cube',   18, [ 0.33, -0.07, 0],    [0.13, 0.40, 0.15]],
  ['PlayerHandL',  'sphere', 19, [-0.33, -0.30, 0],    [0.15, 0.15, 0.15]],
  ['PlayerHandR',  'sphere', 19, [ 0.33, -0.30, 0],    [0.15, 0.15, 0.15]],
  ['PlayerHead',   'sphere', 19, [0, 0.42, 0],         [0.46, 0.44, 0.46]],
  ['PlayerEyeL',   'sphere', 20, [-0.13, 0.45, -0.19], [0.055, 0.09, 0.05]],
  ['PlayerEyeR',   'sphere', 20, [ 0.13, 0.45, -0.19], [0.055, 0.09, 0.05]],
  ['PlayerBlushL', 'sphere', 21, [-0.19, 0.38, -0.15], [0.06, 0.045, 0.035]],
  ['PlayerBlushR', 'sphere', 21, [ 0.19, 0.38, -0.15], [0.06, 0.045, 0.035]],
  ['PlayerHat',    'sphere',  9, [0, 0.58, 0],         [0.48, 0.28, 0.48]],
  ['PlayerBobble', 'sphere', 15, [0, 0.73, 0],         [0.13, 0.13, 0.13]],
];
let nextId = Math.max(...scene.payload.entities.map((n) => n.localId)) + 1;
for (const [name, mesh, mat, pos, scale] of P) {
  scene.payload.entities.push({
    localId: nextId,
    components: {
      Entity: { self: nextId },
      MeshFilter: { assetHandle: MESH[mesh] },
      MeshRenderer: { materials: [mat] },
      ChildOf: { parent: 28 },
      Name: { value: name },
      Transform: { pos, quat: [0, 0, 0, 1], scale },
    },
  });
  nextId++;
}

// 3) integrity check BEFORE writing: every ref resolvable, only cube/sphere builtins
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const known = new Set([CUBE, SPHERE, ...pack.assets.map((a) => a.guid), ...base.assets.map((a) => a.guid)]);
for (const a of pack.assets) {
  for (const [i, g] of (a.refs ?? []).entries()) {
    if (!known.has(g)) { console.error(`DANGLING ref[${i}]=${g} in ${a.guid}`); process.exit(1); }
  }
}
for (const n of scene.payload.entities) {
  const h = n.components.MeshFilter?.assetHandle;
  if (h !== undefined && (h < 0 || h >= scene.refs.length)) { console.error(`bad assetHandle ${h} @ ${n.localId}`); process.exit(1); }
  const ids = scene.payload.entities.filter((m) => m.localId === n.localId);
  if (ids.length !== 1) { console.error(`duplicate localId ${n.localId}`); process.exit(1); }
}

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n');
console.log(`ok: removed ${removed} old parts, added ${P.length} humanoid parts, ${scene.payload.entities.length} nodes total`);
