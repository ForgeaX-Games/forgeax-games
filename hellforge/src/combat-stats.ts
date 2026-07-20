// Derived combat state — never persisted. Inputs: ClassDef + CharacterSnapshot
// (level / equipment / skill ranks). SkillSystem and runtime orbs consume this;
// they must not keep a parallel writable authority for the same numbers.
//
// Skill-tree combat modifiers (Kindling, etc.) land in Task 3.2 via SkillResolver;
// skillRanks are accepted on the snapshot so this seam stays the single input.

import type { CharacterSnapshot } from './character-domain';
import {
  computeBaseStats,
  growthForLevel,
  type ClassDef,
} from './classes';
import type { DeepReadonly } from './deep-readonly';
import { computeBonus, type Equipment } from './items';

/** Spec §5.2 — derived only; caps applied here. */
export interface CombatStats {
  maxHp: number;
  maxMana: number;
  hpRegen: number;
  manaRegen: number;
  /** Final move-speed multiplier (1 = base walk/sprint; equipment bonus capped). */
  moveSpeed: number;
  damageReduction: number;
  globalDamageMul: number;
  fireDamageMul: number;
  frostDamageMul: number;
  arcDamageMul: number;
  critChance: number;
  critMultiplier: number;
  /** Multiplier applied to skill cooldowns (1 − CDR, CDR capped at 45%). */
  cooldownMul: number;
  goldFind: number;
  magicFind: number;
  xpGain: number;
  lifeOnKill: number;
}

/** Base mana regen before equipment (matches historical runtime default). */
export const BASE_MANA_REGEN = 5;

const DR_CAP = 0.6;
const CRIT_CHANCE_CAP = 0.5;
const CDR_CAP = 0.45;
const MOVE_BONUS_CAP = 0.4;

/**
 * Defense → damage reduction.
 * `damageReduction = clamp(defense / (defense + 100 + 15 × (level - 1)), 0, 0.60)`
 */
export function damageReductionFromDefense(defense: number, level: number): number {
  const denom = defense + 100 + 15 * (level - 1);
  if (denom <= 0) return 0;
  return Math.min(DR_CAP, Math.max(0, defense / denom));
}

/** Cumulative class+level HP/MP/defense (no equipment). */
export function classProgressionTotals(
  classDef: ClassDef,
  level: number,
): { maxHp: number; maxMana: number; defense: number } {
  const base = computeBaseStats(classDef);
  let maxHp = base.hp;
  let maxMana = base.mp;
  let defense = base.defense;
  const lv = Math.max(1, level);
  for (let L = 2; L <= lv; L++) {
    const g = growthForLevel(L, classDef.growthMods);
    maxHp += g.hp;
    maxMana += g.mp;
    defense += g.def;
  }
  return { maxHp, maxMana, defense };
}

export function deriveCombatStats(input: {
  character: DeepReadonly<CharacterSnapshot>;
  classDef: ClassDef;
}): CombatStats {
  const { character, classDef } = input;
  const level = Math.max(1, character.level);
  const base = computeBaseStats(classDef);
  const prog = classProgressionTotals(classDef, level);
  const equip = computeBonus(character.equipment as Equipment);

  // computeBonus already clamps equipment CDR / move; re-clamp for safety.
  const cdr = Math.min(CDR_CAP, Math.max(0, equip.cdr));
  const moveBonus = Math.min(MOVE_BONUS_CAP, Math.max(0, equip.moveSpd));

  const critChance = Math.min(CRIT_CHANCE_CAP, Math.max(0, base.critChance + equip.critChance));
  const critMultiplier = Math.max(1, base.critMultiplier + equip.critDmg);

  // skillRanks reserved for Task 3.2 tree → combat multipliers.
  void character.skillRanks;

  return Object.freeze({
    maxHp: prog.maxHp + equip.maxHp,
    maxMana: prog.maxMana + equip.maxMana,
    hpRegen: equip.hpRegen,
    manaRegen: BASE_MANA_REGEN + equip.manaRegen,
    moveSpeed: 1 + moveBonus,
    damageReduction: damageReductionFromDefense(prog.defense, level),
    globalDamageMul: 1 + equip.dmgPct,
    fireDamageMul: 1 + equip.fireDmg,
    frostDamageMul: 1 + equip.frostDmg,
    arcDamageMul: 1 + equip.arcDmg,
    critChance,
    critMultiplier,
    cooldownMul: 1 - cdr,
    goldFind: equip.goldFind,
    magicFind: equip.magicFind,
    xpGain: equip.xpGain,
    lifeOnKill: equip.lifeOnKill,
  });
}
