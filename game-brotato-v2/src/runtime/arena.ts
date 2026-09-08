import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import {
  projectSceneAsset,
  sceneAssetKind,
  Transform,
  worldDespawnScene,
  worldInstantiateScene,
} from '@forgeax/engine-scene';
import { SceneInstance } from '@forgeax/engine-render';
import type { SceneAsset } from '@forgeax/engine-types';
import { ASSET_IDS } from './asset-ids.ts';

async function loadScene(assets: AssetRegistry): Promise<SceneAsset> {
  const parsed = AssetGuid.parse(ASSET_IDS.sceneArena);
  if (!parsed.ok) throw parsed.error;
  const loaded = await assets.load(ASSET_IDS.sceneArena, sceneAssetKind);
  if (!loaded.ok) {
    throw new Error(`Brotato v2 arena asset load failed: ${loaded.error.code} ${loaded.error.hint}`);
  }
  return loaded.value;
}

/** Load, project, and instantiate the arena scene under one synthetic root. */
export async function instantiateArena(world: World, assets: AssetRegistry): Promise<EntityHandle> {
  const scene = await loadScene(assets);
  const projected = await projectSceneAsset(world, scene, (guid, kind) => assets.load(guid, kind));
  if (!projected.ok) {
    throw new Error(`Brotato v2 arena scene projection failed: ${projected.error.code}`);
  }
  const handle = world.allocSharedRef('SceneAsset', projected.value);
  const instance = worldInstantiateScene(world, handle);
  if (!instance.ok) {
    world.sharedRefs.release(handle);
    throw new Error(`Brotato v2 arena scene instantiate failed: ${instance.error.code}`);
  }
  return instance.value.root;
}

/** Remove the arena root, its members, and the producer's shared scene grant. */
export function destroyArena(world: World, root: EntityHandle): void {
  const source = world.get(root, SceneInstance);
  const handle = source.ok ? source.value.source : undefined;
  const result = worldDespawnScene(world, root);
  if (!result.ok) throw result.error;
  if (handle !== undefined) world.sharedRefs.release(handle);
}
