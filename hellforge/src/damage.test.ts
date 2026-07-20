import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import { getClassDef } from './classes';
import { deriveCombatStats, type CombatStats } from './combat-stats';
import { preserveResourceRatio, resolveIncomingDamage } from './damage';
import type { ItemInstance } from './items';

function statsWithDr(dr: number): CombatStats {
  return {
    maxHp: 100,
    maxMana: 50,
    hpRegen: 0,
    manaRegen: 5,
    moveSpeed: 1,
    damageReduction: dr,
    globalDamageMul: 1,
    fireDamageMul: 1,
    frostDamageMul: 1,
    arcDamageMul: 1,
    critChance: 0.05,
    critMultiplier: 1.5,
    cooldownMul: 1,
    goldFind: 0,
    magicFind: 0,
    xpGain: 0,
    lifeOnKill: 0,
  };
}

describe('resolveIncomingDamage', () => {
  test('applies damage reduction', () => {
    expect(resolveIncomingDamage(100, statsWithDr(0.25))).toBe(75);
    expect(resolveIncomingDamage(100, statsWithDr(0))).toBe(100);
    expect(resolveIncomingDamage(100, statsWithDr(0.6))).toBe(40);
  });

  test('non-positive raw damage yields 0', () => {
    expect(resolveIncomingDamage(0, statsWithDr(0.3))).toBe(0);
    expect(resolveIncomingDamage(-10, statsWithDr(0.3))).toBe(0);
  });

  test('derived sorceress DR reduces monster hit', () => {
    const domain = createSorceressDomain({ playerName: '承伤' });
    const stats = deriveCombatStats({
      character: domain.snapshot(),
      classDef: getClassDef('sorceress'),
    });
    const raw = 20;
    const taken = resolveIncomingDamage(raw, stats);
    expect(taken).toBeLessThan(raw);
    expect(taken).toBeCloseTo(raw * (1 - stats.damageReduction), 5);
  });
});

describe('preserveResourceRatio', () => {
  test('keeps percentage when max rises', () => {
    expect(preserveResourceRatio(50, 100, 200)).toBe(100);
  });

  test('keeps percentage when max falls', () => {
    expect(preserveResourceRatio(80, 100, 50)).toBe(40);
  });

  test('clamps ratio to [0, 1]', () => {
    expect(preserveResourceRatio(150, 100, 80)).toBe(80);
    expect(preserveResourceRatio(-10, 100, 80)).toBe(0);
  });

  test('repeated +HP equipment swap cannot heal', () => {
    const domain = createSorceressDomain({ playerName: '换装' });
    const classDef = getClassDef('sorceress');
    let stats = deriveCombatStats({ character: domain.snapshot(), classDef });
    let hp = stats.maxHp * 0.4; // wounded
    const armor: ItemInstance = {
      instanceId: 'a1',
      slot: 'armor',
      rarity: 'magic',
      name: '血甲',
      ilvl: 1,
      reqLevel: 1,
      affixes: [{ stat: 'maxHp', v: 40, label: '+40 生命上限' }],
      score: 40,
    };

    for (let i = 0; i < 8; i++) {
      // equip
      domain.dispatch({ op: 'take-item', item: { ...armor, instanceId: `a-${i}` } });
      const nextOn = deriveCombatStats({ character: domain.snapshot(), classDef });
      hp = preserveResourceRatio(hp, stats.maxHp, nextOn.maxHp);
      stats = nextOn;
      const ratioOn = hp / stats.maxHp;

      // unequip
      domain.dispatch({ op: 'unequip', slot: 'armor' });
      const nextOff = deriveCombatStats({ character: domain.snapshot(), classDef });
      hp = preserveResourceRatio(hp, stats.maxHp, nextOff.maxHp);
      stats = nextOff;
      expect(hp / stats.maxHp).toBeCloseTo(ratioOn, 5);
    }
    expect(hp / stats.maxHp).toBeCloseTo(0.4, 5);
    expect(hp).toBeLessThan(stats.maxHp);
  });
});
