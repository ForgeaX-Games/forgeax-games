//  localized comment
// A tall archway over the path that leads from the plaza to the signup booth,
// plus bright yellow arrow tiles on the ground pointing the way.
//
// RULES (episodes/paopaotang/*):
//   - cube/sphere builtin meshes ONLY (Play doesn't catalogue cylinder)
//   - reuse EXISTING material refs (no new assets → zero dangling-ref risk)
//   - run with ✎ Edit CLOSED; idempotent (refuses if GateCrossbar exists)
import fs from 'node:fs';

const PACK = '.forgeax/games/paopaotang/assets/scene.pack.json';
const BASE = '.forgeax/games/paopaotang/assets/base-material.pack.json';
const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const scene = pack.assets.find((a) => a.kind === 'scene');
const nodes = scene.payload.entities;

if (nodes.some((n) => n.components.Name?.value === 'GateCrossbar')) {
  console.error('gate already built — refusing to run twice');
  process.exit(1);
}
if (scene.refs[0] !== CUBE || scene.refs[17] !== SPHERE) {
  console.error('ref layout changed — aborting'); process.exit(1);
}

// mats: 3 white-lilac 5 hotpink 6 caramel 7 blue 9 red 10 yellow 11 purple
//       12 teal 13 brown 14 white 15 pure-white 20 dark
// The player approaches from the plaza (+z) heading north to the booth (10.9, 8.4),
// so the arch spans the venue path at z = 11.6, facing +z.
const S = [];
// two candy-cane pillars (stacked red/white segments), x = 8.9 / 12.9
for (const [side, x] of [['L', 8.9], ['R', 12.9]]) {
  for (let i = 0; i < 4; i++) {
    S.push([`GatePillar_${side}${i}`, 'cube', i % 2 === 0 ? 9 : 15, [x, 0.2 + i * 0.8, 11.6], [0.55, 0.8, 0.55]]);
  }
  S.push([`GateBall_${side}`, 'sphere', 5, [x, 3.35, 11.6], [0.45, 0.45, 0.45]]);
}
// crossbar + big sign board (faces the plaza)
S.push(['GateCrossbar', 'cube', 9, [10.9, 3.25, 11.6], [4.9, 0.5, 0.6]]);
S.push(['GateSign', 'cube', 15, [10.9, 3.95, 11.6], [3.6, 0.85, 0.35]]);
// colorful "letter blocks" on the sign face — reads as localized marquee from afar
[[-1.2, 9], [-0.4, 10], [0.4, 7], [1.2, 11]].forEach(([dx, m], i) => {
  S.push([`GateDeco_${i}`, 'cube', m, [10.9 + dx, 3.95, 11.82], [0.55, 0.55, 0.12]]);
});
// candy topper balls
S.push(['GateTop_0', 'sphere', 10, [10.9, 4.75, 11.6], [0.5, 0.5, 0.5]]);
S.push(['GateTop_1', 'sphere', 9, [9.9, 4.62, 11.6], [0.34, 0.34, 0.34]]);
S.push(['GateTop_2', 'sphere', 7, [11.9, 4.62, 11.6], [0.34, 0.34, 0.34]]);
// flag garland hanging under the crossbar
[9, 10, 7, 5, 12].forEach((m, i) => {
  S.push([`GateFlag_${i}`, 'cube', m, [9.3 + i * 0.8, 2.82, 11.6], [0.3, 0.36, 0.1]]);
});
// yellow arrow tiles (45°-rotated diamonds) on the path, plaza → arch
const DIAG = [0, 0.3826834, 0, 0.9238795];
[15.6, 14.2, 12.9].forEach((z, i) => {
  S.push([`GateArrow_${i}`, 'cube', 10, [10.9, -0.12, z], [0.52, 0.05, 0.52], DIAG]);
});

const MESH = { cube: 0, sphere: 17 };
let nextId = Math.max(...nodes.map((n) => n.localId)) + 1;
for (const [name, mesh, mat, pos, scale, quat] of S) {
  nodes.push({
    localId: nextId,
    components: {
      Entity: { self: nextId },
      MeshFilter: { assetHandle: MESH[mesh] },
      MeshRenderer: { materials: [mat] },
      Name: { value: name },
      Transform: { pos, quat: quat ?? [0, 0, 0, 1], scale },
    },
  });
  nextId++;
}

// integrity check BEFORE writing (same gate as build-town.mjs)
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
}

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n');
console.log(`ok: gate built — +${S.length} nodes, ${nodes.length} total`);
