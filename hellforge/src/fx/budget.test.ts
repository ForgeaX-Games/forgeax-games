import { afterEach, describe, expect, test } from 'bun:test';
import {
  assertEffectBudget,
  checkEffectBudget,
  effectExecutionDemand,
  FX_DEV_ASSERTS,
  setFxDevAsserts,
} from './budget';
import type { EffectDef, EmitterDef } from './effect-def';
import { validateEffectDef } from './effect-def';
import { COMBAT_EFFECT_DEFS, type CombatEffectId } from './defs';
import { EffectExecutor, type FxSpawnLease, type FxSpawnPort } from './executor';

const originalAsserts = FX_DEV_ASSERTS;

afterEach(() => {
  setFxDevAsserts(originalAsserts);
});

function def(overrides: Partial<EffectDef> & { emitters: readonly EmitterDef[] }): EffectDef {
  return {
    behaviors: [],
    trails: [],
    subEmitters: [],
    budget: { maxEmitters: 8, maxParticles: 128, maxTrails: 4 },
    ...overrides,
  };
}

function noopPort(): FxSpawnPort {
  const lease = (): FxSpawnLease => ({ dispose() {} });
  return {
    burst: () => lease(),
    pop: () => lease(),
    rise: () => lease(),
  };
}

const overBudget = def({
  emitters: [
    { id: 'a', kind: 'burst', color: 'lightning', count: 40 },
    { id: 'b', kind: 'burst', color: 'lightning', count: 30 },
  ],
  budget: { maxEmitters: 4, maxParticles: 50, maxTrails: 2 },
});

describe('checkEffectBudget / effectExecutionDemand', () => {
  test('in-budget def passes', () => {
    expect(checkEffectBudget(def({
      emitters: [{ id: 'a', kind: 'pop', color: 'ice', count: 3 }],
    }))).toEqual({ ok: true });
  });

  test('over-budget particle demand fails with maxParticles error', () => {
    const result = checkEffectBudget(overBudget);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maxParticles'))).toBe(true);
    }
  });

  test('sub-emitter edges charge child once each', () => {
    const slice = def({
      emitters: [
        { id: 'left', kind: 'burst', color: 'lightning', count: 1 },
        { id: 'right', kind: 'burst', color: 'lightning', count: 1 },
        { id: 'child', kind: 'pop', color: 'lightning', count: 4 },
      ],
      subEmitters: [
        {
          id: 'left-child',
          parentEmitterId: 'left',
          childEmitterId: 'child',
          trigger: 'onSpawn',
        },
        {
          id: 'right-child',
          parentEmitterId: 'right',
          childEmitterId: 'child',
          trigger: 'onSpawn',
        },
      ],
      budget: { maxEmitters: 3, maxParticles: 6, maxTrails: 0 },
    });
    expect(effectExecutionDemand(slice)).toEqual({
      emitters: 4,
      particles: 10,
      trails: 0,
    });
    const result = checkEffectBudget(slice);
    expect(result.ok).toBe(false);
  });
});

describe('assertEffectBudget', () => {
  test('over-budget def throws when FX_DEV_ASSERTS is on', () => {
    setFxDevAsserts(true);
    expect(() => assertEffectBudget(overBudget)).toThrow(/exceeds budget/);
  });

  test('over-budget def is silent when FX_DEV_ASSERTS is off', () => {
    setFxDevAsserts(false);
    expect(() => assertEffectBudget(overBudget)).not.toThrow();
  });

  test('in-budget def never throws', () => {
    setFxDevAsserts(true);
    expect(() => assertEffectBudget(def({
      emitters: [{ id: 'a', kind: 'rise', color: 'shadow', count: 2 }],
    }))).not.toThrow();
  });
});

describe('EffectExecutor.play budget paths', () => {
  test('dev asserts: over-budget play throws (no soft reject)', () => {
    setFxDevAsserts(true);
    const ex = new EffectExecutor(noopPort());
    expect(() => ex.play(overBudget, { x: 0, y: 0, z: 0 })).toThrow(/exceeds budget/);
    expect(ex.activeCount()).toBe(0);
    expect(ex.stats().budgetRejects).toBe(0);
  });

  test('production: over-budget play returns null + budgetRejects++', () => {
    setFxDevAsserts(false);
    const ex = new EffectExecutor(noopPort());
    const h = ex.play(overBudget, { x: 0, y: 0, z: 0 });
    expect(h).toBeNull();
    expect(ex.activeCount()).toBe(0);
    expect(ex.stats().budgetRejects).toBe(1);
  });
});

describe('COMBAT_EFFECT_DEFS still validate under execution demand', () => {
  const ids = Object.keys(COMBAT_EFFECT_DEFS) as CombatEffectId[];

  for (const id of ids) {
    test(`${id} passes validateEffectDef + checkEffectBudget`, () => {
      const combatDef = COMBAT_EFFECT_DEFS[id];
      expect(validateEffectDef(combatDef)).toEqual({ ok: true });
      expect(checkEffectBudget(combatDef)).toEqual({ ok: true });
    });
  }
});
