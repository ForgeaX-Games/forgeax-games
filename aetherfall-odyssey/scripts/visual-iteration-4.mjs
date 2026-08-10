import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const gameRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenePath = resolve(gameRoot, 'assets/scene.pack.json');
const pack = JSON.parse(readFileSync(scenePath, 'utf8'));
const scene = pack.assets.find((asset) => asset.kind === 'scene' && asset.guid === '76a15ebd-0d8c-4a0e-ad3f-e27d553f667d');
if (!scene) throw new Error('Aetherfall main scene missing');

const entities = new Map(scene.payload.entities
  .filter((candidate) => candidate.components?.Name?.value)
  .map((candidate) => [candidate.components.Name.value, candidate]));

function entity(name) {
  const found = entities.get(name);
  if (!found) throw new Error(`Missing authored entity: ${name}`);
  return found;
}

function transform(name, values) {
  Object.assign(entity(name).components.Transform, values);
}

function quaternionY(degrees) {
  const half = degrees * Math.PI / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

// Keep tested interaction anchors but make the return marker camera-safe. The
// richer ceremonial ring is spawned by procedural-world.ts during Play.
transform('SanctuaryDais', { pos: [0, 0.025, 3.1], scale: [0.95, 0.04, 0.78] });
transform('SanctuaryReturn', { pos: [0, 0.08, 3.1], scale: [0.34, 0.06, 0.34] });
transform('SanctuaryReturnRing', { pos: [0, 0.025, 3.1], scale: [0.72, 0.018, 0.72] });

const route = [
  ['StonePath01', [-0.55, 0.08, -1.5], [1.3, 0.08, 0.95], 7],
  ['StonePath02', [0.35, 0.09, -2.75], [1.05, 0.09, 0.78], -10],
  ['StonePath03', [-0.2, 0.09, -3.75], [0.85, 0.08, 0.55], 5],
  ['StormBridgeDeckA', [0, 0.1, -4.85], [1.65, 0.16, 1.9], 0],
  ['StormBridgeDeckB', [0.08, 0.08, -7.15], [1.38, 0.15, 1.75], -2],
  ['StormBridgeDeckC', [-0.08, 0.06, -9.45], [1.22, 0.14, 1.55], 2],
  ['StormBridgeBreak', [0.55, -0.5, -8.45], [0, 0, 0], 17],
];
for (const [name, pos, scale, yaw] of route) transform(name, { pos, scale, quat: quaternionY(yaw) });

// Re-enable a restrained middle/far silhouette hierarchy. These entities were
// authored and licensed in the game's own pack; no external ruin kit is used.
const vista = [
  ['HangingShardWest', [-12.8, 5.6, -17.5], [2.1, 0.7, 1.4], -8],
  ['HangingShardEast', [13.6, 6.4, -20.5], [1.8, 0.65, 1.25], 10],
  ['FloatingRuinWest', [-14, 4.8, -22], [5.2, 0.8, 3.7], -12],
  ['FloatingRuinWestSpire', [-15.2, 8, -22], [0.55, 3.8, 0.55], -4],
  ['FloatingRuinEast', [15.5, 6.2, -27], [4.7, 0.75, 3.2], 10],
  ['FloatingRuinEastSpire', [16.8, 9.7, -27], [0.48, 3.5, 0.48], 5],
  ['StormShardWest', [-10, 7.4, -31], [1.1, 3.2, 0.8], -14],
  ['StormShardEast', [11, 8, -34], [1, 3.8, 0.75], 17],
  ['DistantIslandCenter', [0, 9.8, -44], [8, 1.2, 4.8], -3],
  ['DistantIslandBeacon', [0, 14.2, -44], [0.5, 5, 0.5], 2],
  ['SkylineRuinWest', [-21, 10.5, -36], [0.45, 5.2, 0.45], -6],
  ['SkylineRuinEast', [22, 11.8, -40], [0.42, 5.8, 0.42], 7],
];
for (const [name, pos, scale, yaw] of vista) transform(name, { pos, scale, quat: quaternionY(yaw) });
for (const [name] of vista) transform(name, { scale: [0, 0, 0] });

Object.assign(entity('Sun').components.DirectionalLight, {
  direction: [-0.42, -1, 0.26], color: [1, 0.88, 0.74], intensity: 1.25, shadowDistance: 70,
});
Object.assign(entity('Skylight').components.Skylight, {
  color: [0.72, 0.78, 0.84], intensity: 0.4, rotation: [0, 0.2419, 0, 0.9703],
});

writeFileSync(scenePath, `${JSON.stringify(pack, null, 2)}\n`);
