// Shared player progression state — HP / mana / XP / level / gold.
//
// One mutable singleton owned by main.ts and read by skills (mana), monsters
// (damage → hp), loot (xp/gold/potions) and hud (render). Pure data + a few
// curve helpers; no ECS access so it stays trivially testable.

export interface PlayerStats {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  manaRegen: number;   // per second
  hpRegen: number;     // per second (equipment-driven; base 0)
  xp: number;
  xpMax: number;       // xp needed for the NEXT level
  level: number;
  gold: number;
  kills: number;
  dead: boolean;
  /** i-frame window after taking a hit (seconds remaining). */
  hurtCooldown: number;
}

/** D2-ish gentle exponential: L1→2 needs 60, then ×1.45 per level. */
export function xpForLevel(level: number): number {
  return Math.floor(60 * Math.pow(1.45, level - 1));
}

export function createPlayer(): PlayerStats {
  return {
    hp: 80, maxHp: 80,
    mana: 50, maxMana: 50, manaRegen: 5,
    hpRegen: 0,
    xp: 0, xpMax: xpForLevel(1),
    level: 1, gold: 0, kills: 0,
    dead: false,
    hurtCooldown: 0,
  };
}

export interface LevelUpResult { level: number; hpGain: number; manaGain: number }

/** Add xp; apply any level-ups (possibly several). Returns them for HUD FX. */
export function grantXp(p: PlayerStats, xp: number): LevelUpResult[] {
  const ups: LevelUpResult[] = [];
  p.xp += xp;
  while (p.xp >= p.xpMax) {
    p.xp -= p.xpMax;
    p.level += 1;
    p.xpMax = xpForLevel(p.level);
    const hpGain = 14, manaGain = 9;
    p.maxHp += hpGain;
    p.maxMana += manaGain;
    p.hp = p.maxHp;          // D2 ding = full heal, feels great
    p.mana = p.maxMana;
    ups.push({ level: p.level, hpGain, manaGain });
  }
  return ups;
}

/** Apply damage with a 0.5s i-frame window. Returns true if it landed. */
export function damagePlayer(p: PlayerStats, dmg: number): boolean {
  if (p.dead || p.hurtCooldown > 0) return false;
  p.hp -= dmg;
  p.hurtCooldown = 0.5;
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

/** Respawn at camp after death: keep level/gold, refill orbs, small xp toll. */
export function respawnPlayer(p: PlayerStats): void {
  p.dead = false;
  p.hp = p.maxHp;
  p.mana = p.maxMana;
  p.xp = Math.floor(p.xp * 0.9);
  p.hurtCooldown = 1.5;
}
