import { describe, expect, test } from 'bun:test';
import { createSorceressDomain } from './character-domain';
import {
  createCombatRunDomain,
  deriveAreaSeed,
  resetCombatRun,
  type CombatRunSnapshot,
  type CombatTransientResetters,
  type PlayerRuntimeState,
} from './combat-run';
import { acceptQuest, markQuestReady, PURGE_QUEST_ID } from './quests';

function mockRuntime(overrides: Partial<PlayerRuntimeState> = {}): PlayerRuntimeState {
  return {
    hp: 10,
    maxHp: 100,
    mana: 5,
    maxMana: 80,
    dead: true,
    hurtCooldown: 0,
    ...overrides,
  };
}

describe('deriveAreaSeed', () => {
  test('stable FNV-1a vectors', () => {
    const a = deriveAreaSeed('char-1', 'purge-slagdeep-hollow', 'slagdeep-hollow');
    const b = deriveAreaSeed('char-1', 'purge-slagdeep-hollow', 'slagdeep-hollow');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    // Different inputs → different seeds
    expect(deriveAreaSeed('char-2', 'purge-slagdeep-hollow', 'slagdeep-hollow')).not.toBe(a);
    expect(deriveAreaSeed('char-1', 'purge-slagdeep-hollow', 'ashen-reach')).not.toBe(a);
    // Fixed vector — reload derives the same seed without a saved duplicate
    expect(deriveAreaSeed('abc', 'purge-slagdeep-hollow', 'slagdeep-hollow')).toBe(0xad137bf9);
  });
});

describe('CombatRunDomain', () => {
  test('enter derives seed; mark-objective; both → objectivesMet', () => {
    const run = createCombatRunDomain();
    run.dispatch({
      op: 'enter',
      areaId: 'slagdeep-hollow',
      characterId: 'hero-42',
    });
    const snap = run.snapshot();
    expect(snap.areaId).toBe('slagdeep-hollow');
    expect(snap.areaSeed).toBe(
      deriveAreaSeed('hero-42', 'purge-slagdeep-hollow', 'slagdeep-hollow'),
    );
    expect(snap.objectives['den-minions-cleared']).toBe(false);
    expect(snap.objectives['slagdeep-boss-defeated']).toBe(false);
    expect(run.objectivesMet()).toBe(false);

    run.dispatch({ op: 'mark-objective', id: 'den-minions-cleared' });
    expect(run.objectivesMet()).toBe(false);
    run.dispatch({ op: 'mark-objective', id: 'slagdeep-boss-defeated' });
    expect(run.objectivesMet()).toBe(true);
  });

  test('reset clears flags but preserves area and seed', () => {
    const run = createCombatRunDomain();
    run.dispatch({
      op: 'enter',
      areaId: 'slagdeep-hollow',
      characterId: 'hero-42',
    });
    run.dispatch({ op: 'mark-objective', id: 'den-minions-cleared' });
    run.dispatch({ op: 'mark-objective', id: 'slagdeep-boss-defeated' });
    const before = run.snapshot();
    run.dispatch({ op: 'reset' });
    const after = run.snapshot();
    expect(after.areaId).toBe(before.areaId);
    expect(after.areaSeed).toBe(before.areaSeed);
    expect(after.objectives['den-minions-cleared']).toBe(false);
    expect(after.objectives['slagdeep-boss-defeated']).toBe(false);
    expect(run.objectivesMet()).toBe(false);
  });

  test('snapshot is detached / frozen in test builds', () => {
    const run = createCombatRunDomain();
    run.dispatch({
      op: 'enter',
      areaId: 'ashen-reach',
      characterId: 'x',
    });
    const snap = run.snapshot() as CombatRunSnapshot & {
      objectives: { 'den-minions-cleared': boolean };
    };
    expect(() => {
      (snap as { areaSeed: number }).areaSeed = 999;
    }).toThrow();
    expect(run.snapshot().areaSeed).not.toBe(999);
  });
});

describe('resetCombatRun', () => {
  test('preserves character progression and resets active objectives', () => {
    const character = createSorceressDomain({ playerName: 'D', id: 'dead-1' });
    acceptQuest(character);
    character.dispatch({ op: 'grant-xp', amount: 50 });
    character.dispatch({ op: 'add-gold', amount: 40 });
    const before = character.snapshot();

    const run = createCombatRunDomain();
    run.dispatch({
      op: 'enter',
      areaId: 'slagdeep-hollow',
      characterId: 'dead-1',
    });
    const seed = run.snapshot().areaSeed;
    run.dispatch({ op: 'mark-objective', id: 'den-minions-cleared' });

    const runtime = mockRuntime({ hp: 1, mana: 2, dead: true });

    const resetLog: string[] = [];
    let lastReset: { areaId: string; seed: number } | null = null;
    const resetters: CombatTransientResetters = {
      encounters: {
        clear: () => { resetLog.push('enc.clear'); },
        reset: (areaId, s) => {
          resetLog.push('enc.reset');
          lastReset = { areaId, seed: s };
        },
      },
      enemyAttacks: { clear: () => { resetLog.push('attacks.clear'); } },
      playerSkills: { clearProjectilesAndCooldowns: () => { resetLog.push('skills.clear'); } },
      loot: { clearGroundDrops: () => { resetLog.push('loot.clear'); } },
      fx: { clearTransient: () => { resetLog.push('fx.clear'); } },
    };

    let camped = false;
    const after = resetCombatRun({
      failedAreaId: 'slagdeep-hollow',
      character,
      run,
      runtime,
      resetters,
      returnToCamp: () => {
        camped = true;
        return { areaId: 'cinderwatch', entryId: 'camp-center', playerPos: [0, 5] };
      },
    });

    const snap = character.snapshot();
    expect(snap.identity.id).toBe(before.identity.id);
    expect(snap.level).toBe(before.level);
    expect(snap.xp).toBe(before.xp);
    expect(snap.gold).toBe(before.gold);
    expect(snap.quests[PURGE_QUEST_ID].status).toBe('active');
    expect(after.areaSeed).toBe(seed);
    expect(after.objectives['den-minions-cleared']).toBe(false);
    expect(after.objectives['slagdeep-boss-defeated']).toBe(false);
    expect(runtime.dead).toBe(false);
    expect(runtime.hp).toBe(runtime.maxHp);
    expect(runtime.mana).toBe(runtime.maxMana);
    expect(camped).toBe(true);
    expect(lastReset).toEqual({ areaId: 'slagdeep-hollow', seed });
    expect(resetLog).toEqual([
      'enc.clear', 'attacks.clear', 'skills.clear', 'loot.clear', 'fx.clear', 'enc.reset',
    ]);
  });

  test('ready quest keeps status; objectives not force-cleared via run.reset', () => {
    const character = createSorceressDomain({ playerName: 'R', id: 'ready-1' });
    acceptQuest(character);
    markQuestReady(character);
    const run = createCombatRunDomain();
    run.dispatch({
      op: 'enter',
      areaId: 'ashen-reach',
      characterId: 'ready-1',
    });
    // Simulate leftover flags that should not be wiped by run.reset when ready
    run.dispatch({ op: 'mark-objective', id: 'den-minions-cleared' });
    const seedBefore = run.snapshot().areaSeed;

    resetCombatRun({
      failedAreaId: 'ashen-reach',
      character,
      run,
      runtime: mockRuntime(),
      resetters: {
        encounters: { clear: () => {}, reset: () => {} },
        enemyAttacks: { clear: () => {} },
        playerSkills: { clearProjectilesAndCooldowns: () => {} },
        loot: { clearGroundDrops: () => {} },
        fx: { clearTransient: () => {} },
      },
      returnToCamp: () => ({ areaId: 'cinderwatch', entryId: 'camp-center', playerPos: [0, 5] }),
    });

    expect(character.snapshot().quests[PURGE_QUEST_ID].status).toBe('ready');
    // When not active, run.reset is skipped — flags may remain; seed preserved.
    expect(run.snapshot().areaSeed).toBe(seedBefore);
    expect(run.snapshot().objectives['den-minions-cleared']).toBe(true);
  });
});
