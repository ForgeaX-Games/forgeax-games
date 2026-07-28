// Versioned character-save wire format (Task 2.1).
// Pure parse/validate — no localStorage I/O. save.ts owns persistence.

import {
  PLAYABLE_CLASS_ID,
  SKILL_NODE_IDS,
  type ActiveSkillId,
  type PlayableClassId,
  type QuestId,
  type QuestSave,
  type QuestStatus,
  type SkillNodeId,
} from './content-ids';
import type { CharacterRecord, ClassId } from './classes';
import type { DeepReadonly } from './deep-readonly';
import type { Affix, AffixStat, Equipment, EquipSlot, ItemInstance, ItemSlot, Rarity } from './items';
import { EQUIP_SLOT_ORDER, equipSlotsFor, SLOT_ORDER } from './items';
import { BAG_SIZE, POTION_CAP } from './character-domain';
import type { HotbarSlots } from './content-ids';
import { clampSkillRanks } from './skill-tree';

export const LEGACY_STORAGE_KEY = 'hellforge.characters.v1';
export const SAVES_STORAGE_KEY = 'hellforge.character-saves.v1';
export const SAVE_SCHEMA_VERSION = 1 as const;
export const CHECKPOINT_CINDERWATCH = 'cinderwatch' as const;

export type CheckpointId = typeof CHECKPOINT_CINDERWATCH;

/** Shard currency counters (PR10). Optional on disk — old saves parse as zeros. */
export type MaterialsSave = { common: number; magic: number; rare: number };

export interface ProgressionSave {
  readonly level: number;
  readonly xp: number;
  readonly gold: number;
  readonly unspentSkillPoints: number;
  readonly skillRanks: Readonly<Record<SkillNodeId, number>>;
  readonly hotbar: HotbarSlots;
  readonly selectedHotbarSlot: 0 | 1 | 2 | 3;
  /** Belt stock (R2 potions). Optional on disk — old saves parse as 0/0. */
  readonly potions?: { life: number; mana: number };
  /** Forge materials (PR10). Optional on disk — old saves parse as 0/0/0. */
  readonly materials?: MaterialsSave;
}

export interface InventorySave {
  readonly bag: readonly (DeepReadonly<ItemInstance> | null)[];
  readonly equipment: DeepReadonly<Equipment>;
}

export interface CharacterSaveEnvelope {
  readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
  readonly character: {
    readonly id: string;
    readonly playerName: string;
    readonly classId: PlayableClassId;
    readonly createdAt: number;
    readonly lastPlayedAt: number;
  };
  readonly progression: ProgressionSave;
  readonly inventory: InventorySave;
  /** Persistent quest status only — CombatRunDomain objectives/seeds are never serialized. */
  readonly quests: Readonly<Record<QuestId, QuestSave>>;
  readonly checkpointId: CheckpointId;
}

/** On-disk blob for hellforge.character-saves.v1 */
export interface CharacterSavesStore {
  readonly envelopes: Readonly<Record<string, CharacterSaveEnvelope>>;
  /** Soft-hide user-deleted legacy rows without rewriting hellforge.characters.v1. */
  readonly hiddenLegacyIds: readonly string[];
}

const ACTIVE_SKILLS: readonly ActiveSkillId[] = ['magma', 'frost', 'arc', 'blink', 'inferno-nova'];
const ITEM_SLOTS: readonly ItemSlot[] = SLOT_ORDER;
const EQUIP_SLOTS: readonly EquipSlot[] = EQUIP_SLOT_ORDER;
const RARITIES: readonly Rarity[] = ['common', 'magic', 'rare', 'legendary'];
const AFFIX_STATS: readonly AffixStat[] = [
  'dmgPct', 'fireDmg', 'frostDmg', 'arcDmg', 'critChance', 'critDmg',
  'maxHp', 'maxMana', 'hpRegen', 'manaRegen', 'moveSpd', 'cdr',
  'goldFind', 'magicFind', 'xpGain', 'lifeOnKill',
];
const QUEST_STATUSES: readonly QuestStatus[] = ['available', 'active', 'ready', 'completed'];
const CLASS_IDS: readonly ClassId[] = [
  'barbarian', 'sorceress', 'amazon', 'necromancer',
  'paladin', 'druid', 'assassin', 'warlock',
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isActiveSkillId(v: unknown): v is ActiveSkillId {
  return typeof v === 'string' && (ACTIVE_SKILLS as readonly string[]).includes(v);
}

function isSkillNodeId(v: unknown): v is SkillNodeId {
  return typeof v === 'string' && (SKILL_NODE_IDS as readonly string[]).includes(v);
}

function isItemSlot(v: unknown): v is ItemSlot {
  return typeof v === 'string' && (ITEM_SLOTS as readonly string[]).includes(v);
}

function isRarity(v: unknown): v is Rarity {
  return typeof v === 'string' && (RARITIES as readonly string[]).includes(v);
}

function isAffixStat(v: unknown): v is AffixStat {
  return typeof v === 'string' && (AFFIX_STATS as readonly string[]).includes(v);
}

function isQuestStatus(v: unknown): v is QuestStatus {
  return typeof v === 'string' && (QUEST_STATUSES as readonly string[]).includes(v);
}

function isClassId(v: unknown): v is ClassId {
  return typeof v === 'string' && (CLASS_IDS as readonly string[]).includes(v);
}

function parseAffix(raw: unknown): Affix | null {
  if (!isObject(raw)) return null;
  if (!isAffixStat(raw.stat) || !isFiniteNumber(raw.v) || typeof raw.label !== 'string') return null;
  return { stat: raw.stat, v: raw.v, label: raw.label };
}

function parseItemInstance(raw: unknown): ItemInstance | null {
  if (!isObject(raw)) return null;
  if (!isNonEmptyString(raw.instanceId)) return null;
  if (!isItemSlot(raw.slot) || !isRarity(raw.rarity)) return null;
  if (typeof raw.name !== 'string') return null;
  if (!isFiniteNumber(raw.ilvl) || !isFiniteNumber(raw.reqLevel) || !isFiniteNumber(raw.score)) return null;
  if (!Array.isArray(raw.affixes)) return null;
  const affixes: Affix[] = [];
  for (const a of raw.affixes) {
    const parsed = parseAffix(a);
    if (!parsed) return null;
    affixes.push(parsed);
  }
  const item: ItemInstance = {
    instanceId: raw.instanceId,
    slot: raw.slot,
    rarity: raw.rarity,
    name: raw.name,
    ilvl: raw.ilvl,
    reqLevel: raw.reqLevel,
    affixes,
    score: raw.score,
  };
  if (typeof raw.legendary === 'string') item.legendary = raw.legendary;
  return item;
}

function parseHotbar(raw: unknown): HotbarSlots | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const slots: Array<ActiveSkillId | null> = [];
  for (const s of raw) {
    if (s === null) {
      slots.push(null);
      continue;
    }
    if (!isActiveSkillId(s)) return null;
    slots.push(s);
  }
  return slots as unknown as HotbarSlots;
}

function parseSkillRanks(raw: unknown): Record<SkillNodeId, number> | null {
  if (!isObject(raw)) return null;
  const partial: Partial<Record<SkillNodeId, number>> = {};
  for (const id of SKILL_NODE_IDS) {
    const v = raw[id];
    if (v === undefined) continue;
    if (!isFiniteNumber(v) || v < 0) return null;
    partial[id] = Math.floor(v);
  }
  // Tree SSOT: clamp to max ranks + enforce free Frost Fang rank 1.
  return clampSkillRanks(partial);
}

function parseEquipment(raw: unknown): Equipment | null {
  if (!isObject(raw)) return null;
  const eq = {} as Equipment;
  for (const slot of EQUIP_SLOTS) {
    // Legacy key `ring` → ring1; explicit ring1 wins if both present.
    const v = slot === 'ring1' && raw.ring1 === undefined ? raw.ring : raw[slot];
    if (v === null || v === undefined) {
      eq[slot] = null;
      continue;
    }
    const item = parseItemInstance(v);
    // Rings: ItemSlot 'ring' may sit in ring1 or ring2 (identity ≠ EquipSlot key).
    if (!item || !equipSlotsFor(item.slot).includes(slot)) return null;
    eq[slot] = item;
  }
  return eq;
}

function parseBag(raw: unknown): Array<ItemInstance | null> | null {
  if (!Array.isArray(raw)) return null;
  const bag: Array<ItemInstance | null> = [];
  for (const slot of raw) {
    if (slot === null) {
      bag.push(null);
      continue;
    }
    const item = parseItemInstance(slot);
    if (!item) return null;
    bag.push(item);
  }
  while (bag.length < BAG_SIZE) bag.push(null);
  return bag.slice(0, BAG_SIZE);
}

function parseQuests(raw: unknown): Record<QuestId, QuestSave> | null {
  if (!isObject(raw)) return null;
  const entry = raw['purge-slagdeep-hollow'];
  if (!isObject(entry) || !isQuestStatus(entry.status)) return null;
  return { 'purge-slagdeep-hollow': { status: entry.status } };
}

function parseSelectedHotbarSlot(raw: unknown): 0 | 1 | 2 | 3 | null {
  if (raw === 0 || raw === 1 || raw === 2 || raw === 3) return raw;
  return null;
}

/** Optional belt stock — absent/garbage → 0/0 (never rejects the envelope). */
function parsePotions(raw: unknown): { life: number; mana: number } {
  if (!isObject(raw)) return { life: 0, mana: 0 };
  const n = (v: unknown): number =>
    isFiniteNumber(v) && v >= 0 ? Math.min(POTION_CAP, Math.floor(v)) : 0;
  return { life: n(raw.life), mana: n(raw.mana) };
}

/** Optional forge materials — absent/garbage → zeros (never rejects the envelope). */
function parseMaterials(raw: unknown): MaterialsSave {
  if (!isObject(raw)) return { common: 0, magic: 0, rare: 0 };
  const n = (v: unknown): number =>
    isFiniteNumber(v) && v >= 0 ? Math.floor(v) : 0;
  return { common: n(raw.common), magic: n(raw.magic), rare: n(raw.rare) };
}

/** Validate unknown JSON → CharacterSaveEnvelope, or null if malformed. */
export function parseEnvelope(raw: unknown): CharacterSaveEnvelope | null {
  if (!isObject(raw)) return null;
  if (raw.schemaVersion !== SAVE_SCHEMA_VERSION) return null;
  if (raw.checkpointId !== CHECKPOINT_CINDERWATCH) return null;

  const character = raw.character;
  if (!isObject(character)) return null;
  if (!isNonEmptyString(character.id) || typeof character.playerName !== 'string') return null;
  if (character.classId !== PLAYABLE_CLASS_ID) return null;
  if (!isFiniteNumber(character.createdAt) || !isFiniteNumber(character.lastPlayedAt)) return null;

  const progression = raw.progression;
  if (!isObject(progression)) return null;
  if (!isFiniteNumber(progression.level) || progression.level < 1) return null;
  if (!isFiniteNumber(progression.xp) || progression.xp < 0) return null;
  if (!isFiniteNumber(progression.gold) || progression.gold < 0) return null;
  if (!isFiniteNumber(progression.unspentSkillPoints) || progression.unspentSkillPoints < 0) return null;
  const skillRanks = parseSkillRanks(progression.skillRanks);
  const hotbar = parseHotbar(progression.hotbar);
  const selectedHotbarSlot = parseSelectedHotbarSlot(progression.selectedHotbarSlot);
  if (!skillRanks || !hotbar || selectedHotbarSlot === null) return null;

  const inventory = raw.inventory;
  if (!isObject(inventory)) return null;
  const bag = parseBag(inventory.bag);
  const equipment = parseEquipment(inventory.equipment);
  if (!bag || !equipment) return null;

  const quests = parseQuests(raw.quests);
  if (!quests) return null;

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    character: {
      id: character.id,
      playerName: character.playerName,
      classId: PLAYABLE_CLASS_ID,
      createdAt: character.createdAt,
      lastPlayedAt: character.lastPlayedAt,
    },
    progression: {
      level: Math.floor(progression.level),
      xp: Math.floor(progression.xp),
      gold: Math.floor(progression.gold),
      unspentSkillPoints: Math.floor(progression.unspentSkillPoints),
      skillRanks,
      hotbar,
      selectedHotbarSlot,
      potions: parsePotions(progression.potions),
      materials: parseMaterials(progression.materials),
    },
    inventory: { bag, equipment },
    quests,
    checkpointId: CHECKPOINT_CINDERWATCH,
  };
}

/** Validate a legacy CharacterRecord row (any class, including disabled). */
export function parseLegacyRecord(raw: unknown): CharacterRecord | null {
  if (!isObject(raw)) return null;
  if (!isNonEmptyString(raw.id) || typeof raw.playerName !== 'string') return null;
  if (!isClassId(raw.classId)) return null;
  if (!isFiniteNumber(raw.level) || raw.level < 1) return null;
  if (!isFiniteNumber(raw.createdAt) || !isFiniteNumber(raw.lastPlayedAt)) return null;
  return {
    id: raw.id,
    playerName: raw.playerName,
    classId: raw.classId,
    level: Math.floor(raw.level),
    createdAt: raw.createdAt,
    lastPlayedAt: raw.lastPlayedAt,
  };
}

export function parseLegacyList(raw: unknown): CharacterRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: CharacterRecord[] = [];
  for (const row of raw) {
    const rec = parseLegacyRecord(row);
    if (rec) out.push(rec);
  }
  return out;
}

export function emptySavesStore(): CharacterSavesStore {
  return { envelopes: {}, hiddenLegacyIds: [] };
}

export function parseSavesStore(raw: unknown): CharacterSavesStore {
  if (!isObject(raw)) return emptySavesStore();
  const envelopes: Record<string, CharacterSaveEnvelope> = {};
  if (isObject(raw.envelopes)) {
    for (const [id, value] of Object.entries(raw.envelopes)) {
      const env = parseEnvelope(value);
      if (env && env.character.id === id) envelopes[id] = env;
    }
  }
  const hiddenLegacyIds: string[] = [];
  if (Array.isArray(raw.hiddenLegacyIds)) {
    for (const id of raw.hiddenLegacyIds) {
      if (isNonEmptyString(id) && !hiddenLegacyIds.includes(id)) hiddenLegacyIds.push(id);
    }
  }
  return { envelopes, hiddenLegacyIds };
}

/** Project an envelope to the shallow list card shape. */
export function envelopeToRecord(env: CharacterSaveEnvelope): CharacterRecord {
  return {
    id: env.character.id,
    playerName: env.character.playerName,
    classId: env.character.classId,
    level: env.progression.level,
    createdAt: env.character.createdAt,
    lastPlayedAt: env.character.lastPlayedAt,
  };
}
