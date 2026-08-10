import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { PhysicsWorld } from '@forgeax/engine-physics';
import { AnimationPlayer } from '@forgeax/engine-animation';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { SceneInstance, Visibility, VisibilityStateValue, visibilityStateFromU32 } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { Skin } from '@forgeax/engine-skinning';
import type { AnimationClip, Handle, SceneAsset } from '@forgeax/engine-types';
import { vec3 } from '@forgeax/engine-math';
import { installFbxTargetCompanionSystem } from './systems/fbx-target-companion';
import { instantiateSceneAsset } from './scene-asset-instance';

export const GAME_DEFAULT_FBX_SKIN_SCENE_GUID = '019ecd87-179b-7eb3-a37d-391f05c61e52';
export const GAME_DEFAULT_FBX_SKIN_CLIP_GUID = '019ecd87-179b-71f7-b9f8-4c8518326b65';

export type FbxSkinnedTargetSnapshot = {
  readonly available: boolean;
  readonly root: EntityHandle | null;
  readonly skinEntity: EntityHandle | null;
  readonly clipGuid: string | null;
  readonly jointCount: number;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly worldMatrix: readonly number[];
  readonly animationTime: number;
  readonly hitPulses: number;
  readonly companionActive: boolean;
  readonly targetEntity: EntityHandle | null;
};

export type FbxSkinnedTarget = {
  readonly root: EntityHandle;
  readonly skinEntity: EntityHandle;
  readonly triggerHit: () => void;
  readonly reactToHit: (entity: EntityHandle) => boolean;
  readonly toggleCompanion: () => boolean;
  readonly companionActive: () => boolean;
  readonly reset: () => void;
  readonly dispose: () => void;
  readonly snapshot: () => FbxSkinnedTargetSnapshot;
};

type Args = {
  readonly world: World;
  readonly assets: AssetRegistry | undefined;
  readonly physics?: PhysicsWorld;
  readonly position?: readonly [number, number, number];
  readonly target?: EntityHandle;
};

function parseGuid(text: string): ReturnType<typeof AssetGuid.parse> {
  return AssetGuid.parse(text);
}

/** Load one authored FBX scene and make its animation a participant in the game loop. */
export async function createFbxSkinnedTarget(args: Args): Promise<FbxSkinnedTarget | undefined> {
  if (args.assets === undefined) return undefined;
  const sceneGuid = parseGuid(GAME_DEFAULT_FBX_SKIN_SCENE_GUID);
  const clipGuid = parseGuid(GAME_DEFAULT_FBX_SKIN_CLIP_GUID);
  if (!sceneGuid.ok || !clipGuid.ok) return undefined;

  const sceneResult = await args.assets.loadByGuid<SceneAsset>(sceneGuid.value);
  if (!sceneResult.ok) {
    console.warn(`[game] FBX skin scene unavailable: ${sceneResult.error.code} — ${sceneResult.error.hint}`);
    return undefined;
  }
  const clipResult = await args.assets.loadByGuid<AnimationClip>(clipGuid.value);
  if (!clipResult.ok) {
    console.warn(`[game] FBX skin clip unavailable: ${clipResult.error.code} — ${clipResult.error.hint}`);
    return undefined;
  }

  const instanceResult = instantiateSceneAsset(args.world, args.assets, sceneResult.value);
  if (!instanceResult.ok) {
    console.warn(`[game] FBX skin instantiate failed: ${instanceResult.error.code} — ${instanceResult.error.hint}`);
    return undefined;
  }
  const root = instanceResult.value;
  const instance = args.world.get(root, SceneInstance);
  if (!instance.ok) {
    args.world.despawnScene(root);
    return undefined;
  }
  let skinEntity: EntityHandle | undefined;
  for (const raw of instance.value.mapping) {
    if (raw === undefined || raw === 0 || raw === 0xffffffff) continue;
    const entity = raw as EntityHandle;
    if (args.world.get(entity, Skin).ok) {
      skinEntity = entity;
      break;
    }
  }
  if (skinEntity === undefined) {
    args.world.despawnScene(root);
    return undefined;
  }

  const targetTransform = args.target === undefined ? undefined : args.world.get(args.target, Transform);
  const targetPlacementTransform = targetTransform?.ok === true
    ? {
        pos: [targetTransform.value.pos[0] ?? 0, targetTransform.value.pos[1] ?? 0, targetTransform.value.pos[2] ?? 0] as [number, number, number],
        quat: [targetTransform.value.quat[0] ?? 0, targetTransform.value.quat[1] ?? 0, targetTransform.value.quat[2] ?? 0, targetTransform.value.quat[3] ?? 1] as [number, number, number, number],
        scale: [targetTransform.value.scale[0] ?? 1, targetTransform.value.scale[1] ?? 1, targetTransform.value.scale[2] ?? 1] as [number, number, number],
      }
    : undefined;
  const targetPosition = targetTransform?.ok === true
    ? [targetTransform.value.pos[0] ?? 0, targetTransform.value.pos[1] ?? 0, targetTransform.value.pos[2] ?? 0] as [number, number, number]
    : undefined;
  const position = args.position ?? targetPosition ?? [0, 0, 0];
  const rootTransform = args.world.get(root, Transform);
  const rootPlacementTransform = {
    pos: [position[0], position[1], position[2]] as [number, number, number],
    quat: rootTransform.ok
      ? [rootTransform.value.quat[0] ?? 0, rootTransform.value.quat[1] ?? 0, rootTransform.value.quat[2] ?? 0, rootTransform.value.quat[3] ?? 1] as [number, number, number, number]
      : [0, 0, 0, 1] as [number, number, number, number],
    scale: [0.03, 0.03, 0.03] as [number, number, number],
  };
  args.world.set(root, Transform, rootPlacementTransform);
  const skinTransform = args.world.get(skinEntity, Transform);
  const initialTransform = skinTransform.ok
    ? {
        quat: [skinTransform.value.quat[0] ?? 0, skinTransform.value.quat[1] ?? 0, skinTransform.value.quat[2] ?? 0, skinTransform.value.quat[3] ?? 1] as [number, number, number, number],
      }
    : { quat: [0, 0, 0, 1] as [number, number, number, number] };
  const skinPlacementTransform = {
    pos: [0, 0, 0] as [number, number, number],
    quat: initialTransform.quat,
    scale: [1, 1, 1] as [number, number, number],
  };
  args.world.set(skinEntity, Transform, {
    pos: skinPlacementTransform.pos,
    quat: skinPlacementTransform.quat,
    scale: skinPlacementTransform.scale,
  });

  const clipHandle: Handle<'AnimationClip', 'shared'> = args.world.allocSharedRef('AnimationClip', clipResult.value);
  const animationPlayer = (() => {
    try {
      return args.world.addComponent(skinEntity, {
        component: AnimationPlayer,
        data: { clips: [clipHandle], times: [0], weights: [1], speeds: [1], looping: true, paused: args.target !== undefined },
      });
    } finally {
      args.world.sharedRefs.release(clipHandle).unwrap();
    }
  })();
  if (!animationPlayer.ok) {
    args.world.despawnScene(root);
    return undefined;
  }

  const rootVisibility = args.world.get(root, Visibility);
  const rootInitialVisibility = rootVisibility.ok
    ? visibilityStateFromU32(rootVisibility.value.state) ?? 'inherited'
    : 'inherited';
  if (!rootVisibility.ok) {
    const added = args.world.addComponent(root, {
      component: Visibility,
      data: { state: VisibilityStateValue.inherited },
    });
    if (!added.ok) {
      args.world.despawnScene(root);
      return undefined;
    }
  }
  const targetInitialVisibility = args.target === undefined
    ? 'inherited'
    : (() => {
      const value = args.world.get(args.target, Visibility);
      return value.ok ? visibilityStateFromU32(value.value.state) ?? 'inherited' : 'inherited';
    })();

  let hitPulses = 0;
  let companionActive = false;
  const setVisibility = (entity: EntityHandle, state: keyof typeof VisibilityStateValue): void => {
    args.world.set(entity, Visibility, { state: VisibilityStateValue[state] });
  };
  const triggerHit = (): void => {
    const player = args.world.get(skinEntity, AnimationPlayer);
    if (!player.ok) return;
    args.world.set(skinEntity, AnimationPlayer, { times: [0], paused: false });
    hitPulses += 1;
  };
  const reactToHit = (entity: EntityHandle): boolean => {
    if (!companionActive || args.target !== entity) return false;
    triggerHit();
    return true;
  };
  const syncToTarget = (): void => {
    if (args.target === undefined) return;
    const target = args.world.get(args.target, Transform);
    if (!target.ok) return;
    args.world.set(root, Transform, {
      pos: [target.value.pos[0] ?? 0, target.value.pos[1] ?? 0, target.value.pos[2] ?? 0],
      quat: rootPlacementTransform.quat,
      scale: rootPlacementTransform.scale,
    });
  };
  const restoreTargetPlacement = (): void => {
    if (args.target === undefined || targetPlacementTransform === undefined) return;
    args.world.set(args.target, Transform, targetPlacementTransform);
    if (args.physics?.hasBody(args.target)) {
      args.physics.teleport(args.target, vec3.create(targetPlacementTransform.pos[0], targetPlacementTransform.pos[1], targetPlacementTransform.pos[2]));
    }
  };
  const toggleCompanion = (): boolean => {
    if (args.target === undefined) return false;
    companionActive = !companionActive;
    if (companionActive) restoreTargetPlacement();
    setVisibility(root, companionActive ? 'visible' : rootInitialVisibility);
    setVisibility(args.target, companionActive ? 'hidden' : targetInitialVisibility);
    if (companionActive) syncToTarget();
    else restoreTargetPlacement();
    args.world.set(skinEntity, AnimationPlayer, { paused: !companionActive });
    return companionActive;
  };
  if (args.target !== undefined) {
    setVisibility(root, 'hidden');
    installFbxTargetCompanionSystem({
      world: args.world,
      target: args.target,
      root,
      isActive: () => companionActive,
      rootQuat: rootPlacementTransform.quat,
      rootScale: rootPlacementTransform.scale,
    });
  }
  const reset = (): void => {
    companionActive = false;
    if (args.target !== undefined) setVisibility(args.target, targetInitialVisibility);
    setVisibility(root, args.target === undefined ? rootInitialVisibility : 'hidden');
    args.world.set(root, Transform, rootPlacementTransform);
    args.world.set(skinEntity, Transform, skinPlacementTransform);
    args.world.set(skinEntity, AnimationPlayer, { times: [0], paused: args.target !== undefined, looping: true });
    hitPulses = 0;
  };
  const dispose = (): void => {
    if (args.target !== undefined) setVisibility(args.target, targetInitialVisibility);
    args.world.despawnScene(root);
  };
  return {
    root,
    skinEntity,
    triggerHit,
    reactToHit,
    toggleCompanion,
    companionActive: () => companionActive,
    reset,
    dispose,
    snapshot: () => {
      const player = args.world.get(skinEntity, AnimationPlayer);
      const skin = args.world.get(skinEntity, Skin);
      return {
        available: true,
        root,
        skinEntity,
        clipGuid: GAME_DEFAULT_FBX_SKIN_CLIP_GUID,
        jointCount: skin.ok ? skin.value.joints.length : 0,
        position: playerTransform(args.world, root).position,
        scale: playerTransform(args.world, root).scale,
        worldMatrix: playerTransform(args.world, root).worldMatrix,
        animationTime: player.ok ? (player.value.times[0] ?? 0) : 0,
        hitPulses,
        companionActive,
        targetEntity: args.target ?? null,
      };
    },
  };
}

function playerTransform(world: World, entity: EntityHandle): {
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly worldMatrix: readonly number[];
} {
  const transform = world.get(entity, Transform);
  if (!transform.ok) return { position: [0, 0, 0], scale: [1, 1, 1], worldMatrix: [] };
  return {
    position: [transform.value.pos[0] ?? 0, transform.value.pos[1] ?? 0, transform.value.pos[2] ?? 0],
    scale: [transform.value.scale[0] ?? 1, transform.value.scale[1] ?? 1, transform.value.scale[2] ?? 1],
    worldMatrix: Array.from(transform.value.world),
  };
}
