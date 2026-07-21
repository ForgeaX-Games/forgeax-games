// CharacterDomain — sole long-term mutable authority for a Sorceress save.
// Callers dispatch commands and read deep-frozen snapshots; no writable mirrors.

import {
  PLAYABLE_CLASS_ID,
  SKILL_NODE_IDS,
  type ActiveSkillId,
  type AreaId,
  type HotbarSlots,
  type PlayableClassId,
  type QuestId,
  type QuestSave,
  type SkillNodeId,
} from './content-ids';

export type { HotbarSlots };
import {
  getClassDef,
  growthForLevel,
  type CharacterRecord,
  type ClassId,
} from './classes';
import { deepClone, deepFreeze, shouldFreezeSnapshots, type DeepReadonly } from './deep-readonly';
import {
  emptyEquipment,
  meltGoldValue,
  type Equipment,
  type ItemInstance,
  type ItemSlot,
} from './items';
import {
  assignActiveToHotbar,
  investPoint,
  respecInCamp,
  stateFromProgression,
  type SkillTreeFailReason,
} from './skill-tree';
import { xpForLevel } from './xp';

/** Mutable storage twin of HotbarSlots (readonly tuple cannot assign into fields). */
type MutableHotbarSlots = [
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
];

export const BAG_SIZE = 24;

/** Belt potion stock — domain counters (not bag items), see UI-CUTSCENE-UPGRADE-PLAN §R2. */
export interface PotionStock {
  life: number;
  mana: number;
}
export const POTION_CAP = 20;
/** Instant restore per potion kind (aidiablo small-potion tier; no HoT in this slice). */
export const POTION_RESTORE: Readonly<Record<'life' | 'mana', number>> = { life: 30, mana: 20 };

export interface CharacterIdentity {
  readonly id: string;
  readonly playerName: string;
  readonly classId: PlayableClassId;
  readonly createdAt: number;
  readonly lastPlayedAt: number;
}

export interface CharacterSnapshot {
  readonly identity: Readonly<CharacterIdentity>;
  readonly level: number;
  readonly xp: number;
  readonly gold: number;
  readonly unspentSkillPoints: number;
  readonly skillRanks: Readonly<Record<SkillNodeId, number>>;
  readonly hotbar: HotbarSlots;
  readonly selectedHotbarSlot: 0 | 1 | 2 | 3;
  readonly bag: readonly (Readonly<ItemInstance> | null)[];
  readonly equipment: Readonly<Equipment>;
  readonly quests: Readonly<Record<QuestId, QuestSave>>;
  readonly potions: Readonly<PotionStock>;
}

export type CharacterCommand =
  | { op: 'grant-xp'; amount: number }
  | { op: 'add-gold'; amount: number }
  | { op: 'touch' }
  | { op: 'death-xp-toll' }
  | { op: 'set-quest-status'; questId: QuestId; status: QuestSave['status'] }
  | { op: 'take-item'; item: ItemInstance }
  | { op: 'equip-from-bag'; index: number }
  | { op: 'unequip'; slot: ItemSlot }
  | { op: 'melt-bag'; index: number }
  | { op: 'use-potion'; kind: 'life' | 'mana' }
  | { op: 'add-potion'; kind: 'life' | 'mana'; count?: number }
  | { op: 'select-hotbar'; slot: 0 | 1 | 2 | 3 }
  | { op: 'invest-skill'; nodeId: SkillNodeId }
  | { op: 'respec-skills'; areaId: AreaId }
  | { op: 'assign-hotbar'; nodeId: SkillNodeId; slot: 0 | 1 | 2 | 3 }
  /** DEV fixture only — restore a full progression snapshot. */
  | {
      op: 'dev-set-progression';
      level: number;
      xp: number;
      unspentSkillPoints: number;
      skillRanks: Readonly<Record<SkillNodeId, number>>;
      hotbar: HotbarSlots;
      selectedHotbarSlot: 0 | 1 | 2 | 3;
    };

export interface LevelUpResult {
  level: number;
  hpGain: number;
  manaGain: number;
}

export type CharacterResult =
  | {
      ok: true;
      levelUps?: LevelUpResult[];
      goldGained?: number;
      melted?: boolean;
      /** use-potion: instant restore amount for main.ts to apply to runtime hp/mana. */
      potionUsed?: { kind: 'life' | 'mana'; restore: number };
      /** add-potion: count actually added (0 when already capped → caller may fallback). */
      potionAdded?: number;
    }
  | {
      ok: false;
      reason:
        | 'not-playable'
        | 'bag-full'
        | 'empty-slot'
        | 'level-req'
        | 'bad-index'
        | 'empty-equip'
        | 'empty-potion'
        | SkillTreeFailReason;
    };

export interface CharacterDomain {
  dispatch(command: CharacterCommand): CharacterResult;
  snapshot(): DeepReadonly<CharacterSnapshot>;
}

export function isPlayableClass(classId: ClassId): classId is PlayableClassId {
  return classId === PLAYABLE_CLASS_ID;
}

function emptySkillRanks(): Record<SkillNodeId, number> {
  const ranks = {} as Record<SkillNodeId, number>;
  for (const id of SKILL_NODE_IDS) ranks[id] = 0;
  ranks['frost-fang'] = 1;
  return ranks;
}

function emptyQuests(): Record<QuestId, QuestSave> {
  return { 'purge-slagdeep-hollow': { status: 'available' } };
}

function newId(): string {
  return crypto.randomUUID();
}

export interface CreateSorceressOptions {
  playerName: string;
  /** When omitted, a fresh UUID is minted. */
  id?: string;
  createdAt?: number;
  lastPlayedAt?: number;
  /** Legacy shallow-save level (defaults to 1). */
  level?: number;
  xp?: number;
  gold?: number;
  /**
   * Explicit ephemeral domains for play-config den-direct. Same constructor /
   * invariants as persisted characters; caller skips localStorage projection.
   */
  ephemeral?: boolean;
}

/** Full progression restore from a validated CharacterSaveEnvelope (Task 2.1). */
export interface HydrateSorceressOptions {
  identity: CharacterIdentity;
  level: number;
  xp: number;
  gold: number;
  unspentSkillPoints: number;
  skillRanks: Readonly<Record<SkillNodeId, number>>;
  hotbar: HotbarSlots;
  selectedHotbarSlot: 0 | 1 | 2 | 3;
  bag: readonly (DeepReadonly<ItemInstance> | null)[];
  equipment: DeepReadonly<Equipment>;
  quests: Readonly<Record<QuestId, QuestSave>>;
  /** Old saves predate potions — absent means 0/0 (no retroactive stock). */
  potions?: PotionStock;
}

class CharacterDomainImpl implements CharacterDomain {
  #identity: CharacterIdentity;
  #level: number;
  #xp: number;
  #gold: number;
  #unspentSkillPoints: number;
  #skillRanks: Record<SkillNodeId, number>;
  #hotbar: [ActiveSkillId | null, ActiveSkillId | null, ActiveSkillId | null, ActiveSkillId | null];
  #selectedHotbarSlot: 0 | 1 | 2 | 3;
  #bag: Array<ItemInstance | null>;
  #equipment: Equipment;
  #quests: Record<QuestId, QuestSave>;
  #potions: PotionStock;

  constructor(opts: CreateSorceressOptions) {
    const now = Date.now();
    const name = opts.playerName.trim() || (opts.ephemeral ? 'Dev' : 'Sorceress');
    this.#identity = {
      id: opts.id ?? newId(),
      playerName: name,
      classId: PLAYABLE_CLASS_ID,
      createdAt: opts.createdAt ?? now,
      lastPlayedAt: opts.lastPlayedAt ?? now,
    };
    this.#level = Math.max(1, opts.level ?? 1);
    this.#xp = Math.max(0, opts.xp ?? 0);
    this.#gold = Math.max(0, opts.gold ?? 0);
    // One skill point per level after level 1 (grant-xp also increments on ding).
    this.#unspentSkillPoints = this.#level - 1;
    this.#skillRanks = emptySkillRanks();
    this.#hotbar = ['frost', null, null, null];
    this.#selectedHotbarSlot = 0;
    this.#bag = new Array(BAG_SIZE).fill(null);
    this.#equipment = emptyEquipment();
    this.#quests = emptyQuests();
    // Starting belt stock (D2 convention: a couple of reds, one blue).
    this.#potions = { life: 2, mana: 1 };
  }

  /** Full restore from a validated save envelope — never retains the envelope. */
  static fromHydrate(opts: HydrateSorceressOptions): CharacterDomainImpl {
    if (opts.identity.classId !== PLAYABLE_CLASS_ID) {
      throw new Error(`Class "${opts.identity.classId}" is not playable — only Sorceress domains may be hydrated`);
    }
    const domain = new CharacterDomainImpl({
      playerName: opts.identity.playerName,
      id: opts.identity.id,
      createdAt: opts.identity.createdAt,
      lastPlayedAt: opts.identity.lastPlayedAt,
      level: opts.level,
      xp: opts.xp,
      gold: opts.gold,
    });
    domain.#unspentSkillPoints = Math.max(0, opts.unspentSkillPoints);
    domain.#skillRanks = { ...emptySkillRanks(), ...deepClone(opts.skillRanks as Record<SkillNodeId, number>) };
    domain.#hotbar = [...opts.hotbar] as [ActiveSkillId | null, ActiveSkillId | null, ActiveSkillId | null, ActiveSkillId | null];
    domain.#selectedHotbarSlot = opts.selectedHotbarSlot;
    const bag = deepClone(opts.bag as Array<ItemInstance | null>);
    while (bag.length < BAG_SIZE) bag.push(null);
    domain.#bag = bag.slice(0, BAG_SIZE);
    domain.#equipment = deepClone(opts.equipment as Equipment);
    domain.#quests = deepClone(opts.quests as Record<QuestId, QuestSave>);
    domain.#potions = {
      life: Math.max(0, Math.floor(opts.potions?.life ?? 0)),
      mana: Math.max(0, Math.floor(opts.potions?.mana ?? 0)),
    };
    return domain;
  }

  dispatch(command: CharacterCommand): CharacterResult {
    switch (command.op) {
      case 'grant-xp':
        return this.#grantXp(command.amount);
      case 'add-gold':
        this.#gold += command.amount;
        return { ok: true, goldGained: command.amount };
      case 'touch':
        this.#identity = { ...this.#identity, lastPlayedAt: Date.now() };
        return { ok: true };
      case 'death-xp-toll':
        // Spec §12 / Task 4.3: no XP penalty on death — kept as a no-op seam.
        return { ok: true };
      case 'set-quest-status':
        this.#quests = {
          ...this.#quests,
          [command.questId]: { status: command.status },
        };
        return { ok: true };
      case 'take-item':
        return this.#takeItem(command.item);
      case 'equip-from-bag':
        return this.#equipFromBag(command.index);
      case 'unequip':
        return this.#unequip(command.slot);
      case 'melt-bag':
        return this.#meltBag(command.index);
      case 'use-potion': {
        if (this.#potions[command.kind] <= 0) return { ok: false, reason: 'empty-potion' };
        this.#potions = { ...this.#potions, [command.kind]: this.#potions[command.kind] - 1 };
        return { ok: true, potionUsed: { kind: command.kind, restore: POTION_RESTORE[command.kind] } };
      }
      case 'add-potion': {
        const want = Math.max(1, command.count ?? 1);
        const room = POTION_CAP - this.#potions[command.kind];
        const added = Math.max(0, Math.min(room, want));
        if (added > 0) this.#potions = { ...this.#potions, [command.kind]: this.#potions[command.kind] + added };
        return { ok: true, potionAdded: added };
      }
      case 'select-hotbar':
        this.#selectedHotbarSlot = command.slot;
        return { ok: true };
      case 'invest-skill':
        return this.#applyTree(
          investPoint(this.#treeState(), command.nodeId),
        );
      case 'respec-skills':
        return this.#applyTree(
          respecInCamp(this.#treeState(), command.areaId),
        );
      case 'assign-hotbar':
        return this.#applyTree(
          assignActiveToHotbar(this.#treeState(), command.nodeId, command.slot),
        );
      case 'dev-set-progression': {
        const next = stateFromProgression({
          level: command.level,
          unspentSkillPoints: command.unspentSkillPoints,
          skillRanks: command.skillRanks,
          hotbar: command.hotbar,
          selectedHotbarSlot: command.selectedHotbarSlot,
        });
        this.#level = next.level;
        this.#xp = Math.max(0, command.xp);
        this.#unspentSkillPoints = next.unspentSkillPoints;
        this.#skillRanks = { ...next.skillRanks };
        this.#hotbar = [...next.hotbar] as MutableHotbarSlots;
        this.#selectedHotbarSlot = next.selectedHotbarSlot;
        return { ok: true };
      }
      default: {
        const _exhaustive: never = command;
        return _exhaustive;
      }
    }
  }

  #treeState() {
    return stateFromProgression({
      level: this.#level,
      unspentSkillPoints: this.#unspentSkillPoints,
      skillRanks: this.#skillRanks,
      hotbar: this.#hotbar as HotbarSlots,
      selectedHotbarSlot: this.#selectedHotbarSlot,
    });
  }

  #applyTree(
    result: { ok: true; state: ReturnType<typeof stateFromProgression> } | { ok: false; reason: SkillTreeFailReason },
  ): CharacterResult {
    if (!result.ok) return { ok: false, reason: result.reason };
    this.#unspentSkillPoints = result.state.unspentSkillPoints;
    this.#skillRanks = { ...result.state.skillRanks };
    this.#hotbar = [...result.state.hotbar] as MutableHotbarSlots;
    this.#selectedHotbarSlot = result.state.selectedHotbarSlot;
    return { ok: true };
  }

  snapshot(): DeepReadonly<CharacterSnapshot> {
    const raw: CharacterSnapshot = {
      identity: { ...this.#identity },
      level: this.#level,
      xp: this.#xp,
      gold: this.#gold,
      unspentSkillPoints: this.#unspentSkillPoints,
      skillRanks: { ...this.#skillRanks },
      hotbar: [...this.#hotbar] as HotbarSlots,
      selectedHotbarSlot: this.#selectedHotbarSlot,
      bag: this.#bag.map((item) => (item ? deepClone(item) : null)),
      equipment: deepClone(this.#equipment),
      quests: deepClone(this.#quests),
      potions: { ...this.#potions },
    };
    const detached = deepClone(raw);
    return (shouldFreezeSnapshots() ? deepFreeze(detached) : detached) as DeepReadonly<CharacterSnapshot>;
  }

  #grantXp(amount: number): CharacterResult {
    if (amount <= 0) return { ok: true, levelUps: [] };
    const growthMods = getClassDef(PLAYABLE_CLASS_ID).growthMods;
    const levelUps: LevelUpResult[] = [];
    this.#xp += amount;
    let xpMax = xpForLevel(this.#level);
    while (this.#xp >= xpMax) {
      this.#xp -= xpMax;
      this.#level += 1;
      this.#unspentSkillPoints += 1;
      xpMax = xpForLevel(this.#level);
      const { hp, mp } = growthForLevel(this.#level, growthMods);
      levelUps.push({ level: this.#level, hpGain: hp, manaGain: mp });
    }
    return { ok: true, levelUps };
  }

  #takeItem(item: ItemInstance): CharacterResult {
    if (!this.#equipment[item.slot] && this.#level >= item.reqLevel) {
      this.#equipment = { ...this.#equipment, [item.slot]: deepClone(item) };
      return { ok: true };
    }
    const i = this.#bag.indexOf(null);
    if (i < 0) return { ok: false, reason: 'bag-full' };
    this.#bag[i] = deepClone(item);
    return { ok: true };
  }

  #equipFromBag(index: number): CharacterResult {
    const item = this.#bag[index];
    if (!item) return { ok: false, reason: 'empty-slot' };
    if (this.#level < item.reqLevel) return { ok: false, reason: 'level-req' };
    const prev = this.#equipment[item.slot];
    this.#equipment = { ...this.#equipment, [item.slot]: deepClone(item) };
    this.#bag[index] = prev ? deepClone(prev) : null;
    return { ok: true };
  }

  #unequip(slot: ItemSlot): CharacterResult {
    const item = this.#equipment[slot];
    if (!item) return { ok: false, reason: 'empty-equip' };
    const i = this.#bag.indexOf(null);
    if (i < 0) return { ok: false, reason: 'bag-full' };
    this.#bag[i] = deepClone(item);
    this.#equipment = { ...this.#equipment, [slot]: null };
    return { ok: true };
  }

  #meltBag(index: number): CharacterResult {
    const item = this.#bag[index];
    if (!item) return { ok: false, reason: 'empty-slot' };
    const gold = meltGoldValue(item);
    this.#bag[index] = null;
    this.#gold += gold;
    return { ok: true, goldGained: gold, melted: true };
  }
}

/** Sole constructor for playable (and ephemeral den-direct) Sorceress domains. */
export function createSorceressDomain(opts: CreateSorceressOptions): CharacterDomain {
  return new CharacterDomainImpl(opts);
}

/**
 * Hydrate a domain from validated save fields. Rejects non-Sorceress at the
 * domain seam. Callers must discard the source envelope after this returns.
 */
export function hydrateSorceressDomain(opts: HydrateSorceressOptions): CharacterDomain {
  return CharacterDomainImpl.fromHydrate(opts);
}

/**
 * Hydrate a domain from the shallow CharacterRecord projection (legacy / list).
 * Rejects non-Sorceress at the domain seam.
 */
export function createDomainFromRecord(rec: CharacterRecord): CharacterDomain {
  if (!isPlayableClass(rec.classId)) {
    throw new Error(`Class "${rec.classId}" is not playable — only Sorceress domains may be created`);
  }
  return createSorceressDomain({
    playerName: rec.playerName,
    id: rec.id,
    createdAt: rec.createdAt,
    lastPlayedAt: rec.lastPlayedAt,
    level: rec.level,
  });
}

/** Project domain snapshot → shallow list-card CharacterRecord (not gameplay state). */
export function projectCharacterRecord(
  snap: DeepReadonly<CharacterSnapshot>,
): CharacterRecord {
  return {
    id: snap.identity.id,
    playerName: snap.identity.playerName,
    classId: snap.identity.classId,
    level: snap.level,
    createdAt: snap.identity.createdAt,
    lastPlayedAt: snap.identity.lastPlayedAt,
  };
}
