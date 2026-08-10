import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const gameRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenePath = resolve(gameRoot, 'assets/scene.pack.json');
const pack = JSON.parse(readFileSync(scenePath, 'utf8'));
const scene = pack.assets.find((asset) => asset.kind === 'scene' && asset.guid === '76a15ebd-0d8c-4a0e-ad3f-e27d553f667d');
if (!scene) throw new Error('Aetherfall main scene missing');

const entities = new Map(
  scene.payload.entities
    .filter((entity) => entity.components?.Name?.value)
    .map((entity) => [entity.components.Name.value, entity]),
);

function entity(name) {
  const found = entities.get(name);
  if (!found) throw new Error(`Missing authored entity: ${name}`);
  return found;
}

function transform(name, values) {
  const target = entity(name).components.Transform;
  Object.assign(target, values);
}

function material(name, handle) {
  entity(name).components.MeshRenderer.materials = [handle];
}

function hide(name) {
  transform(name, { scale: [0, 0, 0] });
}

// Establish a grounded, asymmetrical spawn composition without moving mission
// names or changing interaction semantics.
transform('Ground', {
  pos: [0, -0.1, 0],
  quat: [0, 0.0349, 0, 0.9994],
  scale: [10.8, 0.2, 8.8],
});
material('Ground', 17);
transform('SanctuaryIslandShelf', {
  pos: [0, -0.48, 0],
  quat: [0, -0.0436, 0, 0.999],
  scale: [11.6, 0.9, 9.4],
});
transform('SanctuaryIslandCore', {
  pos: [0.8, -2.25, -0.7],
  quat: [0, 0.0698, 0, 0.9976],
  scale: [8.4, 3.5, 6.8],
});

// The sanctuary return stays at its tested x/z anchor, but becomes an inset
// ground rune instead of a camera-blocking pillar.
transform('SanctuaryDais', { pos: [0, 0.04, 3.1], scale: [3.8, 0.12, 2.7] });
material('SanctuaryDais', 17);
transform('SanctuaryReturn', { pos: [0, 0.1, 3.1], scale: [0.62, 0.12, 0.62] });
transform('SanctuaryReturnRing', { pos: [0, 0.07, 3.1], scale: [1.8, 0.05, 1.8] });
material('SanctuaryReturnRing', 1);

// Separate the memory shrine, beacon and observatory silhouettes so they read
// as a route through depth rather than one vertical primitive stack.
transform('MemoryShrine_C', { pos: [-2.6, 0.32, -11.2] });
transform('ShrineCObelisk', { pos: [-2.6, 1.9, -11.2], scale: [0.3, 3.2, 0.3] });
transform('ShrineCMemoryCore', { pos: [-2.6, 3.65, -11.2], scale: [0.48, 0.48, 0.48] });
transform('ShrineCWaystone', { pos: [-1.55, 0.72, -8.55] });

for (const name of ['LastLightBeacon', 'LastLightBeaconCrown', 'BeaconHaloLower', 'BeaconHaloUpper']) {
  const target = entity(name).components.Transform;
  target.pos[0] = 1.8;
  target.pos[2] = -16.8;
}
transform('LastLightBeacon', { pos: [1.8, 2.45, -16.8], scale: [0.38, 4.4, 0.38] });
material('LastLightBeacon', 20);
transform('LastLightBeaconCrown', { pos: [1.8, 4.95, -16.8], scale: [0.62, 0.62, 0.62] });
transform('BeaconHaloLower', { pos: [1.8, 2.0, -16.8], scale: [0.92, 0.1, 0.92] });
transform('BeaconHaloUpper', { pos: [1.8, 3.85, -16.8], scale: [0.7, 0.08, 0.7] });
transform('AncientObservatoryDome', { pos: [-0.8, 1.1, -18.2], scale: [3.4, 1.1, 2.7] });
transform('ObservatoryAperture', { pos: [-0.8, 2.7, -17.5], scale: [0.8, 0.8, 0.8] });

// Retain a single readable ruin silhouette and remove the prototype-like sky
// crosses from the normal vista.
for (const name of [
  'FloatingRuinWest', 'FloatingRuinWestSpire', 'FloatingRuinEast', 'FloatingRuinEastSpire',
  'DistantIslandCenter', 'DistantIslandBeacon', 'StormShardWest', 'StormShardEast',
  'HangingShardWest', 'HangingShardEast', 'SkylineRuinWest', 'SkylineRuinEast',
]) hide(name);
transform('RuinArchWest', { pos: [-9.2, 1.4, -9.5], scale: [0.42, 2.8, 0.42] });
transform('RuinArchWestR', { pos: [-6.9, 1.4, -9.5], scale: [0.42, 2.8, 0.42] });
transform('RuinArchWestCap', { pos: [-8.05, 2.8, -9.5], scale: [1.55, 0.34, 0.42] });

// Break the ruler-straight route while preserving walkable overlap.
transform('StonePath01', { pos: [-0.45, 0.11, -1.35], quat: [0, 0.061, 0, 0.9981], scale: [1.15, 0.1, 1.15] });
transform('StonePath02', { pos: [0.28, 0.12, -2.75], quat: [0, -0.0785, 0, 0.9969], scale: [1.05, 0.11, 0.9] });
transform('StonePath03', { pos: [-0.22, 0.12, -3.85], quat: [0, 0.0436, 0, 0.999], scale: [0.88, 0.11, 0.58] });
transform('StormBridgeDeckB', { pos: [0.18, 0.05, -7.1], quat: [0, -0.0262, 0, 0.9997] });
transform('StormBridgeDeckC', { pos: [-0.18, -0.1, -9.5], quat: [0, 0.0349, 0, 0.9994] });

// Reduce toy-like shrine proportions while keeping each core legible.
for (const name of ['MemoryShrine_A', 'MemoryShrine_B', 'MemoryShrine_C']) material(name, 17);
transform('ShrineAMemoryCore', { scale: [0.42, 0.42, 0.42] });
transform('ShrineBMemoryCore', { scale: [0.44, 0.44, 0.44] });
transform('ShrineAArchL', { scale: [0.24, 2.25, 0.24] });
transform('ShrineAArchR', { scale: [0.24, 2.25, 0.24] });
transform('ShrineBSpireL', { scale: [0.22, 2.55, 0.22] });
transform('ShrineBSpireR', { scale: [0.22, 2.55, 0.22] });
for (const name of [
  'ShrineAArchL', 'ShrineAArchR', 'ShrineBSpireL', 'ShrineBSpireR', 'ShrineCObelisk',
  'ShrineAWaystone', 'ShrineBWaystone', 'ShrineCWaystone', 'PathMarkerWest', 'PathMarkerEast',
]) material(name, 20);

const materialValues = new Map([
  ['a151d8ba-11c3-4d26-a5f8-724f4d830002', { baseColor: [0.24, 0.22, 0.19, 1], metallic: 0.02, roughness: 0.9 }],
  ['a151d8ba-11c3-4d26-a5f8-724f4d830003', { baseColor: [0.07, 0.34, 0.18, 1], metallic: 0, roughness: 0.72 }],
  ['a151d8ba-11c3-4d26-a5f8-724f4d830001', { baseColor: [0.12, 0.15, 0.17, 1], metallic: 0.04, roughness: 0.92 }],
  ['a151d8ba-11c3-4d26-a5f8-724f4d830007', { baseColor: [0.12, 0.16, 0.19, 1], metallic: 0.42, roughness: 0.58 }],
  ['a151d8ba-11c3-4d26-a5f8-724f4d830004', { baseColor: [0.06, 0.32, 0.55, 1], metallic: 0.12, roughness: 0.42, emissive: [0.02, 0.18, 0.42], emissiveIntensity: 1.6 }],
  ['a151d8ba-11c3-4d26-a5f8-724f4d830005', { baseColor: [0.55, 0.08, 0.25, 1], metallic: 0.1, roughness: 0.44, emissive: [0.38, 0.02, 0.12], emissiveIntensity: 1.5 }],
  ['a151d8ba-11c3-4d26-a5f8-724f4d830006', { baseColor: [0.72, 0.27, 0.04, 1], metallic: 0.16, roughness: 0.4, emissive: [0.48, 0.12, 0.01], emissiveIntensity: 1.7 }],
  ['a151d8ba-11c3-4d26-a5f8-724f4d830008', { baseColor: [0.62, 0.34, 0.07, 1], metallic: 0.48, roughness: 0.38, emissive: [0.42, 0.16, 0.015], emissiveIntensity: 2.2 }],
  ['3c4223ab-1f84-4ca9-ae95-919716f0d20d', { baseColor: [0.09, 0.2, 0.12, 1], metallic: 0, roughness: 0.94 }],
  ['d523519a-fa1b-45f0-b5e0-8589347a751f', { baseColor: [0.2, 0.3, 0.17, 1], metallic: 0, roughness: 0.96 }],
]);
for (const asset of pack.assets) {
  const values = materialValues.get(asset.guid);
  if (values) Object.assign(asset.payload.values, values);
}

// Softer directional key with enough cool ambient fill to avoid black sphere
// hemispheres; runtime point light is tuned separately in gameplay-session.
Object.assign(entity('Sun').components.DirectionalLight, {
  direction: [-0.32, -1, 0.18],
  color: [1, 0.97, 0.91],
  intensity: 1.55,
});
Object.assign(entity('Skylight').components.Skylight, {
  color: [0.72, 0.84, 1],
  intensity: 0.48,
});

writeFileSync(scenePath, `${JSON.stringify(pack, null, 2)}\n`);
