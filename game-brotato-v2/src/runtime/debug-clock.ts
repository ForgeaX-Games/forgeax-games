import { FixedUpdate, type World } from '@forgeax/engine-ecs';

export const DEBUG_CLOCK_KEY = 'BrotatoV2DebugClock';

export interface DebugClockState {
  paused: boolean;
  hudVisible: boolean;
  fixedTicks: number;
  stepRequested: boolean;
  /** Set by the fixed clock immediately before game fixed systems run. */
  fixedActive: boolean;
}

export const DEBUG_CLOCK_SYSTEM_NAME = 'brotato-v2/debug-clock';

export function installDebugClock(world: World, clock: DebugClockState): () => void {
  world
    .addSystem(FixedUpdate, {
      name: DEBUG_CLOCK_SYSTEM_NAME,
      queries: [],
      fn: () => {
        clock.fixedActive = !clock.paused || clock.stepRequested;
        if (clock.fixedActive) clock.fixedTicks += 1;
        clock.stepRequested = false;
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(FixedUpdate, DEBUG_CLOCK_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
  };
}
