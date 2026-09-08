import { Time, Update, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { COMBAT } from '../config/combat.ts';
import { SPAWN } from '../config/spawn.ts';
import { Dying, Enemy, EnemyBrain } from '../ecs/components.ts';
import { DEBUG_CLOCK_KEY, type DebugClockState } from '../runtime/debug-clock.ts';
import { SPROUTED_POTATO_RECIPE } from '../../assets/lib/actors/sprouted-potato.ts';
import { COMBAT_STATE_KEY, type CombatState } from './combat-system.ts';

export const ENEMY_HOP_SYSTEM_NAME = 'brotato-v2/enemy-hop';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutBack(value: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = value - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}

/** Update the mutually exclusive birth, idle-hop, and death presentations. */
export function installEnemyHopSystem(world: World): () => void {
  world
    .addSystem(Update, {
      name: ENEMY_HOP_SYSTEM_NAME,
      queries: [{ write: [Transform, Enemy, EnemyBrain], optional: [Dying] }],
      fn: (world, [enemies]) => {
        const dt = Math.max(0, world.getResource(Time).delta);
        const clock = world.hasResource(DEBUG_CLOCK_KEY)
          ? world.getResource<DebugClockState>(DEBUG_CLOCK_KEY)
          : undefined;
        if (clock?.paused) return;
        const combat = world.getResource<CombatState>(COMBAT_STATE_KEY);
        if (combat.phase === 'defeated') return;
        for (const row of enemies) {
          if (row.mut(Enemy).active <= 0) continue;
          const brain = row.mut(EnemyBrain);
          const transform = row.mut(Transform);
          const dying = row.get(Dying);
          if (dying !== undefined) {
            const flashRatio = SPAWN.death.flashSec / SPAWN.death.ttlSec;
            const u = clamp01(1 - dying.ttl / Math.max(Number.EPSILON, dying.total));
            const flashU = clamp01(u / flashRatio);
            const pop = 1 + (SPAWN.death.popScale - 1) * flashU;
            const flatten = u <= flashRatio ? 1 : 1 - (u - flashRatio) / (1 - flashRatio);
            const spread = 1 + (SPAWN.death.spreadScale - 1) * (1 - Math.max(0, flatten));
            transform.pos[1] = -SPROUTED_POTATO_RECIPE.groundOffset * (1 - u) + SPAWN.death.sinkY * u;
            transform.scale[0] = SPROUTED_POTATO_RECIPE.rootScale * pop * spread;
            transform.scale[1] = SPROUTED_POTATO_RECIPE.rootScale * pop * Math.max(SPAWN.death.flattenScale, flatten);
            transform.scale[2] = transform.scale[0];
            continue;
          }
          if (brain.birthClock < SPAWN.birth.popSec) {
            const u = clamp01(brain.birthClock / Math.max(Number.EPSILON, SPAWN.birth.popSec));
            const scale = SPROUTED_POTATO_RECIPE.rootScale * Math.max(
              0.1,
              SPAWN.birth.spawnScale + (1 - SPAWN.birth.spawnScale) * easeOutBack(u),
            );
            transform.pos[1] = -SPROUTED_POTATO_RECIPE.groundOffset;
            transform.scale[0] = scale;
            transform.scale[1] = scale;
            transform.scale[2] = scale;
            continue;
          }
          brain.hopClock += dt;
          const hop = Math.abs(Math.sin(brain.hopClock * COMBAT.enemy.hopFrequency * Math.PI)) * COMBAT.enemy.hopHeight;
          const squash = Math.max(0.5, 1 - hop * COMBAT.enemy.squashFactor);
          transform.pos[1] = -SPROUTED_POTATO_RECIPE.groundOffset + hop;
          transform.scale[0] = SPROUTED_POTATO_RECIPE.rootScale / squash;
          transform.scale[1] = SPROUTED_POTATO_RECIPE.rootScale * squash;
          transform.scale[2] = SPROUTED_POTATO_RECIPE.rootScale / squash;
        }
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(Update, ENEMY_HOP_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
  };
}
