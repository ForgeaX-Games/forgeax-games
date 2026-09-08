/**
 * Scene load helpers — ForgeaX asset-first Play (adopt host) + fallback loadByGuid.
 */
import { SceneInstance } from '@forgeax/engine-render';
import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import { projectSceneAsset, worldInstantiateScene } from '@forgeax/engine-scene';

export const SCENE_GUID = '8e21f04f-e29b-464b-8b6f-2a001f4f18ad';

export interface PackNode {
  localId: number;
  components: Record<string, Record<string, unknown>>;
}

export interface LoadedScene {
  mapping: ReadonlyMap<number, EntityHandle>;
  nodes: PackNode[];
}

function mappingFromArray(
  mappingArray: { length: number; [index: number]: number },
): Map<number, EntityHandle> {
  const mapping = new Map<number, EntityHandle>();
  for (let localId = 0; localId < mappingArray.length; localId++) {
    const entity = mappingArray[localId];
    if (entity !== undefined && entity !== 0xffffffff && entity !== 0) {
      mapping.set(localId, entity as EntityHandle);
    }
  }
  return mapping;
}

export function adoptHostScene(world: World, ctx?: BootstrapContext): LoadedScene | null {
  if (ctx?.defaultSceneRoot === undefined || ctx.defaultScene === undefined) return null;

  const sceneInstance = world.get(ctx.defaultSceneRoot, SceneInstance);
  if (!sceneInstance.ok) {
    console.error('[go-karts] host SceneInstance lookup failed:', sceneInstance.error);
    return null;
  }

  return {
    mapping: mappingFromArray(
      sceneInstance.value.mapping as unknown as { length: number; [index: number]: number },
    ),
    nodes: ctx.defaultScene.entities as unknown as PackNode[],
  };
}

export async function loadSceneByGuid(
  world: World,
  assets?: AssetRegistry,
): Promise<LoadedScene | null> {
  if (!assets) return null;

  const sceneGuid = AssetGuid.parse(SCENE_GUID);
  if (!sceneGuid.ok) {
    console.error('[go-karts] invalid default scene GUID');
    return null;
  }

  const loadResult = await assets.load(AssetGuid.format(sceneGuid.value), 'scene');
  if (!loadResult.ok) {
    console.error('[go-karts] scene load failed:', loadResult.error);
    return null;
  }

  const projected = await projectSceneAsset(world, loadResult.value, (guid, kind) =>
    assets.load(guid, kind),
  );
  if (!projected.ok) {
    console.error('[go-karts] scene project failed:', projected.error);
    return null;
  }

  const sceneHandle = world.allocSharedRef('SceneAsset', projected.value);
  const instantiateResult = worldInstantiateScene(world, sceneHandle);
  if (!instantiateResult.ok) {
    console.error('[go-karts] scene instantiate failed:', instantiateResult.error);
    return null;
  }

  const sceneInstance = world.get(instantiateResult.value.root, SceneInstance);
  if (!sceneInstance.ok) {
    console.error('[go-karts] SceneInstance lookup failed:', sceneInstance.error);
    return null;
  }

  return {
    mapping: mappingFromArray(
      sceneInstance.value.mapping as unknown as { length: number; [index: number]: number },
    ),
    nodes: projected.value.entities as unknown as PackNode[],
  };
}

export function findEntityByName(scene: LoadedScene, name: string): EntityHandle | undefined {
  const node = scene.nodes.find(
    (candidate) =>
      (candidate.components.Name as { value?: string } | undefined)?.value === name,
  );
  return node ? scene.mapping.get(node.localId) : undefined;
}
