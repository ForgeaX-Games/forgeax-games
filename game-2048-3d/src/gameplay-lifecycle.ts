import { defineSystem, Update, type World } from '@forgeax/engine-ecs';
import type { InputSnapshot } from '@forgeax/engine-input';

export type GameplayLifecycleContext = {
  world: World;
  readInput: () => InputSnapshot;
  requestReset: () => void;
};

/** Turn the reset action edge into one deterministic gameplay reset request. */
export function installGameplayLifecycle(ctx: GameplayLifecycleContext): void {
  ctx.world.addSystem(Update, defineSystem({
    name: 'game-reset',
    queries: [] as const,
    after: ['input-frame-start-scan', 'game-look', 'game-pick-shoot'],
    fn: () => {
      if (ctx.readInput().action('reset').justPressed()) ctx.requestReset();
    },
  }));
}
