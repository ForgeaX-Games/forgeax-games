// Runtime-only player combat resources — HP / mana / dead / hurt / kills.
// Long-term progression (level / XP / gold / inventory / quests / skills) lives
// in CharacterDomain; this module must not retain a writable copy of those.
// Max HP/MP / regen are synced from derived CombatStats.

import type { ClassId } from './classes';
import { getClassDef } from './classes';
import {
  BASE_MANA_REGEN,
  classProgressionTotals,
  type CombatStats,
} from './combat-stats';
import { preserveResourceRatio } from './damage';
import { getHeroDef } from './heroes';
import { xpForLevel } from './xp';

export { xpForLevel };

export interface PlayerStats {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  manaRegen: number;   // per second
  hpRegen: number;     // per second (equipment-driven; base 0)
  kills: number;
  dead: boolean;
  /** i-frame window after taking a hit (seconds remaining). */
  hurtCooldown: number;
}

/** Seed runtime orbs at full resources from derived CombatStats. */
export function createPlayerFromCombatStats(stats: CombatStats): PlayerStats {
  return {
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    mana: stats.maxMana,
    maxMana: stats.maxMana,
    manaRegen: stats.manaRegen,
    hpRegen: stats.hpRegen,
    kills: 0,
    dead: false,
    hurtCooldown: 0,
  };
}

/** Runtime orbs at class baseline (level 1, empty equipment). */
export function createPlayer(heroId: ClassId): PlayerStats {
  return createPlayerAtLevel(heroId, 1);
}

/**
 * Seeds runtime HP/MP at a saved level with empty equipment using the same
 * class+level progression formulas as deriveCombatStats.
 */
export function createPlayerAtLevel(heroId: ClassId, level: number): PlayerStats {
  void getHeroDef(heroId); // validate hero exists
  const prog = classProgressionTotals(getClassDef(heroId), Math.max(1, level));
  return {
    hp: prog.maxHp,
    maxHp: prog.maxHp,
    mana: prog.maxMana,
    maxMana: prog.maxMana,
    manaRegen: BASE_MANA_REGEN,
    hpRegen: 0,
    kills: 0,
    dead: false,
    hurtCooldown: 0,
  };
}

/**
 * Sync max/regen from CombatStats. Resource ratios preserved unless
 * `refill` is true (level-up / respawn / reload).
 */
export function syncRuntimeFromCombatStats(
  p: PlayerStats,
  stats: CombatStats,
  opts: { refill?: boolean } = {},
): void {
  const prevMaxHp = p.maxHp;
  const prevMaxMana = p.maxMana;
  if (opts.refill) {
    p.maxHp = stats.maxHp;
    p.maxMana = stats.maxMana;
    p.hp = stats.maxHp;
    p.mana = stats.maxMana;
  } else {
    p.hp = preserveResourceRatio(p.hp, prevMaxHp, stats.maxHp);
    p.mana = preserveResourceRatio(p.mana, prevMaxMana, stats.maxMana);
    p.maxHp = stats.maxHp;
    p.maxMana = stats.maxMana;
  }
  p.hpRegen = stats.hpRegen;
  p.manaRegen = stats.manaRegen;
}

/** Apply damage with a 0.9s i-frame window. Returns true if it landed. */
export function damagePlayer(p: PlayerStats, dmg: number): boolean {
  if (p.dead || p.hurtCooldown > 0) return false;
  p.hp -= dmg;
  // 0.9 s (was 0.5): boss slam + volley + adds could re-hit inside the old
  // window and chain-lock the player into a death spiral.
  p.hurtCooldown = 0.9;
  if (p.hp <= 0) { p.hp = 0; p.dead = true; }
  return true;
}

export function tickPlayer(p: PlayerStats, dt: number): void {
  if (p.hurtCooldown > 0) p.hurtCooldown = Math.max(0, p.hurtCooldown - dt);
  if (!p.dead) {
    p.mana = Math.min(p.maxMana, p.mana + p.manaRegen * dt);
    if (p.hpRegen > 0) p.hp = Math.min(p.maxHp, p.hp + p.hpRegen * dt);
  }
}

/** Respawn at camp after death: refill orbs. No XP penalty (Spec §12). */
export function respawnPlayer(p: PlayerStats): void {
  p.dead = false;
  p.hp = p.maxHp;
  p.mana = p.maxMana;
  p.hurtCooldown = 1.5;
}
