import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { InputSnapshot } from '@forgeax/engine-input';
import { inState } from '@forgeax/engine-state';
import type { HudHandle } from '../hud';
import type { VfxHitLoop } from '../vfx-hit-loop';
import { ChargeShot } from '../components/gameplay';
import { GameState } from '../gameplay-state';

const MAX_CHARGE_SECONDS = 0.9;
const MAX_POWER = 2.5;

export type ChargeShotSystemContext = {
  readonly world: World;
  readonly root: EntityHandle;
  readonly readInput: () => InputSnapshot;
  readonly hud: HudHandle;
  readonly vfxHitLoop: VfxHitLoop;
};

function powerFor(seconds: number): number {
  return 1 + Math.min(1, seconds / MAX_CHARGE_SECONDS) * (MAX_POWER - 1);
}

/** Turns a held InputSnapshot action into ECS charge intent and authored VFX. */
export function installChargeShotSystem(ctx: ChargeShotSystemContext): void {
  ctx.world.addSystem(Update, {
    name: 'game-charge-shot',
    runIf: inState(GameState, 'Play'),
    after: ['game-pick-shoot'],
    before: ['game-projectile-simulation'],
    queries: [],
    fn: () => {
      const state = ctx.world.get(ctx.root, ChargeShot);
      if (!state.ok) return;
      const action = ctx.readInput().action('charge');
      const dt = ctx.world.getResource(Time).delta;

      if (action.justPressed()) {
        ctx.world.set(ctx.root, ChargeShot, { active: 1, release: 0, elapsed: 0, power: 1 });
        ctx.vfxHitLoop.beginCharge();
        ctx.hud.setChargeStatus('Charging · 0% · release to fire', 'charging', 0);
        return;
      }

      if (state.value.active !== 0) {
        const held = action.isPressed();
        const elapsed = Math.min(MAX_CHARGE_SECONDS, state.value.elapsed + (held ? dt : 0));
        const power = powerFor(elapsed);
        const progress = elapsed / MAX_CHARGE_SECONDS;
        if (held && !action.justReleased()) {
          ctx.world.set(ctx.root, ChargeShot, { elapsed, power });
          ctx.hud.setChargeStatus(`Charging · ${Math.round(progress * 100)}% · release to fire`, 'charging', progress);
          return;
        }
        ctx.world.set(ctx.root, ChargeShot, { active: 0, release: 1, elapsed, power });
        ctx.vfxHitLoop.endCharge();
        ctx.hud.setChargeStatus(`Charged shot released · impact x${power.toFixed(1)}`, 'released', progress);
        return;
      }

      if (state.value.release === 0) ctx.hud.setChargeStatus('Hold C to charge · release to fire', 'ready', 0);
    },
  }).unwrap();
}
