import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createSorceressDomain,
  projectCharacterRecord,
  type CharacterSnapshot,
} from './character-domain';
import type { CharacterRecord } from './classes';
import type { ItemInstance } from './items';
import {
  CHECKPOINT_CINDERWATCH,
  envelopeToRecord,
  LEGACY_STORAGE_KEY,
  parseEnvelope,
  parseLegacyList,
  parseLegacyRecord,
  parseSavesStore,
  SAVE_SCHEMA_VERSION,
  SAVES_STORAGE_KEY,
  type CharacterSaveEnvelope,
} from './save-schema';
import {
  __clearAllSavesForTests,
  __getPendingSnapshotForTests,
  __seedLegacyCharactersForTests,
  __setSaveStorageForTests,
  createCharacter,
  ensureCharacterEnvelope,
  flushCharacterSaves,
  flushReturnToTitle,
  hydrateCharacter,
  installSaveLifecycleHooks,
  listCharacters,
  listLegacyCharacters,
  loadEnvelope,
  migrateLegacySorceress,
  persistDomainProjection,
  saveSnapshot,
  serializeCharacter,
  type SaveStorage,
} from './save';

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

function sampleItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: 'inst-frost-wand',
    slot: 'weapon',
    rarity: 'magic',
    name: '霜牙短杖',
    ilvl: 2,
    reqLevel: 1,
    affixes: [{ stat: 'frostDmg', v: 0.12, label: '+12% 霜牙伤害' }],
    score: 14,
    ...overrides,
  };
}

function validEnvelope(overrides: Partial<CharacterSaveEnvelope> = {}): CharacterSaveEnvelope {
  const domain = createSorceressDomain({
    playerName: '灰烬娅',
    id: 'char-1',
    createdAt: 1000,
    lastPlayedAt: 2000,
    level: 3,
    xp: 10,
    gold: 50,
  });
  domain.dispatch({ op: 'take-item', item: sampleItem() });
  domain.dispatch({
    op: 'set-quest-status',
    questId: 'purge-slagdeep-hollow',
    status: 'active',
  });
  const base = serializeCharacter(domain.snapshot());
  return { ...base, ...overrides };
}

let mem: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  mem = memoryStorage();
  __setSaveStorageForTests(mem);
  __clearAllSavesForTests();
});

afterEach(() => {
  flushCharacterSaves();
  __setSaveStorageForTests(null);
});

describe('parseEnvelope / parseLegacy', () => {
  test('missing and malformed data return null / empty', () => {
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope(undefined)).toBeNull();
    expect(parseEnvelope({})).toBeNull();
    expect(parseEnvelope({ schemaVersion: 2 })).toBeNull();
    expect(parseEnvelope({ schemaVersion: 3 })).toBeNull(); // future versions rejected
    expect(parseLegacyRecord(null)).toBeNull();
    expect(parseLegacyList('nope')).toEqual([]);
    expect(parseSavesStore(null).envelopes).toEqual({});
  });

  test('rejects barbarian envelope classId', () => {
    const env = validEnvelope();
    const bad = {
      ...env,
      character: { ...env.character, classId: 'barbarian' },
    };
    expect(parseEnvelope(bad)).toBeNull();
  });

  test('accepts valid v2 envelope and preserves item instanceId + anchors', () => {
    const env = validEnvelope();
    const parsed = parseEnvelope(env);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(parsed!.checkpointId).toBe(CHECKPOINT_CINDERWATCH);
    expect(parsed!.progression.level).toBe(3);
    expect(parsed!.inventory.equipment.weapon?.instanceId).toBe('inst-frost-wand');
    expect(parsed!.quests['purge-slagdeep-hollow'].status).toBe('active');
    // v2 bag is an anchor list; this fixture's single item auto-equipped → empty bag.
    expect(parsed!.inventory.bag).toEqual([]);
  });

  test('parsePotions clamps belt stock to POTION_CAP (20), not 999', () => {
    const env = validEnvelope();
    const raw = {
      ...env,
      progression: {
        ...env.progression,
        potions: { life: 999, mana: 40 },
      },
    };
    const parsed = parseEnvelope(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.progression.potions).toEqual({ life: 20, mana: 20 });
  });

  test('legacy list keeps barbarian / necromancer rows', () => {
    const list = parseLegacyList([
      {
        id: 'b1', playerName: '狂战', classId: 'barbarian',
        level: 5, createdAt: 1, lastPlayedAt: 2,
      },
      {
        id: 'n1', playerName: '死灵', classId: 'necromancer',
        level: 2, createdAt: 1, lastPlayedAt: 2,
      },
      { id: 'bad', playerName: 'x', classId: 'not-a-class', level: 1, createdAt: 1, lastPlayedAt: 1 },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]!.classId).toBe('barbarian');
    expect(list[1]!.classId).toBe('necromancer');
  });
});

describe('serialize / hydrate round trip', () => {
  test('domain → envelope → domain restores progression and items', () => {
    const domain = createSorceressDomain({ playerName: '往返', id: 'rt-1', level: 4, xp: 7, gold: 99 });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'stable-id-99' }) });
    domain.dispatch({ op: 'select-hotbar', slot: 2 });
    domain.dispatch({
      op: 'set-quest-status',
      questId: 'purge-slagdeep-hollow',
      status: 'ready',
    });
    const snap = domain.snapshot();
    const env = serializeCharacter(snap);
    const restored = hydrateCharacter(env).snapshot();
    expect(restored.identity.id).toBe('rt-1');
    expect(restored.level).toBe(4);
    expect(restored.xp).toBe(7);
    expect(restored.gold).toBe(99);
    expect(restored.equipment.weapon?.instanceId).toBe('stable-id-99');
    expect(restored.selectedHotbarSlot).toBe(2);
    expect(restored.skillRanks['frost-fang']).toBe(1);
    expect(restored.quests['purge-slagdeep-hollow'].status).toBe('ready');
    expect(env.checkpointId).toBe('cinderwatch');
  });

  test('PR10 T4: round-trip new slots + materials; schema version stays 1', () => {
    const domain = createSorceressDomain({ playerName: '铸炉', id: 'pr10-rt', level: 5, gold: 10 });
    const gear: Array<Partial<ItemInstance> & { slot: ItemInstance['slot']; instanceId: string }> = [
      { instanceId: 'g-gloves', slot: 'gloves', name: '手套' },
      { instanceId: 'g-belt', slot: 'belt', name: '腰带' },
      { instanceId: 'g-ring1', slot: 'ring', name: '戒指甲' },
      { instanceId: 'g-ring2', slot: 'ring', name: '戒指乙' },
      { instanceId: 'g-offhand', slot: 'offhand', name: '法器' },
    ];
    for (const g of gear) {
      expect(domain.dispatch({
        op: 'take-item',
        item: sampleItem({
          ...g,
          rarity: 'magic',
          affixes: [{ stat: 'maxHp', v: 5, label: '+5 HP' }],
        }),
      }).ok).toBe(true);
    }
    // Occupy amulet so the salvage fodder lands in the bag.
    domain.dispatch({
      op: 'take-item',
      item: sampleItem({
        instanceId: 'amu-fill',
        slot: 'amulet',
        rarity: 'common',
        name: '占位',
        affixes: [{ stat: 'maxHp', v: 1, label: '+1' }],
      }),
    });
    domain.dispatch({
      op: 'take-item',
      item: sampleItem({
        instanceId: 'salv-me',
        slot: 'amulet',
        rarity: 'rare',
        name: '拆解物',
        affixes: [{ stat: 'maxHp', v: 1, label: '+1' }],
      }),
    });
    const salvIdx = domain.snapshot().bag.findIndex((a) => a.item.instanceId === 'salv-me');
    expect(salvIdx).toBeGreaterThanOrEqual(0);
    expect(domain.dispatch({ op: 'salvage-bag', index: salvIdx }).ok).toBe(true);
    expect(domain.snapshot().materials.rare).toBe(4);

    const env = serializeCharacter(domain.snapshot());
    expect(env.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(SAVE_SCHEMA_VERSION).toBe(2);
    expect(env.progression.materials).toEqual({ common: 0, magic: 0, rare: 4 });
    expect(env.inventory.equipment.gloves?.instanceId).toBe('g-gloves');
    expect(env.inventory.equipment.belt?.instanceId).toBe('g-belt');
    expect(env.inventory.equipment.ring1?.instanceId).toBe('g-ring1');
    expect(env.inventory.equipment.ring2?.instanceId).toBe('g-ring2');
    expect(env.inventory.equipment.offhand?.instanceId).toBe('g-offhand');

    const restored = hydrateCharacter(env).snapshot();
    expect(restored.materials).toEqual({ common: 0, magic: 0, rare: 4 });
    expect(restored.equipment.gloves?.instanceId).toBe('g-gloves');
    expect(restored.equipment.belt?.instanceId).toBe('g-belt');
    expect(restored.equipment.ring1?.instanceId).toBe('g-ring1');
    expect(restored.equipment.ring2?.instanceId).toBe('g-ring2');
    expect(restored.equipment.offhand?.instanceId).toBe('g-offhand');
  });

  test('PR10 T4 merge gate: legacy 6-slot envelope with ring key, no materials', () => {
    const base = validEnvelope();
    const ringItem = sampleItem({
      instanceId: 'legacy-ring',
      slot: 'ring',
      name: '旧戒指',
      rarity: 'magic',
      affixes: [{ stat: 'maxHp', v: 3, label: '+3 HP' }],
    });
    // Pre-PR10 wire shape: 6 doll slots, key `ring`, no materials / new slots;
    // v1 bag = flat 60-cell array (sparse).
    const v1Bag: Array<unknown> = new Array(60).fill(null);
    const legacyRaw = {
      ...base,
      schemaVersion: 1,
      progression: {
        level: base.progression.level,
        xp: base.progression.xp,
        gold: base.progression.gold,
        unspentSkillPoints: base.progression.unspentSkillPoints,
        skillRanks: base.progression.skillRanks,
        hotbar: base.progression.hotbar,
        selectedHotbarSlot: base.progression.selectedHotbarSlot,
        // intentionally omit materials + potions
      },
      inventory: {
        bag: v1Bag,
        equipment: {
          weapon: base.inventory.equipment.weapon,
          helm: null,
          armor: null,
          boots: null,
          amulet: null,
          ring: ringItem,
        },
      },
    };
    const parsed = parseEnvelope(legacyRaw);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(2); // v1 normalizes to v2 on read
    expect(parsed!.inventory.equipment.ring1?.instanceId).toBe('legacy-ring');
    expect(parsed!.inventory.equipment.ring2).toBeNull();
    expect(parsed!.inventory.equipment.gloves).toBeNull();
    expect(parsed!.inventory.equipment.belt).toBeNull();
    expect(parsed!.inventory.equipment.offhand).toBeNull();
    expect(parsed!.progression.materials).toEqual({ common: 0, magic: 0, rare: 0 });
    expect(parsed!.inventory.bag).toEqual([]);

    const restored = hydrateCharacter(parsed!).snapshot();
    expect(restored.equipment.ring1?.instanceId).toBe('legacy-ring');
    expect(restored.materials).toEqual({ common: 0, magic: 0, rare: 0 });
  });

  test('PR10 T4: garbage materials → zeros; envelope still accepted', () => {
    const env = validEnvelope();
    const raw = {
      ...env,
      progression: {
        ...env.progression,
        materials: { common: 'nope', magic: -3, rare: NaN, extra: 99 },
      },
    };
    const parsed = parseEnvelope(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.progression.materials).toEqual({ common: 0, magic: 0, rare: 0 });
  });

  test('PR10 T4: explicit ring1 wins over legacy ring key', () => {
    const env = validEnvelope();
    const legacy = sampleItem({
      instanceId: 'from-legacy-ring',
      slot: 'ring',
      name: '旧',
      affixes: [{ stat: 'maxHp', v: 1, label: '+1' }],
    });
    const explicit = sampleItem({
      instanceId: 'from-ring1',
      slot: 'ring',
      name: '新',
      affixes: [{ stat: 'maxHp', v: 2, label: '+2' }],
    });
    const raw = {
      ...env,
      inventory: {
        bag: env.inventory.bag,
        equipment: {
          ...env.inventory.equipment,
          ring: legacy,
          ring1: explicit,
        },
      },
    };
    const parsed = parseEnvelope(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.inventory.equipment.ring1?.instanceId).toBe('from-ring1');
  });

  test('hydrate discards envelope — mutating source JSON cannot affect domain', () => {
    const env = validEnvelope() as CharacterSaveEnvelope & {
      progression: { level: number };
    };
    const domain = hydrateCharacter(env);
    env.progression.level = 99;
    expect(domain.snapshot().level).toBe(3);
  });

  test('PR9 T6: pre-expansion envelope hydrates 18 new nodes at rank 0; schema v2', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(2);
    const base = validEnvelope();
    // Pre-PR9 wire shape: only the original 15 SkillNodeId keys.
    const legacyRanks: Record<string, number> = {
      'magma-bolt': 3,
      kindling: 2,
      scorch: 0,
      'volatile-core': 0,
      'hellfire-catalyst': 0,
      'frost-fang': 2,
      permafrost: 0,
      'piercing-ice': 0,
      shatter: 0,
      'winters-grasp': 0,
      'arc-surge': 1,
      conduction: 0,
      'phase-step': 0,
      'phase-echo': 0,
      overcharge: 0,
    };
    const legacyRaw = {
      ...base,
      progression: {
        ...base.progression,
        level: 6,
        unspentSkillPoints: 2,
        skillRanks: legacyRanks,
      },
    };
    const parsed = parseEnvelope(legacyRaw);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(2);
    expect(parsed!.progression.skillRanks['magma-bolt']).toBe(3);
    expect(parsed!.progression.skillRanks['frost-fang']).toBe(2);
    const newIds = [
      'flame-burst', 'ember', 'searing', 'wildfire', 'heat-shimmer', 'furnace-heart',
      'frost-nova', 'rime', 'piercing-cold', 'glacier-shards', 'frozen-focus', 'deep-freeze',
      'discharge', 'resonance', 'swift-phases', 'echo-mastery', 'overcast', 'tempest-conduit',
    ] as const;
    for (const id of newIds) {
      expect(parsed!.progression.skillRanks[id]).toBe(0);
    }
    const restored = hydrateCharacter(parsed!).snapshot();
    for (const id of newIds) {
      expect(restored.skillRanks[id]).toBe(0);
    }
    expect(restored.skillRanks['magma-bolt']).toBe(3);
  });

  test('PR9 T6: round-trip new skill ranks; schema version 2', () => {
    const domain = createSorceressDomain({ playerName: 'PR9往返', id: 'pr9-rt', level: 10 });
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'magma-bolt' }).ok).toBe(true);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'magma-bolt' }).ok).toBe(true);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'flame-burst' }).ok).toBe(true);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'flame-burst' }).ok).toBe(true);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'frost-fang' }).ok).toBe(true);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'frost-fang' }).ok).toBe(true);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'frost-nova' }).ok).toBe(true);
    expect(domain.dispatch({ op: 'assign-hotbar', nodeId: 'flame-burst', slot: 2 }).ok).toBe(true);

    const env = serializeCharacter(domain.snapshot());
    expect(env.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(SAVE_SCHEMA_VERSION).toBe(2);
    expect(env.progression.skillRanks['flame-burst']).toBe(2);
    expect(env.progression.skillRanks['frost-nova']).toBe(1);
    expect(env.progression.hotbar[2]).toBe('flame-burst');

    const restored = hydrateCharacter(env).snapshot();
    expect(restored.skillRanks['flame-burst']).toBe(2);
    expect(restored.skillRanks['frost-nova']).toBe(1);
    expect(restored.skillRanks['magma-bolt']).toBe(3);
    expect(restored.skillRanks['frost-fang']).toBe(3);
    expect(restored.hotbar[2]).toBe('flame-burst');
  });
});

describe('legacy migration', () => {
  const legacySorc = (): CharacterRecord => ({
    id: 'legacy-sorc',
    playerName: '旧法师',
    classId: 'sorceress',
    level: 7,
    createdAt: 111,
    lastPlayedAt: 222,
  });

  test('migrateLegacySorceress preserves identity/level and never rewrites class', () => {
    const env = migrateLegacySorceress(legacySorc());
    expect(env.character.id).toBe('legacy-sorc');
    expect(env.character.classId).toBe('sorceress');
    expect(env.progression.level).toBe(7);
    expect(env.progression.skillRanks['frost-fang']).toBe(1);
    expect(env.progression.hotbar).toEqual(['frost', 'magma', 'arc', 'inferno-nova']);
  });

  test('refuses to migrate barbarian', () => {
    expect(() => migrateLegacySorceress({
      id: 'b', playerName: '蛮', classId: 'barbarian',
      level: 3, createdAt: 1, lastPlayedAt: 1,
    })).toThrow(/non-Sorceress/);
  });

  test('atomic idempotent migration: interrupt before write leaves no envelope', () => {
    __seedLegacyCharactersForTests([legacySorc()]);
    expect(loadEnvelope('legacy-sorc')).toBeNull();
    // Interrupt before write — just build envelope, do not persist.
    const built = migrateLegacySorceress(legacySorc());
    expect(built.character.id).toBe('legacy-sorc');
    expect(loadEnvelope('legacy-sorc')).toBeNull();
    expect(listLegacyCharacters()).toHaveLength(1);
  });

  test('interrupt after write before UI refresh: retry yields one envelope', () => {
    __seedLegacyCharactersForTests([legacySorc()]);
    const first = ensureCharacterEnvelope(legacySorc());
    expect(first.progression.level).toBe(7);
    // Simulate UI not refreshed yet; retry migration path.
    const second = ensureCharacterEnvelope(legacySorc());
    expect(second.character.id).toBe(first.character.id);
    expect(second.progression.level).toBe(7);
    const store = parseSavesStore(JSON.parse(mem.getItem(SAVES_STORAGE_KEY)!));
    expect(Object.keys(store.envelopes)).toEqual(['legacy-sorc']);
    // Legacy untouched.
    expect(listLegacyCharacters()).toHaveLength(1);
    expect(mem.getItem(LEGACY_STORAGE_KEY)).toContain('legacy-sorc');
  });

  test('listCharacters merges envelopes + disabled legacy without rewriting class', () => {
    __seedLegacyCharactersForTests([
      legacySorc(),
      {
        id: 'barb-1', playerName: '蛮族', classId: 'barbarian',
        level: 4, createdAt: 1, lastPlayedAt: 9,
      },
    ]);
    ensureCharacterEnvelope(legacySorc());
    const list = listCharacters();
    const sorc = list.find((c) => c.id === 'legacy-sorc');
    const barb = list.find((c) => c.id === 'barb-1');
    expect(sorc?.classId).toBe('sorceress');
    expect(sorc?.level).toBe(7);
    expect(barb?.classId).toBe('barbarian');
    expect(barb?.level).toBe(4);
  });

  test('createCharacter writes only the new store, not legacy', () => {
    const rec = createCharacter('新法师', 'sorceress');
    expect(loadEnvelope(rec.id)).not.toBeNull();
    expect(listLegacyCharacters()).toHaveLength(0);
    expect(mem.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(() => createCharacter('蛮', 'barbarian')).toThrow(/not playable/);
  });

  test('persistDomainProjection is sealed', () => {
    const rec = createCharacter('封口', 'sorceress');
    expect(() => persistDomainProjection(rec)).toThrow(/sealed/);
  });
});

describe('debounced save coordinator + flush', () => {
  function snapAt(level: number, gold: number): CharacterSnapshot {
    const d = createSorceressDomain({
      playerName: '刷写',
      id: 'flush-1',
      level,
      gold,
      createdAt: 1,
      lastPlayedAt: 1,
    });
    return d.snapshot() as CharacterSnapshot;
  }

  test('pending mutation + flushCharacterSaves writes latest before return', () => {
    saveSnapshot(snapAt(2, 10) as never);
    saveSnapshot(snapAt(5, 99) as never);
    expect(__getPendingSnapshotForTests()?.level).toBe(5);
    flushCharacterSaves();
    expect(__getPendingSnapshotForTests()).toBeNull();
    const env = loadEnvelope('flush-1');
    expect(env?.progression.level).toBe(5);
    expect(env?.progression.gold).toBe(99);
  });

  test('flushReturnToTitle writes synchronously', () => {
    saveSnapshot(snapAt(2, 1) as never);
    flushReturnToTitle(snapAt(8, 40) as never);
    expect(loadEnvelope('flush-1')?.progression.level).toBe(8);
    expect(__getPendingSnapshotForTests()).toBeNull();
  });

  test('lifecycle provider flush on install cleanup writes live snapshot', () => {
    let live = snapAt(3, 7);
    const uninstall = installSaveLifecycleHooks(() => live as never);
    live = snapAt(6, 70);
    uninstall(); // cleanup path must flush
    expect(loadEnvelope('flush-1')?.progression.level).toBe(6);
    expect(loadEnvelope('flush-1')?.progression.gold).toBe(70);
  });

  test('pagehide-style flush uses provider over stale pending', () => {
    let live = snapAt(1, 0);
    installSaveLifecycleHooks(() => live as never);
    saveSnapshot(snapAt(2, 2) as never);
    live = snapAt(9, 900);
    flushCharacterSaves();
    expect(loadEnvelope('flush-1')?.progression.level).toBe(9);
    expect(loadEnvelope('flush-1')?.progression.gold).toBe(900);
  });

  test('real pagehide listener flushes latest live snapshot', () => {
    const { teardown } = installFakeWindowDocument();
    try {
      let live = snapAt(1, 0);
      installSaveLifecycleHooks(() => live as never);
      saveSnapshot(snapAt(2, 2) as never);
      live = snapAt(11, 110);
      (globalThis as { window: FakeTarget }).window.dispatchEvent(new Event('pagehide'));
      expect(loadEnvelope('flush-1')?.progression.level).toBe(11);
      expect(loadEnvelope('flush-1')?.progression.gold).toBe(110);
      expect(__getPendingSnapshotForTests()).toBeNull();
    } finally {
      teardown();
    }
  });

  test('real visibilitychange:hidden listener flushes latest live snapshot', () => {
    const { teardown, setHidden } = installFakeWindowDocument();
    try {
      let live = snapAt(1, 0);
      installSaveLifecycleHooks(() => live as never);
      saveSnapshot(snapAt(3, 3) as never);
      live = snapAt(12, 120);
      setHidden(true);
      (globalThis as { document: FakeTarget }).document.dispatchEvent(
        new Event('visibilitychange'),
      );
      expect(loadEnvelope('flush-1')?.progression.level).toBe(12);
      expect(loadEnvelope('flush-1')?.progression.gold).toBe(120);
      expect(__getPendingSnapshotForTests()).toBeNull();
    } finally {
      teardown();
    }
  });
});

type FakeTarget = {
  addEventListener: (type: string, fn: EventListener) => void;
  removeEventListener: (type: string, fn: EventListener) => void;
  dispatchEvent: (event: Event) => boolean;
};

function installFakeWindowDocument(): {
  teardown: () => void;
  setHidden: (hidden: boolean) => void;
} {
  const listeners = new Map<string, Set<EventListener>>();
  const makeTarget = (): FakeTarget => ({
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
      return true;
    },
  });

  const g = globalThis as {
    window?: FakeTarget;
    document?: FakeTarget & { visibilityState: DocumentVisibilityState };
  };
  const prevWindow = g.window;
  const prevDocument = g.document;
  const win = makeTarget();
  let visibilityState: DocumentVisibilityState = 'visible';
  const docBase = makeTarget();
  const doc = {
    addEventListener: docBase.addEventListener,
    removeEventListener: docBase.removeEventListener,
    dispatchEvent: docBase.dispatchEvent,
    get visibilityState() {
      return visibilityState;
    },
  };
  g.window = win;
  g.document = doc;

  return {
    setHidden(hidden) {
      visibilityState = hidden ? 'hidden' : 'visible';
    },
    teardown() {
      // Drop listeners via storage reset path before restoring globals.
      __setSaveStorageForTests(mem);
      if (prevWindow === undefined) delete g.window;
      else g.window = prevWindow;
      if (prevDocument === undefined) delete g.document;
      else g.document = prevDocument;
    },
  };
}

describe('envelopeToRecord', () => {
  test('projects list card fields', () => {
    const rec = envelopeToRecord(validEnvelope());
    expect(projectCharacterRecord(hydrateCharacter(validEnvelope()).snapshot()).id).toBe(rec.id);
    expect(rec.classId).toBe('sorceress');
  });
});

describe('v1 → v2 bag migration (flat 60-cell → anchor list)', () => {
  /** v1 wire envelope with a caller-supplied flat bag array. */
  function v1EnvelopeWithBag(bag: readonly unknown[]) {
    const base = validEnvelope();
    return {
      ...base,
      schemaVersion: 1,
      inventory: {
        bag,
        equipment: base.inventory.equipment,
      },
    };
  }

  test('sparse v1 bag replays through firstFit in index order', () => {
    const v1Bag: Array<unknown> = new Array(60).fill(null);
    v1Bag[0] = sampleItem({ instanceId: 'v1-armor', slot: 'armor', name: '旧甲' });
    v1Bag[7] = sampleItem({ instanceId: 'v1-weapon', slot: 'weapon', name: '旧杖' });
    v1Bag[42] = sampleItem({ instanceId: 'v1-ring', slot: 'ring', name: '旧戒' });
    const parsed = parseEnvelope(v1EnvelopeWithBag(v1Bag));
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(2);
    const bag = parsed!.inventory.bag;
    expect(bag.map((a) => a.item.instanceId)).toEqual(['v1-armor', 'v1-weapon', 'v1-ring']);
    // armor 2×3 at origin; staff 1×3 beside it; ring in the next free cell.
    expect(bag[0]).toMatchObject({ x: 0, y: 0 });
    expect(bag[1]).toMatchObject({ x: 2, y: 0 });
    expect(bag[2]).toMatchObject({ x: 3, y: 0 });
  });

  test('v1 items without size derive their footprint from the slot', () => {
    const v1Bag = [sampleItem({ instanceId: 'v1-armor', slot: 'armor', name: '旧甲' })];
    const parsed = parseEnvelope(v1EnvelopeWithBag(v1Bag));
    expect(parsed).not.toBeNull();
    expect(parsed!.inventory.bag[0]!.item.size).toEqual({ w: 2, h: 3 });
  });

  test('out-of-space v1 bag migrates what fits and drops the rest sanely', () => {
    // A full v1 bag of body armor (60 × 1-cell then, 2×3 now) cannot fit 60 cells.
    const v1Bag = Array.from({ length: 60 }, (_, i) =>
      sampleItem({ instanceId: `v1-armor-${i}`, slot: 'armor', name: `甲${i}` }));
    const parsed = parseEnvelope(v1EnvelopeWithBag(v1Bag));
    expect(parsed).not.toBeNull();
    const bag = parsed!.inventory.bag;
    // 12×5 grid: six 2×3 armors per 3-row band, one band → 6 fit, 54 dropped.
    expect(bag).toHaveLength(6);
    expect(bag.map((a) => a.item.instanceId)).toEqual(
      ['v1-armor-0', 'v1-armor-1', 'v1-armor-2', 'v1-armor-3', 'v1-armor-4', 'v1-armor-5'],
    );
    // Migrated save hydrates and re-serializes as v2 anchors.
    const restored = hydrateCharacter(parsed!).snapshot();
    expect(restored.bag).toHaveLength(6);
    const env = serializeCharacter(restored);
    expect(env.schemaVersion).toBe(2);
    expect(env.inventory.bag).toHaveLength(6);
  });

  test('v2 bag rejects overlapping / out-of-bounds / bad-size anchors', () => {
    const env = validEnvelope();
    const armor = { item: sampleItem({ instanceId: 'a1', slot: 'armor' }), x: 0, y: 0 };
    const overlap = { item: sampleItem({ instanceId: 'a2', slot: 'ring' }), x: 1, y: 1 };
    expect(parseEnvelope({
      ...env,
      inventory: { bag: [armor, overlap], equipment: env.inventory.equipment },
    })).toBeNull();

    const oob = { item: sampleItem({ instanceId: 'a3', slot: 'armor' }), x: 11, y: 4 };
    expect(parseEnvelope({
      ...env,
      inventory: { bag: [oob], equipment: env.inventory.equipment },
    })).toBeNull();

    const badSize = {
      item: { ...sampleItem({ instanceId: 'a4', slot: 'ring' }), size: { w: 0, h: 1 } },
      x: 0,
      y: 0,
    };
    expect(parseEnvelope({
      ...env,
      inventory: { bag: [badSize], equipment: env.inventory.equipment },
    })).toBeNull();
  });
});
