import type { BootstrapContext } from "@forgeax/engine-app";
import type { EntityHandle, World } from "@forgeax/engine-ecs";
import { AssetGuid } from "@forgeax/engine-pack/guid";
import { Transform } from "@forgeax/engine-scene";
import type { SceneAsset } from "@forgeax/engine-types";
import { instantiateSceneAsset } from "./scene-asset-instance";
import {
  throwAfterFailedRollback,
  type ResidualCleanupOwner,
} from "./world-installation-lifecycle";

export const THRESHOLD_DOOR_SCENE_GUID = "019fddf1-5e4b-7578-91fd-66a8e526a9a1";
export const THRESHOLD_DOOR_POSITION = [1.86, 0.04, -24.72] as const;
export const THRESHOLD_DOOR_SCALE = 1.35 as const;
export const THRESHOLD_DOOR_YAW = 0 as const;

export const GOTHIC_SENTINEL_SCENE_GUID =
  "019fdde8-bbe8-778b-816a-5d058ef3f977";
export const GOTHIC_SENTINEL_POSITION = [4.39, 0.02, -24] as const;
export const GOTHIC_SENTINEL_SCALE = 1.15 as const;
export const GOTHIC_SENTINEL_YAW = Math.PI;

export type ThresholdMonumentHandle = ResidualCleanupOwner & {
  readonly doorRoot: EntityHandle;
  readonly sentinelRoot: EntityHandle;
};

type SceneLoad = Awaited<
  ReturnType<NonNullable<BootstrapContext["assets"]>["loadByGuid"]>
>;

function placeRoot(
  world: World,
  root: EntityHandle,
  position: readonly [number, number, number],
  scale: number,
  yaw: number,
): void {
  const halfYaw = yaw * 0.5;
  world
    .set(root, Transform, {
      pos: [...position],
      quat: [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
      scale: [scale, scale, scale],
    })
    .unwrap();
}

type OwnedRoot = {
  readonly root: EntityHandle;
  owned: boolean;
};

function cleanupRoots(world: World, roots: readonly OwnedRoot[]): unknown[] {
  const errors: unknown[] = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const entry = roots[index]!;
    if (!entry.owned) continue;
    try {
      if (!world.get(entry.root, Transform).ok) {
        entry.owned = false;
        continue;
      }
      const result = world.despawnScene(entry.root);
      if (result.ok) entry.owned = false;
      else errors.push(result.error);
    } catch (error) {
      try {
        if (!world.get(entry.root, Transform).ok) entry.owned = false;
      } catch {
        // Retain ownership for a later retry when liveness cannot be observed.
      }
      errors.push(error);
    }
  }
  return errors;
}

function createThresholdCleanupOwner(
  world: World,
  roots: readonly OwnedRoot[],
): ResidualCleanupOwner {
  return {
    label: "threshold monument",
    hasPending: () => roots.some((entry) => entry.owned),
    dispose: () => {
      const errors = cleanupRoots(world, roots);
      if (errors.length > 0)
        throw new AggregateError(errors, "Threshold monument cleanup failed");
    },
  };
}

/**
 * Instantiate the Last Light facade door and its single right-side sentinel as
 * one presentation owner. Both sources are loaded before either root exists;
 * a failed second instance rolls the first one back so the composition never
 * degrades into a half-monument. Gameplay collision and mission state remain
 * owned by the authored terrace and beacon entities.
 */
export async function createThresholdMonument(args: {
  readonly world: World;
  readonly host: BootstrapContext | undefined;
}): Promise<ThresholdMonumentHandle | undefined> {
  const { world, host } = args;
  const assets = host?.assets;
  if (assets === undefined) {
    console.error(
      "[aetherfall] threshold monument unavailable: asset registry missing",
    );
    return undefined;
  }

  const doorGuid = AssetGuid.parse(THRESHOLD_DOOR_SCENE_GUID);
  const sentinelGuid = AssetGuid.parse(GOTHIC_SENTINEL_SCENE_GUID);
  if (!doorGuid.ok || !sentinelGuid.ok) {
    throw new Error("[aetherfall] threshold monument scene GUID is invalid");
  }

  const [doorScene, sentinelScene] = (await Promise.all([
    assets.loadByGuid<SceneAsset>(doorGuid.value),
    assets.loadByGuid<SceneAsset>(sentinelGuid.value),
  ])) as [SceneLoad, SceneLoad];
  if (!doorScene.ok) {
    console.error(
      `[aetherfall] threshold monument load failed: door ${doorScene.error.code}`,
    );
    return undefined;
  }
  if (!sentinelScene.ok) {
    console.error(
      `[aetherfall] threshold monument load failed: sentinel ${sentinelScene.error.code}`,
    );
    return undefined;
  }

  const ownedRoots: OwnedRoot[] = [];
  const door = instantiateSceneAsset(world, assets, doorScene.value as SceneAsset);
  if (!door.ok) {
    console.error(
      `[aetherfall] threshold monument instantiate failed: door ${door.error.code}`,
    );
    return undefined;
  }
  ownedRoots.push({ root: door.value, owned: true });
  const cleanupOwner = createThresholdCleanupOwner(world, ownedRoots);

  let sentinel: ReturnType<typeof instantiateSceneAsset>;
  try {
    sentinel = instantiateSceneAsset(
      world,
      assets,
      sentinelScene.value as SceneAsset,
    );
  } catch (error) {
    throwAfterFailedRollback({
      primary: error,
      rollbackErrors: cleanupRoots(world, ownedRoots),
      residualCleanup: cleanupOwner,
      message: "Threshold monument instantiation and rollback failed",
    });
  }
  if (!sentinel.ok) {
    const cleanupErrors = cleanupRoots(world, ownedRoots);
    console.error(
      `[aetherfall] threshold monument instantiate failed: sentinel ${sentinel.error.code}`,
    );
    if (cleanupErrors.length > 0)
      throwAfterFailedRollback({
        primary: sentinel.error,
        rollbackErrors: cleanupErrors,
        residualCleanup: cleanupOwner,
        message: "Threshold monument instantiation and rollback failed",
      });
    return undefined;
  }
  ownedRoots.push({ root: sentinel.value, owned: true });

  try {
    placeRoot(
      world,
      door.value,
      THRESHOLD_DOOR_POSITION,
      THRESHOLD_DOOR_SCALE,
      THRESHOLD_DOOR_YAW,
    );
    placeRoot(
      world,
      sentinel.value,
      GOTHIC_SENTINEL_POSITION,
      GOTHIC_SENTINEL_SCALE,
      GOTHIC_SENTINEL_YAW,
    );
  } catch (error) {
    throwAfterFailedRollback({
      primary: error,
      rollbackErrors: cleanupRoots(world, ownedRoots),
      residualCleanup: cleanupOwner,
      message: "Threshold monument placement and rollback failed",
    });
  }

  return {
    doorRoot: door.value,
    sentinelRoot: sentinel.value,
    ...cleanupOwner,
  };
}
