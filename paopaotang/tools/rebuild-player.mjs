// Rebuild the Player rig in assets/scene.pack.json: replace the 6-box "wooden man"
// with a chibi bubble-kid (sphere body/head, beanie + bobble, eyes, blush, mitten
// hands, boots, bubble tank). Parts are ChildOf the Player root so main.ts can
// animate them (walk cycle / squash & stretch). Idempotent: re-running replaces
// the current Player child parts with the same rig.
import fs from 'node:fs';

const PACK = '.forgeax/games/paopaotang/assets/scene.pack.json';
const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const scene = pack.assets.find((a) => a.kind === 'scene');
const nodes = scene.payload.entities;

const playerNode = nodes.find((n) => n.components.Name?.value === 'Player');
if (!playerNode) throw new Error('Player root not found');
const ROOT = playerNode.localId;

// ── new candy materials (fixed guids → idempotent) ──────────────────────────
const MATS = [
  { guid: 'aa10b7c2-51d4-4f2e-9c3a-7e8b2d4f6a01', name: 'player-pink',  baseColor: [1, 0.52, 0.72, 1],    roughness: 0.35 },
  { guid: 'aa10b7c2-51d4-4f2e-9c3a-7e8b2d4f6a02', name: 'player-cream', baseColor: [1, 0.93, 0.84, 1],    roughness: 0.55 },
  { guid: 'aa10b7c2-51d4-4f2e-9c3a-7e8b2d4f6a03', name: 'player-dark',  baseColor: [0.13, 0.11, 0.16, 1], roughness: 0.25 },
  { guid: 'aa10b7c2-51d4-4f2e-9c3a-7e8b2d4f6a04', name: 'player-blush', baseColor: [1, 0.6, 0.64, 1],     roughness: 0.6 },
];
for (const m of MATS) {
  if (pack.assets.some((a) => a.guid === m.guid)) continue;
  pack.assets.push({
    guid: m.guid, kind: 'material',
    payload: {
      kind: 'material',
      passes: [
        { name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 },
        { name: 'ShadowCaster', shader: 'forgeax::default-shadow-caster', tags: { LightMode: 'ShadowCaster' }, passKind: 'shadow-caster' },
      ],
      paramValues: { baseColor: m.baseColor, metallic: 0, roughness: m.roughness },
    },
    refs: [],
  });
}
const refIdx = (guid) => {
  let i = scene.refs.indexOf(guid);
  if (i < 0) { scene.refs.push(guid); i = scene.refs.length - 1; }
  return i;
};
const SPHERE = refIdx('95730fd2-9846-5f84-8658-0b3c971eb263');
const PINK  = refIdx(MATS[0].guid);
const CREAM = refIdx(MATS[1].guid);
const DARK  = refIdx(MATS[2].guid);
const BLUSH = refIdx(MATS[3].guid);
const RED   = refIdx('833e1764-4e1e-4381-8201-8b91d7d020c2');   // strawberry (existing)
const WHITE = refIdx('e0cc6b17-2790-4e7b-8bba-ecb927554531');   // candy white (existing)
const MINT  = refIdx('a931fb99-1201-4798-aabd-c78593146383');   // mint (existing)

// ── drop the old box-man parts (every child of the Player root) ─────────────
for (let i = nodes.length - 1; i >= 0; i--) {
  if (nodes[i].components.ChildOf?.parent === ROOT) nodes.splice(i, 1);
}

// ── chibi rig (local space; the FACE is on -Z — root yaw maps -Z to heading) ─
// name, material ref, pos, scale
const PARTS = [
  ['PlayerBody',   PINK,  [0, -0.22, 0],        [0.64, 0.58, 0.60]],
  ['PlayerBelly',  CREAM, [0, -0.24, -0.20],    [0.42, 0.38, 0.26]],
  ['PlayerHead',   CREAM, [0, 0.30, 0],         [0.74, 0.70, 0.72]],
  ['PlayerHat',    RED,   [0, 0.60, 0.02],      [0.66, 0.34, 0.68]],
  ['PlayerBobble', WHITE, [0, 0.80, 0.02],      [0.22, 0.22, 0.22]],
  ['PlayerEyeL',   DARK,  [-0.14, 0.34, -0.35], [0.11, 0.14, 0.08]],
  ['PlayerEyeR',   DARK,  [0.14, 0.34, -0.35],  [0.11, 0.14, 0.08]],
  ['PlayerBlushL', BLUSH, [-0.26, 0.22, -0.27], [0.11, 0.07, 0.06]],
  ['PlayerBlushR', BLUSH, [0.26, 0.22, -0.27],  [0.11, 0.07, 0.06]],
  ['PlayerHandL',  RED,   [-0.40, -0.20, 0],    [0.20, 0.20, 0.20]],
  ['PlayerHandR',  RED,   [0.40, -0.20, 0],     [0.20, 0.20, 0.20]],
  ['PlayerFootL',  RED,   [-0.15, -0.60, -0.02],[0.22, 0.15, 0.28]],
  ['PlayerFootR',  RED,   [0.15, -0.60, -0.02], [0.22, 0.15, 0.28]],
  ['PlayerTank',   MINT,  [0, -0.10, 0.36],     [0.34, 0.42, 0.26]],
];

let nextId = Math.max(...nodes.map((n) => n.localId)) + 1;
const playerIdx = nodes.indexOf(playerNode);
const newNodes = PARTS.map(([name, matIdx, pos, scale]) => {
  const id = nextId++;
  return {
    localId: id,
    components: {
      Entity: { self: id },
      MeshFilter: { assetHandle: SPHERE },
      MeshRenderer: { materials: [matIdx] },
      ChildOf: { parent: ROOT },
      Name: { value: name },
      Transform: { pos, quat: [0, 0, 0, 1], scale },
    },
  };
});
nodes.splice(playerIdx + 1, 0, ...newNodes);

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2) + '\n');
console.log(`player rig rebuilt: ${PARTS.length} parts, refs now ${scene.refs.length}, nodes ${nodes.length}`);
