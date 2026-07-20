// Incoming-damage and resource-ratio helpers for derived CombatStats.
// All monster → player damage must pass through resolveIncomingDamage.

import type { CombatStats } from './combat-stats';

/** Apply damage reduction from derived combat stats. */
export function resolveIncomingDamage(
  rawDamage: number,
  stats: CombatStats,
): number {
  if (rawDamage <= 0) return 0;
  const reduced = rawDamage * (1 - stats.damageReduction);
  return Math.max(0, reduced);
}

/**
 * Preserve `current / previousMax` when max resources change (equip swap).
 * Prevents repeated +HP equip/unequip from healing.
 */
export function preserveResourceRatio(
  current: number,
  previousMax: number,
  nextMax: number,
): number {
  if (nextMax <= 0) return 0;
  if (previousMax <= 0) return Math.min(nextMax, Math.max(0, current));
  const ratio = Math.min(1, Math.max(0, current / previousMax));
  return ratio * nextMax;
}
