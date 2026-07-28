/**
 * Rebuild scene.pack.json for go-karts.
 *
 * Hard lessons from Play screenshots:
 * - Procedural ToyKart (builtin sphere + pack mats) reads as a white blob; use garage kart_*.glb.
 * - glTF solid-color materials often shade black in ForgeaX; embed explicit PBR mats from col_* names.
 * - Keep asphalt/sidewalk glTF mats (textured — those work).
 * - Drop emissive boost pads (engine shows them as cyan slabs).
 */
import { readFileSync, writeFileSync } from 'fs';

const ASSETS =
  '/Users/you/Desktop/forgeax/forgeax-studio/.forgeax/games/go-karts/assets';
const SCENE_GUID = '8e21f04f-e29b-464b-8b6f-2a001f4f18ad';

const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';
const MAT_GRASS = 'b1a11e00-0001-4000-8000-000000000001';
const MAT_SKY = 'b1a11e00-0001-4000-8000-000000000002';

/** Mesh +Z → ForgeaX drive −Z. */
const MESH_PLUS_Z_TO_FORGEAX_YAW = Math.PI;
/**
 * Seat in kart_base visual local space (feet-at-origin pet).
 * Garage shell bbox Y≈[-0.46,0.46] — keep seat inside cockpit, not on roof.
 */
const PET_SEAT = [0, 0.1, 0.08];
const PET_TARGET_H = 0.72;

function parseCol(name) {
  const m = /^col_([0-9.]+),([0-9.]+),([0-9.]+)\|e(\d+)$/.exec(name);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), e: Number(m[4]) };
}

/** mid_* that keep glTF materials because postprocess injects PNG textures. */
function isTexturedMid(name) {
  if (!name?.startsWith('mid_')) return false;
  return (
    name.startsWith('mid_sign_') ||
    name.startsWith('mid_awning_') ||
    name.startsWith('mid_banner_') ||
    name.startsWith('mid_billboard_') ||
    name === 'mid_window_grid' ||
    name === 'mid_mall_floor' ||
    name === 'mid_mall_wood' ||
    name === 'mid_mall_concrete' ||
    name === 'mid_mall_view'
  );
}

/** Fallback pack-PBR colors for untextured mid_* (ForgeaX shades raw glTF mid near-black). */
function midSolidColor(name) {
  const table = {
    mid_itembox_wood: [0.77, 0.54, 0.32, 0.7],
    mid_itembox_q: [1.0, 0.82, 0.24, 0.4],
    mid_boost_pad: [1.0, 0.82, 0.24, 0.55],
    mid_boost_arrow: [1.0, 0.54, 0.24, 0.5],
    mid_pond_water: [0.37, 0.72, 0.85, 0.35],
    mid_china_apron: [0.81, 0.78, 0.72, 0.85],
    mid_lantern: [0.88, 0.21, 0.16, 0.5],
    mid_bridge_blue: [0.25, 0.45, 0.78, 0.55],
    mid_bridge_dark: [0.18, 0.22, 0.3, 0.7],
    mid_bridge_yellow: [1.0, 0.82, 0.24, 0.55],
    mid_city_rail: [0.99, 0.98, 0.95, 0.5],
    mid_city_rail_post: [0.3, 0.56, 0.84, 0.55],
    mid_planter_pot: [0.99, 0.97, 0.93, 0.6],
    mid_planter_rim: [1.0, 0.7, 0.36, 0.6],
    mid_mall_ceil: [0.95, 0.92, 0.85, 0.9],
    mid_mall_skirt: [0.36, 0.33, 0.31, 0.8],
    mid_mall_shopwood: [0.66, 0.45, 0.29, 0.7],
    mid_mall_shopwin: [1.0, 0.95, 0.85, 0.4],
    mid_mall_beam: [0.72, 0.54, 0.35, 0.6],
    mid_mall_strip: [1.0, 0.94, 0.82, 0.5],
    mid_mall_portal: [0.79, 0.56, 0.37, 0.55],
  };
  return table[name] ?? null;
}

function keepTrackPart(name) {
  if (!name) return false;
  if (name === 'asphalt' || name === 'sidewalk') return true;
  if (name.startsWith('mid_')) return true;
  const c = parseCol(name);
  if (!c) return name === 'grass' || name === 'wood';
  // Only drop legacy cyan emissive boost pads — keep blue glass / towers
  if (c.e === 1 && c.b > 0.7 && c.g > 0.5 && c.r < 0.2) return false;
  if (c.r < 0.12 && c.g > 0.55 && c.b > 0.85 && c.e === 1) return false;
  return true;
}

function makeSolidMat(guid, r, g, b, roughness = 0.75) {
  return {
    guid,
    kind: 'material',
    payload: {
      kind: 'material',
      passes: [
        {
          name: 'Forward',
          shader: 'forgeax::default-standard-pbr',
          tags: { LightMode: 'Forward' },
          queue: 2000,
        },
        {
          name: 'ShadowCaster',
          shader: 'forgeax::default-shadow-caster',
          tags: { LightMode: 'ShadowCaster' },
          passKind: 'shadow-caster',
        },
      ],
      // ForgeaX PBR expects RGB (3), not RGBA
      paramValues: {
        baseColor: [r, g, b],
        metallic: 0,
        roughness,
      },
    },
    refs: [],
  };
}

const raceMeta = JSON.parse(readFileSync(`${ASSETS}/race_track.glb.meta.json`, 'utf8'));
const landmarks = JSON.parse(readFileSync(`${ASSETS}/track-landmarks.json`, 'utf8'));
const pairs = JSON.parse(readFileSync(`${ASSETS}/race-pairs.json`, 'utf8'));
const groundSkyMats = JSON.parse(
  readFileSync(new URL('./ground-sky-mats.json', import.meta.url), 'utf8'),
);

const raceMeshes = raceMeta.subAssets
  .filter((s) => s.kind === 'mesh')
  .sort((a, b) => a.sourceIndex - b.sourceIndex);
const raceMats = raceMeta.subAssets
  .filter((s) => s.kind === 'material')
  .sort((a, b) => a.sourceIndex - b.sourceIndex);

if (raceMeshes.length !== raceMats.length) {
  throw new Error(`mesh/mat count mismatch ${raceMeshes.length} vs ${raceMats.length}`);
}

const props = {
  kart_base: {
    mesh: '019f83e3-bd53-7fce-b38c-13e9619d8b8d',
    mat: '019f83e3-bd53-7fce-b38c-13eac1c2376e',
  },
  kart_duck: {
    mesh: '019f83e3-bdfd-7017-afc4-8262398a645b',
    mat: '019f83e3-bdfe-7022-b2bb-a2b7057690ff',
  },
  kart_panda: {
    mesh: '019f83e3-be91-786b-8ad2-257982d3e245',
    mat: '019f83e3-be91-786b-8ad2-257aafe00000',
  },
  prop_barrier: {
    mesh: '019f83e3-b7fc-7f58-82ed-c6503b82a085',
    mat: '019f83e3-b7fc-7f58-82ed-c651a3d5c893',
  },
  prop_bench: {
    mesh: '019f83e3-b88c-75bc-89d2-a09e1feb2174',
    mat: '019f83e3-b88c-75bc-89d2-a09f020edc21',
  },
  prop_bridge: {
    mesh: '019f83e3-b907-7da4-b374-d2a2a25f3237',
    mat: '019f83e3-b907-7da4-b374-d2a3edd55127',
  },
  prop_clocktower: {
    mesh: '019f83e3-b986-7339-a337-5c28d9aae173',
    mat: '019f83e3-b986-7339-a337-5c29a96cd005',
  },
  prop_drum: {
    mesh: '019f83e3-ba14-7577-9790-310419b5b575',
    mat: '019f83e3-ba15-79e1-955f-6ba35ae03e3f',
  },
  prop_lamp: {
    mesh: '019f83e3-ba92-7d08-8c7a-3a21903b93ce',
    mat: '019f83e3-ba92-7d08-8c7a-3a22d20bb57d',
  },
  prop_robot: {
    mesh: '019f83e3-bb43-723a-8c0e-68bdd687d19b',
    mat: '019f83e3-bb43-723a-8c0e-68beb73d22e4',
  },
  prop_shop: {
    mesh: '019f83e3-bbce-7ead-8ab6-aaa60056c997',
    mat: '019f83e3-bbce-7ead-8ab6-aaa77fe9c8be',
  },
  prop_tower: {
    mesh: '019f83e3-bc51-7419-b7d9-9407785cb297',
    mat: '019f83e3-bc51-7419-b7d9-940898a2bcc8',
  },
  prop_tree: {
    mesh: '019f83e3-bcc0-7638-a892-e5949c19f3e3',
    mat: '019f83e3-bcc0-7638-a892-e595bd02c443',
  },
  pet_corgi: {
    mesh: '019f8899-a8fd-7e94-9c3a-7fa2cab06e4d',
    mat: '019f8899-a8fe-792a-af94-ea4beeca5ff0',
  },
  pet_duck: {
    mesh: '019f889e-a0f3-79ab-9629-90b604544ed3',
    mat: '019f889e-a0f4-7636-bc8c-9860c9898d9f',
  },
  pet_panda: {
    mesh: '019f889e-a38d-71ed-bf3c-2443c122806c',
    mat: '019f889e-a38e-7841-91b4-399542049378',
  },
};

const refs = [];
const refIndex = (guid) => {
  let i = refs.indexOf(guid);
  if (i < 0) {
    i = refs.length;
    refs.push(guid);
  }
  return i;
};

function yawQuat(yaw) {
  const half = yaw * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

const solidMats = [];
const solidGuidByKey = new Map();
function solidMatGuid(r, g, b, roughness = 0.75) {
  const key = `${r.toFixed(3)},${g.toFixed(3)},${b.toFixed(3)}|${roughness}`;
  let guid = solidGuidByKey.get(key);
  if (guid) return guid;
  const idx = solidMats.length;
  guid = `b1a11e00-0003-4000-8000-${String(idx).padStart(12, '0')}`;
  solidGuidByKey.set(key, guid);
  solidMats.push(makeSolidMat(guid, r, g, b, roughness));
  return guid;
}

const entities = [];
let localId = 0;
const nextLocalId = () => localId++;
let keptRace = 0;
let droppedRace = 0;
let remappedSolid = 0;

for (let i = 0; i < raceMeshes.length; i++) {
  const pair = pairs.find((p) => p.meshIndex === i);
  const partName = pair?.name ?? `part_${i}`;
  if (!keepTrackPart(partName)) {
    droppedRace += 1;
    continue;
  }
  keptRace += 1;

  let matGuid = raceMats[i].guid;
  // Textured mid_* keep glTF (PNG inject). Untextured mid_* → pack PBR or they shade black.
  // Anonymous col_* / grass / wood also solid-remap.
  if (partName === 'asphalt' || partName === 'sidewalk' || isTexturedMid(partName)) {
    // keep glTF mat
  } else if (partName.startsWith('mid_')) {
    const solid = midSolidColor(partName);
    if (solid) {
      matGuid = solidMatGuid(solid[0], solid[1], solid[2], solid[3] ?? 0.75);
      remappedSolid += 1;
    } else {
      // Unknown untextured mid — warm stone fallback (never leave raw glTF mid)
      matGuid = solidMatGuid(0.85, 0.8, 0.72, 0.75);
      remappedSolid += 1;
    }
  } else if (partName !== 'asphalt' && partName !== 'sidewalk') {
    const c = parseCol(partName);
    if (c) {
      matGuid = solidMatGuid(c.r, c.g, c.b, c.g > 0.5 && c.g > c.r ? 0.92 : 0.72);
      remappedSolid += 1;
    } else if (partName === 'grass') {
      matGuid = solidMatGuid(0.45, 0.72, 0.32, 0.95);
      remappedSolid += 1;
    } else if (partName === 'wood') {
      matGuid = solidMatGuid(0.72, 0.55, 0.32, 0.85);
      remappedSolid += 1;
    }
  }

  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `Race_${partName}` },
      Transform: { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
      MeshFilter: { assetHandle: refIndex(raceMeshes[i].guid) },
      MeshRenderer: { materials: [refIndex(matGuid)] },
    },
  });
}

// Always keep an authored grass slab under the world (baked lawn can z-fight / miss).
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'Ground' },
    Transform: { pos: [0, -0.35, 0], quat: [0, 0, 0, 1], scale: [560, 0.4, 560] },
    MeshFilter: { assetHandle: refIndex(CUBE) },
    MeshRenderer: { materials: [refIndex(MAT_GRASS)] },
  },
});

entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'SkyDome' },
    Transform: { pos: [0, 40, 0], quat: [0, 0, 0, 1], scale: [-320, 320, -320] },
    MeshFilter: { assetHandle: refIndex(SPHERE) },
    MeshRenderer: { materials: [refIndex(MAT_SKY)] },
  },
});
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'Skylight' },
    // Fake hemi: cool sky bias (engine has no Fog; far skyline is desaturated instead)
    Skylight: { color: [0.72, 0.86, 1.0], intensity: 1.05 },
  },
});
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'Sun' },
    Transform: { pos: [120, 115, 68], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
    DirectionalLight: {
      direction: [-0.38, -0.85, -0.28],
      color: [1.0, 0.93, 0.78],
      intensity: 2.45,
      castShadow: true,
      mapSize: 2048,
      shadowDistance: 160,
    },
  },
});

const spawn = landmarks.spawn;
const rootYaw = spawn.heading + Math.PI;
const kartScale = 1.16;
const kartMinY = -0.46;

function placeKartHierarchy(name, kartKey, petKey, petMaxDim, pos, yaw) {
  const rootId = nextLocalId();
  entities.push({
    localId: rootId,
    components: {
      Name: { value: name },
      Transform: {
        pos: [pos.x, pos.y, pos.z],
        quat: yawQuat(yaw),
        scale: [1, 1, 1],
      },
    },
  });
  const asset = props[kartKey];
  const visualId = nextLocalId();
  entities.push({
    localId: visualId,
    components: {
      Name: { value: `${name}Visual` },
      Transform: {
        pos: [0, -kartMinY * kartScale, 0],
        quat: yawQuat(MESH_PLUS_Z_TO_FORGEAX_YAW),
        scale: [kartScale, kartScale, kartScale],
      },
      MeshFilter: { assetHandle: refIndex(asset.mesh) },
      MeshRenderer: { materials: [refIndex(asset.mat)] },
      ChildOf: { parent: rootId },
    },
  });
  const pet = props[petKey];
  const petS = PET_TARGET_H / petMaxDim;
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: name === 'KartBase' ? 'PetDriver' : `${name}Driver` },
      Transform: {
        pos: [...PET_SEAT],
        quat: yawQuat(0),
        scale: [petS, petS, petS],
      },
      MeshFilter: { assetHandle: refIndex(pet.mesh) },
      MeshRenderer: { materials: [refIndex(pet.mat)] },
      ChildOf: { parent: visualId },
    },
  });
  return rootId;
}

const kartRootId = placeKartHierarchy(
  'KartBase',
  'kart_base',
  'pet_corgi',
  0.912,
  { x: spawn.x, y: spawn.y, z: spawn.z },
  rootYaw,
);
placeKartHierarchy(
  'KartDuck',
  'kart_duck',
  'pet_duck',
  1.119,
  { x: spawn.x - 8.4, y: spawn.y, z: spawn.z - 8 },
  rootYaw,
);
placeKartHierarchy(
  'KartPanda',
  'kart_panda',
  'pet_panda',
  1.087,
  { x: spawn.x + 8.4, y: spawn.y, z: spawn.z - 9 },
  rootYaw,
);

const PROP_BOUNDS = {
  prop_barrier: { h: 1.387, minY: -0.694, maxDim: 1.91 },
  prop_bench: { h: 1.441, minY: -0.721, maxDim: 1.9 },
  prop_bridge: { h: 0.62, minY: -0.311, maxDim: 1.9 },
  prop_clocktower: { h: 1.898, minY: -0.951, maxDim: 1.898 },
  prop_drum: { h: 1.899, minY: -0.95, maxDim: 1.899 },
  prop_lamp: { h: 1.899, minY: -0.951, maxDim: 1.899 },
  prop_robot: { h: 1.899, minY: -0.951, maxDim: 1.899 },
  prop_shop: { h: 1.899, minY: -0.951, maxDim: 1.899 },
  prop_tower: { h: 1.898, minY: -0.951, maxDim: 1.898 },
  prop_tree: { h: 1.899, minY: -0.951, maxDim: 1.899 },
};

function placeProp(name, assetKey, placement) {
  const asset = props[assetKey];
  const bounds = PROP_BOUNDS[assetKey];
  const targetH = placement.targetH ?? bounds.h;
  const s = targetH / bounds.maxDim;
  const groundedY = placement.y - bounds.minY * s;
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: name },
      Transform: {
        pos: [placement.x, groundedY, placement.z],
        quat: yawQuat(placement.yaw ?? 0),
        scale: [s, s, s],
      },
      MeshFilter: { assetHandle: refIndex(asset.mesh) },
      MeshRenderer: { materials: [refIndex(asset.mat)] },
    },
  });
}

const placementMap = {
  PropClocktower: 'prop_clocktower',
  PropBridge: 'prop_bridge',
  PropShop0: 'prop_shop',
  PropShop1: 'prop_shop',
  PropShop2: 'prop_shop',
  PropDrum: 'prop_drum',
  PropBench0: 'prop_bench',
  PropBench1: 'prop_bench',
  PropBench2: 'prop_bench',
  PropTower0: 'prop_tower',
  PropTower1: 'prop_tower',
  PropTower2: 'prop_tower',
  PropTower3: 'prop_tower',
  PropTower4: 'prop_tower',
  PropTower5: 'prop_tower',
  PropTower6: 'prop_tower',
  PropTower7: 'prop_tower',
  PropTree0: 'prop_tree',
  PropTree1: 'prop_tree',
  PropTree2: 'prop_tree',
  PropTree3: 'prop_tree',
  PropTree4: 'prop_tree',
  PropTree5: 'prop_tree',
  PropRobot0: 'prop_robot',
  PropRobot1: 'prop_robot',
  PropBarrier0: 'prop_barrier',
};
for (let i = 0; i < 14; i++) placementMap[`PropLamp${i}`] = 'prop_lamp';

for (const [name, key] of Object.entries(placementMap)) {
  const p = landmarks.placements[name];
  if (!p) continue;
  placeProp(name, key, p);
}

// Collectible coins — separate entities (baked mid_coin merge can't hide individuals)
const MAT_COIN = solidMatGuid(1.0, 0.81, 0.23, 0.35);
const coinList = Array.isArray(landmarks.coins) ? landmarks.coins : [];
for (let i = 0; i < coinList.length; i++) {
  const c = coinList[i];
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `Coin_${i}` },
      Transform: {
        pos: [c.x, c.y, c.z],
        quat: yawQuat(c.yaw ?? 0),
        // Flattened sphere ≈ gold ring silhouette at distance
        scale: [0.55, 0.55, 0.18],
      },
      MeshFilter: { assetHandle: refIndex(SPHERE) },
      MeshRenderer: { materials: [refIndex(MAT_COIN)] },
    },
  });
}

const pack = {
  schemaVersion: '1.0.0',
  kind: 'internal-text-package',
  assets: [
    {
      guid: SCENE_GUID,
      kind: 'scene',
      payload: { kind: 'scene', entities, mounts: [] },
      refs,
    },
    ...groundSkyMats,
    ...solidMats,
  ],
};

writeFileSync(`${ASSETS}/scene.pack.json`, JSON.stringify(pack, null, 2));
console.log('entities', entities.length, 'refs', refs.length, 'kartRoot', kartRootId);
console.log('race kept', keptRace, 'dropped', droppedRace, 'solidRemap', remappedSolid, 'solidMats', solidMats.length);
console.log('Pet seat', PET_SEAT, 'kart', 'garage glb');
console.log(
  'sample race mats',
  entities
    .filter((e) => e.components.Name.value.startsWith('Race_col'))
    .slice(0, 3)
    .map((e) => ({
      n: e.components.Name.value,
      mat: refs[e.components.MeshRenderer.materials[0]],
    })),
);
