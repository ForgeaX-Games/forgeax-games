// Class/character data contract — direct port of aidiablo's stat-calc contract
// (shared/types.ts ClassDef, shared/config.ts PLAYER_BASE_STATS/GROWTH_SEGMENTS).
// Pure data + formulas, zero engine deps.
//
// aidiablo computes final stats server-side; hellforge is single-player, so this
// module runs client-side and IS the authority (skip it and picking a class
// produces no differentiation).
//
// hellforge skills are a flat per-hero list (see heroes.ts), not a talent-tree
// system, and equipment has no weapon-type restrictions (see items.ts) — so
// aidiablo's skillTrees/allowedWeaponTypes/canUseShield/classSkillKey/etc. fields
// have no hellforge equivalent and are omitted from ClassDef below.

/** Full aidiablo class namespace; hellforge enables only classes with a matching hero GLB — see CLASS_DEFS. */
export type ClassId =
  | 'barbarian' | 'sorceress' | 'amazon' | 'necromancer'
  | 'paladin' | 'druid' | 'assassin' | 'warlock';

export interface StatMods {
  hp?: number;
  mp?: number;
  damageMin?: number;
  damageMax?: number;
  defense?: number;
  attackSpeed?: number;
  critChance?: number;
}

export interface GrowthMods {
  hpMult: number;
  mpMult: number;
  dmgMult: number;
  defMult: number;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  icon: string;
  description: string;
  lore: string;
  coreMechanic: string;
  coreMechanicDesc: string;
  /** Additive deltas applied once to PLAYER_BASE_STATS — see computeBaseStats(). */
  baseStatMods: StatMods;
  /** Multipliers applied to PLAYER_GROWTH_SEGMENTS — see growthForLevel(). */
  growthMods: GrowthMods;
}

/**
 * CharSelect shows these three (aidiablo HIDDEN_CLASSES filter). Models may be
 * temporary stand-ins until characterd / charactern packs land — see heroes.ts.
 */
export const SELECTABLE_CLASS_IDS: readonly ClassId[] = [
  'barbarian', 'sorceress', 'necromancer',
];

/** Only classes with a hero GLB (or preview stand-in) get an entry. */
export const CLASS_DEFS: Partial<Record<ClassId, ClassDef>> = {
  barbarian: {
    id: 'barbarian',
    name: '野蛮人',
    icon: '🪓',
    description: '以狂怒与蛮力碾碎敌人的近战猛士',
    lore: '北方荒原的部族战士，以热血换取力量',
    coreMechanic: '狂怒',
    coreMechanicDesc: '造成与承受伤害积攒怒气，满怒时短时大幅提升攻击与移速',
    baseStatMods: { hp: 40, mp: -15, damageMin: 3, damageMax: 4, defense: 3, attackSpeed: 0.1 },
    growthMods: { hpMult: 1.4, mpMult: 0.5, dmgMult: 1.2, defMult: 1.3 },
  },
  sorceress: {
    id: 'sorceress',
    name: '法师',
    icon: '🔮',
    description: '掌握元素魔法的奥术大师，精通火冰电三系魔法',
    lore: '来自扎卡拉姆东方魔法学院的奥术师，精通元素魔法的奥秘',
    coreMechanic: '元素精通',
    coreMechanicDesc: '连续使用同一元素的技能时伤害逐步提升，满层时+60%伤害，切换元素重置层数',
    baseStatMods: { hp: -20, mp: 40, damageMin: -1, damageMax: -2, defense: -1, attackSpeed: -0.2 },
    growthMods: { hpMult: 0.7, mpMult: 1.5, dmgMult: 1.0, defMult: 0.6 },
  },
  necromancer: {
    id: 'necromancer',
    name: '死灵法师',
    icon: '💀',
    description: '驱役骸骨与诅咒的暗影施法者',
    lore: '行走于生死边界的祭司，以亡者之力改写战场',
    coreMechanic: '亡灵契约',
    coreMechanicDesc: '击杀积攒尸骨能量，可召唤短暂仆从或强化下一次诅咒',
    baseStatMods: { hp: -10, mp: 30, damageMin: 0, damageMax: 1, defense: 0, attackSpeed: -0.1 },
    growthMods: { hpMult: 0.85, mpMult: 1.35, dmgMult: 1.05, defMult: 0.8 },
  },
};

export function getClassDef(id: ClassId): ClassDef {
  const def = CLASS_DEFS[id];
  if (!def) throw new Error(`No ClassDef for classId "${id}" — hellforge only enables classes with a matching hero GLB.`);
  return def;
}

// ── stat-calc formulas (aidiablo config.ts:171/:192 direct port) ───────────

export interface PlayerStatsInit {
  hp: number;
  mp: number;
  damageMin: number;
  damageMax: number;
  defense: number;
  attackSpeed: number;
  attackRange: number;
  critChance: number;
  critMultiplier: number;
}

export const PLAYER_BASE_STATS: PlayerStatsInit = {
  hp: 80, mp: 40, damageMin: 4, damageMax: 8, defense: 2,
  attackSpeed: 1.5, attackRange: 1.5, critChance: 0.05, critMultiplier: 1.5,
};

/** Final stat = PLAYER_BASE_STATS + ClassDef.baseStatMods. */
export function computeBaseStats(classDef: ClassDef): PlayerStatsInit {
  const m = classDef.baseStatMods;
  return {
    hp: PLAYER_BASE_STATS.hp + (m.hp ?? 0),
    mp: PLAYER_BASE_STATS.mp + (m.mp ?? 0),
    damageMin: PLAYER_BASE_STATS.damageMin + (m.damageMin ?? 0),
    damageMax: PLAYER_BASE_STATS.damageMax + (m.damageMax ?? 0),
    defense: PLAYER_BASE_STATS.defense + (m.defense ?? 0),
    attackSpeed: PLAYER_BASE_STATS.attackSpeed + (m.attackSpeed ?? 0),
    attackRange: PLAYER_BASE_STATS.attackRange,
    critChance: PLAYER_BASE_STATS.critChance + (m.critChance ?? 0),
    critMultiplier: PLAYER_BASE_STATS.critMultiplier,
  };
}

/** Five-segment growth table: [startLv, endLv, hpPerLv, mpPerLv, dmgPerLv, defPerLv]. */
export const PLAYER_GROWTH_SEGMENTS: readonly (readonly [
  startLv: number, endLv: number, hpPerLv: number, mpPerLv: number, dmgPerLv: number, defPerLv: number,
])[] = [
  [1, 18, 12, 6, 1.5, 0.5],
  [19, 36, 18, 9, 2.5, 1.0],
  [37, 55, 28, 14, 4.0, 2.0],
  [56, 72, 42, 21, 6.5, 3.5],
  [73, 99, 60, 30, 10.0, 5.5],
];

export interface LevelGrowth { hp: number; mp: number; dmg: number; def: number }

/** Per-level-up growth = PLAYER_GROWTH_SEGMENTS[segment] × ClassDef.growthMods. */
export function growthForLevel(level: number, growthMods: GrowthMods): LevelGrowth {
  const seg = PLAYER_GROWTH_SEGMENTS.find(([s, e]) => level >= s && level <= e)
    ?? PLAYER_GROWTH_SEGMENTS[PLAYER_GROWTH_SEGMENTS.length - 1]!;
  const [, , hpPerLv, mpPerLv, dmgPerLv, defPerLv] = seg;
  return {
    hp: hpPerLv * growthMods.hpMult,
    mp: mpPerLv * growthMods.mpMult,
    dmg: dmgPerLv * growthMods.dmgMult,
    def: defPerLv * growthMods.defMult,
  };
}

// ── save-slot shape (aidiablo main.ts:60 direct port, minus multiplayer
// reconnect fields — lastRoomId/lastPlayerId/mapSeed don't apply single-player) ─

export interface CharacterRecord {
  id: string;
  playerName: string;
  classId: ClassId;
  level: number;
  createdAt: number;
  lastPlayedAt: number;
}
