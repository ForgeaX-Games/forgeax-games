import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { Transform } from '@forgeax/engine-scene';
import type { SceneAsset } from '@forgeax/engine-types';

export const GARAGE_SCENE_GUID = '1d10390b-d2b1-4283-ab04-1fe9e0205371';
export const GARAGE_POSITION = { x: 170, y: 0.05, z: 0 };

export interface GarageScene {
  readonly root: EntityHandle;
  dispose(): void;
}

/** Instantiate the original baked Three.js garage diorama as a real ECS scene. */
export async function loadGarageScene(
  world: World,
  assets?: AssetRegistry,
): Promise<GarageScene | null> {
  if (!assets) return null;
  const guid = AssetGuid.parse(GARAGE_SCENE_GUID);
  if (!guid.ok) return null;
  const loaded = await assets.loadByGuid<SceneAsset>(guid.value);
  if (!loaded.ok) {
    console.error('[go-karts] garage scene load failed:', loaded.error);
    return null;
  }
  const shared = world.allocSharedRef('SceneAsset', loaded.value);
  const instance = assets.instantiate<SceneAsset>(shared, world);
  if (!instance.ok) {
    console.error('[go-karts] garage scene instantiate failed:', instance.error);
    return null;
  }
  const root = instance.value;
  const transform = world.get(root, Transform);
  if (transform.ok) {
    world.set(root, Transform, {
      ...transform.value,
      pos: [GARAGE_POSITION.x, GARAGE_POSITION.y, GARAGE_POSITION.z],
      // Garage.ts is baked in its original 17 × 13.6 m dimensions.
      scale: [1, 1, 1],
    });
  }
  return {
    root,
    dispose() {
      world.despawnScene(root);
    },
  };
}
