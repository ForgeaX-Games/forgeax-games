import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import {
  projectSceneAsset,
  sceneAssetKind,
  Children,
  Name,
  Transform,
  worldDespawnScene,
  worldInstantiateScene,
} from '@forgeax/engine-scene';
import { SceneInstance } from '@forgeax/engine-render';
import type { SceneAsset } from '@forgeax/engine-types';
import { TOMATO_RECIPE } from '../../assets/lib/actors/tomato.ts';
import { ASSET_IDS } from './asset-ids.ts';
import { ActorAnimState, ActorLimbMotion, Health, Player, PlayerMotion } from '../ecs/components.ts';
import { COMBAT } from '../config/combat.ts';

function fail(message: string, error?: { readonly hint?: string }): never {
  const suffix = error?.hint === undefined ? '' : `: ${error.hint}`;
  throw new Error(`${message}${suffix}`);
}

async function loadPlayerScene(assets: AssetRegistry): Promise<SceneAsset> {
  const parsed = AssetGuid.parse(ASSET_IDS.scenePlayerTomato);
  if (!parsed.ok) fail('Brotato v2 tomato scene GUID is invalid', parsed.error);
  const loaded = await assets.load(ASSET_IDS.scenePlayerTomato, sceneAssetKind);
  if (!loaded.ok) {
    fail(`Brotato v2 tomato scene asset load failed (${loaded.error.code})`, loaded.error);
  }
  return loaded.value;
}

function requireMutation<T extends { readonly ok: boolean }>(
  result: T,
  operation: string,
): void {
  if (!result.ok) fail(`Brotato v2 ${operation} failed`, (result as { readonly error?: { readonly hint?: string } }).error);
}

function motionKind(kind: 'bob' | 'swing' | 'none'): number {
  switch (kind) {
    case 'bob': return 1;
    case 'swing': return 2;
    case 'none': return 0;
  }
}

function motionAxis(axis: 'x' | 'y' | 'z'): number {
  switch (axis) {
    case 'x': return 0;
    case 'y': return 1;
    case 'z': return 2;
  }
}

/** Load and instantiate the authored tomato scene, then attach M1 control state. */
export async function spawnTomatoPlayer(world: World, assets: AssetRegistry): Promise<EntityHandle> {
  const scene = await loadPlayerScene(assets);
  const projected = await projectSceneAsset(world, scene, (guid, kind) => assets.load(guid, kind));
  if (!projected.ok) fail('Brotato v2 tomato scene projection failed', projected.error);

  const source = world.allocSharedRef('SceneAsset', projected.value);
  const instance = worldInstantiateScene(world, source);
  if (!instance.ok) {
    world.sharedRefs.release(source);
    fail('Brotato v2 tomato scene instantiate failed', instance.error);
  }

  const authoredRoot = instance.value.root === undefined
    ? undefined
    : world.get(instance.value.root, SceneInstance).ok
      ? (world.get(instance.value.root, SceneInstance).unwrap().mapping[0] as EntityHandle | undefined)
      : undefined;
  if (authoredRoot === undefined) {
    worldDespawnScene(world, instance.value.root);
    world.sharedRefs.release(source);
    fail('Brotato v2 tomato scene has no authored root localId 0');
  }

  requireMutation(world.addComponent(authoredRoot, { component: Player, data: {} }), 'player marker attach');
  requireMutation(
    world.addComponent(authoredRoot, {
      component: PlayerMotion,
      data: { inputX: 0, inputZ: 0, velocityX: 0, velocityZ: 0, facing: 0 },
    }),
    'player motion attach',
  );
  requireMutation(
    world.addComponent(authoredRoot, {
      component: Health,
      data: { current: COMBAT.player.maxHealth, max: COMBAT.player.maxHealth, invulnerability: 0 },
    }),
    'player health attach',
  );
  requireMutation(
    world.addComponent(authoredRoot, {
      component: ActorAnimState,
      data: { speed01: 0, clock: 0 },
    }),
    'actor animation state attach',
  );
  requireMutation(
    world.set(authoredRoot, Transform, {
      pos: [0, -TOMATO_RECIPE.groundOffset, 0],
      scale: [TOMATO_RECIPE.rootScale, TOMATO_RECIPE.rootScale, TOMATO_RECIPE.rootScale],
      quat: [0, 0, 0, 1],
    }),
    'player transform initialize',
  );

  const children = world.get(authoredRoot, Children);
  if (!children.ok) fail('Brotato v2 tomato scene root has no Children list', children.error);
  const limbsByName = new Map(
    TOMATO_RECIPE.limbs.map((limb) => [`${TOMATO_RECIPE.displayName} ${limb.id}`, limb]),
  );
  const matched = new Set<string>();
  for (const childRaw of children.value.entities) {
    const child = childRaw as unknown as EntityHandle;
    const name = world.get(child, Name);
    const transform = world.get(child, Transform);
    if (!name.ok || !transform.ok) continue;
    const limb = limbsByName.get(name.value.value);
    if (limb === undefined) continue;
    matched.add(limb.id);
    requireMutation(
      world.addComponent(child, {
        component: ActorLimbMotion,
        data: {
          kind: motionKind(limb.motion.kind),
          axis: motionAxis(limb.motion.axis),
          idleAmplitude: limb.motion.idleAmplitude,
          idleFrequency: limb.motion.idleFrequency,
          moveAmplitude: limb.motion.moveAmplitude,
          moveFrequency: limb.motion.moveFrequency,
          phase: limb.motion.phase,
          baseX: transform.value.pos[0] ?? 0,
          baseY: transform.value.pos[1] ?? 0,
          baseZ: transform.value.pos[2] ?? 0,
        },
      }),
      `limb motion attach (${limb.id})`,
    );
  }
  if (matched.size !== TOMATO_RECIPE.limbs.length) {
    worldDespawnScene(world, instance.value.root);
    world.sharedRefs.release(source);
    fail(`Brotato v2 tomato scene matched ${matched.size}/${TOMATO_RECIPE.limbs.length} authored limbs`);
  }
  return authoredRoot;
}

/** Despawn the complete tomato SceneInstance and release its producer grant. */
export function destroyTomatoPlayer(world: World, authoredRoot: EntityHandle): void {
  let sceneRoot: EntityHandle | undefined;
  for (const ancestor of world.iterAncestors(authoredRoot)) {
    if (world.get(ancestor, SceneInstance).ok) {
      sceneRoot = ancestor;
      break;
    }
  }
  if (sceneRoot === undefined) fail('Brotato v2 tomato player is detached from its SceneInstance');
  const instance = world.get(sceneRoot, SceneInstance);
  if (!instance.ok) fail('Brotato v2 tomato SceneInstance disappeared', instance.error);
  const source = instance.value.source;
  const despawned = worldDespawnScene(world, sceneRoot);
  if (!despawned.ok) fail('Brotato v2 tomato scene despawn failed', despawned.error);
  const released = world.sharedRefs.release(source);
  if (!released.ok) fail('Brotato v2 tomato scene source release failed', released.error);
}
