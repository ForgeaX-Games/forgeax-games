import { Time, Update, defineComponent, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { inState } from '@forgeax/engine-state';
import type { HudHandle } from './hud';
import { GameState } from './gameplay-state';

const STREAK_WINDOW_SECONDS = 1.65;
const MAX_STREAK_HITS = 8;
const MULTIPLIER_STEP = 0.25;

/** The player's short-lived hit chain is simulation state, not a DOM timer. */
export const HitStreak = defineComponent('GameDefaultHitStreak', {
  hits: { type: 'u32', default: 0 },
  elapsed: { type: 'f32', default: 0 },
  multiplier: { type: 'f32', default: 1 },
}, { transient: true });

export type HitStreakSnapshot = {
  readonly hits: number;
  readonly elapsed: number;
  readonly multiplier: number;
  readonly state: 'ready' | 'active';
};

export type HitStreakAward = {
  readonly points: number;
  readonly hits: number;
  readonly multiplier: number;
};

export type HitStreakHandle = {
  readonly recordHit: (basePoints: number) => HitStreakAward;
  readonly reset: () => void;
  readonly snapshot: () => HitStreakSnapshot;
};

export type HitStreakSystemContext = {
  readonly world: World;
  readonly player: EntityHandle;
  readonly hud: HudHandle;
};

function label(snapshot: Pick<HitStreakSnapshot, 'hits' | 'multiplier' | 'elapsed'>): string {
  const hits = snapshot.hits === 1 ? 'hit' : 'hits';
  return `Combo x${snapshot.multiplier.toFixed(2)} · ${snapshot.hits} ${hits} · ${snapshot.elapsed.toFixed(1)}s`;
}

/** Install expiry on Update; hit awarding remains owned by target feedback. */
export function installHitStreakSystem(ctx: HitStreakSystemContext): void {
  ctx.world.addSystem(Update, {
    name: 'game-hit-streak',
    runIf: inState(GameState, 'Play'),
    after: ['game-charge-shot'],
    before: ['game-projectile-simulation'],
    queries: [],
    fn: () => {
      const state = ctx.world.get(ctx.player, HitStreak);
      if (!state.ok || state.value.hits === 0) return;
      const elapsed = Math.max(0, state.value.elapsed - ctx.world.getResource(Time).delta);
      if (elapsed === 0) {
        ctx.world.set(ctx.player, HitStreak, { hits: 0, elapsed: 0, multiplier: 1 });
        ctx.hud.setComboStatus('Combo expired · land another hit', 'expired');
        return;
      }
      ctx.world.set(ctx.player, HitStreak, { elapsed });
      ctx.hud.setComboStatus(label({ hits: state.value.hits, multiplier: state.value.multiplier, elapsed }), 'active');
    },
  }).unwrap();
}

/** Create the one player-owned hit chain and its reset-safe score projection. */
export function createHitStreak(world: World, player: EntityHandle | undefined, hud: HudHandle): HitStreakHandle | undefined {
  if (player === undefined) return undefined;
  world.addComponent(player, { component: HitStreak, data: {} }).unwrap();

  const snapshot = (): HitStreakSnapshot => {
    const state = world.get(player, HitStreak);
    if (!state.ok) return { hits: 0, elapsed: 0, multiplier: 1, state: 'ready' };
    return {
      hits: state.value.hits,
      elapsed: state.value.elapsed,
      multiplier: state.value.multiplier,
      state: state.value.hits === 0 ? 'ready' : 'active',
    };
  };

  return {
    recordHit(basePoints) {
      const previous = world.get(player, HitStreak).unwrap();
      const hits = previous.elapsed > 0 ? Math.min(MAX_STREAK_HITS, previous.hits + 1) : 1;
      const multiplier = 1 + Math.min(MAX_STREAK_HITS - 1, hits - 1) * MULTIPLIER_STEP;
      const points = Math.max(1, Math.round(basePoints * multiplier));
      world.set(player, HitStreak, { hits, elapsed: STREAK_WINDOW_SECONDS, multiplier });
      hud.setComboStatus(label({ hits, multiplier, elapsed: STREAK_WINDOW_SECONDS }), 'active');
      return { points, hits, multiplier };
    },
    reset() {
      world.set(player, HitStreak, { hits: 0, elapsed: 0, multiplier: 1 });
      hud.setComboStatus('Combo ready · chain hits for a bonus', 'ready');
    },
    snapshot,
  };
}
