import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AnimationPlayer } from '@forgeax/engine-animation';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { SceneInstance } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { Skin } from '@forgeax/engine-skinning';
import type { AnimationClip, Handle, SceneAsset } from '@forgeax/engine-types';

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
};

export type FbxSkinnedTarget = {
  readonly root: EntityHandle;
  readonly skinEntity: EntityHandle;
  readonly triggerHit: () => void;
  readonly reset: () => void;
  readonly dispose: () => void;
  readonly snapshot: () => FbxSkinnedTargetSnapshot;
};

type Args = {
  readonly world: World;
  readonly assets: AssetRegistry | undefined;
  readonly position?: readonly [number, number, number];
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

  const sceneHandle = args.world.allocSharedRef('SceneAsset', sceneResult.value);
  const instanceResult = args.assets.instantiate(sceneHandle, args.world);
  if (!instanceResult.ok) {
    console.warn(`[game] FBX skin instantiate failed: ${instanceResult.error.code} — ${instanceResult.error.hint}`);
    return undefined;
  }
  const root = instanceResult.value;
  const instance = args.world.get(root, SceneInstance);
  if (!instance.ok) return undefined;
  let skinEntity: EntityHandle | undefined;
  for (const raw of instance.value.mapping) {
    if (raw === undefined || raw === 0 || raw === 0xffffffff) continue;
    const entity = raw as EntityHandle;
    if (args.world.get(entity, Skin).ok) {
      skinEntity = entity;
      break;
    }
  }
  if (skinEntity === undefined) return undefined;

  const position = args.position ?? [0, 0, 0];
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
  args.world.addComponent(skinEntity, {
    component: AnimationPlayer,
    data: { clips: [clipHandle], times: [0], weights: [1], speeds: [1], looping: true },
  });

  let hitPulses = 0;
  const triggerHit = (): void => {
    const player = args.world.get(skinEntity, AnimationPlayer);
    if (!player.ok) return;
    args.world.set(skinEntity, AnimationPlayer, { times: [0], paused: false });
    hitPulses += 1;
  };
  const reset = (): void => {
    args.world.set(root, Transform, rootPlacementTransform);
    args.world.set(skinEntity, Transform, skinPlacementTransform);
    args.world.set(skinEntity, AnimationPlayer, { times: [0], paused: false, looping: true });
    hitPulses = 0;
  };
  const dispose = (): void => {
    args.world.despawnScene(root);
  };
  return {
    root,
    skinEntity,
    triggerHit,
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
