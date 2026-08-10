import { describe, expect, it, vi } from 'vitest';
import {
  World,
  type Component,
  type EntityHandle,
} from '@forgeax/engine-ecs';
import { SceneInstance } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { ok, type Handle, type LocalEntityId, type SceneAsset } from '@forgeax/engine-types';
import { loadScene, type GameContext } from '../assets/plugins/scene-runtime';

const CHILD_SCENE_GUID = 'b9843363-44d7-47b1-b129-dd500446a73b';

function localId(value: number): LocalEntityId {
  return value as LocalEntityId;
}

function countWith(world: World, component: Component): number {
  let count = 0;
  for (const _row of world.query({ with: [component] }).unwrap()) count += 1;
  return count;
}

function expectNoSceneResidue(world: World): void {
  expect(countWith(world, Transform)).toBe(0);
  expect(countWith(world, SceneInstance)).toBe(0);
  expect(world.inspect().entityCount).toBe(0);
}

function singleNodeScene(): SceneAsset {
  return {
    kind: 'scene',
    entities: [{ localId: localId(0), components: { Transform: { pos: [1, 2, 3] } } }],
    mounts: [],
  } as SceneAsset;
}

function nestedScene(): SceneAsset {
  return {
    kind: 'scene',
    entities: [{ localId: localId(0), components: { Transform: { pos: [4, 5, 6] } } }],
    mounts: [{
      localId: localId(1),
      source: CHILD_SCENE_GUID,
      memberFirst: localId(2),
      memberCount: 1,
    }],
  } as SceneAsset;
}

function instantiateWithNestedChild(
  world: World,
  childHandle: Handle<'SceneAsset', 'shared'>,
): NonNullable<GameContext['assets']>['instantiate'] {
  return ((handle: Handle<'SceneAsset', 'shared'>, targetWorld: World) => {
    targetWorld._setSceneAssetResolver(() => ok(childHandle));
    const instance = targetWorld.instantiateScene(handle);
    return instance.ok
      ? { ok: true, value: instance.value.root }
      : instance;
  }) as NonNullable<GameContext['assets']>['instantiate'];
}

describe('Aetherfall scene runtime failed-load cleanup', () => {
  it('despawns an instantiated root before returning null when SceneInstance is missing', async () => {
    const world = new World();
    const authored = { kind: 'scene', entities: [], mounts: [] } as SceneAsset;
    let instantiatedRoot: EntityHandle | undefined;
    const assets = {
      loadByGuid: vi.fn(async () => ({ ok: true, value: authored })),
      instantiate: vi.fn((_handle: unknown, targetWorld: World) => {
        instantiatedRoot = targetWorld.spawn({ component: Transform, data: {} }).unwrap();
        return { ok: true, value: instantiatedRoot };
      }),
    } as unknown as NonNullable<GameContext['assets']>;

    await expect(loadScene({ world, assets })).resolves.toBeNull();

    expect(instantiatedRoot).toBeDefined();
    expectNoSceneResidue(world);
  });

  it.each([
    ['returns an error result', false],
    ['throws', true],
  ] as const)('cleans the main scene and nested roots when nested loading %s', async (_label, throws) => {
    const world = new World();
    const authored = nestedScene();
    const childHandle = world.allocSharedRef('SceneAsset', singleNodeScene());
    let loadCount = 0;
    let instantiatedCounts: { transforms: number; sceneInstances: number } | undefined;
    const instantiate = instantiateWithNestedChild(world, childHandle);
    const assets = {
      loadByGuid: vi.fn(async () => {
        loadCount += 1;
        if (loadCount === 1) return { ok: true, value: authored };
        if (throws) throw new Error('nested-load-threw');
        return { ok: false, error: { code: 'nested-load-failed' } };
      }),
      instantiate: vi.fn((handle: Handle<'SceneAsset', 'shared'>, targetWorld: World) => {
        const result = instantiate(handle, targetWorld);
        if (result.ok) {
          instantiatedCounts = {
            transforms: countWith(world, Transform),
            sceneInstances: countWith(world, SceneInstance),
          };
        }
        return result;
      }),
    } as unknown as NonNullable<GameContext['assets']>;
    const despawnScene = vi.spyOn(world, 'despawnScene');

    await expect(loadScene({ world, assets })).rejects.toThrow(
      throws ? 'nested-load-threw' : 'Nested SceneAsset load failed: nested-load-failed',
    );

    expect(instantiatedCounts).toEqual({ transforms: 5, sceneInstances: 2 });
    expect(despawnScene).toHaveBeenCalledTimes(1);
    expectNoSceneResidue(world);
    world.sharedRefs.release(childHandle).unwrap();
  });

  it('does not clean an instantiated scene that is returned successfully', async () => {
    const world = new World();
    const authored = singleNodeScene();
    let root: EntityHandle | undefined;
    const assets = {
      loadByGuid: vi.fn(async () => ({ ok: true, value: authored })),
      instantiate: vi.fn((handle: Handle<'SceneAsset', 'shared'>, targetWorld: World) => {
        const instance = targetWorld.instantiateScene(handle);
        if (!instance.ok) return instance;
        root = instance.value.root;
        return { ok: true, value: root };
      }),
    } as unknown as NonNullable<GameContext['assets']>;
    const despawnScene = vi.spyOn(world, 'despawnScene');

    await expect(loadScene({ world, assets })).resolves.not.toBeNull();

    expect(root).toBeDefined();
    expect(despawnScene).not.toHaveBeenCalled();
    expect(countWith(world, Transform)).toBe(2);
    expect(countWith(world, SceneInstance)).toBe(1);
    despawnScene.mockRestore();
    world.despawnScene(root!).unwrap();
  });
});
