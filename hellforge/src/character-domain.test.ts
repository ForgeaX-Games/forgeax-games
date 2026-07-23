import { describe, expect, test } from 'bun:test';
import {
  createDomainFromRecord,
  createSorceressDomain,
  hydrateSorceressDomain,
  projectCharacterRecord,
} from './character-domain';
import type { ItemInstance } from './items';

function sampleItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: 'inst-1',
    slot: 'weapon',
    rarity: 'magic',
    name: '测试杖',
    ilvl: 1,
    reqLevel: 1,
    affixes: [{ stat: 'frostDmg', v: 0.1, label: '+10% 霜牙伤害' }],
    score: 10,
    ...overrides,
  };
}

describe('createSorceressDomain', () => {
  test('new character has Frost Fang rank 1 and frost hotbar', () => {
    const domain = createSorceressDomain({ playerName: '灰烬娅' });
    const snap = domain.snapshot();
    expect(snap.identity.classId).toBe('sorceress');
    expect(snap.skillRanks['frost-fang']).toBe(1);
    expect(snap.hotbar).toEqual(['frost', null, null, null]);
    expect(snap.selectedHotbarSlot).toBe(0);
    expect(snap.level).toBe(1);
    expect(snap.quests['purge-slagdeep-hollow'].status).toBe('available');
  });

  test('ephemeral den-direct uses the same constructor invariants', () => {
    const domain = createSorceressDomain({ playerName: 'Dev', ephemeral: true });
    const snap = domain.snapshot();
    expect(snap.identity.classId).toBe('sorceress');
    expect(snap.skillRanks['frost-fang']).toBe(1);
    expect(snap.hotbar).toEqual(['frost', null, null, null]);
  });

  test('rejects non-Sorceress at domain-from-record seam', () => {
    expect(() => createDomainFromRecord({
      id: 'x',
      playerName: 'Barb',
      classId: 'barbarian',
      level: 3,
      createdAt: 1,
      lastPlayedAt: 1,
    })).toThrow(/not playable/);
  });

  test('snapshot freeze: nested mutation throws and does not affect next snapshot', () => {
    const domain = createSorceressDomain({ playerName: '冻结' });
    domain.dispatch({ op: 'take-item', item: sampleItem() });
    domain.dispatch({
      op: 'set-quest-status',
      questId: 'purge-slagdeep-hollow',
      status: 'active',
    });

    const snap = domain.snapshot();
    const mutable = snap as unknown as {
      equipment: { weapon: { affixes: Array<{ v: number }> } };
      quests: { 'purge-slagdeep-hollow': { status: string } };
      bag: Array<{ affixes: Array<{ v: number }> } | null>;
    };

    expect(() => {
      mutable.equipment.weapon.affixes[0]!.v = 999;
    }).toThrow();
    expect(() => {
      mutable.quests['purge-slagdeep-hollow'].status = 'completed';
    }).toThrow();

    // Mutating a cast-away reference must never change the domain's next snapshot.
    const next = domain.snapshot();
    expect(next.equipment.weapon!.affixes[0]!.v).toBe(0.1);
    expect(next.quests['purge-slagdeep-hollow'].status).toBe('active');
  });

  test('grant-xp levels up and projectCharacterRecord mirrors identity/level', () => {
    const domain = createSorceressDomain({ playerName: '升级' });
    const result = domain.dispatch({ op: 'grant-xp', amount: 60 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levelUps?.length).toBe(1);
    expect(result.levelUps![0]!.level).toBe(2);
    const snap = domain.snapshot();
    expect(snap.level).toBe(2);
    expect(snap.unspentSkillPoints).toBe(1);
    const rec = projectCharacterRecord(snap);
    expect(rec.classId).toBe('sorceress');
    expect(rec.level).toBe(2);
    expect(rec.playerName).toBe('升级');
  });

  test('starting above level 1 grants one skill point per level after 1', () => {
    const domain = createSorceressDomain({ playerName: '老点', level: 4 });
    expect(domain.snapshot().level).toBe(4);
    expect(domain.snapshot().unspentSkillPoints).toBe(3);
  });

  test('hotbar tuple survives DeepReadonly snapshot', () => {
    const snap = createSorceressDomain({ playerName: '热键' }).snapshot();
    expect(snap.hotbar[0]).toBe('frost');
    expect(snap.hotbar[1]).toBeNull();
    expect(snap.hotbar[2]).toBeNull();
    expect(snap.hotbar[3]).toBeNull();
    expect(snap.hotbar.length).toBe(4);
  });

  test('select-hotbar updates selectedHotbarSlot (domain sole authority)', () => {
    const domain = createSorceressDomain({ playerName: '选槽' });
    expect(domain.snapshot().selectedHotbarSlot).toBe(0);
    expect(domain.snapshot().hotbar[0]).toBe('frost');
    const res = domain.dispatch({ op: 'select-hotbar', slot: 2 });
    expect(res.ok).toBe(true);
    expect(domain.snapshot().selectedHotbarSlot).toBe(2);
    domain.dispatch({ op: 'select-hotbar', slot: 0 });
    expect(domain.snapshot().selectedHotbarSlot).toBe(0);
  });

  test('magma starts unlearned (rank 0) while frost-fang is rank 1', () => {
    const snap = createSorceressDomain({ playerName: '霜优' }).snapshot();
    expect(snap.skillRanks['frost-fang']).toBe(1);
    expect(snap.skillRanks['magma-bolt']).toBe(0);
    expect(snap.hotbar[0]).toBe('frost');
  });

  test('invest-skill / respec-skills / assign-hotbar go through the domain', () => {
    const domain = createSorceressDomain({ playerName: 'Tree', level: 5 });
    expect(domain.snapshot().unspentSkillPoints).toBe(4);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'magma-bolt' }).ok).toBe(true);
    expect(domain.snapshot().skillRanks['magma-bolt']).toBe(1);
    expect(domain.dispatch({ op: 'assign-hotbar', nodeId: 'magma-bolt', slot: 1 }).ok).toBe(true);
    expect(domain.snapshot().hotbar[1]).toBe('magma');
    expect(domain.dispatch({ op: 'respec-skills', areaId: 'ashen-reach' }).ok).toBe(false);
    expect(domain.dispatch({ op: 'respec-skills', areaId: 'cinderwatch' }).ok).toBe(true);
    const after = domain.snapshot();
    expect(after.skillRanks['magma-bolt']).toBe(0);
    expect(after.skillRanks['frost-fang']).toBe(1);
    expect(after.hotbar).not.toContain('magma');
    expect(after.hotbar[after.selectedHotbarSlot]).toBe('frost');
  });
});

describe('potion belt (R2)', () => {
  test('new character starts with 2 life / 1 mana; use-potion decrements + restores', () => {
    const domain = createSorceressDomain({ playerName: '药水' });
    expect(domain.snapshot().potions).toEqual({ life: 2, mana: 1 });
    const res = domain.dispatch({ op: 'use-potion', kind: 'life', current: 10, max: 100 });
    expect(res.ok).toBe(true);
    expect(res.ok && res.potionUsed).toEqual({ kind: 'life', restore: 30 });
    expect(domain.snapshot().potions.life).toBe(1);
  });

  test('use-potion on empty stock fails with empty-potion', () => {
    const domain = createSorceressDomain({ playerName: '空瓶' });
    domain.dispatch({ op: 'use-potion', kind: 'mana', current: 0, max: 50 });
    const res = domain.dispatch({ op: 'use-potion', kind: 'mana', current: 0, max: 50 });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('empty-potion');
  });

  test('use-potion at full resource rejects with not-needed and does not consume', () => {
    const domain = createSorceressDomain({ playerName: '满血' });
    const before = domain.snapshot().potions.life;
    const res = domain.dispatch({ op: 'use-potion', kind: 'life', current: 100, max: 100 });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('not-needed');
    expect(domain.snapshot().potions.life).toBe(before);
  });

  test('hydrate clamps potion counts to POTION_CAP', () => {
    const base = createSorceressDomain({ playerName: '超量', id: 'pot-cap' }).snapshot();
    const domain = hydrateSorceressDomain({
      identity: base.identity,
      level: base.level,
      xp: base.xp,
      gold: base.gold,
      unspentSkillPoints: base.unspentSkillPoints,
      skillRanks: base.skillRanks,
      hotbar: base.hotbar,
      selectedHotbarSlot: base.selectedHotbarSlot,
      bag: base.bag,
      equipment: base.equipment,
      quests: base.quests,
      potions: { life: 999, mana: 50 },
    });
    expect(domain.snapshot().potions).toEqual({ life: 20, mana: 20 });
  });

  test('add-potion caps at 20 and reports the added count', () => {
    const domain = createSorceressDomain({ playerName: '囤药' });
    const res = domain.dispatch({ op: 'add-potion', kind: 'life', count: 25 });
    expect(res.ok && res.potionAdded).toBe(18); // 2 + 18 = 20
    expect(domain.snapshot().potions.life).toBe(20);
    expect(domain.dispatch({ op: 'add-potion', kind: 'life' })).toMatchObject({ ok: true, potionAdded: 0 });
  });
});
