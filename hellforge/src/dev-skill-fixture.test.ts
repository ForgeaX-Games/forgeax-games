import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import { SKILL_NODE_IDS } from './content-ids';
import {
  FIXTURE_BRANCH,
  fixtureProgression,
  HF_SKILL_FIXTURE_PARAM,
  isSkillFixtureEnabled,
} from './dev-skill-fixture';
import { getSkillNode, nodesForBranch, totalPaidRanks } from './skill-tree';

describe('dev skill fixture', () => {
  test('fixture progression maxes the Flame branch for video / stills', () => {
    const fix = fixtureProgression();
    expect(FIXTURE_BRANCH).toBe('flame');
    const flame = nodesForBranch('flame');
    expect(flame).toHaveLength(11);
    for (const node of flame) {
      expect(fix.skillRanks[node.id]).toBe(getSkillNode(node.id).maxRank);
    }
    // Other branches stay at free starters only.
    expect(fix.skillRanks['frost-fang']).toBe(1);
    expect(fix.skillRanks['frost-nova']).toBe(0);
    expect(fix.skillRanks['arc-surge']).toBe(0);
    expect(fix.skillRanks.discharge).toBe(0);
    expect(fix.unspentSkillPoints).toBe(0);
    expect(fix.level).toBe(totalPaidRanks(fix.skillRanks) + 1);
    expect(fix.level).toBeGreaterThanOrEqual(6);
    expect(fix.hotbar).toEqual(['frost', 'magma', 'flame-burst', null]);
    expect(Object.keys(fix.skillRanks)).toHaveLength(SKILL_NODE_IDS.length);
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
    expect(domain.snapshot().level).toBe(fix.level);
    expect(domain.snapshot().skillRanks['furnace-heart']).toBe(1);
    expect(domain.snapshot().skillRanks['flame-burst']).toBe(5);
    expect(domain.snapshot().hotbar[2]).toBe('flame-burst');
    expect(domain.snapshot().unspentSkillPoints).toBe(0);
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
