import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import {
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
} from '@forgeax/engine-physics';
import { Transform } from '@forgeax/engine-scene';
import type { SceneAsset } from '@forgeax/engine-types';
import type { SightBlocker } from './rules';
import {
  STREET_COLLISION_PROXIES,
  STREET_SCENE_GUID,
  type StreetCollisionProxy,
} from './street-layout';

export type StreetAssets = {
  loadByGuid<T>(guid: unknown): Promise<{
    ok: boolean;
    value?: T;
    error?: { code?: string };
  }>;
  instantiate<T>(
    handle: unknown,
    world: World,
    parent?: EntityHandle,
  ): { ok: boolean; value?: EntityHandle; error?: { code?: string } };
};

function aabbOf(proxy: StreetCollisionProxy): SightBlocker {
  const [cx, , cz] = proxy.center;
  const [sx, , sz] = proxy.size;
  return {
    minX: cx - sx * 0.5,
    maxX: cx + sx * 0.5,
    minZ: cz - sz * 0.5,
    maxZ: cz + sz * 0.5,
  };
}

export function installStreetCollision(world: World): {
  readonly sightBlockers: readonly SightBlocker[];
} {
  const sightBlockers: SightBlocker[] = [];
  for (const proxy of STREET_COLLISION_PROXIES) {
    world.spawn(
      {
        component: Transform,
        data: {
          pos: [...proxy.center],
          scale: [...proxy.size],
          ...(proxy.rotation ? { quat: [...proxy.rotation] } : {}),
        },
      },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      {
        component: Collider,
        data: {
          shape: ColliderShapeValue.cuboid,
          halfExtents: [0.5, 0.5, 0.5],
          friction: 0.9,
          restitution: 0,
        },
      },
    ).unwrap();
    if (proxy.blocksSight) sightBlockers.push(aabbOf(proxy));
  }
  return { sightBlockers };
}

export async function instantiateStreetScene(
  world: World,
  assets: StreetAssets,
): Promise<EntityHandle> {
  const guid = AssetGuid.parse(STREET_SCENE_GUID);
  if (!guid.ok) {
    throw new Error('[rain-alley] street scene guid is not a valid AssetGuid');
  }
  const loaded = await assets.loadByGuid<SceneAsset>(guid.value);
  if (!loaded.ok || loaded.value === undefined) {
    throw new Error(
      `[rain-alley] street scene loadByGuid failed: ${loaded.error?.code ?? 'unknown'}`,
    );
  }
  const handle = world.allocSharedRef('SceneAsset', loaded.value);
  const root = world.spawn({
    component: Transform,
    data: { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] },
  }).unwrap();
  const instanced = assets.instantiate(handle, world, root);
  if (!instanced.ok || instanced.value === undefined) {
    throw new Error(
      `[rain-alley] street instantiate failed: ${instanced.error?.code ?? 'unknown'}`,
    );
  }
  return root;
}
