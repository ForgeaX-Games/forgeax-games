/**
 * MarsCraft -> forgeax-engine — damage resolver (Milestone M6)
 * =============================================================================
 * Port of the Three.js source `web/systems/DamageResolver.ts`. Pure-ish: stateless
 * functions that read a target's Health (+ UnitType / Building / Transform) via
 * `world.get` and write the reduced Health back via `world.set`. Every damage
 * source (melee/hitscan, projectile hit, splash) funnels through `resolveDamage`
 * so the modifier chain stays identical across call sites — exactly as the source
 * unified all callers through one function.
 *
 * Damage pipeline (verbatim from source) — 7 stages:
 *   (1) base damage           = baseDamage + attackBonus
 *   (2) attacker buff bonus    (handled by caller via attackBonus; no-op here)
 *   (3) damage-type modifier
 *        normal -> combat-type triangle multiplier (attacker vs defender)
 *        spell  -> void-spell vulnerability if the defender is `void`
 *   (4) defender mitigation
 *        normal -> subtract armor (constructing buildings have armor 0)
 *        spell  -> ignores armor
 *   (5) defender damage-taken buff multiplier (M9; not yet present -> 1.0)
 *   (6) floor: max(MIN_DAMAGE, dmg)
 *   (7) apply: shield first, then hp; set isDead on hp<=0
 *
 * High-ground miss is rolled BEFORE the pipeline; a miss skips the whole chain.
 *
 * ── ECS adaptation notes ─────────────────────────────────────────────────────
 * - The source read attacker-upgrade / buff bonuses from UnitStats / Abilities;
 *   those systems land in M9, so `attackBonus` / `defenseBonus` are passed in by
 *   the caller (the attack-system passes 0 until upgrades exist). The pipeline is
 *   otherwise 1:1.
 * - Source `gameRandom()` is the seeded multiplayer RNG; netcode is M15. A small
 *   deterministic mulberry32 (`combatRandom`) is used here so the high-ground roll
 *   is reproducible across runs (it only fires when the attacker is >3 world units
 *   below the target — never in the flat skirmish, but kept faithful).
 */

import { type World, type EntityHandle } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Health, UnitType, Building, Illusion, COMBAT_TYPE, BUILDING_STATE, type CombatTypeCode,
} from '../components';
import {
  COMBAT_TYPE_MULTIPLIERS, VOID_SPELL_VULNERABILITY,
  HIGH_GROUND_MISS_CHANCE, MIN_DAMAGE,
} from '../data/balance';
import { eventBus } from '../core/event-bus';
import type { CombatType } from '../data/units';
import type { DamageType } from '../data/weapons';

// ── deterministic combat RNG (mulberry32) ────────────────────────────────────
let _rngState = 0x9e3779b9 >>> 0;
/** Reseed the combat RNG (called by main.ts for reproducible verify runs). */
export function seedCombatRandom(seed: number): void {
  _rngState = seed >>> 0;
}
// ── M15 chunk 1: single-RNG-source unification hook ───────────────────────────
// For full lockstep determinism, ALL sim randomness must funnel through the ONE
// seeded source (src/net/seeded-random). In default play the combat roll uses the
// local mulberry32 below (unchanged). When `?lockstep=1`, main.ts calls
// `setCombatRandomSource(gameRandom)` so the high-ground-miss roll draws from the
// same seeded stream as the rest of the sim — a peer/replay reproduces it exactly.
let _combatRandomSource: (() => number) | null = null;
/** Route combat randomness through an external seeded source (lockstep mode). */
export function setCombatRandomSource(fn: (() => number) | null): void {
  _combatRandomSource = fn;
}
/** Deterministic [0,1). Uses the unified sim source if set, else local mulberry32. */
function combatRandom(): number {
  if (_combatRandomSource) return _combatRandomSource();
  _rngState = (_rngState + 0x6d2b79f5) >>> 0;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ── combat-type code -> string (for the multiplier table) ────────────────────
const COMBAT_CODE_TO_STR: Record<number, CombatType> = {
  [COMBAT_TYPE.BIO]: 'bio',
  [COMBAT_TYPE.ARMORED]: 'armored',
  [COMBAT_TYPE.PSIONIC]: 'psionic',
  [COMBAT_TYPE.VOID]: 'void',
  [COMBAT_TYPE.STRUCTURE]: 'structure',
};

/** Damage-resolution result (mirrors source DamageResult). */
export interface DamageResult {
  actualDamage: number;
  missed: boolean;
  killed: boolean;
}

/**
 * Resolve damage against one target (the unified pipeline).
 *
 * @param world        ECS world
 * @param target       target entity
 * @param baseDamage   base weapon damage
 * @param damageCount  hits this attack (e.g. flamethrower = 2)
 * @param damageType   'normal' (triangle + armor) | 'spell' (void-vuln, no armor)
 * @param gameTime     current game time (stamps Health.lastDamageTime)
 * @param attackerY    attacker Y for high-ground miss; undefined = no roll
 * @param attackBonus  attacker upgrade/buff bonus (+N damage)
 * @param defenseBonus defender upgrade/buff bonus (+N armor)
 * @param attackerCombatType attacker combat-type code (triangle counter)
 * @param attacker     attacker entity (optional) — when present, emits the
 *                     `combat:damage` / `combat:damage_taken` trigger events
 *                     after the deduction. Purely additive: behaviour identical
 *                     to omitting it (the bus is a no-op without subscribers).
 */
export function resolveDamage(
  world: World,
  target: EntityHandle,
  baseDamage: number,
  damageCount: number,
  damageType: DamageType,
  gameTime: number,
  attackerY?: number,
  attackBonus = 0,
  defenseBonus = 0,
  attackerCombatType?: CombatTypeCode,
  attacker?: EntityHandle,
): DamageResult {
  const hr = world.get(target, Health);
  if (!hr.ok || hr.value.isDead) {
    return { actualDamage: 0, missed: false, killed: false };
  }
  const health = hr.value;

  const utr = world.get(target, UnitType);
  const defTypeCode = utr.ok ? utr.value.combatType : COMBAT_TYPE.BIO;
  const defType: CombatType = COMBAT_CODE_TO_STR[defTypeCode] ?? 'bio';

  // ── high-ground miss (rolled before the pipeline) ──
  if (attackerY !== undefined) {
    const tr = world.get(target, Transform);
    if (tr.ok) {
      const heightDiff = tr.value.pos[1] - attackerY;
      if (heightDiff > 3 && combatRandom() < HIGH_GROUND_MISS_CHANCE) {
        return { actualDamage: 0, missed: true, killed: false };
      }
    }
  }

  // building under construction -> armor 0
  const br = world.get(target, Building);
  const isConstructing = br.ok && br.value.state === BUILDING_STATE.CONSTRUCTING;

  // M9 ch3: illusion damage-taken multiplier (clones take e.g. 250% damage). Real,
  // queried from the Illusion component the summon system attaches; identity for
  // non-illusions. (Folded into stage 5 below.)
  const ilr = world.get(target, Illusion);
  const illusionTakenMult = ilr.ok ? ilr.value.damageTakenMultiplier : 1.0;

  const atkType: CombatType =
    attackerCombatType !== undefined ? (COMBAT_CODE_TO_STR[attackerCombatType] ?? 'bio') : 'bio';

  let totalDamage = 0;
  for (let hit = 0; hit < damageCount; hit++) {
    // (1) base
    let dmg = baseDamage + attackBonus;

    // (3) damage-type modifier
    if (damageType !== 'spell') {
      const mult = COMBAT_TYPE_MULTIPLIERS[atkType]?.[defType] ?? 1.0;
      dmg *= mult;
    } else if (defType === 'void') {
      dmg *= VOID_SPELL_VULNERABILITY;
    }

    // (4) defender mitigation (spell ignores armor)
    if (damageType !== 'spell') {
      const effectiveArmor = isConstructing ? 0 : health.armor + defenseBonus;
      dmg -= effectiveArmor;
    }

    // (5) defender damage-taken multiplier — illusion clones take more/less.
    if (illusionTakenMult !== 1.0) dmg *= illusionTakenMult;

    // (6) floor
    dmg = Math.max(MIN_DAMAGE, dmg);
    totalDamage += dmg;
  }

  // (7) apply: shield first, then hp
  const killed = applyDamageToHealth(world, target, health, totalDamage, gameTime);

  // trigger events (only when an attacker is attributed; bus no-ops if unsubscribed)
  if (attacker !== undefined) {
    const atkId = attacker as unknown as number;
    const tgtId = target as unknown as number;
    eventBus.emit('combat:damage', { attacker: atkId, target: tgtId, damage: totalDamage });
    eventBus.emit('combat:damage_taken', { target: tgtId, attacker: atkId, damage: totalDamage });
    // record the killer; the DeathSystem emits the single canonical combat:kill
    // (on_death + on_kill) when it reaps the corpse, so kills from any source
    // (DoT, effects) are covered without double-firing on_kill.
    lastAttacker.set(tgtId, atkId);
  }

  return { actualDamage: totalDamage, missed: false, killed };
}

/**
 * Last attributed attacker per (raw) entity id — written on every attributed hit,
 * read once by the DeathSystem to attribute the `combat:kill` event's killer.
 * Cleaned by the DeathSystem when it reaps the entity.
 */
export const lastAttacker = new Map<number, number>();

/**
 * Apply already-resolved damage to a target's Health (shield -> hp), write it
 * back, and return whether the target died. Mirrors source `CHealth.takeDamage`.
 * Exposed so the splash resolver can reuse the exact deduction logic.
 */
export function applyDamageToHealth(
  world: World,
  target: EntityHandle,
  health: { hp: number; shield: number; armor: number; isDead: boolean },
  amount: number,
  gameTime: number,
): boolean {
  if (health.isDead) return false;

  let remaining = amount;
  let shield = health.shield;
  let hp = health.hp;

  if (shield > 0) {
    const shieldDmg = Math.min(shield, remaining);
    shield -= shieldDmg;
    remaining -= shieldDmg;
  }
  if (remaining > 0) hp -= remaining;

  let isDead = false;
  if (hp <= 0) { hp = 0; isDead = true; }

  world.set(target, Health, { hp, shield, isDead, lastDamageTime: gameTime });
  return isDead;
}
