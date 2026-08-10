import type { BootstrapContext } from '@forgeax/engine-app';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { Transform } from '@forgeax/engine-scene';
import type { SceneAsset } from '@forgeax/engine-types';
import { instantiateSceneAsset } from './scene-asset-instance';

export const HERO_OBSERVATORY_SCENE_GUID = '019fdca7-6c1f-7287-99b2-17e1b488382a';
export const HERO_OBSERVATORY_POSITION = [1.8, -1, -25.5] as const;
export const HERO_OBSERVATORY_SCALE = 0.92 as const;
export const HERO_OBSERVATORY_YAW = 0 as const;

export type HeroObservatoryHandle = {
  readonly root: EntityHandle;
  readonly dispose: () => void;
};

/**
 * Instantiate the licensed Sponza-derived observatory as a distant backdrop
 * beyond the Last Light terrace. It stays outside the supported traversal and
 * objective volumes: the low broken supports retain obstacle collision and
 * the semantic beacon retains mission ownership.
 */
export async function createHeroObservatory(args: {
  readonly world: World;
  readonly host: BootstrapContext | undefined;
}): Promise<HeroObservatoryHandle | undefined> {
  const { world, host } = args;
  const assets = host?.assets;
  if (assets === undefined) {
    console.error('[aetherfall] hero observatory unavailable: asset registry missing');
    return undefined;
  }

  const sceneGuid = AssetGuid.parse(HERO_OBSERVATORY_SCENE_GUID);
  if (!sceneGuid.ok) throw new Error('[aetherfall] hero observatory scene GUID is invalid');
  const scene = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
  if (!scene.ok) {
    console.error(`[aetherfall] hero observatory load failed: ${scene.error.code}`);
    return undefined;
  }

  const instantiated = instantiateSceneAsset(world, assets, scene.value);
  if (!instantiated.ok) {
    console.error(`[aetherfall] hero observatory instantiate failed: ${instantiated.error.code}`);
    return undefined;
  }

  const root = instantiated.value;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const despawned = world.despawnScene(root);
    if (!despawned.ok) {
      console.error(`[aetherfall] hero observatory dispose failed: ${despawned.error.code}`);
    }
  };
  const halfYaw = HERO_OBSERVATORY_YAW * 0.5;
  try {
    const placed = world.set(root, Transform, {
      pos: [...HERO_OBSERVATORY_POSITION],
      quat: [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
      scale: [HERO_OBSERVATORY_SCALE, HERO_OBSERVATORY_SCALE, HERO_OBSERVATORY_SCALE],
    });
    if (!placed.ok) {
      dispose();
      console.error(`[aetherfall] hero observatory placement failed: ${placed.error.code}`);
      return undefined;
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    root,
    dispose,
  };
}
