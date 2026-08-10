import {
  AnimationPlayer,
  AnimationTargetId,
  bindAnimationTargets,
} from "@forgeax/engine-animation";
import type { BootstrapContext } from "@forgeax/engine-app";
import {
  ENTITY_NULL_RAW,
  Entity,
  Update,
  createQueryState,
  queryRun,
  type EntityHandle,
  type World,
} from "@forgeax/engine-ecs";
import { AssetGuid } from "@forgeax/engine-pack/guid";
import { MeshRenderer, SceneInstance } from "@forgeax/engine-render";
import { ChildOf, Transform } from "@forgeax/engine-scene";
import { Skin } from "@forgeax/engine-skinning";
import type {
  AnimationClip,
  Handle,
  MaterialAsset,
  SceneAsset,
} from "@forgeax/engine-types";
import type { InputSnapshot } from "@forgeax/engine-input";
import { PlayerBodyPart } from "./components/gameplay";
import { instantiateSceneAsset } from "./scene-asset-instance";
import {
  readPlayerMovementOutcome,
  type PlayerMovementOutcome,
} from "./systems/player-movement";

export const FOX_SCENE_GUID = "019fdd58-2e01-7b74-a568-bb8340e30734";
export const FOX_CLIP_GUIDS = {
  idle: "019fdd58-2e01-7b74-a568-bb8b4d30fdaa",
  walk: "019fdd58-2e01-7b74-a568-bb9177671295",
  gallop: "019fdd58-2e01-7b74-a568-bb8910831820",
} as const;

// Quaternius Fox is authored facing +Z and is 2.68 source units tall. Scale it
// to the authored gameplay capsule, then turn +Z onto gameplay forward (-Z).
export const FOX_WORLD_SCALE = 0.5;
export const FOX_FEET_OFFSET_Y = -0.75;
export const FOX_FORWARD_ROTATION = [0, 1, 0, 0] as const;
export const FOX_PRESENTATION_ROUGHNESS = 0.42;
export const FOX_PRESENTATION_CLEARCOAT = 0.08;
export const FOX_PRESENTATION_CLEARCOAT_ROUGHNESS = 0.32;
const FOX_MATERIAL_SLOT_COUNT = 5;
export const FOX_LOCOMOTION_SYSTEM_NAME = "aetherfall-fox-locomotion";

type ClipHandle = Handle<"AnimationClip", "shared">;
type Scale3 = readonly [number, number, number];

type AuthoredPlayerBodyPartSnapshot = {
  readonly entity: EntityHandle;
  readonly baseScale: Scale3;
  readonly transformScale: Scale3;
};

export type FoxPlayerHandle = {
  readonly root: EntityHandle;
  readonly dispose: () => void;
};

const FOX_MOVEMENT_EPSILON = 1e-5;

/** Map the last completed fixed-step movement result onto Idle/Walk/Gallop. */
export function foxAnimationWeights(
  outcome: PlayerMovementOutcome | undefined,
): [number, number, number] {
  const moving =
    outcome !== undefined &&
    Number.isFinite(outcome.planarDistance) &&
    Number.isFinite(outcome.planarSpeed) &&
    outcome.planarDistance > FOX_MOVEMENT_EPSILON &&
    outcome.planarSpeed > FOX_MOVEMENT_EPSILON;
  if (!moving) return [1, 0, 0];
  return outcome.sprinting ? [0, 0, 1] : [0, 1, 0];
}

/** Install the component-owned clip references and release all caller grants. */
export function installFoxAnimationPlayer(
  world: World,
  root: EntityHandle,
  clips: readonly [ClipHandle, ClipHandle, ClipHandle],
): void {
  try {
    world
      .addComponent(root, {
        component: AnimationPlayer,
        data: {
          clips: [...clips],
          times: [0, 0, 0],
          weights: [1, 0, 0],
          speeds: [1, 1, 1],
          looping: true,
        },
      })
      .unwrap();
  } finally {
    for (let index = clips.length - 1; index >= 0; index -= 1) {
      world.sharedRefs.release(clips[index]!).unwrap();
    }
  }
}

/**
 * Preserve each imported Quaternius color/PBR chain while giving the stylized
 * coat a restrained specular break-up. A base-color texture is optional: this
 * source intentionally authors five solid-color PBR materials.
 */
export function withFoxPresentation(
  material: MaterialAsset,
): MaterialAsset | undefined {
  const baseColor = material.values?.baseColor;
  if (
    !material.passes?.some(
      (pass) => pass.program.module === "forgeax::pbr-skin",
    ) ||
    !Array.isArray(baseColor) ||
    baseColor.length !== 4
  )
    return undefined;
  return {
    ...material,
    values: {
      ...material.values,
      roughness: FOX_PRESENTATION_ROUGHNESS,
      clearcoat: FOX_PRESENTATION_CLEARCOAT,
      clearcoatRoughness: FOX_PRESENTATION_CLEARCOAT_ROUGHNESS,
    },
  };
}

/** Replace the five scene-owned material slots with private component clones. */
export function installFoxPresentationMaterials(
  world: World,
  entity: EntityHandle,
): boolean {
  const renderer = world.get(entity, MeshRenderer);
  if (
    !renderer.ok ||
    renderer.value.materials.length !== FOX_MATERIAL_SLOT_COUNT
  )
    return false;

  const presentations: MaterialAsset[] = [];
  for (const source of renderer.value.materials) {
    const resolved = world.sharedRefs.resolve<"MaterialAsset", MaterialAsset>(
      source,
    );
    if (!resolved.ok) return false;
    const presentation = withFoxPresentation(resolved.value);
    if (presentation === undefined) return false;
    presentations.push(presentation);
  }

  const materials: Handle<"MaterialAsset", "shared">[] = [];
  try {
    for (const presentation of presentations) {
      materials.push(world.allocSharedRef("MaterialAsset", presentation));
    }
    world.set(entity, MeshRenderer, { materials }).unwrap();
  } finally {
    // MeshRenderer owns the independent references retained by world.set().
    for (const material of materials)
      world.sharedRefs.release(material).unwrap();
  }
  return true;
}

async function loadAssetPayload<T>(
  assets: NonNullable<BootstrapContext["assets"]>,
  guidText: string,
): Promise<T | undefined> {
  const guid = AssetGuid.parse(guidText);
  if (!guid.ok) return undefined;
  const loaded = await assets.loadByGuid<T>(guid.value);
  return loaded.ok ? loaded.value : undefined;
}

async function loadFoxSourceAssets(
  assets: NonNullable<BootstrapContext["assets"]>,
): Promise<
  | {
      readonly scene: SceneAsset;
      readonly clips: readonly [AnimationClip, AnimationClip, AnimationClip];
    }
  | undefined
> {
  const settled = await Promise.allSettled([
    loadAssetPayload<SceneAsset>(assets, FOX_SCENE_GUID),
    loadAssetPayload<AnimationClip>(assets, FOX_CLIP_GUIDS.idle),
    loadAssetPayload<AnimationClip>(assets, FOX_CLIP_GUIDS.walk),
    loadAssetPayload<AnimationClip>(assets, FOX_CLIP_GUIDS.gallop),
  ] as const);
  const [sceneResult, idleResult, walkResult, gallopResult] = settled;
  if (
    sceneResult.status === "rejected" ||
    idleResult.status === "rejected" ||
    walkResult.status === "rejected" ||
    gallopResult.status === "rejected"
  ) {
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    console.warn(
      `[aetherfall] Fox player unavailable: asset loader rejected: ${String(rejected?.reason)}`,
    );
    return undefined;
  }
  const scene = sceneResult.value;
  const idle = idleResult.value;
  const walk = walkResult.value;
  const gallop = gallopResult.value;
  if (
    scene === undefined ||
    idle === undefined ||
    walk === undefined ||
    gallop === undefined
  ) {
    console.warn(
      "[aetherfall] Fox player unavailable: shared scene or clips failed to load",
    );
    return undefined;
  }
  return { scene, clips: [idle, walk, gallop] };
}

function runCleanupSteps(steps: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Fox lifecycle cleanup failed");
}

function releaseClipGrants(world: World, clips: readonly ClipHandle[]): void {
  const steps: Array<() => void> = [];
  for (let index = clips.length - 1; index >= 0; index -= 1) {
    const clip = clips[index]!;
    steps.push(() => world.sharedRefs.release(clip).unwrap());
  }
  runCleanupSteps(steps);
}

function hideAuthoredBlockPlayer(world: World): () => void {
  const query = createQueryState({ with: [PlayerBodyPart, Transform, Entity] });
  const snapshots: AuthoredPlayerBodyPartSnapshot[] = [];
  queryRun(query, world, (bundle) => {
    for (let index = 0; index < bundle.Entity.self.length; index += 1) {
      const entity = bundle.Entity.self[index] as EntityHandle | undefined;
      if (entity === undefined) continue;
      const bodyPart = world.get(entity, PlayerBodyPart);
      const transform = world.get(entity, Transform);
      if (!bodyPart.ok || !transform.ok) continue;
      snapshots.push({
        entity,
        baseScale: [
          bodyPart.value.baseScaleX,
          bodyPart.value.baseScaleY,
          bodyPart.value.baseScaleZ,
        ],
        transformScale: [
          transform.value.scale[0] ?? 1,
          transform.value.scale[1] ?? 1,
          transform.value.scale[2] ?? 1,
        ],
      });
    }
  });
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    const steps: Array<() => void> = [];
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index]!;
      steps.push(() => {
        if (world.get(snapshot.entity, PlayerBodyPart).ok) {
          world
            .set(snapshot.entity, PlayerBodyPart, {
              baseScaleX: snapshot.baseScale[0],
              baseScaleY: snapshot.baseScale[1],
              baseScaleZ: snapshot.baseScale[2],
            })
            .unwrap();
        }
        if (world.get(snapshot.entity, Transform).ok) {
          world
            .set(snapshot.entity, Transform, {
              scale: [...snapshot.transformScale],
            })
            .unwrap();
        }
      });
    }
    runCleanupSteps(steps);
    restored = true;
  };
  try {
    for (const snapshot of snapshots) {
      world
        .set(snapshot.entity, PlayerBodyPart, {
          baseScaleX: 0,
          baseScaleY: 0,
          baseScaleZ: 0,
        })
        .unwrap();
      world.set(snapshot.entity, Transform, { scale: [0, 0, 0] }).unwrap();
    }
  } catch (error) {
    try {
      restore();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Fox visibility installation and rollback failed",
      );
    }
    throw error;
  }
  return restore;
}

/** Own the live locomotion system, Fox scene root, and graybox visibility lease. */
export function installFoxPlayerRuntime(
  world: World,
  root: EntityHandle,
  _readInput: () => InputSnapshot,
  movementEntity: EntityHandle = root,
): FoxPlayerHandle {
  const restoreAuthoredPlayer = hideAuthoredBlockPlayer(world);
  let previousWeights = "1,0,0";
  let systemInstalled = false;
  try {
    world
      .addSystem(Update, {
        name: FOX_LOCOMOTION_SYSTEM_NAME,
        queries: [],
        after: ["game-player-movement"],
        fn: () => {
          const weights = foxAnimationWeights(
            readPlayerMovementOutcome(world, movementEntity),
          );
          const signature = weights.join(",");
          if (signature === previousWeights) return;
          previousWeights = signature;
          world.set(root, AnimationPlayer, { weights });
        },
      })
      .unwrap();
    systemInstalled = true;
  } catch (error) {
    try {
      runCleanupSteps([
        () => world.despawnScene(root).unwrap(),
        restoreAuthoredPlayer,
      ]);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Fox runtime installation and rollback failed",
      );
    }
    throw error;
  }

  let rootOwned = true;
  let visibilityOwned = true;
  return {
    root,
    dispose: () => {
      const steps: Array<() => void> = [];
      if (systemInstalled) {
        steps.push(() => {
          world.removeSystem(Update, FOX_LOCOMOTION_SYSTEM_NAME).unwrap();
          systemInstalled = false;
        });
      }
      if (rootOwned) {
        steps.push(() => {
          world.despawnScene(root).unwrap();
          rootOwned = false;
        });
      }
      if (visibilityOwned) {
        steps.push(() => {
          restoreAuthoredPlayer();
          visibilityOwned = false;
        });
      }
      runCleanupSteps(steps);
    },
  };
}

/** Attach the licensed Quaternius Fox rig to the authored gameplay root. */
export async function createFoxPlayer(args: {
  readonly world: World;
  readonly host: BootstrapContext | undefined;
  readonly player: EntityHandle;
  readonly readInput: () => InputSnapshot;
}): Promise<FoxPlayerHandle | undefined> {
  const { world, host, player, readInput } = args;
  const assets = host?.assets;
  if (assets === undefined) {
    console.warn("[aetherfall] Fox player unavailable: asset registry missing");
    return undefined;
  }

  const source = await loadFoxSourceAssets(assets);
  if (source === undefined) return undefined;
  const allocatedClips: ClipHandle[] = [];
  try {
    for (const clip of source.clips)
      allocatedClips.push(world.allocSharedRef("AnimationClip", clip));
  } catch (error) {
    try {
      releaseClipGrants(world, allocatedClips);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Fox clip allocation and rollback failed",
      );
    }
    throw error;
  }
  const clips = allocatedClips as unknown as readonly [
    ClipHandle,
    ClipHandle,
    ClipHandle,
  ];
  let callerOwnsClipGrants = true;
  let root: EntityHandle | undefined;
  let runtimeOwnsRoot = false;
  const cleanupInstall = (): void => {
    const cleanupRoot =
      root !== undefined && !runtimeOwnsRoot ? root : undefined;
    const cleanupClips = callerOwnsClipGrants;
    root = undefined;
    callerOwnsClipGrants = false;
    const steps: Array<() => void> = [];
    if (cleanupRoot !== undefined)
      steps.push(() => world.despawnScene(cleanupRoot).unwrap());
    if (cleanupClips) steps.push(() => releaseClipGrants(world, clips));
    runCleanupSteps(steps);
  };
  const instantiated = instantiateSceneAsset(world, assets, source.scene);
  if (!instantiated.ok) {
    cleanupInstall();
    console.warn(
      `[aetherfall] Fox player instantiate failed: ${instantiated.error.code}`,
    );
    return undefined;
  }
  root = instantiated.value;
  try {
    world
      .set(root, Transform, {
        pos: [0, FOX_FEET_OFFSET_Y, 0],
        quat: [...FOX_FORWARD_ROTATION],
        scale: [FOX_WORLD_SCALE, FOX_WORLD_SCALE, FOX_WORLD_SCALE],
      })
      .unwrap();
    world
      .addComponent(root, { component: ChildOf, data: { parent: player } })
      .unwrap();

    const instance = world.get(root, SceneInstance);
    const animationTargets: EntityHandle[] = [];
    let hasSkin = false;
    let foxRenderable: EntityHandle | undefined;
    if (instance.ok) {
      for (const raw of instance.value.mapping) {
        if (raw === undefined || raw === ENTITY_NULL_RAW) continue;
        const entity = raw as EntityHandle;
        if (world.get(entity, AnimationTargetId).ok)
          animationTargets.push(entity);
        if (world.get(entity, Skin).ok) {
          hasSkin = true;
          if (world.get(entity, MeshRenderer).ok) foxRenderable = entity;
        }
      }
    }
    if (
      !hasSkin ||
      foxRenderable === undefined ||
      !installFoxPresentationMaterials(world, foxRenderable)
    ) {
      cleanupInstall();
      console.warn(
        "[aetherfall] Fox player unavailable: five-slot pbr-skin renderable invariant failed",
      );
      return undefined;
    }

    try {
      installFoxAnimationPlayer(world, root, clips);
    } finally {
      callerOwnsClipGrants = false;
    }
    const bound = bindAnimationTargets(world, root, animationTargets);
    if (!bound.ok) {
      cleanupInstall();
      console.warn(
        `[aetherfall] Fox animation binding failed: ${bound.error.code}`,
      );
      return undefined;
    }

    runtimeOwnsRoot = true;
    return installFoxPlayerRuntime(world, root, readInput, player);
  } catch (error) {
    try {
      cleanupInstall();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Fox installation and rollback failed",
      );
    }
    throw error;
  }
}
