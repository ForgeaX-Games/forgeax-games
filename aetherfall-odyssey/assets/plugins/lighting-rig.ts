import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Camera, DirectionalLight, PostProcessParams, Skylight, SkyboxBackground, SpotLight } from '@forgeax/engine-render';
import { Name, Transform } from '@forgeax/engine-scene';
import { packAtmosphericFogParams, type AtmosphericFogConfig } from './atmospheric-fog-params';
import type { LoadedScene } from './scene-runtime';

type Vec3 = readonly [number, number, number];
type Vec4 = readonly [number, number, number, number];

// Public PostProcessParams ownership is identified by the renderer registration
// key. Keep this local adapter explicit until the fog installer exposes its
// params entity through CameraController instead of requiring a world lookup.
export const AETHERFALL_FOG_SHADER_ID = 'aetherfall::atmospheric-depth-fog';

export type AetherfallRimLightConfig = {
  readonly name: string;
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly color: Vec3;
  readonly intensity: number;
  readonly range: number;
  readonly innerConeDeg: number;
  readonly outerConeDeg: number;
};

export type AetherfallLightingRigConfig = {
  readonly environmentRotation: Vec4;
  readonly key: {
    readonly direction: Vec3;
    readonly color: Vec3;
    readonly intensity: number;
    readonly shadowDistance: number;
  };
  readonly fill: {
    readonly color: Vec3;
    readonly intensity: number;
  };
  readonly cameraExposure: number;
  readonly fog: AtmosphericFogConfig;
  readonly rims: readonly AetherfallRimLightConfig[];
};

function normalized(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 1e-6) throw new Error('[aetherfall] lighting direction must be non-zero');
  return [value[0] / length, value[1] / length, value[2] / length];
}

/**
 * One authored grade for the traversal vista. A warm, raking key
 * separates silhouettes, the cool skylight keeps their midtones
 * open, and two non-shadowed crystal spills survive punctual 1/d^2 falloff.
 * Fog starts behind the opening tableau so aerial perspective separates the
 * distant ruins without laying a blue-grey veil over the foreground.
 */
export const AETHERFALL_LIGHTING_RIG: AetherfallLightingRigConfig = Object.freeze({
  environmentRotation: Object.freeze([0, Math.sin(14 * Math.PI / 180), 0, Math.cos(14 * Math.PI / 180)] as const),
  key: Object.freeze({
    direction: Object.freeze(normalized([-0.62, -0.58, 0.53])),
    color: Object.freeze([1, 0.83, 0.64] as const),
    intensity: 2.7,
    shadowDistance: 48,
  }),
  fill: Object.freeze({
    color: Object.freeze([0.52, 0.64, 0.82] as const),
    intensity: 0.45,
  }),
  cameraExposure: 1.04,
  fog: Object.freeze({
    nearClip: 0.1,
    farClip: 200,
    density: 0.012,
    startDistance: 25,
    color: Object.freeze([0.26, 0.34, 0.44] as const),
    maxOpacity: 0.38,
  }),
  rims: Object.freeze([
    Object.freeze({
      name: 'Aetherfall_OpeningCrystalSpill',
      position: Object.freeze([5.2, 6.8, -3.1] as const),
      direction: Object.freeze(normalized([0.9, -3.9, -3.2])),
      color: Object.freeze([1, 0.63, 0.78] as const),
      intensity: 260,
      range: 22,
      innerConeDeg: 20,
      outerConeDeg: 42,
    }),
    Object.freeze({
      name: 'Aetherfall_LastLightCrystalSpill',
      position: Object.freeze([3.8, 7.8, -12.2] as const),
      direction: Object.freeze(normalized([-2, -6.25, -4.2])),
      color: Object.freeze([0.58, 0.78, 1] as const),
      intensity: 320,
      range: 18,
      innerConeDeg: 18,
      outerConeDeg: 38,
    }),
  ]),
});

type DirectionalSnapshot = {
  readonly direction: number[];
  readonly color: number[];
  readonly intensity: number;
  readonly shadowDistance: number;
};

type SkylightSnapshot = {
  readonly color: number[];
  readonly intensity: number;
  readonly rotation: number[];
};

export type AetherfallLightingRigHandle = {
  readonly key: EntityHandle;
  readonly fill: EntityHandle;
  readonly skybox: EntityHandle;
  readonly fogParams: EntityHandle;
  readonly rimLights: readonly EntityHandle[];
  readonly dispose: () => void;
};

function namedEntity(loaded: LoadedScene | null, name: string): EntityHandle | undefined {
  const localId = loaded?.nodes.find((node) =>
    (node.components.Name as { value?: string } | undefined)?.value === name,
  )?.localId;
  return localId === undefined ? undefined : loaded?.mapping.get(localId);
}

function findFogParams(world: World): EntityHandle | undefined {
  const query = world.query({ with: [PostProcessParams] }).unwrap();
  for (const row of query) {
    const params = world.get(row.entity, PostProcessParams);
    if (params.ok && params.value.shader === AETHERFALL_FOG_SHADER_ID) return row.entity;
  }
  return undefined;
}

/**
 * Grade the existing authored Sun/Skylight and atmospheric-fog pass, then add
 * two inspectable, non-shadowed silhouette lights. Missing owners fail before
 * mutation; dispose is idempotent and restores every borrowed value.
 */
export function createAetherfallLightingRig(args: {
  readonly world: World;
  readonly loaded: LoadedScene | null;
  readonly camera: EntityHandle;
  readonly config?: AetherfallLightingRigConfig;
}): AetherfallLightingRigHandle | undefined {
  const { world, loaded, camera } = args;
  const config = args.config ?? AETHERFALL_LIGHTING_RIG;
  const key = namedEntity(loaded, 'Sun');
  const fill = namedEntity(loaded, 'Skylight');
  const skybox = namedEntity(loaded, 'Skybox');
  const fogParams = findFogParams(world);
  if (key === undefined || fill === undefined || skybox === undefined || fogParams === undefined) {
    console.error('[aetherfall] lighting rig unavailable: Sun, Skylight, Skybox, and atmospheric fog are required');
    return undefined;
  }

  const currentKey = world.get(key, DirectionalLight);
  const currentFill = world.get(fill, Skylight);
  const currentSkybox = world.get(skybox, SkyboxBackground);
  const currentCamera = world.get(camera, Camera);
  const currentFog = world.get(fogParams, PostProcessParams);
  if (!currentKey.ok || !currentFill.ok || !currentSkybox.ok || !currentCamera.ok || !currentFog.ok) {
    console.error('[aetherfall] lighting rig unavailable: required lighting components are missing');
    return undefined;
  }
  const keySnapshot: DirectionalSnapshot = {
    direction: Array.from(currentKey.value.direction),
    color: Array.from(currentKey.value.color),
    intensity: currentKey.value.intensity,
    shadowDistance: currentKey.value.shadowDistance,
  };
  const fillSnapshot: SkylightSnapshot = {
    color: Array.from(currentFill.value.color),
    intensity: currentFill.value.intensity,
    rotation: Array.from(currentFill.value.rotation),
  };
  const skyboxRotationSnapshot = Array.from(currentSkybox.value.rotation);
  const exposureSnapshot = currentCamera.value.exposure;
  const fogSnapshot = new Uint8Array(currentFog.value.data);

  world.set(key, DirectionalLight, {
    direction: [...config.key.direction],
    color: [...config.key.color],
    intensity: config.key.intensity,
    shadowDistance: config.key.shadowDistance,
  });
  world.set(fill, Skylight, {
    color: [...config.fill.color],
    intensity: config.fill.intensity,
    rotation: [...config.environmentRotation],
  });
  world.set(skybox, SkyboxBackground, { rotation: [...config.environmentRotation] });
  world.set(camera, Camera, { exposure: config.cameraExposure });
  world.set(fogParams, PostProcessParams, { data: packAtmosphericFogParams(config.fog) });

  const rimLights = config.rims.map((rim) => world.spawn(
    { component: Name, data: { value: rim.name } },
    { component: Transform, data: { pos: [...rim.position] } },
    {
      component: SpotLight,
      data: {
        direction: [...rim.direction],
        color: [...rim.color],
        intensity: rim.intensity,
        range: rim.range,
        innerConeDeg: rim.innerConeDeg,
        outerConeDeg: rim.outerConeDeg,
        castShadow: false,
      },
    },
  ).unwrap());

  let disposed = false;
  return {
    key,
    fill,
    skybox,
    fogParams,
    rimLights,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entity of rimLights) {
        if (world.get(entity, Entity).ok) world.despawn(entity).unwrap();
      }
      if (world.get(key, DirectionalLight).ok) world.set(key, DirectionalLight, keySnapshot);
      if (world.get(fill, Skylight).ok) world.set(fill, Skylight, fillSnapshot);
      if (world.get(skybox, SkyboxBackground).ok) world.set(skybox, SkyboxBackground, { rotation: skyboxRotationSnapshot });
      if (world.get(camera, Camera).ok) world.set(camera, Camera, { exposure: exposureSnapshot });
      if (world.get(fogParams, PostProcessParams).ok) world.set(fogParams, PostProcessParams, { data: fogSnapshot });
    },
  };
}
