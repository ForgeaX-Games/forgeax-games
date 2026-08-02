// One-shot scene decorator: appends candy-world dressing around the 13x11 arena.
// Idempotent-ish: refuses to run twice (checks for the "Apron" node).
import fs from 'node:fs';
import crypto from 'node:crypto';

const PATH = '.forgeax/games/paopaotang/assets/scene.pack.json';
const pack = JSON.parse(fs.readFileSync(PATH, 'utf8'));
const scene = pack.assets.find((a) => a.kind === 'scene');
const refs = scene.refs;
const ents = scene.payload.entities;

if (ents.some((e) => e.components?.Name?.value === 'Apron')) {
  console.log('already decorated — nothing to do');
  process.exit(0);
}

const MESH_CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const MESH_SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';
const MESH_CYL = 'c1111111-0000-5000-8000-000000000001';

let nextId = Math.max(...ents.map((e) => e.localId)) + 1;

function refIdx(guid) {
  let i = refs.indexOf(guid);
  if (i < 0) { refs.push(guid); i = refs.length - 1; }
  return i;
}

function makeMat(baseColor, roughness, { castShadow = true } = {}) {
  const guid = crypto.randomUUID();
  const passes = [
    { name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 },
  ];
  if (castShadow) {
    passes.push({ name: 'ShadowCaster', shader: 'forgeax::default-shadow-caster', tags: { LightMode: 'ShadowCaster' }, passKind: 'shadow-caster' });
  }
  pack.assets.push({
    guid, kind: 'material',
    payload: { kind: 'material', passes, paramValues: { baseColor, metallic: 0, roughness } },
    refs: [],
  });
  return refIdx(guid);
}

function node(name, meshGuid, matIdx, pos, scale, quat = [0, 0, 0, 1]) {
  const id = nextId++;
  ents.push({
    localId: id,
    components: {
      Entity: { self: id },
      MeshFilter: { assetHandle: refIdx(meshGuid) },
      MeshRenderer: { materials: [matIdx] },
      Name: { value: name },
      Transform: { pos, quat, scale },
    },
  });
}

// --- palette (candy world) ---
const matApron = makeMat([0.97, 0.9, 0.78, 1], 0.95);
const matStrawberry = makeMat([0.95, 0.32, 0.38, 1], 0.45);
const matLemon = makeMat([0.99, 0.84, 0.32, 1], 0.5);
const matGrape = makeMat([0.63, 0.44, 0.86, 1], 0.5);
const matMint = makeMat([0.42, 0.86, 0.68, 1], 0.5);
const matChocolate = makeMat([0.4, 0.27, 0.17, 1], 0.85);
const matWhiteCandy = makeMat([0.98, 0.97, 0.94, 1], 0.4);
// clouds get NO shadow-caster pass so they never darken the playfield
const matCloud = makeMat([1, 1, 1, 1], 1, { castShadow: false });

const candy = [matStrawberry, matLemon, matGrape, matMint];

// --- 1. pastel apron ground under everything ---
node('Apron', MESH_CUBE, matApron, [0, -0.45, 0], [40, 0.5, 34]);

// --- 2. peppermint corner towers on the 4 wall corners ---
const corners = [[-7, -6], [7, -6], [-7, 6], [7, 6]];
corners.forEach(([x, z], i) => {
  node(`TowerPost_${i}`, MESH_CYL, matWhiteCandy, [x, 1.0, z], [1.15, 2.4, 1.15]);
  node(`TowerCap_${i}`, MESH_SPHERE, matStrawberry, [x, 2.55, z], [1.35, 1.35, 1.35]);
});

// --- 3. lollipop trees around the arena (all outside the walls) ---
const trees = [
  [-10, -3], [-10, 3.5], [10, -4], [10, 2.5],
  [-4, -9.5], [3.5, -9.5], [-2.5, 9.5], [5, 9.5],
];
trees.forEach(([x, z], i) => {
  const s = 1.2 + (i % 3) * 0.2; // head size 1.2 / 1.4 / 1.6
  node(`TreeTrunk_${i}`, MESH_CYL, matChocolate, [x, 0.55, z], [0.28, 1.5, 0.28]);
  node(`TreeHead_${i}`, MESH_SPHERE, candy[i % candy.length], [x, 1.3 + s * 0.45, z], [s, s, s]);
});

// --- 4. gumdrops scattered on the apron ---
const drops = [
  [-11.5, -6.5], [-9, 7.5], [-6.5, -8.5], [-12, 1],
  [9.5, 6.5], [11.5, -1.5], [8, -8], [1, 10.5],
];
drops.forEach(([x, z], i) => {
  const s = 0.5 + (i % 2) * 0.15;
  node(`Gumdrop_${i}`, MESH_SPHERE, candy[(i + 1) % candy.length], [x, s * 0.38 - 0.2, z], [s, s * 0.85, s]);
});

// --- 5. candy studs along the wall tops (alternating red / white) ---
let studIdx = 0;
const stud = (x, z) => {
  const m = studIdx % 2 === 0 ? matStrawberry : matWhiteCandy;
  node(`Stud_${studIdx}`, MESH_SPHERE, m, [x, 1.22, z], [0.42, 0.42, 0.42]);
  studIdx += 1;
};
for (let x = -6; x <= 6; x += 2) { stud(x, -6); stud(x, 6); } // N + S walls
for (let z = -4; z <= 4; z += 2) { stud(-7, z); stud(7, z); } // W + E walls

// --- 6. soft clouds (shadows land outside the arena; material casts none anyway) ---
const clouds = [
  { c: [-16, 8.5, -9], puffs: [[0, 0, 0, 2.6], [1.9, -0.3, 0.6, 1.9], [-1.9, -0.45, 0.4, 1.7]] },
  { c: [15, 9.5, 8], puffs: [[0, 0, 0, 2.4], [1.7, -0.35, -0.5, 1.8], [-1.8, -0.4, 0.5, 1.6]] },
  { c: [-5, 9.2, 14], puffs: [[0, 0, 0, 2.2], [1.6, -0.3, 0.4, 1.6], [-1.6, -0.4, -0.4, 1.5]] },
];
clouds.forEach(({ c, puffs }, i) => {
  puffs.forEach(([dx, dy, dz, s], j) => {
    node(`Cloud_${i}_${j}`, MESH_SPHERE, matCloud, [c[0] + dx, c[1] + dy, c[2] + dz], [s, s * 0.62, s]);
  });
});

fs.writeFileSync(PATH, JSON.stringify(pack, null, 2) + '\n');
console.log(`done: +${nextId - 35} nodes, refs now ${refs.length}, assets now ${pack.assets.length}`);
