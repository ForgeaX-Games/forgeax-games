// Append the digital-life guide "Guide" humanoid rig to the scene pack.
// Guide is the 5th resident (a plaza greeter), wired via soul_create +
// npc_wire (src/npcs/guide). This authors its BODY as a persistent asset —
// same geometry/convention as the NpcA..D + NpcR rigs in build-town.mjs, so
// ✎ Edit and ▶ Play instantiate the same Guide.
//
// RULES (episodes/paopaotang/*): cube/sphere builtin meshes only; reuse
// EXISTING material refs (no new assets → zero dangling-ref risk); run with
// ✎ Edit CLOSED; idempotent (refuses if a 'Guide' root already exists).
import fs from 'node:fs';

const PACK = '.forgeax/games/paopaotang/assets/scene.pack.json';
const BASE = '.forgeax/games/paopaotang/assets/base-material.pack.json';
const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const scene = pack.assets.find((a) => a.kind === 'scene');
const nodes = scene.payload.entities;

if (nodes.some((n) => n.components.Name?.value === 'Guide')) {
  console.error('Guide rig already present — refusing to run twice');
  process.exit(1);
}
if (scene.refs[0] !== CUBE || scene.refs[17] !== SPHERE) {
  console.error('ref layout changed — aborting'); process.exit(1);
}

// Same humanoid table build-town.mjs uses for the residents (parameterized mats).
// mats palette: 9 red 14 white 15 pure-white 19 skin 20 dark 21 blush.
const RIG = (shirt, shorts, hat) => [
  ['Torso', 'cube', shirt, [0, -0.05, 0], [0.50, 0.46, 0.30]],
  ['Shorts', 'cube', shorts, [0, -0.31, 0], [0.52, 0.16, 0.32]],
  ['LegL', 'cube', shorts, [-0.12, -0.51, 0], [0.17, 0.42, 0.19]],
  ['LegR', 'cube', shorts, [0.12, -0.51, 0], [0.17, 0.42, 0.19]],
  ['FootL', 'cube', 20, [-0.12, -0.70, -0.04], [0.18, 0.10, 0.28]],
  ['FootR', 'cube', 20, [0.12, -0.70, -0.04], [0.18, 0.10, 0.28]],
  ['ArmL', 'cube', shirt, [-0.33, -0.07, 0], [0.13, 0.40, 0.15]],
  ['ArmR', 'cube', shirt, [0.33, -0.07, 0], [0.13, 0.40, 0.15]],
  ['HandL', 'sphere', 19, [-0.33, -0.30, 0], [0.15, 0.15, 0.15]],
  ['HandR', 'sphere', 19, [0.33, -0.30, 0], [0.15, 0.15, 0.15]],
  ['Head', 'sphere', 19, [0, 0.42, 0], [0.46, 0.44, 0.46]],
  ['EyeL', 'sphere', 20, [-0.13, 0.45, -0.19], [0.055, 0.09, 0.05]],
  ['EyeR', 'sphere', 20, [0.13, 0.45, -0.19], [0.055, 0.09, 0.05]],
  ['BlushL', 'sphere', 21, [-0.19, 0.38, -0.15], [0.06, 0.045, 0.035]],
  ['BlushR', 'sphere', 21, [0.19, 0.38, -0.15], [0.06, 0.045, 0.035]],
  ['Hat', 'sphere', hat, [0, 0.58, 0], [0.48, 0.28, 0.48]],
  ['Bobble', 'sphere', 15, [0, 0.73, 0], [0.13, 0.13, 0.13]],
];

// Guide look: red shirt (the studio's signature colour), dark shorts, white hat
// — a friendly mirror of the referee's white-shirt/red-hat, clearly distinct
// from the four residents. Rest pose at the fountain plaza; runtime drives it.
const PREFIX = 'Guide';
const MATS = [9, 20, 15];        // shirt, shorts, hat
const SPAWN = [4, 13.6];         // PLAZA_E waypoint — beside the fountain, on the
                                 // path toward the signup booth (Guide's home)

const MESH = { cube: 0, sphere: 17 };
let nextId = Math.max(...nodes.map((n) => n.localId)) + 1;
const push = (name, mesh, mat, pos, scale, parent) => {
  const c = {
    Entity: { self: nextId },
    MeshFilter: { assetHandle: MESH[mesh] },
    MeshRenderer: { materials: [mat] },
    Name: { value: name },
    Transform: { pos, quat: [0, 0, 0, 1], scale },
  };
  if (parent !== undefined) c.ChildOf = { parent };
  nodes.push({ localId: nextId, components: c });
  return nextId++;
};

const rootId = nextId;
nodes.push({
  localId: nextId,
  components: {
    Entity: { self: nextId },
    Name: { value: PREFIX },
    Transform: { pos: [SPAWN[0], 0.55, SPAWN[1]], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
  },
});
nextId++;
const [shirt, shorts, hat] = MATS;
for (const [suffix, mesh, mat, pos, scale] of RIG(shirt, shorts, hat)) {
  push(PREFIX + suffix, mesh, mat, pos, scale, rootId);
}

// ── integrity check BEFORE writing (same guards build-town.mjs uses) ─────────
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const known = new Set([CUBE, SPHERE, ...pack.assets.map((a) => a.guid), ...base.assets.map((a) => a.guid)]);
for (const a of pack.assets) {
  for (const [i, g] of (a.refs ?? []).entries()) {
    if (!known.has(g)) { console.error(`DANGLING ref[${i}]=${g} in ${a.guid}`); process.exit(1); }
  }
}
const seen = new Set();
for (const n of nodes) {
  if (seen.has(n.localId)) { console.error(`duplicate localId ${n.localId}`); process.exit(1); }
  seen.add(n.localId);
  const h = n.components.MeshFilter?.assetHandle;
  if (h !== undefined && (h < 0 || h >= scene.refs.length)) { console.error(`bad assetHandle ${h} @ ${n.localId}`); process.exit(1); }
  const p = n.components.ChildOf?.parent;
  if (p !== undefined && !nodes.some((m) => m.localId === p)) { console.error(`missing parent ${p} @ ${n.localId}`); process.exit(1); }
}

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n');
console.log(`ok: Guide rig appended — ${nodes.length} nodes total (rig parts ${RIG().length + 1})`);
