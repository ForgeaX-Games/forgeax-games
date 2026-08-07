import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scene = JSON.parse(readFileSync(resolve(root, 'assets/scenes/sundering-reach.pack.json'), 'utf8')).assets[0];
const entities = scene.payload.entities;
const refs = scene.refs;
const names = new Set();
const errors = [];
const worldMeshPattern = /^5c4c2f30-955e-4ae6-b864-e001000000(0[1-9]|10)$/;

for (const entity of entities) {
  const name = entity.components.Name?.value;
  if (!name) continue;
  if (names.has(name)) errors.push(`duplicate entity name: ${name}`);
  names.add(name);
}

const story = entities.filter((entity) => /^Story/.test(entity.components.Name?.value ?? ''));
const colliders = entities.filter((entity) => entity.components.Collider && entity.components.MeshFilter);
const particlePlayers = entities.filter((entity) => entity.components.ParticleEffectPlayer);
const cliffs = entities.filter((entity) => /^Cliff/.test(entity.components.Name?.value ?? ''));
const revision = entities.find((entity) => /^WorldAssetBindingOffset_/.test(entity.components.Name?.value ?? ''));
const worldMeshEntities = entities.filter((entity) => {
  const handle = entity.components.MeshFilter?.assetHandle;
  return Number.isInteger(handle) && worldMeshPattern.test(refs[handle] ?? '');
});
const licensedRockEntities = entities.filter((entity) => {
  const handle = entity.components.MeshFilter?.assetHandle;
  return refs[handle] === '5c4c2f30-955e-4ae6-b864-e00100000010';
});
const licensedRockMaterialEntities = entities.filter((entity) => {
  const handle = entity.components.MeshRenderer?.materials?.[0];
  return refs[handle] === '5c4c2f30-955e-4ae6-b864-e10100000001';
});
const ruinMasonryEntities = entities.filter((entity) => {
  const handle = entity.components.MeshRenderer?.materials?.[0];
  return refs[handle] === '5c4c2f30-955e-4ae6-b864-e10100000002';
});

if (story.length !== 41) errors.push(`expected 41 story entities, found ${story.length}`);
if (colliders.length !== 64) errors.push(`expected 64 persistent static colliders, found ${colliders.length}`);
if (particlePlayers.length !== 3) errors.push(`expected 3 native VFX players, found ${particlePlayers.length}`);
if (cliffs.some((entity) => !entity.components.MeshRenderer?.materials?.length)) errors.push('one or more cliffs remain invisible');
if (story.some((entity) => !entity.components.MeshFilter || !entity.components.MeshRenderer?.materials?.length)) errors.push('one or more story entities remain unbound');
if (story.some((entity) => !worldMeshPattern.test(refs[entity.components.MeshFilter?.assetHandle] ?? ''))) errors.push('one or more story entities still use a placeholder mesh');
if (story.some((entity) => entity.components.Visibility?.state === 1)) errors.push('one or more fully authored story entities remain hidden');
if (!revision || Number(revision.components.Name.value.split('_').at(-1)) < 492) errors.push('world binding revision does not prove all 492 fields');
if (worldMeshEntities.length < 220) errors.push(`expected at least 220 custom world mesh assignments, found ${worldMeshEntities.length}`);
if (licensedRockEntities.length < 60) errors.push(`expected at least 60 licensed rock assignments, found ${licensedRockEntities.length}`);
if (licensedRockMaterialEntities.length < 60) errors.push(`expected at least 60 textured rock material assignments, found ${licensedRockMaterialEntities.length}`);
if (ruinMasonryEntities.length < 20) errors.push(`expected at least 20 textured ruin assignments, found ${ruinMasonryEntities.length}`);
for (let index = 1; index <= 10; index += 1) {
  const guid = `5c4c2f30-955e-4ae6-b864-e001${String(index).padStart(8, '0')}`;
  if (!refs.includes(guid)) errors.push(`scene refs missing ${guid}`);
}

if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, errors, entities: entities.length, story: story.length, colliders: colliders.length, particlePlayers: particlePlayers.length }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  entities: entities.length,
  story: story.length,
  colliders: colliders.length,
  particlePlayers: particlePlayers.length,
  worldMeshEntities: worldMeshEntities.length,
  licensedRockEntities: licensedRockEntities.length,
  licensedRockMaterialEntities: licensedRockMaterialEntities.length,
  ruinMasonryEntities: ruinMasonryEntities.length,
  revision: revision.components.Name.value,
}));
