/**
 * MarsCraft -> forgeax-engine — combat balance constants (Milestone M6)
 * =============================================================================
 * Port of the combat-relevant subset of the Three.js source `web/data/balance.ts`.
 * Only the constants M6 (damage/attack/chase) consumes are ported here; the rest
 * of balance.ts (upgrade tables, ability tuning) lands with its own milestone.
 *
 * `RANGE_SCALE` already lives in `data/weapons.ts` (inlined there for the table
 * build), so it is NOT re-declared here — SSOT stays in weapons.ts.
 */

import type { CombatType } from './units';

/**
 * Combat-type triangle counter multipliers (verbatim from source).
 * Lookup: COMBAT_TYPE_MULTIPLIERS[attackerType][defenderType].
 *
 *   armored > bio     -> 115%
 *   bio     > psionic -> 115%
 *   psionic > armored -> 115%
 *   void: 110% vs the triangle, normal vs void/structure
 *   structure: neutral (100% both ways)
 */
export const COMBAT_TYPE_MULTIPLIERS: Record<CombatType, Record<CombatType, number>> = {
  bio: { bio: 1.0, armored: 0.85, psionic: 1.15, void: 1.0, structure: 1.0 },
  armored: { bio: 1.15, armored: 1.0, psionic: 0.85, void: 1.0, structure: 1.0 },
  psionic: { bio: 0.85, armored: 1.15, psionic: 1.0, void: 1.0, structure: 1.0 },
  void: { bio: 1.10, armored: 1.10, psionic: 1.10, void: 1.0, structure: 1.0 },
  structure: { bio: 1.0, armored: 1.0, psionic: 1.0, void: 1.0, structure: 1.0 },
};

/** Void units take +25% from spell damage. */
export const VOID_SPELL_VULNERABILITY = 1.25;

/** High-ground miss chance (attacker below target by >3 world units). */
export const HIGH_GROUND_MISS_CHANCE = 0.2;

/** Damage floor (a hit never deals less than this). */
export const MIN_DAMAGE = 0.5;

/** Leash distance — give up the chase past this from the engage origin. */
export const LEASH_DISTANCE = 20;

/** Ranged-chase target: close to 85% of weapon range before firing. */
export const CHASE_RANGE_FACTOR = 0.85;
