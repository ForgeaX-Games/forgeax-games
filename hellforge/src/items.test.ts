import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import {
  affixRangeFor,
  compareItems,
  computeBonus,
  createFrostforgedWand,
  emptyEquipment,
  equipSlotsFor,
  EQUIP_SLOT_ORDER,
  meltGoldValue,
  rollItem,
  SLOT_ORDER,
  type EquipSlot,
  type Item,
  type ItemInstance,
  type ItemSlot,
} from './items';
import { hydrateCharacter, serializeCharacter } from './save';

function weapon(overrides: Partial<ItemInstance> & { affixes: ItemInstance['affixes'] }): ItemInstance {
  return {
    instanceId: overrides.instanceId ?? 'w-1',
    slot: 'weapon',
    rarity: overrides.rarity ?? 'rare',
    name: overrides.name ?? '试杖',
    ilvl: overrides.ilvl ?? 2,
    reqLevel: overrides.reqLevel ?? 1,
    affixes: overrides.affixes,
    score: overrides.score ?? 10,
  };
}

describe('createFrostforgedWand', () => {
  test('deterministic recipe: name, affixes, ilvl; fresh instanceId each call', () => {
    const a = createFrostforgedWand();
    const b = createFrostforgedWand();
    expect(a.name).toBe('霜铸魔杖');
    expect(a.slot).toBe('weapon');
    expect(a.rarity).toBe('rare');
    expect(a.ilvl).toBe(4);
    expect(a.reqLevel).toBe(1);
    expect(a.affixes).toHaveLength(2);
    expect(a.affixes[0]).toMatchObject({ stat: 'frostDmg', v: 0.2 });
    expect(a.affixes[1]).toMatchObject({ stat: 'cdr', v: 0.08 });
    expect(a.affixes[0]!.label).toContain('霜牙');
    expect(a.affixes[1]!.label).toContain('冷却');
    expect(a.instanceId).not.toBe(b.instanceId);
    expect(a.instanceId.length).toBeGreaterThan(8);
  });
});

describe('compareItems', () => {
  test('empty equipped → all candidate affixes are positive gains', () => {
    const wand = createFrostforgedWand();
    const deltas = compareItems(wand, null);
    expect(deltas.length).toBe(2);
    expect(deltas.every((d) => d.polarity === 'positive')).toBe(true);
    expect(deltas.find((d) => d.stat === 'frostDmg')!.delta).toBeCloseTo(0.2, 5);
    expect(deltas.find((d) => d.stat === 'cdr')!.delta).toBeCloseTo(0.08, 5);
  });

  test('positive / negative / neutral polarities vs equipped', () => {
    const candidate = weapon({
      instanceId: 'cand',
      affixes: [
        { stat: 'frostDmg', v: 0.2, label: '+20% 霜牙伤害' },
        { stat: 'cdr', v: 0.05, label: '-5% 技能冷却' },
        { stat: 'maxHp', v: 10, label: '+10 生命上限' },
      ],
    });
    const equipped = weapon({
      instanceId: 'eq',
      affixes: [
        { stat: 'frostDmg', v: 0.1, label: '+10% 霜牙伤害' },
        { stat: 'cdr', v: 0.08, label: '-8% 技能冷却' },
        { stat: 'maxHp', v: 10, label: '+10 生命上限' },
        { stat: 'critChance', v: 0.05, label: '+5.0% 暴击率' },
      ],
    });
    const deltas = compareItems(candidate, equipped);
    const frost = deltas.find((d) => d.stat === 'frostDmg')!;
    expect(frost.polarity).toBe('positive');
    expect(frost.delta).toBeCloseTo(0.1, 5);
    const cdr = deltas.find((d) => d.stat === 'cdr')!;
    expect(cdr.polarity).toBe('negative');
    expect(cdr.delta).toBeCloseTo(-0.03, 5);
    const hp = deltas.find((d) => d.stat === 'maxHp')!;
    expect(hp.polarity).toBe('neutral');
    expect(hp.delta).toBe(0);
    const crit = deltas.find((d) => d.stat === 'critChance')!;
    expect(crit.polarity).toBe('negative');
    expect(crit.delta).toBeCloseTo(-0.05, 5);
  });
});

describe('item instance persistence', () => {
  test('stable instanceId survives v1 save round trip (equipment + bag)', () => {
    const domain = createSorceressDomain({ playerName: '存档', id: 'persist-1' });
    const wand = createFrostforgedWand();
    const bagFiller = weapon({
      instanceId: 'bag-stable-42',
      name: '背包杖',
      affixes: [{ stat: 'dmgPct', v: 0.1, label: '+10% 伤害' }],
    });
    // First take equips into empty weapon slot; second goes to bag.
    domain.dispatch({ op: 'take-item', item: wand });
    domain.dispatch({ op: 'take-item', item: bagFiller });
    const before = domain.snapshot();
    expect(before.equipment.weapon?.instanceId).toBe(wand.instanceId);
    expect(before.bag.some((i) => i?.instanceId === 'bag-stable-42')).toBe(true);

    const env = serializeCharacter(before);
    const restored = hydrateCharacter(env).snapshot();
    expect(restored.equipment.weapon?.instanceId).toBe(wand.instanceId);
    expect(restored.equipment.weapon?.name).toBe('霜铸魔杖');
    expect(restored.equipment.weapon?.affixes).toEqual(wand.affixes);
    expect(restored.bag.find((i) => i?.instanceId === 'bag-stable-42')?.name).toBe('背包杖');
  });
});

describe('meltGoldValue', () => {
  test('scales with rarity and ilvl', () => {
    const common = weapon({
      rarity: 'common',
      ilvl: 1,
      affixes: [{ stat: 'maxHp', v: 1, label: '+1' }],
    });
    const rare = weapon({
      rarity: 'rare',
      ilvl: 4,
      affixes: [{ stat: 'maxHp', v: 1, label: '+1' }],
    });
    expect(meltGoldValue(common)).toBe(5);
    expect(meltGoldValue(rare)).toBe(29);
  });
});

describe('affixRangeFor (Exile-UI tooltip ranges)', () => {
  test('magic item range = def lo/hi × ilvlScale(ilvl)', () => {
    const item: Item = {
      slot: 'weapon', rarity: 'magic', name: '测试杖', ilvl: 3, reqLevel: 1,
      affixes: [{ stat: 'dmgPct', v: 0.1, label: '+10% 伤害' }], score: 10,
    };
    // dmgPct def 0.06–0.15 × 1.24 → 7–19%
    expect(affixRangeFor(item, 0)).toBe('7–19%');
  });

  test('common implicit uses the weaker pool (ilvl-2 × 0.45)', () => {
    const item: Item = {
      slot: 'armor', rarity: 'common', name: '灰布袍', ilvl: 3, reqLevel: 1,
      affixes: [{ stat: 'maxHp', v: 5, label: '+5 生命上限' }], score: 5,
    };
    // maxHp def 8–20 × ilvlScale(1)=1 × 0.45 → 4–9
    expect(affixRangeFor(item, 0)).toBe('4–9');
  });

  test('legendary curated affix ranges come from LEGENDARIES', () => {
    const item: Item = {
      slot: 'weapon', rarity: 'legendary', name: '熔渣之杖', ilvl: 5, reqLevel: 4,
      affixes: [
        { stat: 'dmgPct', v: 0.2, label: '+20% 伤害' },
        { stat: 'fireDmg', v: 0.3, label: '+30% 熔火弹伤害' },
      ],
      score: 50, legendary: 'slag-staff',
    };
    // slag-staff dmgPct 0.16–0.24 × ilvlScale(5)=1.48 → 24–36%
    expect(affixRangeFor(item, 0)).toBe('24–36%');
  });

  test('out-of-range index → null', () => {
    const item: Item = {
      slot: 'ring', rarity: 'magic', name: '铜环', ilvl: 1, reqLevel: 1, affixes: [], score: 0,
    };
    expect(affixRangeFor(item, 3)).toBeNull();
  });
});

describe('PR10 T1 slot model (6→10)', () => {
  test("equipSlotsFor('ring') → ['ring1','ring2']; identity otherwise", () => {
    expect(equipSlotsFor('ring')).toEqual(['ring1', 'ring2']);
    expect(equipSlotsFor('weapon')).toEqual(['weapon']);
    expect(equipSlotsFor('gloves')).toEqual(['gloves']);
    expect(equipSlotsFor('belt')).toEqual(['belt']);
    expect(equipSlotsFor('offhand')).toEqual(['offhand']);
  });

  test('emptyEquipment has ten null EquipSlot keys', () => {
    expect(EQUIP_SLOT_ORDER).toHaveLength(10);
    const eq = emptyEquipment();
    for (const slot of EQUIP_SLOT_ORDER) {
      expect(eq[slot]).toBeNull();
    }
    expect(Object.keys(eq).sort()).toEqual([...EQUIP_SLOT_ORDER].sort());
  });

  test('computeBonus sums affixes across all ten equip slots', () => {
    const eq = emptyEquipment();
    const stub = (slot: ItemSlot, instanceId: string): ItemInstance => ({
      instanceId,
      slot,
      rarity: 'magic',
      name: 'stub',
      ilvl: 1,
      reqLevel: 1,
      affixes: [{ stat: 'maxHp', v: 1, label: '+1 生命上限' }],
      score: 1,
    });
    const fill: Array<[EquipSlot, ItemSlot]> = [
      ['weapon', 'weapon'],
      ['helm', 'helm'],
      ['armor', 'armor'],
      ['boots', 'boots'],
      ['amulet', 'amulet'],
      ['gloves', 'gloves'],
      ['belt', 'belt'],
      ['ring1', 'ring'],
      ['ring2', 'ring'],
      ['offhand', 'offhand'],
    ];
    for (const [eqSlot, itemSlot] of fill) {
      eq[eqSlot] = stub(itemSlot, eqSlot);
    }
    expect(computeBonus(eq).maxHp).toBe(10);
  });

  test('rollItem produces gloves/belt/offhand over a seeded draw sample', () => {
    expect(SLOT_ORDER).toEqual(expect.arrayContaining(['gloves', 'belt', 'offhand']));

    const seen = new Set<ItemSlot>();
    const orig = Math.random;
    try {
      for (let idx = 0; idx < SLOT_ORDER.length; idx++) {
        let n = 0;
        Math.random = () => {
          n += 1;
          // First draw picks SLOT_ORDER[idx]; later draws stay in-range for affixes.
          if (n === 1) return (idx + 0.5) / SLOT_ORDER.length;
          return 0.5;
        };
        seen.add(rollItem('common', 1).slot);
      }
    } finally {
      Math.random = orig;
    }
    expect(seen.has('gloves')).toBe(true);
    expect(seen.has('belt')).toBe(true);
    expect(seen.has('offhand')).toBe(true);

    expect(rollItem('magic', 1, 'gloves').name).toContain('布手套');
    expect(rollItem('magic', 4, 'belt').name).toContain('铁');
    expect(rollItem('magic', 7, 'offhand').name).toContain('法器');
  });
});
