/**
 * Engine-current skinned AnimationPlayer arming (post AnimationTargetId).
 *
 * Canonical pattern (apps/hello/skin, apps/collectathon spawn-player):
 *   1. Put AnimationPlayer on the SceneInstance root (ancestor of joints)
 *   2. Collect every mapping entity carrying AnimationTargetId
 *   3. bindAnimationTargets(player, targets)
 *
 * Hellforge historically put AnimationPlayer on the Skin entity and then
 * removed its ChildOf — joints were no longer under the player →
 * animation-target-missing every frame and T-pose.
 *
 * The Skin mesh stays parented. Detaching it to identity used to be needed
 * against bug-20260615-skin-mesh-node-double-transform, but the M1 shader fix
 * makes a skinned mesh rigid-follow its parent, so detaching now only strands
 * the entity's transform at the world origin — and frustum culling uses that
 * transform (render-system-extract cull gate is unconditional, skinning-blind),
 * so every character vanishes once the camera leaves the origin.
 */

import {
  AnimationPlayer,
  AnimationTargetId,
  bindAnimationTargets,
} from '@forgeax/engine-animation';
import { ENTITY_NULL_RAW, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Name } from '@forgeax/engine-scene';
import { SceneInstance } from '@forgeax/engine-render';
import { Skin } from '@forgeax/engine-skinning';
import type { AnimationClip, Handle } from '@forgeax/engine-types';
import { isRootJointName } from './anim-root';

export type SkinnedAnimArmResult = {
  /** SceneInstance root — hosts AnimationPlayer. */
  readonly player: EntityHandle;
  readonly skin: EntityHandle;
  readonly targetCount: number;
};

export type CollectSkinnedAnimResult = {
  readonly skin: EntityHandle;
  readonly targets: readonly EntityHandle[];
};

/** Walk SceneInstance.mapping; skip only ENTITY_NULL_RAW (entity 0 is valid). */
export function collectSkinnedAnimTargets(
  world: World,
  sceneRoot: EntityHandle,
): CollectSkinnedAnimResult | null {
  const inst = world.get(sceneRoot, SceneInstance);
  if (!inst.ok) return null;
  let skin: EntityHandle | undefined;
  const targets: EntityHandle[] = [];
  for (const entRaw of inst.value.mapping) {
    if (entRaw === undefined || entRaw === ENTITY_NULL_RAW) continue;
    const ent = entRaw as EntityHandle;
    if (world.get(ent, AnimationTargetId).ok) targets.push(ent);
    if (skin === undefined && world.get(ent, Skin).ok) skin = ent;
  }
  if (skin === undefined) return null;
  return { skin, targets };
}

/**
 * Target ids of the rig's root joint(s), for `normalizeClipRoot`.
 *
 * Clip channels address joints by opaque `targetId` hash, so the only place the
 * name is still visible is the instantiated scene: each mapping entity carries
 * `Name` alongside `AnimationTargetId`. Call this after `instantiate` and feed
 * the result to `normalizeClipRoot` before arming the player.
 */
export function collectRootJointTargetIds(
  world: World,
  sceneRoot: EntityHandle,
): Set<string> {
  const ids = new Set<string>();
  const inst = world.get(sceneRoot, SceneInstance);
  if (!inst.ok) return ids;
  for (const entRaw of inst.value.mapping) {
    if (entRaw === undefined || entRaw === ENTITY_NULL_RAW) continue;
    const ent = entRaw as EntityHandle;
    const name = world.get(ent, Name);
    if (!name.ok || typeof name.value.value !== 'string') continue;
    if (!isRootJointName(name.value.value)) continue;
    const target = world.get(ent, AnimationTargetId);
    if (target.ok) ids.add(String(target.value.value));
  }
  return ids;
}

export type ArmSkinnedAnimationOpts = {
  readonly clips: readonly Handle<'AnimationClip', 'shared'>[];
  readonly looping?: boolean;
  readonly speeds?: Float32Array | number[];
};

/**
 * Arms AnimationPlayer on `sceneRoot` and binds AnimationTargetId joints.
 * Returns null when Skin/targets/bind fail.
 */
export function armSkinnedAnimationPlayer(
  world: World,
  sceneRoot: EntityHandle,
  opts: ArmSkinnedAnimationOpts,
): SkinnedAnimArmResult | null {
  const collected = collectSkinnedAnimTargets(world, sceneRoot);
  if (collected === null) return null;
  if (opts.clips.length === 0) return null;

  const n = opts.clips.length;
  const times = new Float32Array(n);
  const weights = new Float32Array(n);
  weights[0] = 1;
  const speeds = opts.speeds !== undefined
    ? (opts.speeds instanceof Float32Array ? opts.speeds : Float32Array.from(opts.speeds))
    : new Float32Array(n).fill(1);

  const addRes = world.addComponent(sceneRoot, {
    component: AnimationPlayer,
    data: {
      clips: [...opts.clips],
      times,
      weights,
      speeds,
      paused: false,
      looping: opts.looping ?? true,
    },
  });
  // Already present (re-arm) — overwrite via set.
  if (!addRes.ok) {
    world.set(sceneRoot, AnimationPlayer, {
      clips: [...opts.clips],
      times,
      weights,
      speeds,
      paused: false,
      looping: opts.looping ?? true,
    });
  }

  if (collected.targets.length > 0) {
    const bound = bindAnimationTargets(world, sceneRoot, collected.targets);
    if (!bound.ok) {
      console.warn(
        `[hellforge] bindAnimationTargets failed: ${bound.error.code}`,
        bound.error.detail,
      );
      return null;
    }
  } else {
    console.warn('[hellforge] SceneInstance has Skin but zero AnimationTargetId joints');
  }

  return {
    player: sceneRoot,
    skin: collected.skin,
    targetCount: collected.targets.length,
  };
}

/** Type-only re-export so callers can keep AnimationClip in the same import. */
export type { AnimationClip };
