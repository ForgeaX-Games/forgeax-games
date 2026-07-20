import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import { getClassDef } from './classes';
import { deriveCombatStats } from './combat-stats';
import { buildCharacterStatRows } from './character-panel';

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
