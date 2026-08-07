import {
  AnimationPlayer,
  AnimationTargetId,
  bindAnimationTargets,
} from '@forgeax/engine-animation';
import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { ENTITY_NULL_RAW, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { quat } from '@forgeax/engine-math';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { MeshFilter, MeshRenderer, SceneInstance } from '@forgeax/engine-render';
import { ChildOf, Transform } from '@forgeax/engine-scene';
import { Skin } from '@forgeax/engine-skinning';
import type { AnimationClip, Handle, SceneAsset } from '@forgeax/engine-types';
import {
  applyWardenPose,
  createWardenRig,
  type WardenMotion,
  type WardenRig,
} from './echofall-warden';

export const ECHOFALL_CHARACTER_ROOT = '@shared/characters';
export const FOX_SCENE_GUID = '019f56f2-0ac0-776a-9d28-50eb5a9edeb8';
export const FOX_CLIP_GUIDS = {
  survey: '019f56f2-0ac0-776a-9d28-50efaa0ebd1f',
  walk: '019f56f2-0ac0-776a-9d28-50f060b82860',
  run: '019f56f2-0ac0-776a-9d28-50f1596ab5a5',
} as const;

type ClipHandle = Handle<'AnimationClip', 'shared'>;
type AvatarMode = 'skinned-fox' | 'procedural-warden';

export type AvatarSnapshot = {
  mode: AvatarMode;
  sourceRoot: typeof ECHOFALL_CHARACTER_ROOT;
  sceneGuid: typeof FOX_SCENE_GUID;
  animation: 'survey' | 'walk' | 'run';
  blend: readonly [number, number, number];
  targetCount: number;
  meshHandle: number | null;
  materialHandles: readonly number[];
  sceneMeshRefs: readonly (string | number)[];
  loadError: string | null;
};

export type EchofallAvatar = {
  readonly mode: AvatarMode;
  update(motion: WardenMotion, dt: number): void;
  snapshot(): AvatarSnapshot;
};

type SkinTargetCollection = {
  readonly skin: EntityHandle;
  readonly targets: readonly EntityHandle[];
};

function parsedGuid(raw: string): ReturnType<typeof AssetGuid.parse> {
  return AssetGuid.parse(raw);
}

async function loadShared<T>(assets: AssetRegistry, rawGuid: string): Promise<T> {
  const guid = parsedGuid(rawGuid);
  if (!guid.ok) throw new Error(`invalid-guid:${rawGuid}`);
  const loaded = await assets.loadByGuid<T>(guid.value);
  if (!loaded.ok) throw new Error(`${loaded.error.code}:${rawGuid}`);
  return loaded.value;
}

function collectSkinTargets(world: World, sceneRoot: EntityHandle): SkinTargetCollection {
  const instance = world.get(sceneRoot, SceneInstance);
  if (!instance.ok) throw new Error('scene-instance-missing');
  let skin: EntityHandle | undefined;
  const targets: EntityHandle[] = [];
  for (const raw of instance.value.mapping) {
    if (raw === undefined || raw === ENTITY_NULL_RAW) continue;
    const entity = raw as EntityHandle;
    if (world.get(entity, AnimationTargetId).ok) targets.push(entity);
    if (skin === undefined && world.get(entity, Skin).ok) skin = entity;
  }
  if (skin === undefined) throw new Error('skin-target-missing');
  if (targets.length === 0) throw new Error('animation-targets-missing');
  return { skin, targets };
}

export function blendAvatarWeights(
  current: readonly [number, number, number],
  target: readonly [number, number, number],
  dt: number,
): [number, number, number] {
  const follow = 1 - Math.exp(-Math.max(0, dt) * 9.5);
  const next = current.map((weight, index) => weight + (target[index]! - weight) * follow) as [number, number, number];
  const sum = next[0] + next[1] + next[2];
  return sum > 0 ? [next[0] / sum, next[1] / sum, next[2] / sum] : [1, 0, 0];
}

function fallbackAvatar(world: World, player: EntityHandle, loadError: string): EchofallAvatar {
  const rig: WardenRig = createWardenRig(world, player);
  let animation: AvatarSnapshot['animation'] = 'survey';
  return {
    mode: 'procedural-warden',
    update(motion) {
      animation = motion.sprinting && motion.moving ? 'run' : motion.moving ? 'walk' : 'survey';
      applyWardenPose(world, rig, motion);
    },
    snapshot: () => ({
      mode: 'procedural-warden',
      sourceRoot: ECHOFALL_CHARACTER_ROOT,
      sceneGuid: FOX_SCENE_GUID,
      animation,
      blend: animation === 'survey' ? [1, 0, 0] : animation === 'walk' ? [0, 1, 0] : [0, 0, 1],
      targetCount: 0,
      meshHandle: null,
      materialHandles: [],
      sceneMeshRefs: [],
      loadError,
    }),
  };
}

/**
 * Loads the Studio-declared shared Fox, instantiates its skinned hierarchy, and
 * binds all three authored clips. A bounded procedural Warden is visible only
 * when the public shared-asset path genuinely fails, and that failure remains
 * observable through {@link AvatarSnapshot}.
 */
export async function createEchofallAvatar(
  world: World,
  assets: AssetRegistry | undefined,
  player: EntityHandle,
): Promise<EchofallAvatar> {
  if (!assets) return fallbackAvatar(world, player, 'asset-registry-unavailable');
  try {
    const [scene, survey, walk, run] = await Promise.all([
      loadShared<SceneAsset>(assets, FOX_SCENE_GUID),
      loadShared<AnimationClip>(assets, FOX_CLIP_GUIDS.survey),
      loadShared<AnimationClip>(assets, FOX_CLIP_GUIDS.walk),
      loadShared<AnimationClip>(assets, FOX_CLIP_GUIDS.run),
    ]);
    const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', scene);
    const sceneMeshRefs = scene.entities.flatMap((entity) => {
      const components = entity.components as Record<string, Record<string, unknown>>;
      const value = components.MeshFilter?.assetHandle;
      return typeof value === 'string' || typeof value === 'number' ? [value] : [];
    });
    const clipHandles: [ClipHandle, ClipHandle, ClipHandle] = [survey, walk, run].map((clip) =>
      world.allocSharedRef<'AnimationClip', AnimationClip>('AnimationClip', clip)) as [ClipHandle, ClipHandle, ClipHandle];
    const instantiated = assets.instantiate<SceneAsset>(sceneHandle, world);
    if (!instantiated.ok) throw new Error(`instantiate:${instantiated.error.code}`);
    const sceneRoot = instantiated.value;
    const facing = quat.create();
    quat.fromAxisAngle(facing, [0, 1, 0], Math.PI);
    world.set(sceneRoot, Transform, {
      pos: [0, -0.9, 0],
      quat: [facing[0]!, facing[1]!, facing[2]!, facing[3]!],
      scale: [0.012, 0.012, 0.012],
    });
    const parented = world.addComponent(sceneRoot, { component: ChildOf, data: { parent: player } });
    if (!parented.ok) throw new Error(`parent:${parented.error.code}`);
    const collected = collectSkinTargets(world, sceneRoot);
    const playerComponent = world.addComponent(sceneRoot, {
      component: AnimationPlayer,
      data: {
        clips: clipHandles,
        times: [0, 0, 0],
        weights: [1, 0, 0],
        speeds: [0.82, 1, 1.08],
      },
    });
    if (!playerComponent.ok) throw new Error(`animation-player:${playerComponent.error.code}`);
    const bound = bindAnimationTargets(world, sceneRoot, collected.targets);
    if (!bound.ok) throw new Error(`animation-bind:${bound.error.code}`);

    let blend: [number, number, number] = [1, 0, 0];
    let animation: AvatarSnapshot['animation'] = 'survey';
    return {
      mode: 'skinned-fox',
      update(motion, dt) {
        animation = motion.sprinting && motion.moving ? 'run' : motion.moving ? 'walk' : 'survey';
        const target: [number, number, number] = animation === 'survey'
          ? [1, 0, 0] : animation === 'walk' ? [0, 1, 0] : [0, 0, 1];
        blend = blendAvatarWeights(blend, target, dt);
        world.set(sceneRoot, AnimationPlayer, { weights: blend });
      },
      snapshot: () => {
        const mesh = world.get(collected.skin, MeshFilter);
        const renderer = world.get(collected.skin, MeshRenderer);
        return {
          mode: 'skinned-fox',
          sourceRoot: ECHOFALL_CHARACTER_ROOT,
          sceneGuid: FOX_SCENE_GUID,
          animation,
          blend,
          targetCount: collected.targets.length,
          meshHandle: mesh.ok ? Number(mesh.value.assetHandle) : null,
          materialHandles: renderer.ok ? Array.from(renderer.value.materials, Number) : [],
          sceneMeshRefs,
          loadError: null,
        };
      },
    };
  } catch (error) {
    return fallbackAvatar(world, player, error instanceof Error ? error.message : String(error));
  }
}
