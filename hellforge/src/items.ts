// Hellforge items — the loot-game core (装备/词条/品质/装备等级).
//
// Itemization model:
//   • 6 equip slots (weapon/helm/armor/boots/ring/amulet — a paper doll)
//   • 4 rarities: 普通 (1 weak implicit) / 魔法 (1-2 affixes) / 稀有 (3-4)
//     / 传奇 (fixed-name uniques with a curated affix set rolled high)
//   • 16 affix stats split D2-style: PREFIXES are offense (damage%, per-
//     element damage, crit), SUFFIXES are defense/utility (hp/mana, regen,
//     movespeed, cdr, gold find, MAGIC FIND, xp gain, life-on-kill)
//   • item level (装备等级): rolls off the killing monster's level; affix
//     values scale ×(1 + 0.12·(ilvl−1)); requires player level ≥ ilvl
//   • magic find (掉宝率) shifts rarity weights on every kill roll — the
//     stat that makes it a loot game
//
// The bag/paper-doll UI lives in inventory-ui.ts; this module is pure data.

export type ItemSlot = 'weapon' | 'helm' | 'armor' | 'boots' | 'ring' | 'amulet';
export type Rarity = 'common' | 'magic' | 'rare' | 'legendary';

export type AffixStat =
  | 'dmgPct' | 'fireDmg' | 'frostDmg' | 'arcDmg' | 'critChance' | 'critDmg'
  | 'maxHp' | 'maxMana' | 'hpRegen' | 'manaRegen' | 'moveSpd' | 'cdr'
  | 'goldFind' | 'magicFind' | 'xpGain' | 'lifeOnKill';

export interface Affix {
  stat: AffixStat;
  v: number;
  label: string;
}

export interface Item {
  slot: ItemSlot;
  rarity: Rarity;
  name: string;
  ilvl: number;            // 装备等级 — drives affix scale + level requirement
  reqLevel: number;
  affixes: Affix[];
  score: number;           // comparable power (auto-suggest / sort)
  legendary?: string;      // unique id when rarity === 'legendary'
}

/** Aggregate bonus of everything equipped — main.ts applies it. */
export interface EquipBonus {
  dmgPct: number;
  fireDmg: number; frostDmg: number; arcDmg: number;
  critChance: number; critDmg: number;
  maxHp: number; maxMana: number;
  hpRegen: number; manaRegen: number;
  moveSpd: number; cdr: number;
  goldFind: number; magicFind: number; xpGain: number; lifeOnKill: number;
}

export const RARITY_META: Record<Rarity, { label: string; color: string; beam: [number, number, number]; beamI: number }> = {
  common:    { label: '普通', color: '#d8d8d8', beam: [0.85, 0.85, 0.85], beamI: 2.2 },
  magic:     { label: '魔法', color: '#6f8dff', beam: [0.35, 0.5, 1.0], beamI: 4 },
  rare:      { label: '稀有', color: '#ffd04a', beam: [1.0, 0.78, 0.2], beamI: 5 },
  legendary: { label: '传奇', color: '#ff8a2a', beam: [1.0, 0.42, 0.08], beamI: 6 },
};

export const SLOT_META: Record<ItemSlot, { label: string; icon: string }> = {
  weapon: { label: '武器', icon: '🪄' },
  helm:   { label: '头盔', icon: '🎩' },
  armor:  { label: '胸甲', icon: '🧥' },
  boots:  { label: '靴子', icon: '👢' },
  ring:   { label: '戒指', icon: '💍' },
  amulet: { label: '项链', icon: '📿' },
};

export const SLOT_ORDER: ItemSlot[] = ['weapon', 'helm', 'armor', 'boots', 'ring', 'amulet'];

const BASE_NAMES: Record<ItemSlot, string[]> = {
  weapon: ['焦木杖', '熔岩杖', '星核杖'],
  helm:   ['布兜帽', '铁面盔', '角冠'],
  armor:  ['灰布袍', '烬羽斗篷', '熔鳞甲'],
  boots:  ['麻绳靴', '皮行靴', '熔纹靴'],
  ring:   ['铜环', '银纹戒', '曜石戒'],
  amulet: ['骨符', '烬石坠', '熔核项链'],
};

interface AffixDef { stat: AffixStat; name: string; lo: number; hi: number }

// PREFIXES — offense. `name` composes into the item name (灼热的熔岩杖…).
const PREFIXES: AffixDef[] = [
  { stat: 'dmgPct',     name: '残暴的', lo: 0.06, hi: 0.15 },
  { stat: 'fireDmg',    name: '灼热的', lo: 0.08, hi: 0.20 },
  { stat: 'frostDmg',   name: '凛冽的', lo: 0.08, hi: 0.20 },
  { stat: 'arcDmg',     name: '雷鸣的', lo: 0.08, hi: 0.20 },
  { stat: 'critChance', name: '锐利的', lo: 0.02, hi: 0.05 },
  { stat: 'critDmg',    name: '致命的', lo: 0.10, hi: 0.25 },
];

// SUFFIXES — defense / utility / loot.
const SUFFIXES: AffixDef[] = [
  { stat: 'maxHp',      name: '之壁', lo: 8,    hi: 20 },
  { stat: 'maxMana',    name: '之潮', lo: 6,    hi: 16 },
  { stat: 'hpRegen',    name: '之愈', lo: 0.5,  hi: 1.5 },
  { stat: 'manaRegen',  name: '之泉', lo: 0.6,  hi: 1.6 },
  { stat: 'moveSpd',    name: '之风', lo: 0.04, hi: 0.08 },
  { stat: 'cdr',        name: '之疾', lo: 0.03, hi: 0.08 },
  { stat: 'goldFind',   name: '之贪', lo: 0.10, hi: 0.25 },
  { stat: 'magicFind',  name: '之缘', lo: 0.08, hi: 0.20 },
  { stat: 'xpGain',     name: '之智', lo: 0.05, hi: 0.12 },
  { stat: 'lifeOnKill', name: '之噬', lo: 2,    hi: 6 },
];

export function fmtAffix(stat: AffixStat, v: number): string {
  switch (stat) {
    case 'dmgPct':     return `+${Math.round(v * 100)}% 伤害`;
    case 'fireDmg':    return `+${Math.round(v * 100)}% 熔火弹伤害`;
    case 'frostDmg':   return `+${Math.round(v * 100)}% 霜牙伤害`;
    case 'arcDmg':     return `+${Math.round(v * 100)}% 电弧涌伤害`;
    case 'critChance': return `+${(v * 100).toFixed(1)}% 暴击率`;
    case 'critDmg':    return `+${Math.round(v * 100)}% 暴击伤害`;
    case 'maxHp':      return `+${Math.round(v)} 生命上限`;
    case 'maxMana':    return `+${Math.round(v)} 法力上限`;
    case 'hpRegen':    return `+${v.toFixed(1)}/秒 生命回复`;
    case 'manaRegen':  return `+${v.toFixed(1)}/秒 法力回复`;
    case 'moveSpd':    return `+${Math.round(v * 100)}% 移动速度`;
    case 'cdr':        return `-${Math.round(v * 100)}% 技能冷却`;
    case 'goldFind':   return `+${Math.round(v * 100)}% 金币获取`;
    case 'magicFind':  return `+${Math.round(v * 100)}% 掉宝率`;
    case 'xpGain':     return `+${Math.round(v * 100)}% 经验获取`;
    case 'lifeOnKill': return `击杀回复 ${Math.round(v)} 生命`;
  }
}

/** Normalized per-stat weight so cross-stat scores compare sanely. */
const WEIGHT: Record<AffixStat, number> = {
  dmgPct: 110, fireDmg: 55, frostDmg: 55, arcDmg: 55, critChance: 260, critDmg: 65,
  maxHp: 1.1, maxMana: 1.0, hpRegen: 11, manaRegen: 9, moveSpd: 100, cdr: 120,
  goldFind: 28, magicFind: 55, xpGain: 45, lifeOnKill: 4,
};

const ilvlScale = (ilvl: number): number => 1 + 0.12 * (ilvl - 1);

function rollAffixFrom(pool: AffixDef[], ilvl: number, exclude: Set<AffixStat>): { def: AffixDef; affix: Affix } | null {
  const usable = pool.filter((p) => !exclude.has(p.stat));
  if (usable.length === 0) return null;
  const p = usable[Math.floor(Math.random() * usable.length)]!;
  const v = (p.lo + Math.random() * (p.hi - p.lo)) * ilvlScale(ilvl);
  return { def: p, affix: { stat: p.stat, v, label: fmtAffix(p.stat, v) } };
}

function scoreOf(affixes: Affix[], rarity: Rarity): number {
  const s = affixes.reduce((acc, a) => acc + a.v * WEIGHT[a.stat], 0);
  return s * (rarity === 'legendary' ? 1.08 : rarity === 'rare' ? 1.04 : 1);
}

// ── legendary uniques (传奇) — one per slot, curated affix sets ────────────
interface LegendaryDef {
  id: string;
  name: string;
  slot: ItemSlot;
  /** Affixes rolled at 1.15–1.35× the normal top end. */
  affixes: Array<{ stat: AffixStat; lo: number; hi: number }>;
  flavor: string;
}

export const LEGENDARIES: LegendaryDef[] = [
  {
    id: 'slag-staff', name: '熔渣之杖', slot: 'weapon',
    affixes: [
      { stat: 'dmgPct', lo: 0.16, hi: 0.24 },
      { stat: 'fireDmg', lo: 0.25, hi: 0.40 },
      { stat: 'critChance', lo: 0.04, hi: 0.07 },
    ],
    flavor: '从大熔炉的余渣中锻出，仍在低声燃烧。',
  },
  {
    id: 'warden-crown', name: '督军之冠', slot: 'helm',
    affixes: [
      { stat: 'maxHp', lo: 22, hi: 34 },
      { stat: 'cdr', lo: 0.08, hi: 0.12 },
      { stat: 'xpGain', lo: 0.12, hi: 0.18 },
    ],
    flavor: '熔渣督军的角冠，戴上的人听得见炉火的命令。',
  },
  {
    id: 'ash-raiment', name: '灰烬战衣', slot: 'armor',
    affixes: [
      { stat: 'maxHp', lo: 26, hi: 40 },
      { stat: 'hpRegen', lo: 1.6, hi: 2.4 },
      { stat: 'moveSpd', lo: 0.06, hi: 0.10 },
    ],
    flavor: '灰烬织成的战衣，火焰从不烧向自己人。',
  },
  {
    id: 'flame-striders', name: '掠火靴', slot: 'boots',
    affixes: [
      { stat: 'moveSpd', lo: 0.10, hi: 0.14 },
      { stat: 'goldFind', lo: 0.25, hi: 0.40 },
      { stat: 'lifeOnKill', lo: 5, hi: 9 },
    ],
    flavor: '踏过熔渣不留脚印，只留下空了的钱袋。',
  },
  {
    id: 'greed-band', name: '贪婪之环', slot: 'ring',
    affixes: [
      { stat: 'magicFind', lo: 0.22, hi: 0.35 },
      { stat: 'goldFind', lo: 0.25, hi: 0.40 },
      { stat: 'maxMana', lo: 14, hi: 22 },
    ],
    flavor: '它想要的和你想要的，恰好是同一件事。',
  },
  {
    id: 'ember-heart', name: '余烬之心', slot: 'amulet',
    affixes: [
      { stat: 'fireDmg', lo: 0.18, hi: 0.28 },
      { stat: 'frostDmg', lo: 0.18, hi: 0.28 },
      { stat: 'arcDmg', lo: 0.18, hi: 0.28 },
    ],
    flavor: '大熔炉最后一颗火星，在三种颜色里跳动。',
  },
];

// ── rolls ──────────────────────────────────────────────────────────────────

function rollLegendary(ilvl: number): Item {
  const def = LEGENDARIES[Math.floor(Math.random() * LEGENDARIES.length)]!;
  const scale = ilvlScale(ilvl);
  const affixes: Affix[] = def.affixes.map((a) => {
    const v = (a.lo + Math.random() * (a.hi - a.lo)) * scale;
    return { stat: a.stat, v, label: fmtAffix(a.stat, v) };
  });
  // + one random suffix so two copies of the same unique still differ
  const extra = rollAffixFrom(SUFFIXES, ilvl, new Set(affixes.map((a) => a.stat)));
  if (extra) affixes.push(extra.affix);
  return {
    slot: def.slot, rarity: 'legendary', name: def.name,
    ilvl, reqLevel: Math.max(1, ilvl - 1),
    affixes, score: scoreOf(affixes, 'legendary'), legendary: def.id,
  };
}

/** Roll an item of the given rarity at the given item level. */
export function rollItem(rarity: Rarity, ilvl: number, slot?: ItemSlot): Item {
  if (rarity === 'legendary') return rollLegendary(ilvl);
  const s = slot ?? SLOT_ORDER[Math.floor(Math.random() * SLOT_ORDER.length)]!;
  const base = BASE_NAMES[s][Math.min(2, Math.floor((ilvl - 1) / 3))]!;
  const affixes: Affix[] = [];
  const used = new Set<AffixStat>();
  let name = base;

  const addPrefix = (): void => {
    const r = rollAffixFrom(PREFIXES, ilvl, used);
    if (!r) return;
    used.add(r.def.stat);
    affixes.push(r.affix);
    if (!name.startsWith(r.def.name)) name = r.def.name + name;
  };
  const addSuffix = (): void => {
    const r = rollAffixFrom(SUFFIXES, ilvl, used);
    if (!r) return;
    used.add(r.def.stat);
    affixes.push(r.affix);
    if (!name.endsWith(r.def.name)) name = name + r.def.name;
  };

  if (rarity === 'common') {
    // one weak implicit (45% value) so an empty slot still upgrades
    const r = rollAffixFrom(Math.random() < 0.5 ? PREFIXES : SUFFIXES, Math.max(1, ilvl - 2), used);
    if (r) {
      r.affix.v *= 0.45;
      r.affix.label = fmtAffix(r.affix.stat, r.affix.v);
      affixes.push(r.affix);
    }
  } else if (rarity === 'magic') {
    // 1-2: always one, 50% a second from the other pool
    if (Math.random() < 0.5) { addPrefix(); if (Math.random() < 0.5) addSuffix(); }
    else { addSuffix(); if (Math.random() < 0.5) addPrefix(); }
  } else {
    // rare: 3-4 affixes, at least one from each pool
    addPrefix();
    addSuffix();
    const extra = 1 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < extra; i++) {
      if (Math.random() < 0.5) addPrefix(); else addSuffix();
    }
  }
  return {
    slot: s, rarity, name,
    ilvl, reqLevel: Math.max(1, ilvl - 1),
    affixes, score: scoreOf(affixes, rarity),
  };
}

/**
 * Kill-time drop roll. `magicFind` (0.2 = +20%) shifts weight from common
 * toward magic/rare/legendary. Returns null for "no equipment this kill".
 */
export function rollDrop(monsterLevel: number, isBoss: boolean, magicFind: number): Item | null {
  if (!isBoss && Math.random() >= 0.13) return null;
  const ilvl = Math.max(1, Math.min(10, monsterLevel + (Math.random() < 0.35 ? 1 : 0)));
  const mf = 1 + magicFind;
  // rarity weights (commons don't scale with MF — that's the point of MF)
  const wCommon = isBoss ? 0 : 60;
  const wMagic = 28 * mf;
  const wRare = (isBoss ? 70 : 9) * mf;
  const wLegend = (isBoss ? 22 : 0.9) * mf;
  const total = wCommon + wMagic + wRare + wLegend;
  let r = Math.random() * total;
  const rarity: Rarity =
    (r -= wCommon) < 0 ? 'common'
    : (r -= wMagic) < 0 ? 'magic'
    : (r -= wRare) < 0 ? 'rare'
    : 'legendary';
  return rollItem(rarity, isBoss ? Math.min(10, ilvl + 1) : ilvl);
}

export type Equipment = Record<ItemSlot, Item | null>;

export function emptyEquipment(): Equipment {
  return { weapon: null, helm: null, armor: null, boots: null, ring: null, amulet: null };
}

export function computeBonus(eq: Equipment): EquipBonus {
  const b: EquipBonus = {
    dmgPct: 0, fireDmg: 0, frostDmg: 0, arcDmg: 0, critChance: 0, critDmg: 0,
    maxHp: 0, maxMana: 0, hpRegen: 0, manaRegen: 0, moveSpd: 0, cdr: 0,
    goldFind: 0, magicFind: 0, xpGain: 0, lifeOnKill: 0,
  };
  for (const slot of SLOT_ORDER) {
    const item = eq[slot];
    if (!item) continue;
    for (const a of item.affixes) b[a.stat] += a.v;
  }
  b.cdr = Math.min(0.45, b.cdr);
  b.moveSpd = Math.min(0.4, b.moveSpd);
  b.critChance = Math.min(0.45, b.critChance);
  return b;
}

/** Tooltip lines: [text, cssColor][] — the inventory UI renders these. */
export function itemTooltipLines(item: Item, playerLevel: number): Array<[string, string]> {
  const meta = RARITY_META[item.rarity];
  const lines: Array<[string, string]> = [
    [item.name, meta.color],
    [`${meta.label} · ${SLOT_META[item.slot].label} · 装备等级 ${item.ilvl}`, '#998f7d'],
  ];
  if (item.reqLevel > 1) {
    lines.push([`需求等级 ${item.reqLevel}`, playerLevel >= item.reqLevel ? '#998f7d' : '#ff5a5a']);
  }
  for (const a of item.affixes) lines.push([a.label, '#7da2ff']);
  if (item.legendary) {
    const def = LEGENDARIES.find((l) => l.id === item.legendary);
    if (def) lines.push([def.flavor, '#c8843c']);
  }
  return lines;
}
