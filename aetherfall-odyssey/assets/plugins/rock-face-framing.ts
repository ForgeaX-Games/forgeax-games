import type { BootstrapContext } from "@forgeax/engine-app";
import type { EntityHandle, World } from "@forgeax/engine-ecs";
import { AssetGuid } from "@forgeax/engine-pack/guid";
import {
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
} from "@forgeax/engine-physics";
import { Name, Transform } from "@forgeax/engine-scene";
import type { SceneAsset } from "@forgeax/engine-types";
import { instantiateSceneAsset } from "./scene-asset-instance";
import {
  throwAfterFailedRollback,
  type ResidualCleanupOwner,
} from "./world-installation-lifecycle";

export const ROCK_FACE_SCENE_GUID = "019fde01-daea-7c2d-aeab-0b80822a2445";

export const ROCK_FACE_FRAMING_PLACEMENTS = [
  {
    id: "left",
    position: [-9.8, -1.35, 0.65],
    scale: 1.6,
    yaw: 0.24,
  },
  {
    id: "right",
    position: [10.1, -1.45, -0.4],
    scale: 1.72,
    yaw: -0.31,
  },
] as const;

// Source-space bounds are approximately [-2.13, -0.03, -3.47] to
// [2.82, 3.53, 0.36]. The inset box follows the dense interior rather than
// the irregular silhouette, avoiding invisible collision in chipped corners.
const ROCK_COLLIDER_LOCAL_CENTER = [0.343, 1.748, -1.552] as const;
const ROCK_COLLIDER_LOCAL_HALF_EXTENTS = [2.03, 1.46, 1.57] as const;

export type RockFaceFramingHandle = ResidualCleanupOwner & {
  readonly roots: readonly EntityHandle[];
  readonly colliders: readonly EntityHandle[];
};

type OwnedEntity = {
  readonly entity: EntityHandle;
  owned: boolean;
};

function cleanupFraming(
  world: World,
  roots: readonly OwnedEntity[],
  colliders: readonly OwnedEntity[],
): unknown[] {
  const errors: unknown[] = [];
  const cleanup = (
    entries: readonly OwnedEntity[],
    despawn: (entity: EntityHandle) =>
      | { readonly ok: true }
      | { readonly ok: false; readonly error: unknown },
  ): void => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!;
      if (!entry.owned) continue;
      try {
        if (!world.get(entry.entity, Transform).ok) {
          entry.owned = false;
          continue;
        }
        const result = despawn(entry.entity);
        if (result.ok) entry.owned = false;
        else errors.push(result.error);
      } catch (error) {
        try {
          if (!world.get(entry.entity, Transform).ok) entry.owned = false;
        } catch {
          // Retain ownership for a later retry when liveness cannot be observed.
        }
        errors.push(error);
      }
    }
  };
  cleanup(colliders, (entity) => world.despawn(entity));
  cleanup(roots, (entity) => world.despawnScene(entity));
  return errors;
}

function createFramingCleanupOwner(
  world: World,
  roots: readonly OwnedEntity[],
  colliders: readonly OwnedEntity[],
): ResidualCleanupOwner {
  return {
    label: "Rock Face framing",
    hasPending: () =>
      roots.some((entry) => entry.owned) ||
      colliders.some((entry) => entry.owned),
    dispose: () => {
      const errors = cleanupFraming(world, roots, colliders);
      if (errors.length > 0)
        throw new AggregateError(errors, "Rock Face framing cleanup failed");
    },
  };
}

function placeRoot(
  world: World,
  root: EntityHandle,
  placement: (typeof ROCK_FACE_FRAMING_PLACEMENTS)[number],
): void {
  const halfYaw = placement.yaw * 0.5;
  world
    .set(root, Transform, {
      pos: [...placement.position],
      quat: [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
      scale: [placement.scale, placement.scale, placement.scale],
    })
    .unwrap();
}

function spawnPhysicalMass(
  world: World,
  placement: (typeof ROCK_FACE_FRAMING_PLACEMENTS)[number],
): EntityHandle {
  const cosine = Math.cos(placement.yaw);
  const sine = Math.sin(placement.yaw);
  const localX = ROCK_COLLIDER_LOCAL_CENTER[0] * placement.scale;
  const localZ = ROCK_COLLIDER_LOCAL_CENTER[2] * placement.scale;
  const halfYaw = placement.yaw * 0.5;
  return world
    .spawn(
      {
        component: Name,
        data: { value: `AetherfallRockFace_${placement.id}` },
      },
      {
        component: Transform,
        data: {
          pos: [
            placement.position[0] + cosine * localX + sine * localZ,
            placement.position[1] +
              ROCK_COLLIDER_LOCAL_CENTER[1] * placement.scale,
            placement.position[2] - sine * localX + cosine * localZ,
          ],
          quat: [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
          scale: [1, 1, 1],
        },
      },
      {
        component: RigidBody,
        data: { type: RigidBodyTypeValue.static },
      },
      {
        component: Collider,
        data: {
          shape: ColliderShapeValue.cuboid,
          halfExtents: ROCK_COLLIDER_LOCAL_HALF_EXTENTS.map(
            (value) => value * placement.scale,
          ),
          friction: 0.9,
          restitution: 0,
        },
      },
    )
    .unwrap();
}

/**
 * Frame the opening route with two imported photogrammetry side masses. The
 * pair is one owner: both visual roots exist before either collider is added,
 * and every partial mutation is rolled back in reverse order.
 */
export async function createRockFaceFraming(args: {
  readonly world: World;
  readonly host: BootstrapContext | undefined;
}): Promise<RockFaceFramingHandle | undefined> {
  const { world, host } = args;
  const assets = host?.assets;
  if (assets === undefined) {
    console.error(
      "[aetherfall] Rock Face framing unavailable: asset registry missing",
    );
    return undefined;
  }

  const guid = AssetGuid.parse(ROCK_FACE_SCENE_GUID);
  if (!guid.ok) throw new Error("[aetherfall] Rock Face scene GUID is invalid");
  const scene = await assets.loadByGuid<SceneAsset>(guid.value);
  if (!scene.ok) {
    console.error(
      `[aetherfall] Rock Face framing load failed: ${scene.error.code}`,
    );
    return undefined;
  }

  const ownedRoots: OwnedEntity[] = [];
  const ownedColliders: OwnedEntity[] = [];
  const cleanupOwner = createFramingCleanupOwner(
    world,
    ownedRoots,
    ownedColliders,
  );

  for (const placement of ROCK_FACE_FRAMING_PLACEMENTS) {
    let instance: ReturnType<typeof instantiateSceneAsset>;
    try {
      instance = instantiateSceneAsset(world, assets, scene.value);
    } catch (error) {
      throwAfterFailedRollback({
        primary: error,
        rollbackErrors: cleanupFraming(world, ownedRoots, ownedColliders),
        residualCleanup: cleanupOwner,
        message: "Rock Face framing instantiation and rollback failed",
      });
    }
    if (!instance.ok) {
      const cleanupErrors = cleanupFraming(
        world,
        ownedRoots,
        ownedColliders,
      );
      console.error(
        `[aetherfall] Rock Face framing instantiate failed: ${placement.id} ${instance.error.code}`,
      );
      if (cleanupErrors.length > 0)
        throwAfterFailedRollback({
          primary: instance.error,
          rollbackErrors: cleanupErrors,
          residualCleanup: cleanupOwner,
          message: "Rock Face framing instantiation and rollback failed",
        });
      return undefined;
    }
    ownedRoots.push({ entity: instance.value, owned: true });
  }

  try {
    for (
      let index = 0;
      index < ROCK_FACE_FRAMING_PLACEMENTS.length;
      index += 1
    ) {
      const placement = ROCK_FACE_FRAMING_PLACEMENTS[index]!;
      placeRoot(world, ownedRoots[index]!.entity, placement);
      ownedColliders.push({
        entity: spawnPhysicalMass(world, placement),
        owned: true,
      });
    }
  } catch (error) {
    throwAfterFailedRollback({
      primary: error,
      rollbackErrors: cleanupFraming(world, ownedRoots, ownedColliders),
      residualCleanup: cleanupOwner,
      message: "Rock Face framing installation and rollback failed",
    });
  }

  const roots = ownedRoots.map((entry) => entry.entity);
  const colliders = ownedColliders.map((entry) => entry.entity);
  return {
    roots,
    colliders,
    ...cleanupOwner,
  };
}
