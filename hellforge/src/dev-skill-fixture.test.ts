import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import {
  fixtureProgression,
  HF_SKILL_FIXTURE_PARAM,
  isSkillFixtureEnabled,
} from './dev-skill-fixture';

describe('dev skill fixture', () => {
  test('fixture progression is level 10 with 9 points and free Frost Fang', () => {
    const fix = fixtureProgression();
    expect(fix.level).toBe(10);
    expect(fix.unspentSkillPoints).toBe(9);
    expect(fix.skillRanks['frost-fang']).toBe(1);
    expect(fix.hotbar).toEqual(['frost', 'magma', null, null]);
    expect(fix.skillRanks['magma-bolt']).toBe(1);
  });

  test('query param constant is hfSkillFixture', () => {
    expect(HF_SKILL_FIXTURE_PARAM).toBe('hfSkillFixture');
  });

  test('isSkillFixtureEnabled is false without ?hfSkillFixture=1', () => {
    // Without a matching location search, gate stays closed even in DEV.
    const prev = globalThis.location;
    try {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { search: '' },
      });
      expect(isSkillFixtureEnabled()).toBe(false);
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { search: '?hfSkillFixture=1' },
      });
      // Still requires import.meta.env.DEV — in bun test DEV is typically true.
      if (import.meta.env.DEV) {
        expect(isSkillFixtureEnabled()).toBe(true);
      }
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: prev,
      });
    }
  });

  test('dev-set-progression round-trips through the domain', () => {
    const domain = createSorceressDomain({ playerName: 'Fixture' });
    const before = domain.snapshot();
    expect(before.level).toBe(1);
    const fix = fixtureProgression();
    const res = domain.dispatch({ op: 'dev-set-progression', ...fix });
    expect(res.ok).toBe(true);
    expect(domain.snapshot().level).toBe(10);
    expect(domain.snapshot().unspentSkillPoints).toBe(9);
    domain.dispatch({
      op: 'dev-set-progression',
      level: before.level,
      xp: before.xp,
      unspentSkillPoints: before.unspentSkillPoints,
      skillRanks: before.skillRanks as typeof fix.skillRanks,
      hotbar: before.hotbar,
      selectedHotbarSlot: before.selectedHotbarSlot,
    });
    expect(domain.snapshot().level).toBe(1);
  });
});
