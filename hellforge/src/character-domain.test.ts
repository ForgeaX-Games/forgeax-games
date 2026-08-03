import { describe, expect, test } from 'bun:test';
import {
  createDomainFromRecord,
  createSorceressDomain,
  hydrateSorceressDomain,
  projectCharacterRecord,
  type CharacterDomain,
  type HydrateSorceressOptions,
} from './character-domain';
import { SALVAGE_YIELD } from './crafting';
import {
  emptyEquipment,
  equipSlotsFor,
  EQUIP_SLOT_ORDER,
  itemSlotForEquip,
  meltGoldValue,
  type Equipment,
  type ItemInstance,
  type ItemSlot,
  type Rarity,
} from './items';

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

/** Fill all doll slots for `slot` so the next take-item lands in the bag. */
function occupyEquipSlots(domain: CharacterDomain, slot: ItemSlot, tag: string): void {
  for (const eq of equipSlotsFor(slot)) {
    if (domain.snapshot().equipment[eq]) continue;
    expect(domain.dispatch({
      op: 'take-item',
      item: sampleItem({
        instanceId: `occ-${tag}-${eq}`,
        slot,
        rarity: 'common',
        name: `占位-${eq}`,
        affixes: [],
        score: 0,
      }),
    }).ok).toBe(true);
  }
}

/** Place `item` into the bag; returns its bag anchor-list index. */
function putInBag(domain: CharacterDomain, item: ItemInstance): number {
  occupyEquipSlots(domain, item.slot, item.instanceId);
  expect(domain.dispatch({ op: 'take-item', item }).ok).toBe(true);
  const idx = domain.snapshot().bag.findIndex((a) => a.item.instanceId === item.instanceId);
  expect(idx).toBeGreaterThanOrEqual(0);
  return idx;
}

describe('createSorceressDomain', () => {
  test('new character has Frost + Magma free ranks and creation hotbar', () => {
    const domain = createSorceressDomain({ playerName: '灰烬娅' });
    const snap = domain.snapshot();
    expect(snap.identity.classId).toBe('sorceress');
    expect(snap.skillRanks['frost-fang']).toBe(1);
    expect(snap.skillRanks['magma-bolt']).toBe(1);
    expect(snap.hotbar).toEqual(['frost', 'magma', null, null]);
    expect(snap.selectedHotbarSlot).toBe(0);
    expect(snap.level).toBe(1);
    expect(snap.skillRanks['arc-surge']).toBe(0);
    expect(snap.skillRanks['phase-step']).toBe(0);
    expect(snap.quests['purge-slagdeep-hollow'].status).toBe('available');
  });

  test('ephemeral den-direct uses the same constructor invariants', () => {
    const domain = createSorceressDomain({ playerName: 'Dev', ephemeral: true });
    const snap = domain.snapshot();
    expect(snap.identity.classId).toBe('sorceress');
    expect(snap.skillRanks['frost-fang']).toBe(1);
    expect(snap.skillRanks['magma-bolt']).toBe(1);
    expect(snap.hotbar).toEqual(['frost', 'magma', null, null]);
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
    // Starter kit fills the weapon slot — free it so sampleItem auto-equips.
    domain.dispatch({ op: 'unequip', slot: 'weapon' });
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
      bag: Array<{ item: { affixes: Array<{ v: number }> }; x: number; y: number }>;
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

  test('level 2 grants Arc Surge (castable + hotbar) without spending the skill point', () => {
    const domain = createSorceressDomain({ playerName: '电弧' });
    const result = domain.dispatch({ op: 'grant-xp', amount: 60 });
    expect(result.ok).toBe(true);
    const snap = domain.snapshot();
    expect(snap.level).toBe(2);
    expect(snap.unspentSkillPoints).toBe(1);
    expect(snap.skillRanks['arc-surge']).toBe(1);
    expect(snap.hotbar).toEqual(['frost', 'magma', 'arc', null]);
    expect(snap.skillRanks['phase-step']).toBe(0);
    expect(snap.hotbar).not.toContain('blink');
  });

  test('level 3 grants Inferno Nova on hotbar slot 4 without Phase Step', () => {
    const domain = createSorceressDomain({ playerName: '新星' });
    // L1→2 needs 60; L2→3 needs floor(60 * 1.45) = 87.
    const result = domain.dispatch({ op: 'grant-xp', amount: 60 + 87 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.levelUps?.map((u) => u.level)).toEqual([2, 3]);
    const snap = domain.snapshot();
    expect(snap.level).toBe(3);
    expect(snap.unspentSkillPoints).toBe(2);
    expect(snap.skillRanks['arc-surge']).toBe(1);
    expect(snap.skillRanks['phase-step']).toBe(0);
    expect(snap.hotbar).toEqual(['frost', 'magma', 'arc', 'inferno-nova']);
    expect(snap.hotbar).not.toContain('blink');
  });

  test('onboarding never auto-grants PR9 actives (tree-gated only)', () => {
    const domain = createSorceressDomain({ playerName: 'PR9', level: 10 });
    const snap = domain.snapshot();
    expect(snap.skillRanks['flame-burst'] ?? 0).toBe(0);
    expect(snap.skillRanks['frost-nova'] ?? 0).toBe(0);
    expect(snap.skillRanks.discharge ?? 0).toBe(0);
    expect(snap.hotbar).not.toContain('flame-burst');
    expect(snap.hotbar).not.toContain('frost-nova');
    expect(snap.hotbar).not.toContain('discharge');
  });

  test('starting above level 1 grants one skill point per level after 1', () => {
    const domain = createSorceressDomain({ playerName: '起点', level: 4 });
    expect(domain.snapshot().level).toBe(4);
    expect(domain.snapshot().unspentSkillPoints).toBe(3);
    expect(domain.snapshot().skillRanks['arc-surge']).toBe(1);
    expect(domain.snapshot().hotbar).toContain('arc');
    expect(domain.snapshot().hotbar[3]).toBe('inferno-nova');
    expect(domain.snapshot().skillRanks['phase-step']).toBe(0);
  });

  test('hotbar tuple survives DeepReadonly snapshot', () => {
    const snap = createSorceressDomain({ playerName: '热键' }).snapshot();
    expect(snap.hotbar[0]).toBe('frost');
    expect(snap.hotbar[1]).toBe('magma');
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

  test('magma-bolt starts at free rank 1 with frost-fang', () => {
    const snap = createSorceressDomain({ playerName: '霜火' }).snapshot();
    expect(snap.skillRanks['frost-fang']).toBe(1);
    expect(snap.skillRanks['magma-bolt']).toBe(1);
    expect(snap.hotbar).toEqual(['frost', 'magma', null, null]);
  });

  test('invest-skill / respec-skills / assign-hotbar go through the domain', () => {
    const domain = createSorceressDomain({ playerName: 'Tree', level: 5 });
    expect(domain.snapshot().unspentSkillPoints).toBe(4);
    expect(domain.snapshot().skillRanks['magma-bolt']).toBe(1);
    expect(domain.dispatch({ op: 'invest-skill', nodeId: 'magma-bolt' }).ok).toBe(true);
    expect(domain.snapshot().skillRanks['magma-bolt']).toBe(2);
    expect(domain.dispatch({ op: 'assign-hotbar', nodeId: 'magma-bolt', slot: 1 }).ok).toBe(true);
    expect(domain.snapshot().hotbar[1]).toBe('magma');
    expect(domain.dispatch({ op: 'respec-skills', areaId: 'ashen-reach' }).ok).toBe(false);
    expect(domain.dispatch({ op: 'respec-skills', areaId: 'cinderwatch' }).ok).toBe(true);
    const after = domain.snapshot();
    expect(after.skillRanks['magma-bolt']).toBe(1);
    expect(after.skillRanks['frost-fang']).toBe(1);
    expect(after.skillRanks['arc-surge']).toBe(0);
    expect(after.hotbar).toContain('magma');
    expect(after.hotbar).toContain('frost');
    expect(after.hotbar).not.toContain('arc');
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

describe('PR10 T3 materials + craft commands + ring targeting', () => {
  test('snapshot exposes materials currency counters (default zeros)', () => {
    const snap = createSorceressDomain({ playerName: '材料' }).snapshot();
    expect(snap.materials).toEqual({ common: 0, magic: 0, rare: 0 });
  });

  test('take-item ring auto-equip: ring1 → ring2 → bag when both filled', () => {
    const domain = createSorceressDomain({ playerName: '双戒' });
    // Starter kit occupies both ring slots — free them for the auto-equip flow.
    for (const slot of ['ring1', 'ring2'] as const) {
      expect(domain.dispatch({ op: 'unequip', slot }).ok).toBe(true);
    }
    expect(domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'r-a', slot: 'ring', name: '戒A' }),
    }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('r-a');
    expect(domain.snapshot().equipment.ring2).toBeNull();

    expect(domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'r-b', slot: 'ring', name: '戒B' }),
    }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('r-a');
    expect(domain.snapshot().equipment.ring2?.instanceId).toBe('r-b');

    expect(domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'r-c', slot: 'ring', name: '戒C' }),
    }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('r-a');
    expect(domain.snapshot().equipment.ring2?.instanceId).toBe('r-b');
    expect(domain.snapshot().bag.some((a) => a.item.instanceId === 'r-c')).toBe(true);
  });

  test('equip-from-bag with both rings filled swaps ring1; target ring2 swaps ring2', () => {
    const domain = createSorceressDomain({ playerName: '换戒' });
    // Starter kit occupies both ring slots — free them so r1/r2 auto-equip.
    for (const slot of ['ring1', 'ring2'] as const) {
      expect(domain.dispatch({ op: 'unequip', slot }).ok).toBe(true);
    }
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'r1', slot: 'ring', name: '戒1' }) });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'r2', slot: 'ring', name: '戒2' }) });
    const bagIdx = putInBag(domain, sampleItem({ instanceId: 'r3', slot: 'ring', name: '戒3' }));

    expect(domain.dispatch({ op: 'equip-from-bag', index: bagIdx }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('r3');
    expect(domain.snapshot().equipment.ring2?.instanceId).toBe('r2');
    expect(domain.snapshot().bag[bagIdx]?.item.instanceId).toBe('r1');

    const bagIdx2 = domain.snapshot().bag.findIndex((a) => a.item.instanceId === 'r1');
    expect(domain.dispatch({ op: 'equip-from-bag', index: bagIdx2, target: 'ring2' }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('r3');
    expect(domain.snapshot().equipment.ring2?.instanceId).toBe('r1');
    expect(domain.snapshot().bag[bagIdx2]?.item.instanceId).toBe('r2');
  });

  test('equip-from-bag target ring2 with ring1 empty still lands on ring2', () => {
    const domain = createSorceressDomain({ playerName: '拖戒2' });
    const idx = putInBag(domain, sampleItem({ instanceId: 'drag-r', slot: 'ring', name: '拖入戒' }));
    // putInBag occupied both ring slots — clear them so doll is empty but item stays in bag
    for (const slot of ['ring1', 'ring2'] as const) {
      const eq = domain.snapshot().equipment[slot];
      if (!eq) continue;
      expect(domain.dispatch({ op: 'unequip', slot }).ok).toBe(true);
    }
    const bagIdx = domain.snapshot().bag.findIndex((a) => a.item.instanceId === 'drag-r');
    expect(bagIdx).toBe(idx);
    expect(domain.dispatch({ op: 'equip-from-bag', index: bagIdx, target: 'ring2' }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1).toBeNull();
    expect(domain.snapshot().equipment.ring2?.instanceId).toBe('drag-r');
  });

  test('equip-from-bag rejects target outside equipSlotsFor', () => {
    const domain = createSorceressDomain({ playerName: '错槽' });
    const idx = putInBag(domain, sampleItem({ instanceId: 'w1', slot: 'weapon', name: '杖' }));
    const res = domain.dispatch({ op: 'equip-from-bag', index: idx, target: 'ring1' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('bad-index');
  });

  test('unequip takes EquipSlot (ring2)', () => {
    const domain = createSorceressDomain({ playerName: '卸戒' });
    // Starter kit occupies both ring slots — free them so u1/u2 auto-equip.
    for (const slot of ['ring1', 'ring2'] as const) {
      expect(domain.dispatch({ op: 'unequip', slot }).ok).toBe(true);
    }
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'u1', slot: 'ring' }) });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'u2', slot: 'ring' }) });
    expect(domain.dispatch({ op: 'unequip', slot: 'ring2' }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring2).toBeNull();
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('u1');
    expect(domain.snapshot().bag.some((a) => a.item.instanceId === 'u2')).toBe(true);
  });

  test('salvage-bag happy: grants matching-tier shards and clears bag cell', () => {
    const domain = createSorceressDomain({ playerName: '拆解' });
    const tiers: Array<{ rarity: Rarity; key: 'common' | 'magic' | 'rare' }> = [
      { rarity: 'common', key: 'common' },
      { rarity: 'magic', key: 'magic' },
      { rarity: 'rare', key: 'rare' },
    ];
    for (const { rarity, key } of tiers) {
      const before = { ...domain.snapshot().materials };
      const idx = putInBag(domain, sampleItem({
        instanceId: `salv-${key}`,
        slot: 'gloves',
        rarity,
        name: `拆-${key}`,
      }));
      const res = domain.dispatch({ op: 'salvage-bag', index: idx });
      expect(res.ok).toBe(true);
      expect(domain.snapshot().bag.some((a) => a.item.instanceId === `salv-${key}`)).toBe(false);
      expect(domain.snapshot().materials[key]).toBe(before[key] + SALVAGE_YIELD[key]);
    }
  });

  test('salvage-bag rejects legendary with legendary-locked; out-of-range indices', () => {
    const domain = createSorceressDomain({ playerName: '禁拆' });
    const idx = putInBag(domain, sampleItem({
      instanceId: 'leg',
      slot: 'weapon',
      rarity: 'legendary',
      legendary: 'slag-staff',
      name: '熔渣之杖',
    }));
    const locked = domain.dispatch({ op: 'salvage-bag', index: idx });
    expect(locked.ok).toBe(false);
    expect(!locked.ok && locked.reason).toBe('legendary-locked');
    expect(domain.snapshot().bag[idx]?.item.instanceId).toBe('leg');
    expect(domain.snapshot().materials).toEqual({ common: 0, magic: 0, rare: 0 });

    // Anchor list has no empty cells — any out-of-range index is bad-index.
    expect(domain.dispatch({ op: 'salvage-bag', index: 23 })).toMatchObject({ ok: false, reason: 'bad-index' });
    expect(domain.dispatch({ op: 'salvage-bag', index: 99 })).toMatchObject({ ok: false, reason: 'bad-index' });
  });

  test('reroll-bag happy: spends matching shards, replaces item (same slot/rarity/ilvl, new id)', () => {
    const domain = createSorceressDomain({ playerName: '重铸' });
    // Fund: salvage one magic → 3 blue (reroll cost for magic).
    const fundIdx = putInBag(domain, sampleItem({
      instanceId: 'fund-m',
      slot: 'belt',
      rarity: 'magic',
      name: '燃料带',
    }));
    expect(domain.dispatch({ op: 'salvage-bag', index: fundIdx }).ok).toBe(true);
    expect(domain.snapshot().materials.magic).toBe(3);

    const idx = putInBag(domain, sampleItem({
      instanceId: 'roll-me',
      slot: 'belt',
      rarity: 'magic',
      ilvl: 4,
      name: '旧腰带',
      affixes: [{ stat: 'maxHp', v: 1, label: '+1' }],
    }));
    const before = domain.snapshot().bag[idx]!;
    const res = domain.dispatch({ op: 'reroll-bag', index: idx });
    expect(res.ok).toBe(true);
    const after = domain.snapshot().bag[idx]!;
    // Reroll keeps slot/rarity/ilvl → same footprint → same anchor cell.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.item.slot).toBe(before.item.slot);
    expect(after.item.rarity).toBe(before.item.rarity);
    expect(after.item.ilvl).toBe(before.item.ilvl);
    expect(after.item.instanceId).not.toBe(before.item.instanceId);
    expect(domain.snapshot().materials.magic).toBe(0);
  });

  test('reroll-bag rejects: legendary-locked, not-enough-materials, bad-index', () => {
    const domain = createSorceressDomain({ playerName: '禁铸' });
    const legIdx = putInBag(domain, sampleItem({
      instanceId: 'leg-r',
      rarity: 'legendary',
      legendary: 'slag-staff',
      name: '熔渣之杖',
    }));
    expect(domain.dispatch({ op: 'reroll-bag', index: legIdx })).toMatchObject({
      ok: false,
      reason: 'legendary-locked',
    });

    const idx = putInBag(domain, sampleItem({
      instanceId: 'need-mats',
      rarity: 'rare',
      name: '缺料',
    }));
    expect(domain.snapshot().materials.rare).toBe(0);
    expect(domain.dispatch({ op: 'reroll-bag', index: idx })).toMatchObject({
      ok: false,
      reason: 'not-enough-materials',
    });
    expect(domain.snapshot().bag[idx]?.item.instanceId).toBe('need-mats');

    expect(domain.dispatch({ op: 'reroll-bag', index: 22 })).toMatchObject({ ok: false, reason: 'bad-index' });
  });

  test('fuse-bag happy: 3 same-slot commons → one magic; consumes inputs', () => {
    const domain = createSorceressDomain({ playerName: '三合一' });
    const indices = [0, 1, 2].map((n) => putInBag(domain, sampleItem({
      instanceId: `fuse-${n}`,
      slot: 'gloves',
      rarity: 'common',
      ilvl: n === 1 ? 5 : 2,
      name: `合${n}`,
    })));
    const matsBefore = { ...domain.snapshot().materials };
    const res = domain.dispatch({ op: 'fuse-bag', indices: indices as [number, number, number] });
    expect(res.ok).toBe(true);
    expect(domain.snapshot().materials).toEqual(matsBefore); // fuse costs items only
    // All three inputs consumed; the fused result sits at the lowest list index.
    const bagAfter = domain.snapshot().bag;
    expect(bagAfter).toHaveLength(1);
    const fused = bagAfter[0]!.item;
    expect(fused.rarity).toBe('magic');
    expect(fused.slot).toBe('gloves');
    expect(fused.ilvl).toBe(5); // max ilvl
    expect(['fuse-0', 'fuse-1', 'fuse-2']).not.toContain(fused.instanceId);
    expect(bagAfter[0]!.x).toBe(0);
    expect(bagAfter[0]!.y).toBe(0);
  });

  test('fuse-bag rejects: bad-recipe, legendary-locked, bad-index', () => {
    const domain = createSorceressDomain({ playerName: '禁合' });
    // Mixed RARITY still violates the (relaxed) recipe: 3 of the same rarity.
    const a = putInBag(domain, sampleItem({ instanceId: 'fa', slot: 'weapon', rarity: 'common' }));
    const m = putInBag(domain, sampleItem({ instanceId: 'fm', slot: 'helm', rarity: 'magic' }));
    const c = putInBag(domain, sampleItem({ instanceId: 'fc', slot: 'weapon', rarity: 'common' }));
    expect(domain.dispatch({ op: 'fuse-bag', indices: [a, m, c] })).toMatchObject({
      ok: false,
      reason: 'bad-recipe',
    });

    const leg = putInBag(domain, sampleItem({
      instanceId: 'leg-f',
      rarity: 'legendary',
      legendary: 'slag-staff',
      name: '熔渣之杖',
    }));
    const m1 = putInBag(domain, sampleItem({ instanceId: 'fm1', rarity: 'magic', slot: 'weapon' }));
    const m2 = putInBag(domain, sampleItem({ instanceId: 'fm2', rarity: 'magic', slot: 'weapon' }));
    expect(domain.dispatch({ op: 'fuse-bag', indices: [leg, m1, m2] })).toMatchObject({
      ok: false,
      reason: 'legendary-locked',
    });

    expect(domain.dispatch({ op: 'fuse-bag', indices: [a, a, c] })).toMatchObject({
      ok: false,
      reason: 'bad-index',
    });
    expect(domain.dispatch({ op: 'fuse-bag', indices: [99, a, c] })).toMatchObject({
      ok: false,
      reason: 'bad-index',
    });
  });

  test('fuse-bag relaxed recipe: cross-slot commons fuse; rare×3 → legendary', () => {
    const domain = createSorceressDomain({ playerName: '宽合' });
    const trio = [
      putInBag(domain, sampleItem({ instanceId: 'xa', slot: 'weapon', rarity: 'common' })),
      putInBag(domain, sampleItem({ instanceId: 'xb', slot: 'helm', rarity: 'common' })),
      putInBag(domain, sampleItem({ instanceId: 'xc', slot: 'belt', rarity: 'common' })),
    ];
    const res = domain.dispatch({ op: 'fuse-bag', indices: trio as [number, number, number] });
    expect(res.ok).toBe(true);
    const bagAfter = domain.snapshot().bag;
    expect(bagAfter).toHaveLength(1);
    expect(bagAfter[0]!.item.rarity).toBe('magic');
    // Result slot is picked at random among the input slots.
    expect(['weapon', 'helm', 'belt']).toContain(bagAfter[0]!.item.slot);

    const rares = [
      putInBag(domain, sampleItem({ instanceId: 'ra', slot: 'ring', rarity: 'rare' })),
      putInBag(domain, sampleItem({ instanceId: 'rb', slot: 'ring', rarity: 'rare' })),
      putInBag(domain, sampleItem({ instanceId: 'rc', slot: 'amulet', rarity: 'rare' })),
    ];
    const res2 = domain.dispatch({ op: 'fuse-bag', indices: rares as [number, number, number] });
    expect(res2.ok).toBe(true);
    const fused = domain.snapshot().bag.find((x) => x.item.rarity === 'legendary');
    expect(fused).toBeDefined();
    expect(fused!.item.legendary).toBeDefined();
  });

  test('melt-bag rejects legendary with legendary-locked (item + gold untouched)', () => {
    const domain = createSorceressDomain({ playerName: '禁熔' });
    domain.dispatch({ op: 'add-gold', amount: 10 });
    const idx = putInBag(domain, sampleItem({
      instanceId: 'leg-melt',
      rarity: 'legendary',
      legendary: 'slag-staff',
      name: '熔渣之杖',
    }));
    const goldBefore = domain.snapshot().gold;
    const res = domain.dispatch({ op: 'melt-bag', index: idx });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('legendary-locked');
    expect(domain.snapshot().bag[idx]?.item.instanceId).toBe('leg-melt');
    expect(domain.snapshot().gold).toBe(goldBefore);
  });

  test('melt-bag still melts non-legendary for gold', () => {
    const domain = createSorceressDomain({ playerName: '可熔' });
    const idx = putInBag(domain, sampleItem({
      instanceId: 'melt-ok',
      rarity: 'magic',
      name: '可熔杖',
    }));
    const res = domain.dispatch({ op: 'melt-bag', index: idx });
    expect(res.ok).toBe(true);
    expect(res.ok && res.melted).toBe(true);
    expect(domain.snapshot().bag.some((a) => a.item.instanceId === 'melt-ok')).toBe(false);
    expect(domain.snapshot().gold).toBeGreaterThan(0);
  });
});

describe('bag grid anchors (multi-size items)', () => {
  test('take-item firstFits by footprint: staff 1×3 then armor 2×3 packs beside it', () => {
    const domain = createSorceressDomain({ playerName: '摆放' });
    // Starter kit occupies weapon + armor doll slots, so all four take-items
    // land in the bag; the first two still demonstrate 1×3 then 2×3 packing.
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'eq-w', slot: 'weapon' }) });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'eq-a', slot: 'armor' }) });
    expect(domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'bag-w', slot: 'weapon', name: '杖' }),
    }).ok).toBe(true);
    expect(domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'bag-a', slot: 'armor', name: '甲' }),
    }).ok).toBe(true);
    const bag = domain.snapshot().bag;
    expect(bag[0]).toMatchObject({ x: 0, y: 0 }); // 1×3 staff at the top-left
    expect(bag[1]).toMatchObject({ x: 1, y: 0 }); // 2×3 armor packs right beside it
  });

  test('sixty 1×1 items fill the 12×5 grid exactly; the 61st returns bag-full', () => {
    const domain = createSorceressDomain({ playerName: '满包' });
    // Starter kit occupies every doll slot, so all fillers land in the bag.
    for (let i = 0; i < 60; i++) {
      expect(domain.dispatch({
        op: 'take-item',
        item: sampleItem({ instanceId: `fill-${i}`, slot: 'ring', name: `填${i}` }),
      }).ok).toBe(true);
    }
    expect(domain.snapshot().bag).toHaveLength(60);
    const res = domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'overflow', slot: 'ring' }),
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('bag-full');
  });

  test('unequip firstFits back into the bag; no fit keeps the item equipped', () => {
    const domain = createSorceressDomain({ playerName: '卸装' });
    // Starter kit occupies the ring slots — free them so eq-r1/eq-r2 auto-equip.
    domain.dispatch({ op: 'unequip', slot: 'ring1' });
    domain.dispatch({ op: 'unequip', slot: 'ring2' });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'eq-r1', slot: 'ring' }) });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'eq-r2', slot: 'ring' }) });
    // Partially filled bag: the two 1×1 kit rings sit at (0,0)/(1,0) and the
    // bag ring at (2,0); unequipped gloves (2×2) land at the first free spot.
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'bag-r', slot: 'ring' }) });
    const kitGloves = domain.snapshot().equipment.gloves!;
    expect(domain.dispatch({ op: 'unequip', slot: 'gloves' }).ok).toBe(true);
    const after = domain.snapshot();
    expect(after.equipment.gloves).toBeNull();
    const g = after.bag.find((a) => a.item.instanceId === kitGloves.instanceId);
    expect(g).toMatchObject({ x: 3, y: 0 }); // 2×2 next to the 1×1 ring

    // Fill the grid completely, then unequip must refuse and keep the item on.
    // 60 cells − 7 occupied (2 kit rings + 1 bag ring + 2×2 gloves) = 53 fillers.
    for (let i = 0; i < 53; i++) {
      expect(domain.dispatch({
        op: 'take-item',
        item: sampleItem({ instanceId: `pack-${i}`, slot: 'ring' }),
      }).ok).toBe(true);
    }
    // 57 anchors cover all 60 cells (2 + 1 + 4 + 53×1) — no free cell remains.
    expect(domain.snapshot().bag).toHaveLength(57);
    const res = domain.dispatch({ op: 'unequip', slot: 'ring1' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('bag-full');
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('eq-r1');
  });

  test('equip-from-bag swap is atomic: no-fit for the swapped-out piece changes nothing', () => {
    const domain = createSorceressDomain({ playerName: '原子' });
    // Starter kit occupies both rings — free them so the big rings auto-equip.
    domain.dispatch({ op: 'unequip', slot: 'ring1' });
    domain.dispatch({ op: 'unequip', slot: 'ring2' });
    // Oversized custom rings (2×2) on both doll ring slots.
    domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'big-r1', slot: 'ring', size: { w: 2, h: 2 } }),
    });
    domain.dispatch({
      op: 'take-item',
      item: sampleItem({ instanceId: 'big-r2', slot: 'ring', size: { w: 2, h: 2 } }),
    });
    // One small ring in the bag, then pack every remaining cell.
    const swapIdx = putInBag(domain, sampleItem({ instanceId: 'small-r', slot: 'ring', name: '小戒' }));
    // 60 cells − 3 occupied (2 kit rings + small-r) = 57 one-cell jammers.
    for (let i = 0; i < 57; i++) {
      expect(domain.dispatch({
        op: 'take-item',
        item: sampleItem({ instanceId: `jam-${i}`, slot: 'ring' }),
      }).ok).toBe(true);
    }
    expect(domain.snapshot().bag).toHaveLength(60);
    // Swapping small-r in would have to firstFit big-r1 (2×2) into one free cell — impossible.
    const res = domain.dispatch({ op: 'equip-from-bag', index: swapIdx });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('bag-full');
    const after = domain.snapshot();
    expect(after.equipment.ring1?.instanceId).toBe('big-r1');
    expect(after.equipment.ring2?.instanceId).toBe('big-r2');
    expect(after.bag).toHaveLength(60);
    expect(after.bag[swapIdx]?.item.instanceId).toBe('small-r');
  });
});

describe('starter kit (N3R-N3 ten-slot newbie gear)', () => {
  // Tier-0 BASE_NAMES from the shared 词表 — deterministic starter names.
  // Helm/armor/gloves/belt/offhand are the 「布*」family; weapon/boots/ring/
  // amulet keep their own tier-0 names (词表 is shared with drops, untouched).
  const STARTER_NAMES: Record<ItemSlot, string> = {
    weapon: '焦木杖', helm: '布兜帽', armor: '灰布袍', boots: '麻绳靴',
    ring: '铜环', amulet: '骨符', gloves: '布手套', belt: '布腰带', offhand: '布纹法器',
  };

  function sentinelEquipment(prefix: string): Equipment {
    const eq = emptyEquipment();
    for (const slot of EQUIP_SLOT_ORDER) {
      eq[slot] = {
        instanceId: `${prefix}-${slot}`,
        slot: itemSlotForEquip(slot),
        rarity: 'magic',
        name: `哨兵-${slot}`,
        ilvl: 3,
        reqLevel: 1,
        affixes: [{ stat: 'maxHp', v: 10, label: '+10 生命上限' }],
        score: 10,
      };
    }
    return eq;
  }

  test('a) new characters wear all ten slots: common / ilvl 1 / reqLevel 1 / tier-0 names', () => {
    const eq = createSorceressDomain({ playerName: '新手' }).snapshot().equipment;
    for (const slot of EQUIP_SLOT_ORDER) {
      const item = eq[slot];
      expect(item).not.toBeNull();
      expect(item!.rarity).toBe('common');
      expect(item!.ilvl).toBe(1);
      expect(item!.reqLevel).toBe(1);
      expect(item!.affixes).toEqual([]);
      expect(item!.instanceId).toBeTruthy();
      expect(item!.name).toBe(STARTER_NAMES[itemSlotForEquip(slot)]);
      expect(item!.slot).toBe(itemSlotForEquip(slot));
    }
    // 「布*」slots: tier-0 names all carry 布 (布兜帽/灰布袍/布手套/布腰带/布纹法器).
    for (const slot of ['helm', 'armor', 'gloves', 'belt', 'offhand'] as const) {
      expect(eq[slot]!.name.includes('布')).toBe(true);
    }
  });

  test('b) hydrating an equipped save keeps its gear untouched (no kit overwrite)', () => {
    const base = createSorceressDomain({ playerName: '旧档', id: 'old-1' }).snapshot();
    const opts = {
      identity: base.identity,
      level: base.level,
      xp: base.xp,
      gold: base.gold,
      unspentSkillPoints: base.unspentSkillPoints,
      skillRanks: base.skillRanks,
      hotbar: base.hotbar,
      selectedHotbarSlot: base.selectedHotbarSlot,
      bag: base.bag,
      quests: base.quests,
    };
    // Full ten-slot save: every sentinel survives verbatim.
    const full = hydrateSorceressDomain({ ...opts, equipment: sentinelEquipment('s') });
    for (const slot of EQUIP_SLOT_ORDER) {
      expect(full.snapshot().equipment[slot]?.instanceId).toBe(`s-${slot}`);
    }
    // Partial old save (weapon only): nothing is granted, the rest stays null.
    const partial = hydrateSorceressDomain({
      ...opts,
      equipment: { ...emptyEquipment(), weapon: sentinelEquipment('s').weapon },
    });
    const pe = partial.snapshot().equipment;
    expect(pe.weapon?.instanceId).toBe('s-weapon');
    for (const slot of EQUIP_SLOT_ORDER.filter((s) => s !== 'weapon')) {
      expect(pe[slot]).toBeNull();
    }
  });

  test('c) hydrating an all-empty old save grants the full kit', () => {
    const base = createSorceressDomain({ playerName: '空档', id: 'empty-1' }).snapshot();
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
      equipment: emptyEquipment(),
      quests: base.quests,
    });
    const eq = domain.snapshot().equipment;
    for (const slot of EQUIP_SLOT_ORDER) {
      expect(eq[slot]).not.toBeNull();
      expect(eq[slot]!.rarity).toBe('common');
      expect(eq[slot]!.ilvl).toBe(1);
      expect(eq[slot]!.reqLevel).toBe(1);
      expect(eq[slot]!.name).toBe(STARTER_NAMES[itemSlotForEquip(slot)]);
    }
  });

  test('d) granted items are real: replaceable, unequippable, meltable', () => {
    const domain = createSorceressDomain({ playerName: '真品' });
    const kitWeapon = domain.snapshot().equipment.weapon!;
    // Replace: a better weapon lands in the bag (doll full) and swaps in.
    expect(domain.dispatch({
      op: 'take-item',
      item: {
        instanceId: 'better-w',
        slot: 'weapon',
        rarity: 'rare',
        name: '好杖',
        ilvl: 1,
        reqLevel: 1,
        affixes: [{ stat: 'dmgPct', v: 0.1, label: '+10% 伤害' }],
        score: 20,
      },
    }).ok).toBe(true);
    const swapIdx = domain.snapshot().bag.findIndex((a) => a.item.instanceId === 'better-w');
    expect(swapIdx).toBeGreaterThanOrEqual(0);
    expect(domain.dispatch({ op: 'equip-from-bag', index: swapIdx }).ok).toBe(true);
    expect(domain.snapshot().equipment.weapon?.instanceId).toBe('better-w');
    expect(domain.snapshot().bag.some((a) => a.item.instanceId === kitWeapon.instanceId)).toBe(true);
    // Unequip a kit piece → doll slot frees up (inventory-ui shows the dim ghost).
    const kitGloves = domain.snapshot().equipment.gloves!;
    expect(domain.dispatch({ op: 'unequip', slot: 'gloves' }).ok).toBe(true);
    expect(domain.snapshot().equipment.gloves).toBeNull();
    // Melt it for gold via the existing dispatch.
    const goldBefore = domain.snapshot().gold;
    const meltIdx = domain.snapshot().bag.findIndex((a) => a.item.instanceId === kitGloves.instanceId);
    expect(meltIdx).toBeGreaterThanOrEqual(0);
    expect(domain.dispatch({ op: 'melt-bag', index: meltIdx }).ok).toBe(true);
    expect(domain.snapshot().gold).toBe(goldBefore + meltGoldValue(kitGloves));
    expect(domain.snapshot().bag.some((a) => a.item.instanceId === kitGloves.instanceId)).toBe(false);
  });
});

describe('personal stash (N-Stash)', () => {
  /** Full hydrate options from a fresh domain; stash intentionally omitted. */
  function baseHydrateOpts(overrides: Partial<HydrateSorceressOptions> = {}): HydrateSorceressOptions {
    const base = createSorceressDomain({ playerName: '仓库', id: 'stash-base-1' }).snapshot();
    return {
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
      ...overrides,
    };
  }

  /** 120 non-overlapping 1×1 rings covering the full 12×10 stash. */
  function fullStashRings(prefix = 'st'): Array<{ item: ItemInstance; x: number; y: number }> {
    return Array.from({ length: 120 }, (_, i) => ({
      item: sampleItem({ instanceId: `${prefix}-${i}`, slot: 'ring', name: `${prefix}-${i}` }),
      x: i % 12,
      y: Math.floor(i / 12),
    }));
  }

  test('stash-bag success: bag −1, stash +1, same instanceId, snapshot reflects', () => {
    const domain = createSorceressDomain({ playerName: '入库' });
    const idx = putInBag(domain, sampleItem({ instanceId: 'stash-me', slot: 'gloves', name: '入仓' }));
    const before = domain.snapshot();
    expect(domain.dispatch({ op: 'stash-bag', index: idx, areaId: 'cinderwatch' }).ok).toBe(true);
    const after = domain.snapshot();
    expect(after.bag).toHaveLength(before.bag.length - 1);
    expect(after.bag.some((a) => a.item.instanceId === 'stash-me')).toBe(false);
    expect(after.stash).toHaveLength(1);
    expect(after.stash[0]!.item.instanceId).toBe('stash-me');
    expect(after.stash[0]).toMatchObject({ x: 0, y: 0 }); // 2×2 gloves pack the stash top-left
  });

  test('stash-full is an atomic no-op: a full stash blocks the transfer', () => {
    const domain = hydrateSorceressDomain({
      ...baseHydrateOpts(),
      bag: [{ item: sampleItem({ instanceId: 'last-ring', slot: 'ring' }), x: 0, y: 0 }],
      stash: fullStashRings(),
    });
    const before = domain.snapshot();
    const res = domain.dispatch({ op: 'stash-bag', index: 0, areaId: 'cinderwatch' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('stash-full');
    const after = domain.snapshot();
    expect(after.bag).toHaveLength(1);
    expect(after.bag[0]!.item.instanceId).toBe('last-ring');
    expect(after.stash).toHaveLength(120);
    expect(after).toEqual(before);
  });

  test('unstash-bag success: stash −1, bag +1, same instanceId', () => {
    const domain = hydrateSorceressDomain({
      ...baseHydrateOpts(),
      stash: [{ item: sampleItem({ instanceId: 'out-1', slot: 'gloves', name: '出仓' }), x: 0, y: 0 }],
    });
    const before = domain.snapshot();
    expect(domain.dispatch({ op: 'unstash-bag', index: 0, areaId: 'cinderwatch' }).ok).toBe(true);
    const after = domain.snapshot();
    expect(after.stash).toHaveLength(0);
    expect(after.bag).toHaveLength(before.bag.length + 1);
    const moved = after.bag.find((a) => a.item.instanceId === 'out-1');
    expect(moved).toMatchObject({ x: 0, y: 0 });
  });

  test('bag-full is an atomic no-op: a full bag blocks unstash', () => {
    // First 60 rings of the grid pattern fill the 12×5 bag exactly.
    const bag = fullStashRings('bf').slice(0, 60);
    const domain = hydrateSorceressDomain({
      ...baseHydrateOpts(),
      bag,
      stash: [{ item: sampleItem({ instanceId: 'trapped', slot: 'ring', name: '困' }), x: 0, y: 0 }],
    });
    const before = domain.snapshot();
    expect(before.bag).toHaveLength(60);
    const res = domain.dispatch({ op: 'unstash-bag', index: 0, areaId: 'cinderwatch' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('bag-full');
    expect(domain.snapshot()).toEqual(before);
  });

  test('both ops refuse outside cinderwatch with not-in-camp and zero mutation', () => {
    const domain = hydrateSorceressDomain({
      ...baseHydrateOpts(),
      bag: [{ item: sampleItem({ instanceId: 'bag-wild', slot: 'ring', name: '袋' }), x: 0, y: 0 }],
      stash: [{ item: sampleItem({ instanceId: 'stash-wild', slot: 'ring', name: '仓' }), x: 0, y: 0 }],
    });
    for (const areaId of ['ashen-reach', 'slagdeep-hollow'] as const) {
      const before = domain.snapshot();
      expect(domain.dispatch({ op: 'stash-bag', index: 0, areaId })).toEqual({ ok: false, reason: 'not-in-camp' });
      expect(domain.dispatch({ op: 'unstash-bag', index: 0, areaId })).toEqual({ ok: false, reason: 'not-in-camp' });
      expect(domain.snapshot()).toEqual(before);
    }
  });

  test('out-of-range indices → bad-index (camp gate passes first)', () => {
    const domain = createSorceressDomain({ playerName: '越界' });
    expect(domain.dispatch({ op: 'stash-bag', index: 5, areaId: 'cinderwatch' })).toEqual({
      ok: false,
      reason: 'bad-index',
    });
    expect(domain.dispatch({ op: 'stash-bag', index: -1, areaId: 'cinderwatch' })).toEqual({
      ok: false,
      reason: 'bad-index',
    });
    expect(domain.dispatch({ op: 'unstash-bag', index: 0, areaId: 'cinderwatch' })).toEqual({
      ok: false,
      reason: 'bad-index',
    });
  });

  test('hydrate without stash yields an empty stash', () => {
    const domain = hydrateSorceressDomain(baseHydrateOpts());
    expect(domain.snapshot().stash).toEqual([]);
  });

  test('snapshot().stash is a deep copy — mutating it cannot touch the domain', () => {
    const domain = hydrateSorceressDomain({
      ...baseHydrateOpts(),
      stash: [{ item: sampleItem({ instanceId: 'deep-1', slot: 'gloves', name: '深' }), x: 0, y: 0 }],
    });
    const snap = domain.snapshot();
    const mutable = snap.stash as unknown as Array<{
      item: { affixes: Array<{ v: number }> };
      x: number;
    }>;
    expect(() => {
      mutable[0]!.item.affixes[0]!.v = 999;
    }).toThrow();
    expect(() => {
      mutable[0]!.x = 5;
    }).toThrow();
    const next = domain.snapshot();
    expect(next.stash[0]!.item.affixes[0]!.v).toBe(0.1);
    expect(next.stash[0]!.x).toBe(0);
    expect(next.stash[0]!.item.instanceId).toBe('deep-1');
  });
});
