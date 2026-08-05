import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { Transform } from '@forgeax/engine-scene';
import type { SceneAsset } from '@forgeax/engine-types';
import type { GarageSelection, KartKind, OutfitKind, PetKind } from './garage';
import { setProceduralOutfitPieces } from './garage-appearance';
import type { KartPose } from './kart-controller';
import { findEntityByName, type LoadedScene } from './scene';

type SocketId = 'hat_top' | 'hat_back' | 'glasses_bridge' | 'halo_above';

/**
 * Original Pets.ts sockets — calibrated for ~1.35 world-height pets.
 *
 * glasses_bridge is re-measured against the GLBs this project actually ships
 * (pet-dog / pet_duck / pet_panda), whose eyes sit much lower on the head than
 * the original fallback pets. Values are the eye-ball centers projected into
 * the same 1.35-tall space: raw model y * (1.35 / model height).
 */
const PET_SOCKETS: Record<PetKind, Record<SocketId, readonly [number, number, number]>> = {
  dog: {
    hat_top: [0, 1.3, 0.02],
    hat_back: [0, 1.13, -0.3],
    glasses_bridge: [0, 0.95, 0.32],
    halo_above: [0, 1.5, 0.02],
  },
  duck: {
    hat_top: [0, 1.17, -0.03],
    hat_back: [0, 1.12, -0.31],
    glasses_bridge: [0, 0.87, 0.35],
    halo_above: [0, 1.42, -0.03],
  },
  panda: {
    hat_top: [0, 1.3, 0],
    hat_back: [0, 1.14, -0.3],
    glasses_bridge: [0, 0.89, 0.33],
    halo_above: [0, 1.52, 0],
  },
};

const OUTFIT_SOCKET: Record<Exclude<OutfitKind, 'none'>, SocketId> = {
  straw: 'hat_top',
  shades: 'glasses_bridge',
  party: 'hat_top',
  pot: 'hat_top',
  halo: 'halo_above',
  booger: 'glasses_bridge',
  poop: 'hat_top',
  prop: 'hat_top',
  crown: 'hat_top',
  bow: 'hat_back',
};

/** headW / 0.62 from original Accessories attach scale. */
const PET_ACC_SCALE: Record<PetKind, number> = {
  dog: 0.66 / 0.62,
  duck: 0.62 / 0.62,
  panda: 0.74 / 0.62,
};

const PET_SOCKET_SCALE: Partial<Record<PetKind, Partial<Record<SocketId, number>>>> = {
  duck: { hat_top: 0.9, glasses_bridge: 0.92 },
};

const KART_SCENES: Record<KartKind, string> = {
  classic: 'ce8c8cfe-c839-4f1c-9a1b-2a3676301940',
  banana: 'd1f86c0d-f90a-433b-abd5-68a2d2d791c2',
  slipper: '4cfc2799-cb0f-4d91-b12b-58abacc88960',
  box: 'ef9e51a5-44f1-4100-abc9-cbdab7aaf9c9',
  hotdog: '5848ed81-bd8a-49af-84af-2e14d9619584',
  melon: '06d3b429-3c4a-4221-950e-78770d3b71ce',
  duck: 'ad700eba-1c6d-494e-ab7c-2759ba516cb1',
  donut: 'fb6db999-fee5-4f18-a870-3e1149a5b4bc',
  rocket: 'd9efa38e-a719-43b1-934a-fd17622f7814',
  tub: '72bcfdef-c278-424b-a841-669621413dca',
};

const KART_SEATS: Record<KartKind, readonly [number, number, number]> = {
  classic: [0, 0.55, -0.25],
  banana: [0, 0.5, -0.18],
  slipper: [0, 0.62, -0.35],
  box: [0, 0.58, -0.3],
  hotdog: [0, 0.72, -0.3],
  melon: [0, 0.6, -0.1],
  duck: [0, 0.78, -0.35],
  donut: [0, 0.44, 0],
  rocket: [0, 0.62, -0.25],
  tub: [0, 0.55, -0.2],
};

interface ModelBounds {
  center: readonly [number, number, number];
  size: readonly [number, number, number];
}

// World-space bounds measured from the baked GLBs. Thumbnail scenes keep the
// authored model origins (needed by the main preview), so the carousel must
// compensate for each asset's center and dimensions independently.
const KART_BOUNDS: Record<KartKind, ModelBounds> = {
  classic: { center: [0, 0.7681, -0.014], size: [1.9584, 1.5361, 2.812] },
  banana: { center: [0, 0.6866, 0], size: [1.9584, 1.6591, 3.176] },
  slipper: { center: [0, 0.7931, 0], size: [1.7952, 1.5661, 2.94] },
  box: { center: [0, 0.7981, 0.1966], size: [2.5332, 1.5961, 2.6131] },
  hotdog: { center: [0, 0.8481, 0], size: [1.7008, 1.6961, 2.54] },
  melon: { center: [0, 0.7426, 0], size: [2.0496, 1.7471, 2.415] },
  duck: { center: [0, 0.8521, 0.1144], size: [1.9152, 1.7681, 3.0801] },
  donut: { center: [0, 0.7481, 0], size: [2.5, 1.4961, 2.875] },
  rocket: { center: [0, 0.8231, 0.065], size: [1.9952, 1.6261, 3.52] },
  tub: { center: [0, 0.7831, 0], size: [2.0096, 1.5661, 2.7002] },
};

const ACCESSORY_SCENES: Partial<Record<OutfitKind, string>> = {
  straw: '3558b64c-7ae7-4cbf-96b7-09581d228742',
  shades: '9d0537f3-d9c1-4c53-99bd-19ea6684dcc5',
  party: 'fe6e4a73-4590-4a00-934e-88e62b91558e',
  pot: '4c89b200-a167-4771-aa87-599d0d4f026f',
  halo: 'b28a0e26-21ba-4ab2-bd5f-2b5db43bca9e',
  booger: '9586d081-931e-4452-a29c-ab81883cdb15',
  poop: '32f33aca-4975-4501-ab6f-9986ad2db065',
  prop: 'd745ca7e-96bd-42fe-964a-ab5094795a86',
  crown: '07904b2c-328f-4c48-abc0-7163222db9ad',
  bow: '0b8e2552-612d-4d34-8208-c675720e959c',
};
const ACCESSORY_BOUNDS: Partial<Record<OutfitKind, ModelBounds>> = {
  straw: { center: [0, 0.125, 0], size: [1.16, 0.3, 1.16] },
  shades: { center: [0, 0, -0.2092], size: [0.6924, 0.3, 0.4633] },
  party: { center: [0, 0.345, 0], size: [0.5121, 0.69, 0.52] },
  pot: { center: [0, 0.175, 0], size: [0.95, 0.41, 0.72] },
  halo: { center: [0, 0.02, 0], size: [0.61, 0.0856, 0.6056] },
  booger: { center: [0, -0.0428, -0.1775], size: [0.69, 0.4303, 0.4862] },
  poop: { center: [0, 0.084, 0.0103], size: [0.66, 0.828, 0.3325] },
  prop: { center: [0, 0.2112, 0], size: [0.64, 0.4223, 0.64] },
  crown: { center: [0, 0.116, 0.0245], size: [0.71, 0.392, 0.6841] },
  bow: { center: [0, 0.08, 0], size: [0.9371, 0.3018, 0.2038] },
};
const ACCESSORY_ORDER: OutfitKind[] = [
  'none',
  'straw',
  'shades',
  'party',
  'pot',
  'halo',
  'booger',
  'poop',
  'prop',
  'crown',
  'bow',
];

const DOG_SCENE = '446cc3a6-394c-4861-98ed-30374a9e10b1';
const PROCEDURAL_FALLBACK = new Set<OutfitKind>(['straw', 'shades', 'party']);

const DOG_WORLD_HEIGHT = 1.119224 * 1.206;
const AUTHORED_PET_LOCAL_SCALES: Record<Exclude<PetKind, 'dog'>, number> = {
  duck: DOG_WORLD_HEIGHT / (1.16 * 1.118981),
  panda: DOG_WORLD_HEIGHT / (1.16 * 1.086623),
};
const AUTHORED_PET_SEATED_RISE: Record<Exclude<PetKind, 'dog'>, number> = {
  duck: 0,
  panda: 0,
};

interface DisplayPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface OriginalGarageModels {
  select(selection: GarageSelection): void;
  setCarouselTab(tab: 'kart' | 'outfit'): void;
  setGarageVisible(visible: boolean): void;
  updatePose(pose: DisplayPose | KartPose): void;
  dispose(): void;
}

async function loadSceneAsset(
  assets: AssetRegistry,
  guidText: string,
): Promise<SceneAsset | null> {
  try {
    const guid = AssetGuid.parse(guidText);
    if (!guid.ok) return null;
    const loaded = await assets.loadByGuid<SceneAsset>(guid.value);
    if (!loaded.ok) {
      console.error('[go-karts] original garage asset load failed:', guidText, loaded.error);
      return null;
    }
    return loaded.value;
  } catch (error) {
    console.error('[go-karts] original garage asset threw:', guidText, error);
    return null;
  }
}

export function createOriginalGarageModels(options: {
  world: World;
  assets?: AssetRegistry;
  scene: LoadedScene;
}): OriginalGarageModels | null {
  const { world, assets, scene } = options;
  if (!assets) return null;
  const sceneAssetCache = new Map<string, Promise<SceneAsset | null>>();
  // Serialize cooks: raw .glb catalog rows go through POST /__import. Flooding
  // that endpoint (warm-all + carousel) drops most garage models as load misses.
  let loadChain: Promise<void> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = loadChain.then(fn, fn);
    loadChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, ms));
  const spawnScene = (guidText: string): Promise<EntityHandle | null> =>
    enqueue(async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        let pending = sceneAssetCache.get(guidText);
        if (!pending) {
          pending = loadSceneAsset(assets, guidText);
          sceneAssetCache.set(guidText, pending);
        }
        const asset = await pending;
        if (!asset) {
          sceneAssetCache.delete(guidText);
          if (attempt < 3) {
            await delay(200 * attempt);
            continue;
          }
          return null;
        }
        const shared = world.allocSharedRef('SceneAsset', asset);
        const instance = assets.instantiate<SceneAsset>(shared, world);
        if (instance.ok) return instance.value;
        console.error(
          '[go-karts] original garage asset instantiate failed:',
          guidText,
          instance.error,
          `attempt=${attempt}`,
        );
        sceneAssetCache.delete(guidText);
        if (attempt < 3) await delay(200 * attempt);
      }
      return null;
    });

  const authoredVisual = findEntityByName(scene, 'KartBaseVisual');
  const authoredPet = findEntityByName(scene, 'PetDriver');
  const authoredPetTransform = authoredPet === undefined
    ? null
    : world.get(authoredPet, Transform);
  const authoredPetScale = authoredPetTransform?.ok
    ? [...authoredPetTransform.value.scale] as [number, number, number]
    : [1, 1, 1] as [number, number, number];
  // Scene pack always has kart_base on KartBaseVisual. Hide that mesh while the
  // original-garage GLB is showing — otherwise every selection still looks like
  // classic (or double-draws) and "missing" cars appear not to load.
  const authoredMeshResult = authoredVisual === undefined
    ? null
    : world.get(authoredVisual, MeshFilter);
  const authoredRendererResult = authoredVisual === undefined
    ? null
    : world.get(authoredVisual, MeshRenderer);
  const authoredMesh = authoredMeshResult?.ok
    ? structuredClone(authoredMeshResult.value)
    : null;
  const authoredRenderer = authoredRendererResult?.ok
    ? structuredClone(authoredRendererResult.value)
    : null;
  let authoredKartMeshHidden = false;
  const setAuthoredKartMeshVisible = (visible: boolean): void => {
    if (authoredVisual === undefined || authoredMesh === null || authoredRenderer === null) return;
    if (visible) {
      if (!authoredKartMeshHidden) return;
      world.set(authoredVisual, MeshFilter, authoredMesh);
      world.set(authoredVisual, MeshRenderer, authoredRenderer);
      authoredKartMeshHidden = false;
      return;
    }
    if (authoredKartMeshHidden) return;
    world.removeComponent(authoredVisual, MeshFilter);
    world.removeComponent(authoredVisual, MeshRenderer);
    authoredKartMeshHidden = true;
  };

  let selection: GarageSelection = { kart: 'classic', pet: 'dog', outfit: 'none' };
  let pose: DisplayPose = { x: 170, y: 0.23, z: 0, yaw: Math.PI };
  let kartRoot: EntityHandle | null = null;
  let accessoryRoot: EntityHandle | null = null;
  let petRoot: EntityHandle | null = null;
  const kartThumbs = new Map<KartKind, EntityHandle>();
  const accessoryThumbs = new Map<OutfitKind, EntityHandle>();
  let carouselTab: 'kart' | 'outfit' = 'kart';
  let garageVisible = true;
  let kartLoad = 0;
  let accessoryLoad = 0;
  let dogLoad = 0;
  const thumbLoads = new Set<string>();
  let carouselLayoutRetries = 0;

  const setRoot = (
    root: EntityHandle | null,
    position: readonly [number, number, number],
    yaw: number,
    scale: number,
  ): void => {
    if (root === null) return;
    const transform = world.get(root, Transform);
    if (!transform.ok) return;
    world.set(root, Transform, {
      ...transform.value,
      pos: [...position],
      quat: [0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5)],
      scale: [scale, scale, scale],
    });
  };

  const setThumbnailRoot = (
    root: EntityHandle | null,
    bounds: ModelBounds,
    center: readonly [number, number, number],
    targetExtent: number,
  ): void => {
    // The garage camera looks downward by about 15 degrees. Include the depth
    // contribution in the apparent vertical span so long karts do not overflow.
    const apparentHeight = bounds.size[1] * 0.966 + bounds.size[2] * 0.259;
    const scale = targetExtent / Math.max(bounds.size[0], apparentHeight);
    setRoot(
      root,
      [
        center[0] - bounds.center[0] * scale,
        center[1] - bounds.center[1] * scale,
        center[2] - bounds.center[2] * scale,
      ],
      0,
      scale,
    );
  };

  const cardPresentation = (
    id: KartKind | OutfitKind,
    fill: number,
  ): { center: [number, number, number]; extent: number } | null => {
    const garage = document.getElementById('forgeax-kart-garage');
    const card = garage?.querySelector<HTMLElement>(`.kg-card[data-choice="${id}"]`);
    if (!garage || !card) return null;
    const viewport = garage.getBoundingClientRect();
    const bounds = card.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0) return null;

    const screenX = bounds.left + bounds.width * 0.5;
    const screenY = bounds.top + bounds.height * 0.5;
    const ndcX = ((screenX - viewport.left) / viewport.width) * 2 - 1;
    const ndcY = 1 - ((screenY - viewport.top) / viewport.height) * 2;

    // Inverse-project the real DOM card center through the fixed garage camera.
    // This keeps every 3D thumbnail centered when aspect ratio or UI clamps change.
    const eye: readonly [number, number, number] = [170, 3, 6.4];
    const forwardLength = Math.hypot(1.72, 6.4);
    const forward: readonly [number, number, number] = [
      0,
      -1.72 / forwardLength,
      -6.4 / forwardLength,
    ];
    const up: readonly [number, number, number] = [
      0,
      6.4 / forwardLength,
      -1.72 / forwardLength,
    ];
    const tanHalfFov = Math.tan((50 * Math.PI) / 360);
    const aspect = viewport.width / viewport.height;
    const direction: [number, number, number] = [
      ndcX * tanHalfFov * aspect,
      forward[1] + up[1] * ndcY * tanHalfFov,
      forward[2] + up[2] * ndcY * tanHalfFov,
    ];
    // Keep thumbnail meshes on a camera-side presentation plane. At the old
    // z=2.85 depth their wheels, rocket fins and box flaps nearly touched the
    // garage floor/shadow plane, producing visible depth flicker.
    const targetZ = 5;
    const rayT = (targetZ - eye[2]) / direction[2];
    const center: [number, number, number] = [
      eye[0] + direction[0] * rayT,
      eye[1] + direction[1] * rayT,
      targetZ,
    ];
    const depth =
      (center[1] - eye[1]) * forward[1] +
      (center[2] - eye[2]) * forward[2];
    const worldPerPixel = (2 * depth * tanHalfFov) / viewport.height;
    return {
      center,
      extent: Math.min(bounds.width, bounds.height) * fill * worldPerPixel,
    };
  };

  const modelPoint = (
    local: readonly [number, number, number],
    modelYaw: number,
  ): [number, number, number] => {
    const c = Math.cos(modelYaw);
    const s = Math.sin(modelYaw);
    return [
      pose.x + c * local[0] + s * local[2],
      pose.y + local[1],
      pose.z - s * local[0] + c * local[2],
    ];
  };

  const socket = (): {
    position: [number, number, number];
    scale: number;
  } => {
    const seat = KART_SEATS[selection.kart];
    if (selection.outfit === 'none') {
      return { position: [...seat], scale: 0 };
    }
    const socketId = OUTFIT_SOCKET[selection.outfit];
    const offset = PET_SOCKETS[selection.pet][socketId];
    const extra = PET_SOCKET_SCALE[selection.pet]?.[socketId] ?? 1;
    return {
      position: [seat[0] + offset[0], seat[1] + offset[1], seat[2] + offset[2]],
      scale: PET_ACC_SCALE[selection.pet] * extra,
    };
  };

  const writePose = (): void => {
    const modelYaw = pose.yaw + Math.PI;
    setRoot(kartRoot, [pose.x, pose.y, pose.z], modelYaw, 1);
    const seat = KART_SEATS[selection.kart];
    setRoot(petRoot, modelPoint(seat, modelYaw), modelYaw, 1.206);
    const accessory = socket();
    setRoot(
      accessoryRoot,
      modelPoint(accessory.position, modelYaw),
      modelYaw,
      accessory.scale,
    );
    if (authoredPet !== undefined) {
      const transform = world.get(authoredPet, Transform);
      if (transform.ok) {
        // Dog uses the spawned original-garage GLB (petRoot). Only hide the
        // authored PetDriver once that GLB is actually on screen — otherwise a
        // slow/failed import leaves both kart and driver invisible.
        // Duck/panda keep using the authored PetDriver mesh swap.
        let seatedRise = 0;
        let scale: [number, number, number];
        if (selection.pet === 'dog') {
          scale = petRoot !== null ? [0, 0, 0] : authoredPetScale;
        } else {
          const s = AUTHORED_PET_LOCAL_SCALES[selection.pet];
          seatedRise = AUTHORED_PET_SEATED_RISE[selection.pet];
          scale = [s, s, s];
        }
        world.set(authoredPet, Transform, {
          ...transform.value,
          // PetDriver is parented below KartBaseVisual, whose local transform
          // contributes +0.5336 Y, PI yaw and 1.16 scale. Undo that parent
          // transform so the pet's feet land on the selected kart's seat.
          pos: [
            seat[0] / 1.16,
            (seat[1] + seatedRise - 0.5336) / 1.16,
            seat[2] / 1.16,
          ],
          scale,
        });
      }
    }
  };

  const cyclicDelta = (index: number, selected: number, length: number): number => {
    let delta = index - selected;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    return delta;
  };

  const writeCarousel = (): void => {
    let awaitingDom = false;
    const kartOrder = Object.keys(KART_SCENES) as KartKind[];
    const selectedKart = kartOrder.indexOf(selection.kart);
    for (let index = 0; index < kartOrder.length; index++) {
      const id = kartOrder[index]!;
      const root = kartThumbs.get(id) ?? null;
      const delta = cyclicDelta(index, selectedKart, kartOrder.length);
      // Skip delta===0 — the stage already shows the selected kart.
      const shown =
        garageVisible && carouselTab === 'kart' && Math.abs(delta) >= 1 && Math.abs(delta) <= 2;
      const presentation = shown ? cardPresentation(id, 0.7) : null;
      if (shown && !presentation) awaitingDom = true;
      if (presentation && root) {
        setThumbnailRoot(
          root,
          KART_BOUNDS[id],
          presentation.center,
          presentation.extent,
        );
      } else {
        setRoot(root, [0, -20, 0], 0, 0);
      }
    }

    const selectedAccessory = ACCESSORY_ORDER.indexOf(selection.outfit);
    for (let index = 0; index < ACCESSORY_ORDER.length; index++) {
      const id = ACCESSORY_ORDER[index]!;
      const root = accessoryThumbs.get(id) ?? null;
      const delta = cyclicDelta(index, selectedAccessory, ACCESSORY_ORDER.length);
      const shown =
        garageVisible &&
        carouselTab === 'outfit' &&
        Math.abs(delta) >= 1 &&
        Math.abs(delta) <= 2 &&
        id !== 'none';
      const bounds = ACCESSORY_BOUNDS[id];
      const presentation = shown ? cardPresentation(id, 0.68) : null;
      if (shown && !presentation) awaitingDom = true;
      if (bounds && presentation && root) {
        setThumbnailRoot(
          root,
          bounds,
          presentation.center,
          presentation.extent,
        );
      } else {
        setRoot(root, [0, -20, 0], 0, 0);
      }
    }

    if (awaitingDom && carouselLayoutRetries < 8) {
      carouselLayoutRetries += 1;
      requestAnimationFrame(() => {
        writeCarousel();
        void syncCarouselThumbs();
      });
    } else {
      carouselLayoutRetries = 0;
    }
  };

  /** Only cook the handful of models currently on-screen in the carousel. */
  const syncCarouselThumbs = async (): Promise<void> => {
    if (!garageVisible) return;
    if (carouselTab === 'kart') {
      const kartOrder = Object.keys(KART_SCENES) as KartKind[];
      const selectedKart = kartOrder.indexOf(selection.kart);
      for (let index = 0; index < kartOrder.length; index++) {
        const id = kartOrder[index]!;
        const delta = cyclicDelta(index, selectedKart, kartOrder.length);
        if (Math.abs(delta) < 1 || Math.abs(delta) > 2) continue;
        const key = `kart:${id}`;
        if (kartThumbs.has(id) || thumbLoads.has(key)) continue;
        thumbLoads.add(key);
        const root = await spawnScene(KART_SCENES[id]);
        if (root !== null) kartThumbs.set(id, root);
        else thumbLoads.delete(key);
        writeCarousel();
      }
      return;
    }

    const selectedAccessory = ACCESSORY_ORDER.indexOf(selection.outfit);
    for (let index = 0; index < ACCESSORY_ORDER.length; index++) {
      const id = ACCESSORY_ORDER[index]!;
      if (id === 'none') continue;
      const delta = cyclicDelta(index, selectedAccessory, ACCESSORY_ORDER.length);
      if (Math.abs(delta) < 1 || Math.abs(delta) > 2) continue;
      const guid = ACCESSORY_SCENES[id];
      if (!guid) continue;
      const key = `acc:${id}`;
      if (accessoryThumbs.has(id) || thumbLoads.has(key)) continue;
      thumbLoads.add(key);
      const root = await spawnScene(guid);
      if (root !== null) accessoryThumbs.set(id, root);
      else thumbLoads.delete(key);
      writeCarousel();
    }
  };
  const selectKart = async (): Promise<void> => {
    const token = ++kartLoad;
    const next = await spawnScene(KART_SCENES[selection.kart]);
    if (token !== kartLoad) {
      if (next !== null) world.despawnScene(next);
      return;
    }
    if (kartRoot !== null) world.despawnScene(kartRoot);
    kartRoot = next;
    // Prefer original GLB; fall back to authored kart_base mesh if spawn failed.
    setAuthoredKartMeshVisible(next === null);
    writePose();
  };

  const selectAccessory = async (): Promise<void> => {
    const token = ++accessoryLoad;
    const outfit = selection.outfit;
    const guid = ACCESSORY_SCENES[outfit];
    const next = guid ? await spawnScene(guid) : null;
    if (token !== accessoryLoad) {
      if (next !== null) world.despawnScene(next);
      return;
    }
    if (accessoryRoot !== null) world.despawnScene(accessoryRoot);
    accessoryRoot = next;
    // Prefer original GLB mesh/style; only fall back to pack cubes if import failed.
    if (next === null && PROCEDURAL_FALLBACK.has(outfit)) {
      setProceduralOutfitPieces(world, scene, outfit);
    } else {
      setProceduralOutfitPieces(world, scene, null);
    }
    writePose();
  };

  const selectPet = async (): Promise<void> => {
    const token = ++dogLoad;
    const next = selection.pet === 'dog' ? await spawnScene(DOG_SCENE) : null;
    if (token !== dogLoad) {
      if (next !== null) world.despawnScene(next);
      return;
    }
    if (petRoot !== null) world.despawnScene(petRoot);
    petRoot = next;
    writePose();
  };

  const handleResize = (): void => {
    requestAnimationFrame(() => {
      writeCarousel();
      void syncCarouselThumbs();
    });
  };
  window.addEventListener('resize', handleResize);

  // Keep pack kart_base / PetDriver visible until original GLBs finish spawning.

  return {
    select(next) {
      const kartChanged = next.kart !== selection.kart;
      const petChanged = next.pet !== selection.pet;
      const accessoryChanged = next.outfit !== selection.outfit;
      selection = { ...next };
      // Stage models first (same serial queue), then only the visible thumbs.
      if (kartChanged || kartRoot === null) void selectKart();
      if (petChanged || (selection.pet === 'dog' && petRoot === null)) {
        void selectPet();
      }
      if (accessoryChanged || (selection.outfit !== 'none' && accessoryRoot === null)) {
        void selectAccessory();
      }
      writePose();
      writeCarousel();
      void syncCarouselThumbs();
    },
    setCarouselTab(tab) {
      carouselTab = tab;
      writeCarousel();
      void syncCarouselThumbs();
    },
    setGarageVisible(visible) {
      garageVisible = visible;
      writeCarousel();
      if (visible) void syncCarouselThumbs();
    },
    updatePose(next) {
      pose = { x: next.x, y: next.y, z: next.z, yaw: next.yaw };
      writePose();
    },
    dispose() {
      window.removeEventListener('resize', handleResize);
      kartLoad++;
      accessoryLoad++;
      dogLoad++;
      if (kartRoot !== null) world.despawnScene(kartRoot);
      if (accessoryRoot !== null) world.despawnScene(accessoryRoot);
      if (petRoot !== null) world.despawnScene(petRoot);
      for (const root of kartThumbs.values()) world.despawnScene(root);
      for (const root of accessoryThumbs.values()) world.despawnScene(root);
      setAuthoredKartMeshVisible(true);
      if (authoredPet !== undefined) {
        const transform = world.get(authoredPet, Transform);
        if (transform.ok) world.set(authoredPet, Transform, { ...transform.value, scale: authoredPetScale });
      }
    },
  };
}
