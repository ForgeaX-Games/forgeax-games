//  localized comment
// apron, a NORTH residential district (6 houses), 2 extra west-lane houses,
// shifted east structures (stands/booth/factory move out with the wider arena),
// and TWENTY new resident rigs (NpcE..NpcQ, NpcS..NpcY — R is the referee).
//
// RULES (episodes/paopaotang/*):
//   - cube/sphere builtin meshes ONLY
//   - reuse EXISTING material refs (no new assets → zero dangling-ref risk)
//   - run with ✎ Edit CLOSED; idempotent (refuses if NorthHouseBody_0 exists)
import fs from 'node:fs';

const PACK = '.forgeax/games/paopaotang/assets/scene.pack.json';
const BASE = '.forgeax/games/paopaotang/assets/base-material.pack.json';
const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const scene = pack.assets.find((a) => a.kind === 'scene');
const nodes = scene.payload.entities;

if (nodes.some((n) => n.components.Name?.value === 'NorthHouseBody_0')) {
  console.error('town already expanded — refusing to run twice');
  process.exit(1);
}
if (scene.refs[0] !== CUBE || scene.refs[17] !== SPHERE) {
  console.error('ref layout changed — aborting'); process.exit(1);
}

const byName = (nm) => nodes.find((n) => n.components.Name?.value === nm);
const setPos = (nm, x, y, z) => { byName(nm).components.Transform.pos = [x, y, z]; };
const setScale = (nm, x, y, z) => { byName(nm).components.Transform.scale = [x, y, z]; };
const shift = (nm, dx, dz) => {
  const t = byName(nm).components.Transform;
  t.pos = [t.pos[0] + dx, t.pos[1], t.pos[2] + dz];
};

// ── 1) bigger apron ──────────────────────────────────────────────────────────
setScale('Apron', 100, 0.5, 80);

// ── 2) arena 13×11 → 17×13 (world x -8..8, z -6..6) ─────────────────────────
setScale('Ground', 19, 0.2, 15);
setPos('WallN', 0, 0.5, -7); setScale('WallN', 19, 1.2, 1);
setPos('WallS', 0, 0.5, 7); setScale('WallS', 19, 1.2, 1);
setPos('WallW', -9, 0.5, 0); setScale('WallW', 1, 1.2, 13);
setPos('WallE', 9, 0.5, 0); setScale('WallE', 1, 1.2, 13);
// drop the old 5×4 pillar lattice, rebuild 7×5 (they're childless — safe)
for (let i = nodes.length - 1; i >= 0; i--) {
  if (/^Pillar_/.test(nodes[i].components.Name?.value ?? '')) nodes.splice(i, 1);
}

// ── 3) east structures move out with the wider arena (x +2; booth also z +1) ─
for (const nm of ['StandTier_0', 'StandStripe_0', 'StandTier_1', 'StandStripe_1',
  'Path_4', 'Path_5', 'FactoryBody', 'FactoryRoof', 'FactoryChim_0',
  'FactoryChim_1', 'FactoryDoor', 'Path_3']) shift(nm, 2, 0);
for (const nm of ['BoothBase', 'BoothPost_0', 'BoothPost_1', 'BoothRoof', 'BoothSign']) {
  shift(nm, 2, 1);
}
setPos('NpcR', 12.9, 0.55, 8.4);   //  localized comment
// west lane path now reaches the north district (z -12.5..29.5)
setPos('Path_6', -13.4, -0.17, 8.5); setScale('Path_6', 2.2, 0.06, 21);

// ── 4) new structures ────────────────────────────────────────────────────────
// mats: 3 white-lilac 5 hotpink 6 caramel 7 blue 9 red 10 yellow 11 purple
//       12 teal 13 brown 14 white 15 pure-white 19 skin 20 dark 21 blush
const S = [];
// north lane path + connectors
S.push(['Path_N', 'cube', 6, [0, -0.17, -11.5], [44, 0.06, 2.2]]);
// north district: 6 houses at z=-17, doors facing south onto the lane
const N_X = [-21, -13, -5, 3, 11, 19];
const ROOF = [9, 7, 12, 10, 5, 11];
N_X.forEach((x, i) => {
  S.push([`NorthHouseBody_${i}`, 'cube', 14, [x, 0.9, -17], [3.4, 2.2, 3.0]]);
  S.push([`NorthHouseRoof_${i}`, 'cube', ROOF[i], [x, 2.32, -17], [3.8, 0.75, 3.4]]);
  S.push([`NorthHouseDoor_${i}`, 'cube', 13, [x, 0.42, -13.95], [0.8, 1.25, 0.16]]);
  S.push([`NorthHouseWin_${i}`, 'cube', 15, [x + 0.95, 1.35, -13.93], [0.55, 0.55, 0.12]]);
});
// two extra west-lane houses (styles match the original four)
[[-4, 12], [26, 5]].forEach(([z, roof], i) => {
  S.push([`HouseBody_${4 + i}`, 'cube', 14, [-16, 0.9, z], [3.4, 2.2, 3.0]]);
  S.push([`HouseRoof_${4 + i}`, 'cube', roof, [-16, 2.32, z], [3.8, 0.75, 3.4]]);
  S.push([`HouseDoor_${4 + i}`, 'cube', 13, [-14.25, 0.42, z], [0.16, 1.25, 0.8]]);
  S.push([`HouseWin_${4 + i}`, 'cube', 15, [-14.25, 1.35, z + 0.9], [0.12, 0.55, 0.55]]);
});
// lamps + gumdrops along the north lane
[-17, -9, -1, 7].forEach((x, i) => {
  S.push([`LampPost_${2 + i}`, 'cube', 20, [x, 0.7, -10.2], [0.16, 1.8, 0.16]]);
  S.push([`LampBulb_${2 + i}`, 'sphere', 10, [x, 1.78, -10.2], [0.34, 0.34, 0.34]]);
});
[[-24.5, -13, 5], [15, -10.6, 9], [23, -12.6, 11], [-11, -9.4, 12]].forEach(([x, z, m], i) => {
  S.push([`Gumdrop_${6 + i}`, 'sphere', m, [x, 0.15, z], [0.5, 0.5, 0.5]]);
});
// rebuilt pillar lattice: world x -6..6, z -4..4, step 2
for (let x = -6; x <= 6; x += 2) {
  for (let z = -4; z <= 4; z += 2) {
    const nm = `Pillar_${x < 0 ? 'm' + -x : x}_${z < 0 ? 'm' + -z : z}`;
    S.push([nm, 'cube', 3, [x, 0.5, z], [0.95, 1, 0.95]]);
  }
}

// ── 5) 20 new resident rigs (same geometry as the Player rig) ────────────────
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
// prefix, [shirt, shorts, hat], spawn (root y 0.55: feet on the apron -0.2)
const NPCS = [
  ['NpcE', [5, 20, 14], [-13.7, -4]],   // localized
  ['NpcF', [6, 13, 10], [-13.7, 26]],   // localized
  ['NpcG', [13, 20, 6], [-21.7, -11.5]],// localized
  ['NpcH', [12, 20, 12], [-20.3, -11.5]],// localized
  ['NpcI', [10, 13, 10], [-13.7, -11.5]],// localized
  ['NpcJ', [10, 12, 12], [-12.3, -11.5]],// localized
  ['NpcK', [9, 10, 10], [-5.7, -11.5]], // localized
  ['NpcL', [14, 13, 6], [-4.3, -11.5]], // localized
  ['NpcM', [3, 5, 21], [2.3, -11.5]],   // localized
  ['NpcN', [21, 6, 5], [3.7, -11.5]],   // localized
  ['NpcO', [15, 7, 7], [10.3, -11.5]],  // localized
  ['NpcP', [7, 11, 9], [11.7, -11.5]],  // localized
  ['NpcQ', [6, 9, 13], [18.3, -11.5]],  // localized
  ['NpcS', [13, 6, 9], [19.7, -11.5]],  // localized
  ['NpcT', [10, 6, 13], [-12.3, 2]],    // localized
  ['NpcU', [12, 7, 15], [-12.3, 8]],    // localized
  ['NpcV', [15, 21, 5], [-12.3, 14]],   // localized
  ['NpcW', [10, 9, 15], [-12.3, 20]],   // localized
  ['NpcX', [12, 14, 12], [-12.3, -4]],  // localized
  ['NpcY', [6, 20, 6], [-12.3, 26]],    // localized
];

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

for (const [name, mesh, mat, pos, scale] of S) push(name, mesh, mat, pos, scale);

for (const [prefix, [shirt, shorts, hat], [sx, sz]] of NPCS) {
  const rootId = nextId;
  nodes.push({
    localId: nextId,
    components: {
      Entity: { self: nextId },
      Name: { value: prefix },
      Transform: { pos: [sx, 0.55, sz], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  });
  nextId++;
  for (const [suffix, mesh, mat, pos, scale] of RIG(shirt, shorts, hat)) {
    push(prefix + suffix, mesh, mat, pos, scale, rootId);
  }
}

// ── 6) integrity check BEFORE writing ────────────────────────────────────────
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
console.log(`ok: town expanded — ${nodes.length} nodes (structures ${S.length}, new rigs ${NPCS.length}×18, pillars 35)`);
