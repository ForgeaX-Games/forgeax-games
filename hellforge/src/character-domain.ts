// CharacterDomain — sole long-term mutable authority for a Sorceress save.
// Callers dispatch commands and read deep-frozen snapshots; no writable mirrors.

import {
  PLAYABLE_CLASS_ID,
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
  buildFuseResult,
  buildRerollResult,
  canFuse,
  canReroll,
  canSalvage,
  rerollCost,
  salvageYield,
  type MaterialCounts,
  type MaterialTier,
} from './crafting';
import {
  emptyEquipment,
  equipSlotsFor,
  itemFootprint,
  meltGoldValue,
  type Equipment,
  type EquipSlot,
  type ItemInstance,
} from './items';
import {
  BAG_CELLS,
  firstFit,
  occupancy,
  type BagAnchor,
} from './bag-grid';
import { FINISHER_UNLOCK_LEVEL, grantFinisherHotbar } from './finisher';
import {
  assignActiveToHotbar,
  emptySkillRanks,
  investPoint,
  respecInCamp,
  stateFromProgression,
  type SkillTreeFailReason,
} from './skill-tree';
import { xpForLevel } from './xp';

/** Shard currency on the snapshot (not bag items). */
export type Materials = MaterialCounts;

function emptyMaterials(): Record<MaterialTier, number> {
  return { common: 0, magic: 0, rare: 0 };
}

/** Mutable storage twin of HotbarSlots (readonly tuple cannot assign into fields). */
type MutableHotbarSlots = [
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
];

/**
 * Bag capacity in cells (12×5, SSOT in bag-grid.ts). Kept as BAG_SIZE for
 * existing callers; the bag itself is a variable-length anchor list.
 */
export const BAG_SIZE = BAG_CELLS;

export type { BagAnchor };

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
  /** Anchor list (one entry per item, top-left cell) — see bag-grid.ts. */
  readonly bag: readonly DeepReadonly<BagAnchor>[];
  readonly equipment: Readonly<Equipment>;
  readonly quests: Readonly<Record<QuestId, QuestSave>>;
  readonly potions: Readonly<PotionStock>;
  /** Forge shard currency (白/蓝/黄) — not bag cells. */
  readonly materials: Materials;
}

export type CharacterCommand =
  | { op: 'grant-xp'; amount: number }
  | { op: 'add-gold'; amount: number }
  | { op: 'touch' }
  | { op: 'death-xp-toll' }
  | { op: 'set-quest-status'; questId: QuestId; status: QuestSave['status'] }
  | { op: 'take-item'; item: ItemInstance }
  | { op: 'equip-from-bag'; index: number; target?: EquipSlot }
  | { op: 'unequip'; slot: EquipSlot }
  | { op: 'melt-bag'; index: number }
  | { op: 'salvage-bag'; index: number }
  | { op: 'reroll-bag'; index: number }
  | { op: 'fuse-bag'; indices: readonly [number, number, number] }
  /** current/max let the domain reject full-resource uses without consuming stock. */
  | { op: 'use-potion'; kind: 'life' | 'mana'; current: number; max: number }
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
        | 'not-needed'
        | 'legendary-locked'
        | 'not-enough-materials'
        | 'bad-recipe'
        | SkillTreeFailReason;
    };

export interface CharacterDomain {
  dispatch(command: CharacterCommand): CharacterResult;
  snapshot(): DeepReadonly<CharacterSnapshot>;
}

export function isPlayableClass(classId: ClassId): classId is PlayableClassId {
  return classId === PLAYABLE_CLASS_ID;
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
  /** Validated v2 anchor list (save-schema guarantees in-bounds, no overlap). */
  bag: readonly DeepReadonly<BagAnchor>[];
  equipment: DeepReadonly<Equipment>;
  quests: Readonly<Record<QuestId, QuestSave>>;
  /** Old saves predate potions — absent means 0/0 (no retroactive stock). */
  potions?: PotionStock;
  /** T4 wires save field; absent → zeros (in-memory default). */
  materials?: Materials;
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
  #bag: BagAnchor[];
  #equipment: Equipment;
  #quests: Record<QuestId, QuestSave>;
  #potions: PotionStock;
  #materials: Record<MaterialTier, number>;

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
    // PR2a L8: creation hotbar = Frost Fang + Magma Bolt (slots 0–1).
    this.#hotbar = ['frost', 'magma', null, null];
    this.#selectedHotbarSlot = 0;
    this.#bag = [];
    this.#equipment = emptyEquipment();
    this.#quests = emptyQuests();
    // Starting belt stock (D2 convention: a couple of reds, one blue).
    this.#potions = { life: 2, mana: 1 };
    this.#materials = emptyMaterials();
    // Catch up level grants when constructed above level 1 (legacy migrate / fixtures).
    for (let lv = 2; lv <= this.#level; lv++) this.#applyOnboardingLevelGrant(lv);
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
    domain.#bag = deepClone(opts.bag as BagAnchor[]);
    domain.#equipment = deepClone(opts.equipment as Equipment);
    domain.#quests = deepClone(opts.quests as Record<QuestId, QuestSave>);
    domain.#potions = {
      life: Math.min(POTION_CAP, Math.max(0, Math.floor(opts.potions?.life ?? 0))),
      mana: Math.min(POTION_CAP, Math.max(0, Math.floor(opts.potions?.mana ?? 0))),
    };
    domain.#materials = {
      common: Math.max(0, Math.floor(opts.materials?.common ?? 0)),
      magic: Math.max(0, Math.floor(opts.materials?.magic ?? 0)),
      rare: Math.max(0, Math.floor(opts.materials?.rare ?? 0)),
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
        return this.#equipFromBag(command.index, command.target);
      case 'unequip':
        return this.#unequip(command.slot);
      case 'melt-bag':
        return this.#meltBag(command.index);
      case 'salvage-bag':
        return this.#salvageBag(command.index);
      case 'reroll-bag':
        return this.#rerollBag(command.index);
      case 'fuse-bag':
        return this.#fuseBag(command.indices);
      case 'use-potion': {
        if (this.#potions[command.kind] <= 0) return { ok: false, reason: 'empty-potion' };
        const max = Number.isFinite(command.max) ? command.max : 0;
        const current = Number.isFinite(command.current) ? command.current : 0;
        if (max > 0 && current >= max) return { ok: false, reason: 'not-needed' };
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
      bag: this.#bag.map((a) => ({ item: deepClone(a.item), x: a.x, y: a.y })),
      equipment: deepClone(this.#equipment),
      quests: deepClone(this.#quests),
      potions: { ...this.#potions },
      materials: { ...this.#materials },
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
      this.#applyOnboardingLevelGrant(this.#level);
      xpMax = xpForLevel(this.#level);
      const { hp, mp } = growthForLevel(this.#level, growthMods);
      levelUps.push({ level: this.#level, hpGain: hp, manaGain: mp });
    }
    return { ok: true, levelUps };
  }

  /**
   * PR2a L8 onboarding grants (free; do not spend the level-up skill point).
   * Phase Step stays tree-gated — never auto-granted here.
   */
  #applyOnboardingLevelGrant(level: number): void {
    if (level === 2) {
      // Arc Surge: unlock via ranks so castable; place on hotbar if a slot is free.
      if ((this.#skillRanks['arc-surge'] ?? 0) < 1) this.#skillRanks['arc-surge'] = 1;
      this.#placeOnHotbarIfFree('arc');
      return;
    }
    if (level === FINISHER_UNLOCK_LEVEL) {
      // Inferno Nova: level-granted (not tree); T4 helper places slot 4 (index 3).
      this.#hotbar = [...grantFinisherHotbar(this.#hotbar as HotbarSlots)] as MutableHotbarSlots;
    }
  }

  /** Place `skill` on the first empty hotbar slot; no-op if already present or full. */
  #placeOnHotbarIfFree(skill: ActiveSkillId): void {
    if (this.#hotbar.some((s) => s === skill)) return;
    const empty = this.#hotbar.findIndex((s) => s === null);
    if (empty >= 0) this.#hotbar[empty] = skill;
  }

  #takeItem(item: ItemInstance): CharacterResult {
    // Walk equipSlotsFor first-empty (ring1 → ring2); full slots → bag.
    const target = equipSlotsFor(item.slot).find((s) => !this.#equipment[s]);
    if (target !== undefined && this.#level >= item.reqLevel) {
      this.#equipment = { ...this.#equipment, [target]: deepClone(item) };
      return { ok: true };
    }
    const { w, h } = itemFootprint(item);
    const fit = firstFit(occupancy(this.#bag), w, h);
    if (!fit) return { ok: false, reason: 'bag-full' };
    this.#bag.push({ item: deepClone(item), x: fit.x, y: fit.y });
    return { ok: true };
  }

  #equipFromBag(index: number, target?: EquipSlot): CharacterResult {
    const entry = this.#bag[index];
    if (index < 0 || !entry) return { ok: false, reason: 'bad-index' };
    const item = entry.item;
    if (this.#level < item.reqLevel) return { ok: false, reason: 'level-req' };
    const slots = equipSlotsFor(item.slot);
    let dest: EquipSlot;
    if (target !== undefined) {
      if (!slots.includes(target)) return { ok: false, reason: 'bad-index' };
      dest = target;
    } else {
      // First empty, else swap the primary slot (ring1 when both rings filled).
      dest = slots.find((s) => !this.#equipment[s]) ?? slots[0]!;
    }
    const prev = this.#equipment[dest];
    // Swap path: validate BEFORE mutating so a no-fit swaps nothing (atomic).
    let prevFit: { x: number; y: number } | null = null;
    let rest: BagAnchor[] = [];
    if (prev) {
      rest = this.#bag.filter((_, i) => i !== index);
      const { w, h } = itemFootprint(prev);
      prevFit = firstFit(occupancy(rest), w, h);
      if (!prevFit) return { ok: false, reason: 'bag-full' };
      rest.splice(Math.min(index, rest.length), 0, { item: deepClone(prev), x: prevFit.x, y: prevFit.y });
    } else {
      rest = this.#bag.filter((_, i) => i !== index);
    }
    this.#equipment = { ...this.#equipment, [dest]: deepClone(item) };
    this.#bag = rest;
    return { ok: true };
  }

  #unequip(slot: EquipSlot): CharacterResult {
    const item = this.#equipment[slot];
    if (!item) return { ok: false, reason: 'empty-equip' };
    const { w, h } = itemFootprint(item);
    const fit = firstFit(occupancy(this.#bag), w, h);
    if (!fit) return { ok: false, reason: 'bag-full' };
    this.#bag.push({ item: deepClone(item), x: fit.x, y: fit.y });
    this.#equipment = { ...this.#equipment, [slot]: null };
    return { ok: true };
  }

  #meltBag(index: number): CharacterResult {
    const got = this.#bagItemAt(index);
    if ('ok' in got) return got;
    if (got.item.rarity === 'legendary') return { ok: false, reason: 'legendary-locked' };
    const gold = meltGoldValue(got.item);
    this.#bag.splice(index, 1);
    this.#gold += gold;
    return { ok: true, goldGained: gold, melted: true };
  }

  /** Bag indices are LIST indices into the anchor array (no empty cells). */
  #bagItemAt(index: number): CharacterResult | BagAnchor {
    if (!Number.isInteger(index)) return { ok: false, reason: 'bad-index' };
    const entry = this.#bag[index];
    if (index < 0 || !entry) return { ok: false, reason: 'bad-index' };
    return entry;
  }

  #addMaterials(delta: MaterialCounts): void {
    this.#materials = {
      common: this.#materials.common + delta.common,
      magic: this.#materials.magic + delta.magic,
      rare: this.#materials.rare + delta.rare,
    };
  }

  #hasMaterials(cost: MaterialCounts): boolean {
    return this.#materials.common >= cost.common
      && this.#materials.magic >= cost.magic
      && this.#materials.rare >= cost.rare;
  }

  #spendMaterials(cost: MaterialCounts): void {
    this.#materials = {
      common: this.#materials.common - cost.common,
      magic: this.#materials.magic - cost.magic,
      rare: this.#materials.rare - cost.rare,
    };
  }

  #salvageBag(index: number): CharacterResult {
    const got = this.#bagItemAt(index);
    if ('ok' in got) return got;
    if (got.item.rarity === 'legendary') return { ok: false, reason: 'legendary-locked' };
    if (!canSalvage(got.item)) return { ok: false, reason: 'bad-recipe' };
    const yield_ = salvageYield(got.item);
    if (!yield_) return { ok: false, reason: 'bad-recipe' };
    this.#bag.splice(index, 1);
    this.#addMaterials(yield_);
    return { ok: true };
  }

  #rerollBag(index: number): CharacterResult {
    const got = this.#bagItemAt(index);
    if ('ok' in got) return got;
    if (got.item.rarity === 'legendary') return { ok: false, reason: 'legendary-locked' };
    if (!canReroll(got.item)) return { ok: false, reason: 'bad-recipe' };
    const cost = rerollCost(got.item);
    if (!cost) return { ok: false, reason: 'bad-recipe' };
    if (!this.#hasMaterials(cost)) return { ok: false, reason: 'not-enough-materials' };
    const next = buildRerollResult(got.item);
    if (!next) return { ok: false, reason: 'bad-recipe' };
    this.#spendMaterials(cost);
    // Same slot/rarity/ilvl → same footprint; the item keeps its anchor cell.
    this.#bag[index] = { item: deepClone(next), x: got.x, y: got.y };
    return { ok: true };
  }

  #fuseBag(indices: readonly [number, number, number]): CharacterResult {
    const [i0, i1, i2] = indices;
    if (new Set(indices).size !== 3) return { ok: false, reason: 'bad-index' };
    const entries: BagAnchor[] = [];
    for (const idx of indices) {
      const got = this.#bagItemAt(idx);
      if ('ok' in got) return got;
      entries.push(got);
    }
    const items = entries.map((e) => e.item);
    if (items.some((it) => it.rarity === 'legendary')) {
      return { ok: false, reason: 'legendary-locked' };
    }
    if (!canFuse(items)) return { ok: false, reason: 'bad-recipe' };
    const result = buildFuseResult(items);
    if (!result) return { ok: false, reason: 'bad-recipe' };
    // Validate placement before mutating (atomic): clear the 3 inputs, then
    // firstFit the result on the freed grid — a no-fit fuses nothing.
    const idxSet = new Set(indices);
    const rest = this.#bag.filter((_, i) => !idxSet.has(i));
    const { w, h } = itemFootprint(result);
    const fit = firstFit(occupancy(rest), w, h);
    if (!fit) return { ok: false, reason: 'bag-full' };
    // Result takes the lowest input list index (cube-ui keeps that cell selected).
    const dest = Math.min(i0, i1, i2);
    rest.splice(Math.min(dest, rest.length), 0, { item: deepClone(result), x: fit.x, y: fit.y });
    this.#bag = rest;
    return { ok: true };
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
