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
import { fileURLToPath } from 'url';

const ASSETS = fileURLToPath(new URL('../assets', import.meta.url));
const SCENE_GUID = '8e21f04f-e29b-464b-8b6f-2a001f4f18ad';

const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';
const MAT_GRASS = 'b1a11e00-0001-4000-8000-000000000001';
const MAT_SKY = 'b1a11e00-0001-4000-8000-000000000002';
/** Textured lawn (bake-grass-lawn.mjs) — hellforge-style REPEAT sampler. */
const MESH_GRASS_LAWN = 'b1a11e00-0010-4000-8000-000000000001';
const MAT_GRASS_LAWN = 'b1a11e00-0010-4000-8000-000000000002';

/** Mesh +Z → ForgeaX drive −Z. */
const MESH_PLUS_Z_TO_FORGEAX_YAW = Math.PI;
/**
 * Seat in kart_base visual local space (feet-at-origin pet).
 * Garage shell bbox Y≈[-0.46,0.46] — keep seat inside cockpit, not on roof.
 */
const PET_SEAT = [0, 0.1, 0.08];
/** Fallback pet height for the (hidden) KartBase placeholder driver. */
const PET_TARGET_H = 0.72;
/**
 * AI pets must read near the player dog (~1.35 world). Pet scale is local under
 * Visual, so world height = petWorldH (see placeKartHierarchy).
 */
const AI_PET_WORLD_H = 1.28;

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
    // Pack PBR — never keep glTF mid_grass (white factor + unbound tex = white film).
    // Richer than original grassDay 0xa8d878 — ForgeaX lighting reads greyer.
    mid_grass: [0.52, 0.86, 0.28, 0.9],
    mid_itembox_wood: [0.77, 0.54, 0.32, 0.82],
    mid_itembox_q: [1.0, 0.82, 0.24, 0.55],
    mid_boost_pad: [1.0, 0.9, 0.2, 0.55],
    mid_boost_arrow: [1.0, 0.72, 0.12, 0.48],
    mid_pond_water: [0.37, 0.72, 0.85, 0.35],
    mid_china_apron: [0.81, 0.78, 0.72, 0.88],
    mid_lantern: [0.88, 0.21, 0.16, 0.7],
    mid_bridge_blue: [0.25, 0.45, 0.78, 0.72],
    mid_bridge_dark: [0.18, 0.22, 0.3, 0.85],
    mid_bridge_yellow: [1.0, 0.82, 0.24, 0.7],
    mid_city_rail: [0.99, 0.98, 0.95, 0.72],
    mid_city_rail_post: [0.3, 0.56, 0.84, 0.72],
    mid_planter_pot: [0.99, 0.97, 0.93, 0.78],
    mid_planter_rim: [1.0, 0.7, 0.36, 0.75],
    mid_mall_ceil: [0.95, 0.92, 0.85, 0.9],
    mid_mall_skirt: [0.36, 0.33, 0.31, 0.88],
    mid_mall_shopwood: [0.66, 0.45, 0.29, 0.85],
    mid_mall_shopwin: [1.0, 0.95, 0.85, 0.55],
    mid_mall_beam: [0.72, 0.54, 0.35, 0.78],
    mid_mall_strip: [1.0, 0.94, 0.82, 0.7],
    mid_mall_portal: [0.79, 0.56, 0.37, 0.75],
  };
  return table[name] ?? null;
}

function keepTrackPart(name) {
  if (!name) return false;
  // Item boxes are rebuilt below as independent entities for hide/respawn.
  if (name.startsWith('mid_itembox_')) return false;
  // Drop race-track lawn slabs — they are solid green and hide grass_lawn.glb.
  // (unpatch renamed mid_grass → col_0.390,0.685,0.190|e0)
  if (name === 'mid_grass' || name === 'col_0.390,0.685,0.190|e0' || name === 'grass') {
    return false;
  }
  if (name === 'asphalt' || name === 'sidewalk') return true;
  if (name.startsWith('mid_')) return true;
  const c = parseCol(name);
  if (!c) return name === 'wood';
  // Only drop legacy cyan emissive boost pads — keep blue glass / towers
  if (c.e === 1 && c.b > 0.7 && c.g > 0.5 && c.r < 0.2) return false;
  if (c.r < 0.12 && c.g > 0.55 && c.b > 0.85 && c.e === 1) return false;
  return true;
}

/** Boost chroma toward cartoon toy albedos (keeps luminance roughly stable). */
function punchColor(r, g, b, amount = 1.55) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    Math.min(1, Math.max(0, l + (r - l) * amount)),
    Math.min(1, Math.max(0, l + (g - l) * amount)),
    Math.min(1, Math.max(0, l + (b - l) * amount)),
  ];
}

function makeSolidMat(guid, r, g, b, roughness = 0.72) {
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
      // Rich cartoon albedos + mid-matte roughness so sun shading still reads.
      paramValues: {
        baseColor: [r, g, b],
        metallic: 0,
        roughness,
      },
    },
    refs: [],
  };
}

function makeUnlitMat(guid, r, g, b) {
  return {
    guid,
    kind: 'material',
    payload: {
      kind: 'material',
      passes: [
        {
          name: 'Forward',
          shader: 'forgeax::default-unlit',
          tags: { LightMode: 'Forward' },
          queue: 2000,
        },
      ],
      paramValues: {
        baseColor: [r, g, b],
        metallic: 0,
        roughness: 1,
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
    mesh: '019f83e3-bd53-4fce-b38c-13e9619d8b8d',
    mat: '019f83e3-bd53-4fce-b38c-13eac1c2376e',
  },
  kart_duck: {
    mesh: '019f83e3-bdfd-4017-afc4-8262398a645b',
    mat: '019f83e3-bdfe-4022-b2bb-a2b7057690ff',
  },
  kart_panda: {
    mesh: '019f83e3-be91-486b-8ad2-257982d3e245',
    mat: '019f83e3-be91-486b-8ad2-257aafe00000',
  },
  prop_barrier: {
    mesh: '019f83e3-b7fc-4f58-82ed-c6503b82a085',
    mat: '019f83e3-b7fc-4f58-82ed-c651a3d5c893',
  },
  prop_bench: {
    mesh: '019f83e3-b88c-45bc-89d2-a09e1feb2174',
    mat: '019f83e3-b88c-45bc-89d2-a09f020edc21',
  },
  prop_bridge: {
    mesh: '019f83e3-b907-4da4-b374-d2a2a25f3237',
    mat: '019f83e3-b907-4da4-b374-d2a3edd55127',
  },
  prop_clocktower: {
    mesh: '019f83e3-b986-4339-a337-5c28d9aae173',
    mat: '019f83e3-b986-4339-a337-5c29a96cd005',
  },
  prop_drum: {
    mesh: '019f83e3-ba14-4577-9790-310419b5b575',
    mat: '019f83e3-ba15-49e1-955f-6ba35ae03e3f',
  },
  prop_lamp: {
    mesh: '019f83e3-ba92-4d08-8c7a-3a21903b93ce',
    mat: '019f83e3-ba92-4d08-8c7a-3a22d20bb57d',
  },
  prop_robot: {
    mesh: '019f83e3-bb43-423a-8c0e-68bdd687d19b',
    mat: '019f83e3-bb43-423a-8c0e-68beb73d22e4',
  },
  prop_shop: {
    mesh: '019f83e3-bbce-4ead-8ab6-aaa60056c997',
    mat: '019f83e3-bbce-4ead-8ab6-aaa77fe9c8be',
  },
  prop_tower: {
    mesh: '019f83e3-bc51-4419-b7d9-9407785cb297',
    mat: '019f83e3-bc51-4419-b7d9-940898a2bcc8',
  },
  prop_tree: {
    mesh: '019f83e3-bcc0-4638-a892-e5949c19f3e3',
    mat: '019f83e3-bcc0-4638-a892-e595bd02c443',
  },
  pet_corgi: {
    mesh: '019f8899-a8fd-4e94-9c3a-7fa2cab06e4d',
    mat: '019f8899-a8fe-492a-af94-ea4beeca5ff0',
  },
  pet_duck: {
    mesh: '019f889e-a0f3-49ab-9629-90b604544ed3',
    mat: '019f889e-a0f4-4636-bc8c-9860c9898d9f',
  },
  pet_panda: {
    mesh: '019f889e-a38d-41ed-bf3c-2443c122806c',
    mat: '019f889e-a38e-4841-91b4-399542049378',
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
function solidMatGuid(r, g, b, roughness = 0.72, { punch = true } = {}) {
  const [pr, pg, pb] = punch ? punchColor(r, g, b) : [r, g, b];
  const key = `${pr.toFixed(3)},${pg.toFixed(3)},${pb.toFixed(3)}|${roughness}`;
  let guid = solidGuidByKey.get(key);
  if (guid) return guid;
  const idx = solidMats.length;
  guid = `b1a11e00-0003-4000-8000-${String(idx).padStart(12, '0')}`;
  solidGuidByKey.set(key, guid);
  solidMats.push(makeSolidMat(guid, pr, pg, pb, roughness));
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
      matGuid = solidMatGuid(solid[0], solid[1], solid[2], solid[3] ?? 0.72, {
        punch: true,
      });
      remappedSolid += 1;
    } else {
      // Unknown untextured mid — warm stone fallback (never leave raw glTF mid)
      matGuid = solidMatGuid(0.98, 0.86, 0.62, 0.68);
      remappedSolid += 1;
    }
  } else if (partName !== 'asphalt' && partName !== 'sidewalk') {
    const c = parseCol(partName);
    if (c) {
      const isLawn = c.g > 0.55 && c.g > c.r * 1.2 && c.b < 0.35;
      matGuid = solidMatGuid(c.r, c.g, c.b, isLawn ? 0.88 : c.g > 0.5 && c.g > c.r ? 0.82 : 0.66, {
        punch: true,
      });
      remappedSolid += 1;
    } else if (partName === 'grass') {
      matGuid = solidMatGuid(0.48, 0.82, 0.22, 0.88, { punch: true });
      remappedSolid += 1;
    } else if (partName === 'wood') {
      matGuid = solidMatGuid(0.82, 0.52, 0.24, 0.8);
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

// Original lawn: grass_lawn.glb (tex_grass.png × #a8d878, REPEAT). Solid MAT_GRASS
// remains in the pack as a safe fallback material asset.
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'Ground' },
    Transform: { pos: [0, -0.01, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
    MeshFilter: { assetHandle: refIndex(MESH_GRASS_LAWN) },
    MeshRenderer: { materials: [refIndex(MAT_GRASS_LAWN)] },
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
// Horizon haze + soft clouds so the sky isn't a flat wash.
const MAT_HORIZON = 'b1a11e00-0001-4000-8000-000000000003';
const MAT_CLOUD = 'b1a11e00-0001-4000-8000-000000000004';
const MAT_CLOUD_SOFT = 'b1a11e00-0001-4000-8000-000000000005';
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'SkyHorizon' },
    Transform: { pos: [0, 14, 0], quat: [0, 0, 0, 1], scale: [-295, 48, -295] },
    MeshFilter: { assetHandle: refIndex(SPHERE) },
    MeshRenderer: { materials: [refIndex(MAT_HORIZON)] },
  },
});
// Soft sun disc + warm halo for a bright cartoon sky anchor.
const MAT_SUN = 'b1a11e00-0001-4000-8000-000000000006';
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'SkySunDisc' },
    Transform: { pos: [180, 110, 120], quat: [0, 0, 0, 1], scale: [18, 18, 18] },
    MeshFilter: { assetHandle: refIndex(SPHERE) },
    MeshRenderer: { materials: [refIndex(MAT_SUN)] },
  },
});
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'SkySunHalo' },
    Transform: { pos: [180, 110, 120], quat: [0, 0, 0, 1], scale: [36, 36, 36] },
    MeshFilter: { assetHandle: refIndex(SPHERE) },
    MeshRenderer: { materials: [refIndex(MAT_CLOUD_SOFT)] },
  },
});
// Distant skyline silhouettes — recording/reference reads empty without mid-far mass.
const MAT_SKYLINE = 'b1a11e00-0001-4000-8000-000000000007';
const skylineBlocks = [
  { x: -40, z: 210, sx: 18, sy: 42, sz: 14 },
  { x: -10, z: 220, sx: 14, sy: 55, sz: 12 },
  { x: 20, z: 215, sx: 22, sy: 38, sz: 16 },
  { x: 55, z: 225, sx: 12, sy: 62, sz: 12 },
  { x: 85, z: 210, sx: 20, sy: 48, sz: 14 },
  { x: 120, z: 200, sx: 16, sy: 36, sz: 12 },
  { x: -90, z: 195, sx: 24, sy: 40, sz: 16 },
  { x: -130, z: 185, sx: 18, sy: 50, sz: 14 },
  { x: 160, z: 40, sx: 14, sy: 44, sz: 18 },
  { x: 170, z: -20, sx: 16, sy: 52, sz: 14 },
  { x: 165, z: -80, sx: 12, sy: 38, sz: 16 },
  { x: -170, z: 60, sx: 18, sy: 46, sz: 14 },
  { x: -175, z: 0, sx: 14, sy: 58, sz: 12 },
  { x: -160, z: -70, sx: 20, sy: 34, sz: 16 },
];
for (let i = 0; i < skylineBlocks.length; i++) {
  const b = skylineBlocks[i];
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `Skyline_${i}` },
      Transform: {
        pos: [b.x, b.sy * 0.5 - 0.2, b.z],
        quat: [0, 0, 0, 1],
        scale: [b.sx, b.sy, b.sz],
      },
      MeshFilter: { assetHandle: refIndex(CUBE) },
      MeshRenderer: { materials: [refIndex(MAT_SKYLINE)] },
    },
  });
}
// Multi-lobe cloud clusters (reads fluffier than single ellipsoids).
const cloudClusters = [
  { x: 80, y: 58, z: -40, lobes: [[0, 0, 0, 26, 8, 18], [16, 2, -4, 18, 6, 13], [-14, 1, 6, 16, 5, 12]] },
  { x: -60, y: 64, z: 90, lobes: [[0, 0, 0, 30, 9, 20], [18, 2, 5, 20, 7, 14], [-12, 1, -8, 16, 6, 12]] },
  { x: 20, y: 72, z: 140, lobes: [[0, 0, 0, 34, 10, 24], [20, 2, -6, 22, 7, 15], [-18, 2, 4, 18, 6, 13]] },
  { x: -120, y: 60, z: -20, lobes: [[0, 0, 0, 28, 8, 18], [14, 2, 8, 16, 6, 12]] },
  { x: 140, y: 68, z: 40, lobes: [[0, 0, 0, 32, 9, 22], [-16, 2, -5, 20, 7, 14], [12, 1, 7, 15, 5, 11]] },
  { x: -40, y: 78, z: -130, lobes: [[0, 0, 0, 36, 10, 26], [22, 2, 0, 20, 7, 15], [-20, 2, 6, 18, 6, 13]] },
  { x: 100, y: 54, z: 160, lobes: [[0, 0, 0, 24, 7, 16], [12, 1, -4, 14, 5, 11]] },
  { x: -150, y: 70, z: 80, lobes: [[0, 0, 0, 32, 9, 22], [16, 2, 5, 18, 6, 13], [-14, 1, -6, 15, 5, 12]] },
  { x: 50, y: 50, z: -160, lobes: [[0, 0, 0, 28, 7, 18], [14, 2, 4, 16, 5, 11]] },
  { x: -90, y: 82, z: 160, lobes: [[0, 0, 0, 30, 9, 20], [-16, 2, -3, 16, 6, 12]] },
];
let cloudIdx = 0;
for (const cluster of cloudClusters) {
  for (const [lx, ly, lz, sx, sy, sz] of cluster.lobes) {
    const soft = cloudIdx % 3 === 0;
    entities.push({
      localId: nextLocalId(),
      components: {
        Name: { value: `Cloud_${cloudIdx}` },
        Transform: {
          pos: [cluster.x + lx, cluster.y + ly, cluster.z + lz],
          quat: [0, 0, 0, 1],
          scale: [sx, sy, sz],
        },
        MeshFilter: { assetHandle: refIndex(SPHERE) },
        MeshRenderer: { materials: [refIndex(soft ? MAT_CLOUD_SOFT : MAT_CLOUD)] },
      },
    });
    cloudIdx += 1;
  }
}
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'Skylight' },
    // Flat ambient fill — keep low so directional shading / soft shadows read.
    // Match original screenshot: enough fill to read shadow sides, not wash grass pale.
    Skylight: { color: [0.5, 0.68, 0.95], intensity: 0.2 },
  },
});
entities.push({
  localId: nextLocalId(),
  components: {
    Name: { value: 'Sun' },
    Transform: { pos: [140, 95, 90], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
    DirectionalLight: {
      direction: [-0.55, -0.72, -0.42],
      color: [1.0, 0.86, 0.58],
      intensity: 2.35,
      castShadow: true,
      mapSize: 2048,
      shadowDistance: 180,
      pcfKernelSize: 9,
      depthBias: 0.0025,
      normalBias: 0.04,
    },
  },
});

const spawn = landmarks.spawn;
const rootYaw = spawn.heading + Math.PI;
const kartScale = 1.16;
/**
 * Player race karts are original garage GLBs (~2.0×2.8m at scale 1).
 * Pack kart_*.glb are ~1.15×1.90m — scale ≈ 2.81/1.90 so AI matches hero size.
 * Chase-cam perspective already makes distant rivals read smaller; do NOT shrink
 * the authored mesh further (0.78 made them look like toys).
 */
const aiKartScale = 1.48;
const kartMinY = -0.46;

function placeKartHierarchy(
  name,
  kartKey,
  petKey,
  petMaxDim,
  pos,
  yaw,
  visualScale = kartScale,
  petWorldH = PET_TARGET_H,
) {
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
        pos: [0, -kartMinY * visualScale, 0],
        quat: yawQuat(MESH_PLUS_Z_TO_FORGEAX_YAW),
        scale: [visualScale, visualScale, visualScale],
      },
      // The player uses the original 10-style procedural scenes at runtime.
      // Keep this transform as the pet/outfit anchor, but do not render the
      // old three-car placeholder over the selected model.
      ...(name === 'KartBase'
        ? {}
        : {
            MeshFilter: { assetHandle: refIndex(asset.mesh) },
            MeshRenderer: { materials: [refIndex(asset.mat)] },
          }),
      ChildOf: { parent: rootId },
    },
  });
  const pet = props[petKey];
  // World pet height = localScale * meshH * visualScale → solve for localScale.
  const petS = petWorldH / (petMaxDim * visualScale);
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
  return { rootId, visualId };
}

const playerKart = placeKartHierarchy(
  'KartBase',
  'kart_base',
  'pet_corgi',
  0.912,
  { x: spawn.x, y: spawn.y, z: spawn.z },
  rootYaw,
);
const kartRootId = playerKart.rootId;
placeKartHierarchy(
  'KartDuck',
  'kart_duck',
  'pet_duck',
  1.119,
  { x: spawn.x - 8.4, y: spawn.y, z: spawn.z - 8 },
  rootYaw,
  aiKartScale,
  AI_PET_WORLD_H,
);

// Player outfit pieces — hidden until the garage selection enables them.
const MAT_OUTFIT_STRAW = solidMatGuid(0.96, 0.76, 0.3, 0.65);
const MAT_OUTFIT_DARK = solidMatGuid(0.035, 0.045, 0.06, 0.28);
const MAT_OUTFIT_PARTY = solidMatGuid(1.0, 0.28, 0.46, 0.42);
const outfitPieces = [
  { name: 'OutfitHatBrim', pos: [0, 0.78, 0.08], scale: [0.38, 0.045, 0.33], mat: MAT_OUTFIT_STRAW, mesh: CUBE },
  { name: 'OutfitHatCrown', pos: [0, 0.88, 0.08], scale: [0.23, 0.13, 0.22], mat: MAT_OUTFIT_STRAW, mesh: CUBE },
  { name: 'OutfitGlassLeft', pos: [-0.16, 0.59, 0.34], scale: [0.13, 0.12, 0.055], mat: MAT_OUTFIT_DARK, mesh: SPHERE },
  { name: 'OutfitGlassRight', pos: [0.16, 0.59, 0.34], scale: [0.13, 0.12, 0.055], mat: MAT_OUTFIT_DARK, mesh: SPHERE },
  { name: 'OutfitGlassBridge', pos: [0, 0.59, 0.34], scale: [0.09, 0.025, 0.035], mat: MAT_OUTFIT_DARK, mesh: CUBE },
  { name: 'OutfitPartyHat', pos: [0, 0.96, 0.08], scale: [0.17, 0.33, 0.17], mat: MAT_OUTFIT_PARTY, mesh: CUBE },
  { name: 'OutfitPartyPom', pos: [0, 1.3, 0.08], scale: [0.09, 0.09, 0.09], mat: MAT_OUTFIT_STRAW, mesh: SPHERE },
];
for (const piece of outfitPieces) {
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: piece.name },
      Transform: { pos: piece.pos, quat: yawQuat(0), scale: [0, 0, 0] },
      MeshFilter: { assetHandle: refIndex(piece.mesh) },
      MeshRenderer: { materials: [refIndex(piece.mat)] },
      ChildOf: { parent: playerKart.visualId },
    },
  });
}
placeKartHierarchy(
  'KartPanda',
  'kart_panda',
  'pet_panda',
  1.087,
  { x: spawn.x + 8.4, y: spawn.y, z: spawn.z - 9 },
  rootYaw,
  aiKartScale,
  AI_PET_WORLD_H,
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
  PropTree6: 'prop_tree',
  PropTree7: 'prop_tree',
  PropTree8: 'prop_tree',
  PropTree9: 'prop_tree',
  PropTree10: 'prop_tree',
  PropTree11: 'prop_tree',
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

// Extra lawn flower beds (3D confetti) — recording lawn looked empty beside the road.
const flowerMats = [
  solidMatGuid(1.0, 0.45, 0.58, 0.55),
  solidMatGuid(1.0, 0.82, 0.24, 0.55),
  solidMatGuid(1.0, 0.55, 0.22, 0.55),
  solidMatGuid(0.95, 0.4, 0.82, 0.55),
  solidMatGuid(1.0, 0.95, 0.95, 0.55),
];
const MAT_BUSH = solidMatGuid(0.45, 0.78, 0.32, 0.88, { punch: false });
const MAT_POT = solidMatGuid(0.85, 0.78, 0.62, 0.85, { punch: false });
const flowerBeds = [
  [78, 0, -28], [96, 0, -30], [70, 0, -8], [102, 0, 8],
  [88, 0, 22], [64, 0, 36], [110, 0, 48], [75, 0, 70],
  [50, 0, 95], [20, 0, 110], [-10, 0, 105], [-35, 0, 90],
  [-55, 0, 55], [-70, 0, 25], [-85, 0, -10], [-60, 0, -45],
  [-20, 0, -75], [15, 0, -90], [48, 0, -85], [100, 0, -55],
  [40, 0, 40], [-40, 0, 40], [0, 0, -50], [120, 0, 20],
  [-100, 0, 40], [30, 0, -20], [-15, 0, 70], [55, 0, -60],
];
let flowerIdx = 0;
for (const [fx, fy, fz] of flowerBeds) {
  const potId = nextLocalId();
  entities.push({
    localId: potId,
    components: {
      Name: { value: `LawnBed_${flowerIdx}` },
      Transform: { pos: [fx, fy, fz], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  });
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `LawnBed_${flowerIdx}_Pot` },
      Transform: { pos: [0, 0.12, 0], quat: [0, 0, 0, 1], scale: [1.1, 0.28, 1.1] },
      MeshFilter: { assetHandle: refIndex(CUBE) },
      MeshRenderer: { materials: [refIndex(MAT_POT)] },
      ChildOf: { parent: potId },
    },
  });
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `LawnBed_${flowerIdx}_Bush` },
      Transform: { pos: [0, 0.38, 0], quat: [0, 0, 0, 1], scale: [0.95, 0.45, 0.95] },
      MeshFilter: { assetHandle: refIndex(SPHERE) },
      MeshRenderer: { materials: [refIndex(MAT_BUSH)] },
      ChildOf: { parent: potId },
    },
  });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + flowerIdx * 0.2;
    entities.push({
      localId: nextLocalId(),
      components: {
        Name: { value: `LawnBed_${flowerIdx}_F${k}` },
        Transform: {
          pos: [Math.cos(a) * 0.42, 0.62, Math.sin(a) * 0.42],
          quat: [0, 0, 0, 1],
          scale: [0.22, 0.22, 0.22],
        },
        MeshFilter: { assetHandle: refIndex(SPHERE) },
        MeshRenderer: { materials: [refIndex(flowerMats[k % flowerMats.length])] },
        ChildOf: { parent: potId },
      },
    });
  }
  flowerIdx += 1;
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

// Mystery item boxes — original wooden ? crate (textured + emissive), one mesh each.
// Baked via scripts/bake-item-box.mjs → assets/item_box.gltf (+ meta).
const ITEM_BOX_MESH = '019fc09a-42ba-4b18-834e-366d0587ef95';
const ITEM_BOX_MAT = '019fc09a-42bb-48c4-a9c8-e4e69a8fbce4';
const itemBoxList = Array.isArray(landmarks.itemBoxes) ? landmarks.itemBoxes : [];
for (let i = 0; i < itemBoxList.length; i++) {
  const b = itemBoxList[i];
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `ItemBox_${i}` },
      Transform: {
        pos: [b.x, b.y, b.z],
        quat: yawQuat(b.yaw ?? 0),
        // Slightly larger than unit crate so ? reads at track distance.
        scale: [1.25, 1.25, 1.25],
      },
      MeshFilter: { assetHandle: refIndex(ITEM_BOX_MESH) },
      MeshRenderer: { materials: [refIndex(ITEM_BOX_MAT)] },
    },
  });
}

// Dormant curved banana-trap visuals activated by the runtime item system.
const MAT_BANANA = solidMatGuid(1.0, 0.78, 0.08, 0.42);
const MAT_BANANA_TIP = solidMatGuid(0.32, 0.16, 0.05, 0.7);
for (let i = 0; i < 6; i++) {
  const rootId = nextLocalId();
  entities.push({
    localId: rootId,
    components: {
      Name: { value: `BananaTrap_${i}` },
      Transform: {
        pos: [0, -20, 0],
        quat: yawQuat(0),
        scale: [0, 0, 0],
      },
    },
  });
  const segments = [
    { x: -0.48, z: -0.02, yaw: -0.5 },
    { x: -0.17, z: 0.13, yaw: -0.17 },
    { x: 0.17, z: 0.13, yaw: 0.17 },
    { x: 0.48, z: -0.02, yaw: 0.5 },
  ];
  for (let j = 0; j < segments.length; j++) {
    const seg = segments[j];
    entities.push({
      localId: nextLocalId(),
      components: {
        Name: { value: `BananaSegment_${i}_${j}` },
        Transform: {
          pos: [seg.x, 0, seg.z],
          quat: yawQuat(seg.yaw),
          scale: [0.34, 0.09, 0.18],
        },
        MeshFilter: { assetHandle: refIndex(CUBE) },
        MeshRenderer: { materials: [refIndex(MAT_BANANA)] },
        ChildOf: { parent: rootId },
      },
    });
  }
  for (const [j, x] of [-0.7, 0.7].entries()) {
    entities.push({
      localId: nextLocalId(),
      components: {
        Name: { value: `BananaTip_${i}_${j}` },
        Transform: {
          pos: [x, 0.03, -0.13],
          quat: yawQuat(x < 0 ? -0.62 : 0.62),
          scale: [0.12, 0.1, 0.12],
        },
        MeshFilter: { assetHandle: refIndex(CUBE) },
        MeshRenderer: { materials: [refIndex(MAT_BANANA_TIP)] },
        ChildOf: { parent: rootId },
      },
    });
  }
}

// Horn pulse markers form an expanding ground ring around the player.
const MAT_HORN_WAVE = solidMatGuid(1.0, 0.48, 0.08, 0.28);
for (let i = 0; i < 16; i++) {
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `HornPulse_${i}` },
      Transform: {
        pos: [0, -20, 0],
        quat: yawQuat(0),
        scale: [0, 0, 0],
      },
      MeshFilter: { assetHandle: refIndex(CUBE) },
      MeshRenderer: { materials: [refIndex(MAT_HORN_WAVE)] },
    },
  });
}

// Animated boost-pad chevrons (runtime bob / scroll). Pads themselves stay baked.
const MAT_BOOST_FX = 'b1a11e00-0004-4000-8000-000000000003';
const boostPadSites = [
  { x: 86, y: 0, z: 2.194, yaw: 0 },
  { x: 86, y: 0, z: 56.113, yaw: 0 },
  { x: 63.316, y: 0, z: 106.83, yaw: -1.1502 },
  { x: -38.609, y: 2.6, z: 96.985, yaw: -2.4337 },
  { x: -50.098, y: 2.6, z: 32.678, yaw: -2.7491 },
  { x: -95.477, y: 0, z: -49.116, yaw: -3.1258 },
  { x: -19.792, y: 0, z: -88.941, yaw: 1.5708 },
  { x: 45.658, y: 0, z: -88.978, yaw: 1.5863 },
];
for (let i = 0; i < boostPadSites.length; i++) {
  const b = boostPadSites[i];
  const rootId = nextLocalId();
  // Track tangent heading is +Z-forward; ForgeaX yaw needs +π.
  const yaw = b.yaw + Math.PI;
  entities.push({
    localId: rootId,
    components: {
      Name: { value: `BoostPadFx_${i}` },
      Transform: {
        pos: [b.x, b.y + 0.18, b.z],
        quat: yawQuat(yaw),
        scale: [1, 1, 1],
      },
    },
  });
  // Three chevron wedges that scroll forward along -Z (drive forward).
  for (let k = 0; k < 3; k++) {
    entities.push({
      localId: nextLocalId(),
      components: {
        Name: { value: `BoostPadFx_${i}_Arrow_${k}` },
        Transform: {
          pos: [0, 0.04, -0.7 + k * 0.85],
          quat: [0, 0, 0, 1],
          scale: [1.45 - k * 0.15, 0.12, 0.7],
        },
        MeshFilter: { assetHandle: refIndex(CUBE) },
        MeshRenderer: { materials: [refIndex(MAT_BOOST_FX)] },
        ChildOf: { parent: rootId },
      },
    });
  }
}

// Dormant cartoon puff / spark pool for runtime race VFX (hidden under world).
const MAT_VFX_SMOKE = 'b1a11e00-0004-4000-8000-000000000001';
const MAT_VFX_SPARK = 'b1a11e00-0004-4000-8000-000000000002';
const vfxMats = [
  makeUnlitMat(MAT_VFX_SMOKE, 0.96, 0.97, 1.0),
  makeUnlitMat(MAT_VFX_SPARK, 1.0, 0.85, 0.25),
  makeUnlitMat(MAT_BOOST_FX, 1.0, 0.92, 0.18),
];
for (let i = 0; i < 48; i++) {
  const mat = i % 3 === 0 ? MAT_VFX_SPARK : MAT_VFX_SMOKE;
  entities.push({
    localId: nextLocalId(),
    components: {
      Name: { value: `VfxPuff_${i}` },
      Transform: {
        pos: [0, -40, 0],
        quat: [0, 0, 0, 1],
        scale: [0, 0, 0],
      },
      MeshFilter: { assetHandle: refIndex(SPHERE) },
      MeshRenderer: { materials: [refIndex(mat)] },
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
    ...vfxMats,
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
