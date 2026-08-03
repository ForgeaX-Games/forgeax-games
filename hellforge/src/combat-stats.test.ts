import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import { getClassDef } from './classes';
import {
  classProgressionTotals,
  damageReductionFromDefense,
  deriveCombatStats,
} from './combat-stats';
import type { ItemInstance } from './items';

function hpItem(v: number, instanceId = 'hp-1'): ItemInstance {
  return {
    instanceId,
    slot: 'armor',
    rarity: 'magic',
    name: '血甲',
    ilvl: 1,
    reqLevel: 1,
    affixes: [{ stat: 'maxHp', v, label: `+${v} 生命上限` }],
    score: v,
  };
}

function frostWeapon(v: number): ItemInstance {
  return {
    instanceId: 'w-frost',
    slot: 'weapon',
    rarity: 'rare',
    name: '霜杖',
    ilvl: 1,
    reqLevel: 1,
    affixes: [
      { stat: 'frostDmg', v, label: `+${Math.round(v * 100)}% 霜牙伤害` },
      { stat: 'cdr', v: 0.08, label: '-8% 技能冷却' },
      { stat: 'critChance', v: 0.1, label: '+10.0% 暴击率' },
    ],
    score: 50,
  };
}

describe('deriveCombatStats', () => {
  const sorceress = getClassDef('sorceress');

  test('level-1 sorceress matches class base + empty equipment', () => {
    const domain = createSorceressDomain({ playerName: '基线' });
    const stats = deriveCombatStats({ character: domain.snapshot(), classDef: sorceress });
    const prog = classProgressionTotals(sorceress, 1);
    expect(stats.maxHp).toBe(prog.maxHp);
    expect(stats.maxMana).toBe(prog.maxMana);
    expect(stats.globalDamageMul).toBe(1);
    expect(stats.frostDamageMul).toBe(1);
    expect(stats.critChance).toBe(0.05);
    expect(stats.critMultiplier).toBe(1.5);
    expect(stats.cooldownMul).toBe(1);
    expect(stats.moveSpeed).toBe(1);
    expect(stats.manaRegen).toBe(5);
    expect(stats.damageReduction).toBe(
      damageReductionFromDefense(prog.defense, 1),
    );
  });

  test('level growth increases maxHp/maxMana and defense-driven DR', () => {
    const domain = createSorceressDomain({ playerName: '成长' });
    // Level 1 → 3 via XP (2 skill points granted).
    domain.dispatch({ op: 'grant-xp', amount: 200 });
    expect(domain.snapshot().level).toBeGreaterThanOrEqual(3);
    const level = domain.snapshot().level;
    const stats = deriveCombatStats({ character: domain.snapshot(), classDef: sorceress });
    const lv1 = classProgressionTotals(sorceress, 1);
    const prog = classProgressionTotals(sorceress, level);
    expect(stats.maxHp).toBeGreaterThan(lv1.maxHp);
    expect(stats.maxMana).toBeGreaterThan(lv1.maxMana);
    expect(stats.maxHp).toBe(prog.maxHp);
    expect(stats.damageReduction).toBe(
      damageReductionFromDefense(prog.defense, level),
    );
  });

  test('equipment affixes feed multipliers and resource caps', () => {
    const domain = createSorceressDomain({ playerName: '装备' });
    // Starter kit fills weapon/armor — free them so the test gear auto-equips.
    domain.dispatch({ op: 'unequip', slot: 'weapon' });
    domain.dispatch({ op: 'unequip', slot: 'armor' });
    domain.dispatch({ op: 'take-item', item: frostWeapon(0.2) });
    domain.dispatch({ op: 'take-item', item: hpItem(25) });
    const stats = deriveCombatStats({ character: domain.snapshot(), classDef: sorceress });
    const prog = classProgressionTotals(sorceress, 1);
    expect(stats.frostDamageMul).toBeCloseTo(1.2, 5);
    expect(stats.cooldownMul).toBeCloseTo(0.92, 5);
    expect(stats.maxHp).toBe(prog.maxHp + 25);
    expect(stats.critChance).toBeCloseTo(0.15, 5);
  });

  test('stat caps: CDR 45%, move 40%, crit 50%', () => {
    const domain = createSorceressDomain({ playerName: '上限' });
    const boots: ItemInstance = {
      instanceId: 'boots-cap',
      slot: 'boots',
      rarity: 'legendary',
      name: '疾风',
      ilvl: 1,
      reqLevel: 1,
      affixes: [
        { stat: 'moveSpd', v: 0.9, label: '+90% 移动速度' },
        { stat: 'cdr', v: 0.9, label: '-90% 技能冷却' },
        { stat: 'critChance', v: 0.8, label: '+80.0% 暴击率' },
      ],
      score: 99,
    };
    // Starter kit fills the boots slot — free it so the cap boots auto-equip.
    domain.dispatch({ op: 'unequip', slot: 'boots' });
    domain.dispatch({ op: 'take-item', item: boots });
    const stats = deriveCombatStats({ character: domain.snapshot(), classDef: sorceress });
    expect(stats.moveSpeed).toBeCloseTo(1.4, 5);
    expect(stats.cooldownMul).toBeCloseTo(0.55, 5);
    expect(stats.critChance).toBe(0.5);
  });

  test('derived CombatStats is frozen (not a writable authority)', () => {
    const domain = createSorceressDomain({ playerName: '冻结' });
    const stats = deriveCombatStats({ character: domain.snapshot(), classDef: sorceress });
    expect(Object.isFrozen(stats)).toBe(true);
    expect(() => {
      (stats as { maxHp: number }).maxHp = 9999;
    }).toThrow();
  });
});

describe('damageReductionFromDefense', () => {
  test('monotonic: more defense never increases damage taken (higher DR)', () => {
    const level = 5;
    let prev = -1;
    for (let def = 0; def <= 200; def += 5) {
      const dr = damageReductionFromDefense(def, level);
      expect(dr).toBeGreaterThanOrEqual(prev);
      prev = dr;
    }
    expect(damageReductionFromDefense(10_000, 1)).toBe(0.6);
    expect(damageReductionFromDefense(0, 1)).toBe(0);
  });

  test('higher level softens DR for the same defense', () => {
    const def = 20;
    expect(damageReductionFromDefense(def, 1)).toBeGreaterThan(
      damageReductionFromDefense(def, 20),
    );
  });
});
