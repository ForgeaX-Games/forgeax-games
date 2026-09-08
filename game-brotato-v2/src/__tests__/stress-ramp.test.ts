import { describe, expect, it } from 'vitest';
import { stepStressRamp } from '../stress/ramp.ts';

const input = (overrides: Partial<Parameters<typeof stepStressRamp>[0]> = {}) => ({
  elapsed: 0,
  frozenAt: undefined,
  liveEnemies: 0,
  availableSlots: 100,
  ...overrides,
});

describe('Brotato v2 stress ramp', () => {
  it('starts at the authored target', () => {
    expect(stepStressRamp(input())).toMatchObject({ targetEnemies: 8 });
  });

  it('rises at six enemies per second', () => {
    expect(stepStressRamp(input({ elapsed: 10 })).targetEnemies).toBe(68);
    expect(stepStressRamp(input({ elapsed: 30 })).targetEnemies).toBe(188);
  });

  it('stops at the hard cap', () => {
    expect(stepStressRamp(input({ elapsed: 1000 })).targetEnemies).toBe(600);
    expect(stepStressRamp(input({ elapsed: 1001 })).targetEnemies).toBe(600);
  });

  it('holds the target at the freeze timestamp', () => {
    for (const elapsed of [20, 50, 200]) {
      expect(stepStressRamp(input({ elapsed, frozenAt: 20 })).targetEnemies).toBe(128);
    }
  });

  it('limits a healthy pool to the per-tick spawn budget', () => {
    expect(stepStressRamp(input({ elapsed: 20, liveEnemies: 100, availableSlots: 50 }))).toEqual({
      targetEnemies: 128,
      spawnCount: 12,
      capacityShortfall: 0,
    });
  });

  it('never asks the ramp to remove enemies', () => {
    expect(stepStressRamp(input({ elapsed: 20, liveEnemies: 300 }))).toMatchObject({ spawnCount: 0, capacityShortfall: 0 });
  });

  it('reports pool shortfall when available slots are insufficient', () => {
    expect(stepStressRamp(input({ elapsed: 20, liveEnemies: 100, availableSlots: 10 }))).toMatchObject({
      spawnCount: 10,
      capacityShortfall: 2,
    });
  });

  it('accepts only immediately reusable slots from a dying-aware caller', () => {
    expect(stepStressRamp(input({ elapsed: 20, liveEnemies: 100, availableSlots: 8 }))).toMatchObject({
      spawnCount: 8,
      capacityShortfall: 4,
    });
  });

  it('is deterministic for identical inputs', () => {
    const first = stepStressRamp(input({ elapsed: 42, liveEnemies: 17, availableSlots: 3 }));
    const second = stepStressRamp(input({ elapsed: 42, liveEnemies: 17, availableSlots: 3 }));
    expect(second).toEqual(first);
  });
});
