import { describe, expect, test } from 'bun:test';
import { isSkillAvailable, SKILL_NODE_BY_ACTIVE } from './skill-availability';
import { resolveSkill } from './skill-resolver';

describe('isSkillAvailable', () => {
  const frost = { id: 'frost' as const, unlockLevel: 0 };
  const magma = { id: 'magma' as const, unlockLevel: 0 };

  test('maps active skills to skill-tree nodes', () => {
    expect(SKILL_NODE_BY_ACTIVE.magma).toBe('magma-bolt');
    expect(SKILL_NODE_BY_ACTIVE.frost).toBe('frost-fang');
    expect(SKILL_NODE_BY_ACTIVE.arc).toBe('arc-surge');
    expect(SKILL_NODE_BY_ACTIVE.blink).toBe('phase-step');
  });

  test('learned active-node ranks grant cast rights (unlockLevel unused)', () => {
    expect(isSkillAvailable(frost, 1, {})).toBe(false);
    expect(isSkillAvailable(frost, 1, { 'frost-fang': 1 })).toBe(true);
    expect(isSkillAvailable(frost, 1, { 'frost-fang': 0 })).toBe(false);
  });

  test('magma stays locked without magma-bolt rank regardless of level', () => {
    expect(isSkillAvailable(magma, 1, {})).toBe(false);
    expect(isSkillAvailable(magma, 99, {})).toBe(false);
    expect(isSkillAvailable(magma, 1, { 'magma-bolt': 1 })).toBe(true);
  });
});

describe('resolveSkill tooltips (HUD/combat parity)', () => {
  test('mana/damage/pierce match tooltip source fields', () => {
    const ranks = { 'frost-fang': 3, 'piercing-ice': 1, permafrost: 1 };
    const resolved = resolveSkill('frost', { skillRanks: ranks });
    expect(resolved.tooltipLines[0]).toContain(resolved.damage.toFixed(1));
    expect(resolved.pierceCount).toBe(1);
    expect(resolved.manaCost).toBe(7);
  });
});
