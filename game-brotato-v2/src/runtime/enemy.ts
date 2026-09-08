import type { CommandBuffer, EntityHandle, World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { SPROUTED_POTATO_RECIPE } from '../../assets/lib/actors/sprouted-potato.ts';
import { COMBAT } from '../config/combat.ts';
import { SPAWN } from '../config/spawn.ts';
import { STRESS } from '../config/stress.ts';
import { Dying, Enemy, EnemyBrain, Health, HitFlash } from '../ecs/components.ts';
import type { CombatAssets } from './combat-assets.ts';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function yawQuaternion(angle: number): readonly [number, number, number, number] {
  const halfAngle = angle * 0.5;
  return [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
}

function enemyComponents(
  assets: CombatAssets,
  x: number,
  z: number,
  yaw: number,
  hopClock: number,
  initialScale = SPAWN.birth.spawnScale,
  active = 1,
) {
  return [
    { component: Transform, data: {
      pos: [x, -SPROUTED_POTATO_RECIPE.groundOffset, z],
      scale: [
        SPROUTED_POTATO_RECIPE.rootScale * initialScale,
        SPROUTED_POTATO_RECIPE.rootScale * initialScale,
        SPROUTED_POTATO_RECIPE.rootScale * initialScale,
      ],
      quat: yawQuaternion(yaw),
    } },
    { component: MeshFilter, data: { assetHandle: assets.potatoMesh } },
    { component: MeshRenderer, data: { materials: [assets.potatoBodyMaterial, assets.potatoSproutMaterial, assets.tomatoEyeMaterial] } },
    { component: Enemy, data: { active } },
    { component: Health, data: { current: COMBAT.enemy.maxHealth, max: COMBAT.enemy.maxHealth, invulnerability: 0 } },
    { component: HitFlash, data: { ttl: 0 } },
    { component: EnemyBrain, data: {
      speed: COMBAT.enemy.speed,
      attackCooldown: SPAWN.birth.contactGraceSec,
      hopClock,
      birthClock: 0,
    } },
  ] as const;
}

/** Immediate spawn is kept for setup-time callers; FixedUpdate uses the deferred variant below. */
export function spawnEnemyNow(
  world: World,
  assets: CombatAssets,
  x: number,
  z: number,
  yaw = 0,
  hopClock = 0,
): EntityHandle {
  const result = world.spawn(
    { component: Transform, data: enemyComponents(assets, x, z, yaw, hopClock)[0].data },
    { component: MeshFilter, data: { assetHandle: assets.potatoMesh } },
    { component: MeshRenderer, data: { materials: [assets.potatoBodyMaterial, assets.potatoSproutMaterial, assets.tomatoEyeMaterial] } },
    { component: Enemy, data: { active: 1 } },
    { component: Health, data: { current: COMBAT.enemy.maxHealth, max: COMBAT.enemy.maxHealth, invulnerability: 0 } },
    { component: HitFlash, data: { ttl: 0 } },
    { component: EnemyBrain, data: {
      speed: COMBAT.enemy.speed,
      attackCooldown: SPAWN.birth.contactGraceSec,
      hopClock,
      birthClock: 0,
    } },
  );
  if (!result.ok) throw new Error(`Brotato v2 enemy spawn failed: ${result.error.hint}`);
  return result.value;
}

/** Queue enemy creation for the end-of-frame structural commit. */
export function spawnEnemyDeferred(
  commands: CommandBuffer,
  assets: CombatAssets,
  x: number,
  z: number,
  yaw = 0,
  hopClock = 0,
  initialScale = SPAWN.birth.spawnScale,
  active = 1,
): EntityHandle {
  const components = enemyComponents(assets, x, z, yaw, hopClock, initialScale, active);
  return commands.spawn(...components);
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Queue a bounded pool expansion; newly queued entities are parked and inactive. */
export function ensureEnemyCapacity(
  commands: CommandBuffer,
  assets: CombatAssets,
  current: number,
  target: number,
  serialBase: number,
): number {
  const missing = Math.max(0, Math.ceil(target) - Math.max(0, Math.floor(current)));
  const count = Math.min(STRESS.pool.chunk, missing);
  for (let index = 0; index < count; index += 1) {
    const serial = serialBase + index;
    const angle = serial * GOLDEN_ANGLE;
    spawnEnemyDeferred(
      commands,
      assets,
      Math.cos(angle) * STRESS.pool.parkDistance,
      Math.sin(angle) * STRESS.pool.parkDistance,
      angle,
      SPAWN.birth.popSec,
      SPAWN.birth.spawnScale,
      0,
    );
  }
  return count;
}

export function stressEnemyPosition(serial: number): readonly [number, number] {
  const angle = serial * GOLDEN_ANGLE;
  return [
    clamp(Math.cos(angle) * STRESS.ramp.spawnRadius, STRESS.ramp.arenaClamp),
    clamp(Math.sin(angle) * STRESS.ramp.spawnRadius, STRESS.ramp.arenaClamp),
  ];
}

export function parkEnemyPosition(serial: number): readonly [number, number] {
  const angle = serial * GOLDEN_ANGLE;
  return [Math.cos(angle) * STRESS.pool.parkDistance, Math.sin(angle) * STRESS.pool.parkDistance];
}

export interface EnemySlots {
  readonly live: number;
  readonly available: number;
  readonly capacity: number;
}

/**
 * The only enemy-counting policy: active Enemy entities without Dying.
 * The available and capacity counts are returned from the same pass family so
 * pooled entities and death-transition entities cannot be conflated by callers.
 */
export function countEnemySlots(world: World): EnemySlots {
  const liveQuery = world.query({ read: [Enemy], without: [Dying] });
  const capacityQuery = world.query({ read: [Enemy] });
  let live = 0;
  let available = 0;
  let capacity = 0;
  if (capacityQuery.ok) {
    for (const row of capacityQuery.value) capacity += 1;
  }
  if (liveQuery.ok) {
    for (const row of liveQuery.value) {
      if (row.get(Enemy).active > 0) live += 1;
      else available += 1;
    }
  }
  return { live, available, capacity };
}

/** Convenience view over the shared enemy-count policy. */
export function countLiveEnemies(world: World): number {
  return countEnemySlots(world).live;
}
