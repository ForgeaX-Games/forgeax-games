import { FixedTime, FixedUpdate, type World } from '@forgeax/engine-ecs';
import { Dying } from '../ecs/components.ts';
import { DEBUG_CLOCK_KEY, type DebugClockState } from '../runtime/debug-clock.ts';

export const DEATH_SYSTEM_NAME = 'brotato-v2/death';

/** Advance the short corpse window and defer destruction until it is over. */
export function installDeathSystem(world: World): () => void {
  world
    .addSystem(FixedUpdate, {
      name: DEATH_SYSTEM_NAME,
      after: ['brotato-v2/combat'],
      queries: [{ write: [Dying] }],
      fn: (world, [dying], commands) => {
        if (world.hasResource(DEBUG_CLOCK_KEY) && !world.getResource<DebugClockState>(DEBUG_CLOCK_KEY).fixedActive) return;
        const dt = Math.max(0, world.getResource(FixedTime).delta);
        for (const row of dying) {
          const state = row.mut(Dying);
          state.ttl -= dt;
          if (state.ttl <= 0) commands.despawn(row.entity);
        }
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(FixedUpdate, DEATH_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
  };
}
