import { COMBAT } from './combat.ts';

/** All pressure-test tuning lives here so the measurement path has one source of truth. */
export const STRESS = {
  ramp: {
    startEnemies: 8,
    growthPerSecond: 6,
    hardCap: 600,
    spawnBudgetPerTick: 12,
    spawnRadius: COMBAT.enemy.spawnRadius,
    arenaClamp: 18,
  },
  pool: {
    /** Maximum number of new pool entities queued by one fixed tick. */
    chunk: 32,
    /** Parked entities stay outside the authored arena. */
    parkDistance: COMBAT.enemy.spawnRadius * 4,
  },
  perf: {
    windowSeconds: 1,
    warnFps: 30,
    warnHoldSeconds: 1,
    freezeFps: 15,
    freezeHoldSeconds: 2,
  },
  hud: { updateHz: 10 },
  damageTextBudget: 8,
} as const;
