import { describe, expect, test } from 'bun:test';
import {
  createDomainFromRecord,
  createSorceressDomain,
  hydrateSorceressDomain,
  projectCharacterRecord,
  type CharacterDomain,
} from './character-domain';
import { SALVAGE_YIELD } from './crafting';
import { equipSlotsFor, type ItemInstance, type ItemSlot, type Rarity } from './items';

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

/** Place `item` into the bag; returns its bag index. */
function putInBag(domain: CharacterDomain, item: ItemInstance): number {
  occupyEquipSlots(domain, item.slot, item.instanceId);
  expect(domain.dispatch({ op: 'take-item', item }).ok).toBe(true);
  const idx = domain.snapshot().bag.findIndex((i) => i?.instanceId === item.instanceId);
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
    expect(domain.snapshot().bag.some((i) => i?.instanceId === 'r-c')).toBe(true);
  });

  test('equip-from-bag with both rings filled swaps ring1; target ring2 swaps ring2', () => {
    const domain = createSorceressDomain({ playerName: '换戒' });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'r1', slot: 'ring', name: '戒1' }) });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'r2', slot: 'ring', name: '戒2' }) });
    const bagIdx = putInBag(domain, sampleItem({ instanceId: 'r3', slot: 'ring', name: '戒3' }));

    expect(domain.dispatch({ op: 'equip-from-bag', index: bagIdx }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('r3');
    expect(domain.snapshot().equipment.ring2?.instanceId).toBe('r2');
    expect(domain.snapshot().bag[bagIdx]?.instanceId).toBe('r1');

    const bagIdx2 = domain.snapshot().bag.findIndex((i) => i?.instanceId === 'r1');
    expect(domain.dispatch({ op: 'equip-from-bag', index: bagIdx2, target: 'ring2' }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('r3');
    expect(domain.snapshot().equipment.ring2?.instanceId).toBe('r1');
    expect(domain.snapshot().bag[bagIdx2]?.instanceId).toBe('r2');
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
    const bagIdx = domain.snapshot().bag.findIndex((i) => i?.instanceId === 'drag-r');
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
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'u1', slot: 'ring' }) });
    domain.dispatch({ op: 'take-item', item: sampleItem({ instanceId: 'u2', slot: 'ring' }) });
    expect(domain.dispatch({ op: 'unequip', slot: 'ring2' }).ok).toBe(true);
    expect(domain.snapshot().equipment.ring2).toBeNull();
    expect(domain.snapshot().equipment.ring1?.instanceId).toBe('u1');
    expect(domain.snapshot().bag.some((i) => i?.instanceId === 'u2')).toBe(true);
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
      expect(domain.snapshot().bag[idx]).toBeNull();
      expect(domain.snapshot().materials[key]).toBe(before[key] + SALVAGE_YIELD[key]);
    }
  });

  test('salvage-bag rejects legendary with legendary-locked; empty-slot / bad-index', () => {
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
    expect(domain.snapshot().bag[idx]?.instanceId).toBe('leg');
    expect(domain.snapshot().materials).toEqual({ common: 0, magic: 0, rare: 0 });

    expect(domain.dispatch({ op: 'salvage-bag', index: 23 })).toMatchObject({ ok: false, reason: 'empty-slot' });
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
    expect(after).not.toBeNull();
    expect(after.slot).toBe(before.slot);
    expect(after.rarity).toBe(before.rarity);
    expect(after.ilvl).toBe(before.ilvl);
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(domain.snapshot().materials.magic).toBe(0);
  });

  test('reroll-bag rejects: legendary-locked, not-enough-materials, empty-slot', () => {
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
    expect(domain.snapshot().bag[idx]?.instanceId).toBe('need-mats');

    expect(domain.dispatch({ op: 'reroll-bag', index: 22 })).toMatchObject({ ok: false, reason: 'empty-slot' });
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
    const remaining = domain.snapshot().bag.filter((i) => i && indices.includes(domain.snapshot().bag.indexOf(i)));
    // All three input cells cleared except one holds the fused result.
    const cells = indices.map((i) => domain.snapshot().bag[i]);
    const nonNull = cells.filter((c) => c !== null);
    expect(nonNull).toHaveLength(1);
    expect(nonNull[0]!.rarity).toBe('magic');
    expect(nonNull[0]!.slot).toBe('gloves');
    expect(nonNull[0]!.ilvl).toBe(5); // max ilvl
    expect(['fuse-0', 'fuse-1', 'fuse-2']).not.toContain(nonNull[0]!.instanceId);
    expect(remaining.length).toBeLessThanOrEqual(1);
  });

  test('fuse-bag rejects: bad-recipe, legendary-locked, bad-index', () => {
    const domain = createSorceressDomain({ playerName: '禁合' });
    const a = putInBag(domain, sampleItem({ instanceId: 'fa', slot: 'weapon', rarity: 'common' }));
    const b = putInBag(domain, sampleItem({ instanceId: 'fb', slot: 'helm', rarity: 'common' }));
    const c = putInBag(domain, sampleItem({ instanceId: 'fc', slot: 'weapon', rarity: 'common' }));
    expect(domain.dispatch({ op: 'fuse-bag', indices: [a, b, c] })).toMatchObject({
      ok: false,
      reason: 'bad-recipe',
    });

    const rareIdxs = [0, 1, 2].map((n) => putInBag(domain, sampleItem({
      instanceId: `rare-${n}`,
      slot: 'boots',
      rarity: 'rare',
    })));
    expect(domain.dispatch({ op: 'fuse-bag', indices: rareIdxs as [number, number, number] })).toMatchObject({
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
    expect(domain.snapshot().bag[idx]?.instanceId).toBe('leg-melt');
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
    expect(domain.snapshot().bag[idx]).toBeNull();
    expect(domain.snapshot().gold).toBeGreaterThan(0);
  });
});
