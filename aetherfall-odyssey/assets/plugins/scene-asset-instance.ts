import type { BootstrapContext } from '@forgeax/engine-app';
import type { World } from '@forgeax/engine-ecs';
import type { SceneAsset } from '@forgeax/engine-types';

type GameAssetRegistry = NonNullable<BootstrapContext['assets']>;

/**
 * Instantiate a loaded SceneAsset without leaking the caller's temporary
 * shared-ref grant. AssetRegistry owns the independent handle retained by the
 * resulting SceneInstance.
 */
export function instantiateSceneAsset(
  world: World,
  assets: GameAssetRegistry,
  scene: SceneAsset,
) {
  const callerHandle = world.allocSharedRef('SceneAsset', scene);
  try {
    return assets.instantiate<SceneAsset>(callerHandle, world);
  } finally {
    world.sharedRefs.release(callerHandle).unwrap();
  }
}
