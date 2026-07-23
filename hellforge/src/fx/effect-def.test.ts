import { describe, expect, test } from 'bun:test';
import {
  validateEffectDef,
  type EffectDef,
} from './effect-def';

function minimalDef(overrides: Partial<EffectDef> = {}): EffectDef {
  return {
    emitters: [
      { id: 'impact', kind: 'burst', color: 'ice', count: 6, speed: 2.6 },
    ],
    behaviors: [],
    trails: [],
    subEmitters: [],
    budget: { maxEmitters: 4, maxParticles: 64, maxTrails: 2 },
    ...overrides,
  };
}

describe('validateEffectDef', () => {
  test('valid minimal def passes', () => {
    const result = validateEffectDef(minimalDef());
    expect(result).toEqual({ ok: true });
  });

  test('missing budget fails', () => {
    const { budget: _budget, ...noBudget } = minimalDef();
    const result = validateEffectDef(noBudget);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('budget'))).toBe(true);
    }
  });

  test('over-budget emitter count fails', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'a', kind: 'burst', color: 'fire', count: 2 },
        { id: 'b', kind: 'pop', color: 'fire', count: 1 },
        { id: 'c', kind: 'rise', color: 'fire', count: 1 },
      ],
      budget: { maxEmitters: 2, maxParticles: 64, maxTrails: 2 },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maxEmitters'))).toBe(true);
    }
  });

  test('over-budget particle sum fails', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'a', kind: 'burst', color: 'lightning', count: 40 },
        { id: 'b', kind: 'burst', color: 'lightning', count: 30 },
      ],
      budget: { maxEmitters: 4, maxParticles: 50, maxTrails: 2 },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maxParticles'))).toBe(true);
    }
  });

  test('over-budget trails fails', () => {
    const result = validateEffectDef(minimalDef({
      trails: [
        { id: 't0', width: 0.1 },
        { id: 't1', width: 0.1 },
        { id: 't2', width: 0.1 },
      ],
      budget: { maxEmitters: 4, maxParticles: 64, maxTrails: 2 },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maxTrails'))).toBe(true);
    }
  });

  test('bad emitter shape fails', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        // missing kind / color / count
        { id: 'broken' } as unknown as EffectDef['emitters'][number],
      ],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('kind'))).toBe(true);
      expect(result.errors.some((e) => e.includes('color'))).toBe(true);
      expect(result.errors.some((e) => e.includes('count'))).toBe(true);
    }
  });

  test('subEmitter refs must point at emitter ids', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'parent', kind: 'burst', color: 'gold', count: 4 },
        { id: 'child', kind: 'pop', color: 'gold', count: 1 },
      ],
      subEmitters: [
        {
          id: 'spawn-child',
          parentEmitterId: 'parent',
          childEmitterId: 'missing-child',
          trigger: 'onDeath',
        },
      ],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('childEmitterId'))).toBe(true);
    }
  });

  test('valid subEmitter refs pass', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'parent', kind: 'burst', color: 'shadow', count: 4 },
        { id: 'child', kind: 'pop', color: 'shadow', count: 1, size: 0.3 },
      ],
      subEmitters: [
        {
          id: 'on-death',
          parentEmitterId: 'parent',
          childEmitterId: 'child',
          trigger: 'onDeath',
        },
        {
          id: 'at-half',
          parentEmitterId: 'parent',
          childEmitterId: 'child',
          trigger: 'atAge',
          atAge: 0.5,
        },
      ],
      customStep: 'finisherPulse',
    }));
    expect(result).toEqual({ ok: true });
  });
});
