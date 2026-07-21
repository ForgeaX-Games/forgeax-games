import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import { getClassDef } from './classes';
import { deriveCombatStats } from './combat-stats';
import { buildCharacterStatGroups, buildCharacterStatRows, computeCombatPower } from './character-panel';

describe('buildCharacterStatRows', () => {
  test('rows are sourced only from CombatStats fields', () => {
    const domain = createSorceressDomain({ playerName: '试炼' });
    const stats = deriveCombatStats({
      character: domain.snapshot(),
      classDef: getClassDef('sorceress'),
    });
    const rows = buildCharacterStatRows(stats);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const byLabel = new Map(rows.map((r) => [r.label, r.value]));
    expect(byLabel.get('生命上限')).toBe(String(Math.round(stats.maxHp)));
    expect(byLabel.get('法力上限')).toBe(String(Math.round(stats.maxMana)));
    expect(byLabel.get('伤害减免')).toBe(`${(stats.damageReduction * 100).toFixed(1)}%`);
    expect(byLabel.get('暴击倍率')).toBe(`${stats.critMultiplier.toFixed(2)}×`);
    // No STR/DEX/VIT/ENERGY — skill-point progression only (Spec §3.9).
    const labels = rows.map((r) => r.label).join(' ');
    expect(labels).not.toMatch(/力量|敏捷|体力|能量|STR|DEX|VIT/);
  });
});

describe('computeCombatPower', () => {
  test('total = dps+ehp proxy + equip + level + skill contributions', () => {
    const domain = createSorceressDomain({ playerName: '战力', level: 5 });
    const stats = deriveCombatStats({
      character: domain.snapshot(),
      classDef: getClassDef('sorceress'),
    });
    const p = computeCombatPower(stats, 100, 5, 3);
    expect(p.equip).toBe(100);
    expect(p.level).toBe(40);
    expect(p.skill).toBe(36);
    const dps = stats.globalDamageMul * (1 + stats.critChance * (stats.critMultiplier - 1)) * 10;
    const ehp = (stats.maxHp / (1 - stats.damageReduction)) * 0.3;
    expect(p.total).toBe(Math.round(dps + ehp) + 100 + 40 + 36);
  });

  test('stat groups keep CombatStats-only rows in 攻击/防御/其他 buckets', () => {
    const domain = createSorceressDomain({ playerName: '分组' });
    const stats = deriveCombatStats({
      character: domain.snapshot(),
      classDef: getClassDef('sorceress'),
    });
    const groups = buildCharacterStatGroups(stats);
    expect(groups.map((g) => g.title)).toEqual(['攻击', '防御', '其他']);
    expect(groups[0]!.rows.some((r) => r.label === '暴击率')).toBe(true);
    expect(groups[1]!.rows.some((r) => r.label === '生命上限')).toBe(true);
  });
});
