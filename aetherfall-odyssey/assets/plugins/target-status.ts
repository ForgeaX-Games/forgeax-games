import { Disabled, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Name } from '@forgeax/engine-scene';
import type { HudHandle } from './hud';
import { scoringPoints } from './scoring-target';
import { TargetHealth } from './target-health';
import { Rotatable } from './rotating-target';
import type { TargetProfileLoop } from './target-profile-loop';
import { targetProfilePoints } from './target-profile-loop';

export type TargetStatusContext = {
  readonly world: World;
  readonly hud: HudHandle;
  readonly primaryTarget: () => EntityHandle | undefined;
  readonly targetProfile: TargetProfileLoop | undefined;
};

/** Project the authored primary target into one legible, reset-safe HUD cue. */
export function installTargetStatusSystem(ctx: TargetStatusContext): void {
  const target = ctx.primaryTarget();
  if (target === undefined) return;
  const label = ctx.world.get(target, Name);
  const targetName = label.ok && label.value.value.length > 0 ? label.value.value : 'Target';
  const authoredPoints = scoringPoints(ctx.world, target) ?? 0;

  ctx.world.addSystem(Update, {
    name: 'game-target-status',
    queries: [],
    fn: () => {
      const health = ctx.world.get(target, TargetHealth);
      const disabled = ctx.world.get(target, Disabled).ok;
      const current = health.ok ? Math.ceil(health.value.current) : 0;
      const max = health.ok ? Math.ceil(health.value.max) : 0;
      const points = targetProfilePoints(ctx.targetProfile, authoredPoints);
      const state = disabled ? 'disabled' : current < max ? 'damaged' : 'ready';
      const precision = ctx.targetProfile?.active === 'profile' && ctx.world.get(target, Rotatable).ok;
      const precisionSuffix = precision ? ' · PRECISION MOTION' : '';
      const status = disabled
        ? `TARGET · ${targetName} · DISABLED`
        : `TARGET · ${targetName} · ${current}/${max} HP · +${points}${precisionSuffix}`;
      ctx.hud.setTargetStatus(status, state);
    },
  }).unwrap();
}
