import { FixedTime, FixedUpdate, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { MeshRenderer } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { SPROUTED_POTATO_RECIPE } from '../../assets/lib/actors/sprouted-potato.ts';
import { COMBAT } from '../config/combat.ts';
import { SPAWN } from '../config/spawn.ts';
import { STRESS } from '../config/stress.ts';
import { Dying, Enemy, EnemyBrain, Health, Player, SpawnMarker } from '../ecs/components.ts';
import { DEBUG_CLOCK_KEY, type DebugClockState } from '../runtime/debug-clock.ts';
import { countEnemySlots, ensureEnemyCapacity, parkEnemyPosition, stressEnemyPosition } from '../runtime/enemy.ts';
import type { CombatAssets } from '../runtime/combat-assets.ts';
import { stepStressRamp } from '../stress/ramp.ts';
import { STRESS_STATE_KEY } from '../stress/state.ts';
import { COMBAT_STATE_KEY, COMBAT_SYSTEM_NAME, type CombatState } from './combat-system.ts';
import { DIRECTOR_STATE_KEY, resetDirector, type DirectorState } from '../spawn/director.ts';

export { STRESS_STATE_KEY } from '../stress/state.ts';
export const STRESS_SYSTEM_NAME = 'brotato-v2/stress';

export interface StressCollapsePoint {
  readonly fps: number;
  readonly enemies: number;
  readonly at: number;
}

export interface StressState {
  active: boolean;
  elapsed: number;
  frozenAt: number | undefined;
  targetEnemies: number;
  liveEnemies: number;
  capacity: number;
  spawnSerial: number;
  spawnedRecently: number;
  peakEnemies: number;
  minFps: number;
  collapse30: StressCollapsePoint | undefined;
  collapse15: StressCollapsePoint | undefined;
  phaseMs: { move: number; collide: number; combat: number };
}

export function createStressState(): StressState {
  return {
    active: false,
    elapsed: 0,
    frozenAt: undefined,
    targetEnemies: 0,
    liveEnemies: 0,
    capacity: 0,
    spawnSerial: 0,
    spawnedRecently: 0,
    peakEnemies: 0,
    minFps: 0,
    collapse30: undefined,
    collapse15: undefined,
    phaseMs: { move: 0, collide: 0, combat: 0 },
  };
}

interface SpawnSample {
  age: number;
  count: number;
}

function resetSession(state: StressState): void {
  state.elapsed = 0;
  state.frozenAt = undefined;
  state.targetEnemies = 0;
  state.liveEnemies = 0;
  state.capacity = 0;
  state.spawnSerial = 0;
  state.spawnedRecently = 0;
  state.peakEnemies = 0;
  state.minFps = 0;
  state.collapse30 = undefined;
  state.collapse15 = undefined;
  state.phaseMs = { move: 0, collide: 0, combat: 0 };
}

function parkEnemies(
  world: World,
  enemies: Iterable<{ readonly entity: EntityHandle; mut: (component: any) => any }>,
  assets: CombatAssets,
): void {
  let serial = 0;
  for (const row of enemies) {
    const transform = row.mut(Transform);
    const enemy = row.mut(Enemy);
    const health = row.mut(Health);
    const brain = row.mut(EnemyBrain);
    const [x, z] = parkEnemyPosition(serial);
    serial += 1;
    enemy.active = 0;
    health.current = health.max;
    health.invulnerability = 0;
    brain.attackCooldown = SPAWN.birth.contactGraceSec;
    brain.birthClock = SPAWN.birth.popSec;
    transform.pos[0] = x;
    transform.pos[1] = -SPROUTED_POTATO_RECIPE.groundOffset;
    transform.pos[2] = z;
    transform.scale[0] = SPROUTED_POTATO_RECIPE.rootScale * SPAWN.birth.spawnScale;
    transform.scale[1] = SPROUTED_POTATO_RECIPE.rootScale * SPAWN.birth.spawnScale;
    transform.scale[2] = SPROUTED_POTATO_RECIPE.rootScale * SPAWN.birth.spawnScale;
    world.set(row.entity, MeshRenderer, {
      materials: [assets.potatoBodyMaterial, assets.potatoSproutMaterial, assets.tomatoEyeMaterial],
    }).unwrap();
  }
}

function resetPlayer(world: World, players: Iterable<{ mut: (component: typeof Health) => any }>): void {
  for (const row of players) {
    const health = row.mut(Health);
    health.current = health.max || COMBAT.player.maxHealth;
    health.max = COMBAT.player.maxHealth;
    health.invulnerability = 0;
  }
}

function resetDirectorForNormalPlay(world: World): void {
  if (!world.hasResource(DIRECTOR_STATE_KEY)) return;
  resetDirector(world.getResource<DirectorState>(DIRECTOR_STATE_KEY));
}

function updateSpawnHistory(history: SpawnSample[], state: StressState, dt: number, count: number): void {
  for (const sample of history) sample.age += dt;
  if (count > 0) history.push({ age: 0, count });
  while ((history[0]?.age ?? 0) > STRESS.perf.windowSeconds) history.shift();
  state.spawnedRecently = history.reduce((sum, sample) => sum + sample.count, 0);
}

/** Fixed-rate pressure controller. It only schedules ECS work; FPS is sampled by stress-hud. */
export function installStressSystem(world: World, assets: CombatAssets): () => void {
  const state = world.hasResource(STRESS_STATE_KEY)
    ? world.getResource<StressState>(STRESS_STATE_KEY)
    : createStressState();
  world.insertResource(STRESS_STATE_KEY, state);
  let wasActive = state.active;
  const spawnHistory: SpawnSample[] = [];
  const result = world.addSystem(FixedUpdate, {
    name: STRESS_SYSTEM_NAME,
    after: ['brotato-v2/player-movement'],
    before: [COMBAT_SYSTEM_NAME],
    queries: [
      { write: [Transform, Enemy, Health, EnemyBrain, MeshRenderer], without: [Dying] },
      { read: [Dying] },
      { write: [Health], with: [Player] },
      { read: [SpawnMarker] },
    ],
    fn: (world, [enemies, dying, players, markers], commands) => {
      const clock = world.hasResource(DEBUG_CLOCK_KEY)
        ? world.getResource<DebugClockState>(DEBUG_CLOCK_KEY)
        : undefined;
      if (clock !== undefined && !clock.fixedActive) return;

      if (state.active !== wasActive) {
        if (state.active) {
          resetSession(state);
          spawnHistory.length = 0;
          parkEnemies(world, enemies, assets);
          for (const row of dying) commands.despawn(row.entity);
          for (const row of markers) commands.despawn(row.entity);
          resetPlayer(world, players);
          if (world.hasResource(COMBAT_STATE_KEY)) world.getResource<CombatState>(COMBAT_STATE_KEY).phase = 'playing';
          if (world.hasResource(DIRECTOR_STATE_KEY)) world.getResource<DirectorState>(DIRECTOR_STATE_KEY).frozen = true;
        } else {
          parkEnemies(world, enemies, assets);
          for (const row of dying) commands.despawn(row.entity);
          for (const row of markers) commands.despawn(row.entity);
          resetPlayer(world, players);
          if (world.hasResource(COMBAT_STATE_KEY)) {
            const combat = world.getResource<CombatState>(COMBAT_STATE_KEY);
            combat.phase = 'playing';
            combat.resetRequested = false;
            combat.elapsed = 0;
          }
          resetDirectorForNormalPlay(world);
        }
        wasActive = state.active;
      }
      if (!state.active) return;

      const dt = Math.max(0, world.getResource(FixedTime).delta);
      state.elapsed += dt;
      const slots = countEnemySlots(world);
      const ramp = stepStressRamp({
        elapsed: state.elapsed,
        frozenAt: state.frozenAt,
        liveEnemies: slots.live,
        availableSlots: slots.available,
      });
      state.targetEnemies = ramp.targetEnemies;
      state.liveEnemies = slots.live;
      state.capacity = slots.capacity;
      state.peakEnemies = Math.max(state.peakEnemies, slots.live);

      if (ramp.capacityShortfall > 0) {
        const added = ensureEnemyCapacity(
          commands,
          assets,
          slots.capacity,
          slots.capacity + Math.min(ramp.capacityShortfall, STRESS.pool.chunk),
          state.spawnSerial,
        );
        state.spawnSerial += added;
      }

      let spawned = 0;
      for (const row of enemies) {
        const enemy = row.mut(Enemy);
        if (enemy.active > 0 || spawned >= ramp.spawnCount) continue;
        const transform = row.mut(Transform);
        const health = row.mut(Health);
        const brain = row.mut(EnemyBrain);
        const [x, z] = stressEnemyPosition(state.spawnSerial);
        state.spawnSerial += 1;
        enemy.active = 1;
        health.current = health.max;
        health.invulnerability = 0;
        brain.attackCooldown = SPAWN.birth.contactGraceSec;
        brain.birthClock = SPAWN.birth.popSec;
        transform.pos[0] = x;
        transform.pos[1] = -SPROUTED_POTATO_RECIPE.groundOffset;
        transform.pos[2] = z;
        transform.scale[0] = SPROUTED_POTATO_RECIPE.rootScale;
        transform.scale[1] = SPROUTED_POTATO_RECIPE.rootScale;
        transform.scale[2] = SPROUTED_POTATO_RECIPE.rootScale;
        world.set(row.entity, MeshRenderer, {
          materials: [assets.potatoBodyMaterial, assets.potatoSproutMaterial, assets.tomatoEyeMaterial],
        }).unwrap();
        spawned += 1;
      }
      updateSpawnHistory(spawnHistory, state, dt, spawned);
    },
  });
  result.unwrap();
  return () => {
    const removed = world.removeSystem(FixedUpdate, STRESS_SYSTEM_NAME);
    if (!removed.ok && removed.error.code !== 'system-before-unknown') throw removed.error;
    world.removeResource(STRESS_STATE_KEY);
  };
}
