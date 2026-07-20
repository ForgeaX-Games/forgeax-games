import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import {
  compareItems,
  createFrostforgedWand,
  meltGoldValue,
  type ItemInstance,
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
