//  localized comment
// docs/town-plan.md: houses west, plaza south (+z), factory east-far,
// spectator stands + signup booth east, paths, lamps, and FIVE humanoid
// NPC rigs (4 residents + 1 referee) reusing the Player rig geometry.
//
// RULES (episodes/paopaotang/*):
//   - cube/sphere builtin meshes ONLY (Play doesn't catalogue cylinder)
//   - reuse EXISTING material refs (no new assets → zero dangling-ref risk)
//   - run with ✎ Edit CLOSED; idempotent (refuses if TownPlazaFloor exists)
import fs from 'node:fs';

const PACK = '.forgeax/games/paopaotang/assets/scene.pack.json';
const BASE = '.forgeax/games/paopaotang/assets/base-material.pack.json';
const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const scene = pack.assets.find((a) => a.kind === 'scene');
const nodes = scene.payload.entities;

if (nodes.some((n) => n.components.Name?.value === 'TownPlazaFloor')) {
  console.error('town already built — refusing to run twice');
  process.exit(1);
}
if (scene.refs[0] !== CUBE || scene.refs[17] !== SPHERE) {
  console.error('ref layout changed — aborting'); process.exit(1);
}

const byName = (nm) => nodes.find((n) => n.components.Name?.value === nm);

// ── 1) widen the apron so the town has ground under it ──────────────────────
byName('Apron').components.Transform.scale = [64, 0.5, 52];

// ── 2) relocate 3 decorations that sit where the stands/booth go ────────────
const move = (nm, x, z) => {
  const t = byName(nm).components.Transform;
  t.pos = [x, t.pos[1], z];
};
move('TreeTrunk_2', 10, -7.5); move('TreeHead_2', 10, -7.5);
move('TreeTrunk_3', 6.2, 11.4); move('TreeHead_3', 6.2, 11.4);
move('Gumdrop_5', 17.5, 3.5);

// ── 3) town structures (name, mesh, matRef, pos, scale) ─────────────────────
// mats: 3 white-lilac 5 hotpink 6 caramel 7 blue 9 red 10 yellow 11 purple
//       12 teal 13 brown 14 white 15 pure-white 19 skin 20 dark 21 blush
const S = [];
S.push(['TownPlazaFloor', 'cube', 3, [0, -0.16, 14], [12, 0.1, 8]]);
S.push(['FountainBase', 'cube', 14, [0, 0.05, 14], [2.6, 0.5, 2.6]]);
S.push(['FountainWater', 'cube', 7, [0, 0.28, 14], [2.15, 0.12, 2.15]]);
S.push(['FountainSpout', 'sphere', 15, [0, 0.75, 14], [0.55, 0.75, 0.55]]);
S.push(['Bench_0', 'cube', 13, [-4.2, 0.08, 16.6], [1.7, 0.2, 0.55]]);
S.push(['Bench_1', 'cube', 13, [4.2, 0.08, 16.6], [1.7, 0.2, 0.55]]);
S.push(['LampPost_0', 'cube', 20, [-5.5, 0.7, 11.2], [0.16, 1.8, 0.16]]);
S.push(['LampBulb_0', 'sphere', 10, [-5.5, 1.78, 11.2], [0.34, 0.34, 0.34]]);
S.push(['LampPost_1', 'cube', 20, [5.5, 0.7, 11.2], [0.16, 1.8, 0.16]]);
S.push(['LampBulb_1', 'sphere', 10, [5.5, 1.78, 11.2], [0.34, 0.34, 0.34]]);
// 4 houses (west lane), roofs red/blue/teal/yellow
const ROOF = [9, 7, 12, 10];
[2, 8, 14, 20].forEach((z, i) => {
  S.push([`HouseBody_${i}`, 'cube', 14, [-16, 0.9, z], [3.4, 2.2, 3.0]]);
  S.push([`HouseRoof_${i}`, 'cube', ROOF[i], [-16, 2.32, z], [3.8, 0.75, 3.4]]);
  S.push([`HouseDoor_${i}`, 'cube', 13, [-14.25, 0.42, z], [0.16, 1.25, 0.8]]);
  S.push([`HouseWin_${i}`, 'cube', 15, [-14.25, 1.35, z + 0.9], [0.12, 0.55, 0.55]]);
});
// candy factory (east-far)
S.push(['FactoryBody', 'cube', 14, [19, 1.3, -3], [6, 3, 5]]);
S.push(['FactoryRoof', 'cube', 20, [19, 2.95, -3], [6.4, 0.35, 5.4]]);
S.push(['FactoryChim_0', 'cube', 13, [21, 4.1, -4.5], [0.85, 2.6, 0.85]]);
S.push(['FactoryChim_1', 'cube', 13, [21, 3.8, -2.2], [0.7, 2.1, 0.7]]);
S.push(['FactoryDoor', 'cube', 20, [15.95, 0.75, -3], [0.14, 1.9, 1.3]]);
// spectator stands (east of the arena, 2 tiers + red seat stripes)
S.push(['StandTier_0', 'cube', 3, [10.3, 0.25, 0], [1.6, 0.9, 9]]);
S.push(['StandStripe_0', 'cube', 9, [10.3, 0.73, 0], [1.5, 0.08, 8.8]]);
S.push(['StandTier_1', 'cube', 3, [11.9, 0.7, 0], [1.6, 1.8, 9]]);
S.push(['StandStripe_1', 'cube', 9, [11.9, 1.63, 0], [1.5, 0.08, 8.8]]);
// signup booth (localized) — player approaches from the north path
S.push(['BoothBase', 'cube', 6, [10.9, 0.35, 8.4], [2.2, 1.1, 1.0]]);
S.push(['BoothPost_0', 'cube', 13, [9.95, 0.85, 8.4], [0.16, 2.1, 0.16]]);
S.push(['BoothPost_1', 'cube', 13, [11.85, 0.85, 8.4], [0.16, 2.1, 0.16]]);
S.push(['BoothRoof', 'cube', 9, [10.9, 1.98, 8.4], [2.7, 0.22, 1.5]]);
S.push(['BoothSign', 'cube', 15, [10.9, 2.5, 8.4], [1.9, 0.6, 0.14]]);
// caramel paths (flat, sit 0.03 above the apron top at -0.2)
S.push(['Path_0', 'cube', 6, [0, -0.17, 9.8], [2.4, 0.06, 5.2]]);
S.push(['Path_1', 'cube', 6, [-7.5, -0.17, 14], [13, 0.06, 2.2]]);
S.push(['Path_2', 'cube', 6, [7.5, -0.17, 13.6], [13, 0.06, 2.2]]);
S.push(['Path_3', 'cube', 6, [10.9, -0.17, 11.4], [2.2, 0.06, 4.6]]);
S.push(['Path_4', 'cube', 6, [14, -0.17, 4.8], [2.2, 0.06, 17.6]]);
S.push(['Path_5', 'cube', 6, [17.5, -0.17, -3], [5, 0.06, 2.2]]);
S.push(['Path_6', 'cube', 6, [-13.4, -0.17, 11], [2.2, 0.06, 18.5]]);

// ── 4) NPC humanoid rigs — same geometry as the Player rig ──────────────────
// (rebuild-player-humanoid.mjs P-table, mats parameterized per character)
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
// prefix, [shirt, shorts, hat], spawn (root y = 0.55: feet on the apron -0.2)
const NPCS = [
  ['NpcA', [10, 7, 6], [-13, 2]],     // localized: yellow shirt
  ['NpcB', [12, 20, 14], [-13, 8]],   // localized: teal shirt
  ['NpcC', [11, 20, 10], [-13, 14]],  // localized: purple shirt
  ['NpcD', [5, 7, 9], [-13, 20]],     // localized: pink shirt
  ['NpcR', [14, 20, 9], [10.9, 7.4]], // localized: white shirt, red hat
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
  // root: Transform + Name only (like the Player root)
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

// ── 5) integrity check BEFORE writing ────────────────────────────────────────
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
console.log(`ok: town built — ${nodes.length} nodes total (structures ${S.length}, NPC rigs ${NPCS.length}×18)`);
