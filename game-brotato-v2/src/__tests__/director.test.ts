import { describe, expect, it } from 'vitest';
import { SPAWN } from '../config/spawn.ts';
import {
  createDirectorState,
  resetDirector,
  stepDirector,
  tierAt,
  tierIntervalAt,
} from '../spawn/director.ts';

function collectUntil(seconds: number, live = 0): { times: number[]; batches: ReturnType<typeof stepDirector> extends readonly (infer T)[] ? T[] : never[] } {
  const state = createDirectorState();
  const times: number[] = [];
  const batches: any[] = [];
  const dt = 1 / 60;
  while (state.elapsed < seconds - 1e-9) {
    const dueAt = state.nextBatchAt;
    const next = stepDirector(state, dt, live, 0);
    if (next.length > 0) {
      times.push(dueAt);
      batches.push(...next);
    }
  }
  return { times, batches } as never;
}

describe('M2 spawn director', () => {
  it('emits the documented 19 batch times through 38 seconds', () => {
    const result = collectUntil(38);
    expect(result.times).toHaveLength(19);
    expect(result.times).toEqual([
      1, 4, 7,
      10, 12.2, 14.4, 16.6, 18.8,
      21, 22.6, 24.2, 25.8, 27.4, 29, 30.6, 32.2, 33.8, 35.4, 37,
    ]);
  });

  it('switches tiers at the exact boundaries and ramps T3 to its floor', () => {
    expect(tierAt(7.9)).toBe(0);
    expect(tierAt(8)).toBe(1);
    expect(tierAt(37.9)).toBe(2);
    expect(tierAt(38)).toBe(3);
    expect(tierIntervalAt(38)).toBeCloseTo(1.2);
    expect(tierIntervalAt(58)).toBeCloseTo(1.02);
    expect(tierIntervalAt(78)).toBeCloseTo(0.867);
    expect(tierIntervalAt(98)).toBeCloseTo(0.737);
    expect(tierIntervalAt(118)).toBeCloseTo(0.626);
    expect(tierIntervalAt(138)).toBe(0.6);
  });

  it('skips at the cap without queueing a catch-up burst', () => {
    const state = createDirectorState();
    const dt = 1 / 60;
    let output = [] as ReturnType<typeof stepDirector>;
    for (let index = 0; index < 20 * 60; index += 1) output = stepDirector(state, dt, SPAWN.cap.onScreen, 0);
    expect(state.skipped).toBeGreaterThan(0);
    expect(output).toHaveLength(0);
    let nextBatch = [] as ReturnType<typeof stepDirector>;
    while (nextBatch.length === 0) nextBatch = stepDirector(state, dt, 0, 0);
    expect(nextBatch).toHaveLength(1);
    expect(state.skipped).toBeGreaterThan(0);
  });

  it('freezes and resets deterministically', () => {
    const state = createDirectorState(17);
    state.frozen = true;
    expect(stepDirector(state, 60, 0, 0)).toHaveLength(0);
    expect(state.elapsed).toBe(0);
    resetDirector(state, 17);
    const first = collectUntil(12);
    const second = collectUntil(12);
    expect(first.times).toEqual(second.times);
    expect(first.batches).toEqual(second.batches);
  });
});
