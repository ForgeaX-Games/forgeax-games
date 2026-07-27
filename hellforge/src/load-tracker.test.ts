import { describe, expect, test } from 'bun:test';
import { LoadTracker } from './load-tracker';

describe('LoadTracker (PR11 T2)', () => {
  test('empty tracker reports 0', () => {
    const t = new LoadTracker();
    expect(t.fraction()).toBe(0);
    expect(t.snapshot()).toEqual({ fraction: 0, totalItems: 0, doneItems: 0 });
  });

  test('count-based weighting: fraction = done/total items', () => {
    const t = new LoadTracker();
    t.register('a', 3).register('b', 1); // 4 items, weight 1 each
    expect(t.fraction()).toBe(0);
    t.complete('a'); // 1/4
    expect(t.fraction()).toBeCloseTo(0.25, 5);
    t.complete('a', 2); // 3/4
    expect(t.fraction()).toBeCloseTo(0.75, 5);
    t.complete('b'); // 4/4
    expect(t.fraction()).toBe(1);
  });

  test('byte weighting: heavier phase dominates the fraction', () => {
    const t = new LoadTracker();
    t.register('big', 1, 90).register('small', 1, 10);
    t.complete('small'); // 10/100
    expect(t.fraction()).toBeCloseTo(0.1, 5);
    t.complete('big'); // 100/100
    expect(t.fraction()).toBe(1);
  });

  test('complete is clamped to the registered item count', () => {
    const t = new LoadTracker();
    t.register('a', 2);
    t.complete('a', 99);
    expect(t.fraction()).toBe(1);
    expect(t.snapshot().doneItems).toBe(2);
  });

  test('complete on an unknown phase is a tolerated no-op', () => {
    const t = new LoadTracker();
    t.register('a', 1);
    expect(() => t.complete('nope')).not.toThrow();
    expect(t.fraction()).toBe(0);
  });

  test('duplicate phase registration throws (wiring bug)', () => {
    const t = new LoadTracker();
    t.register('a', 1);
    expect(() => t.register('a', 1)).toThrow();
  });

  test('invalid register args throw', () => {
    const t = new LoadTracker();
    expect(() => t.register('a', 0)).toThrow();
    expect(() => t.register('b', 1, 0)).toThrow();
  });

  test('onChange is monotonic: fires only on increase, never on stall/decrease', () => {
    const t = new LoadTracker();
    t.register('a', 2).register('b', 2);
    const seen: number[] = [];
    t.onChange((f) => seen.push(f));
    t.complete('a'); // 0.25
    t.complete('a'); // 0.5
    t.completePhase('a'); // still 0.5 — no new fire (already there)
    t.complete('b'); // 0.75
    t.complete('b'); // 1.0
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });

  test('reaches exactly 1.0 when every phase completes (100%-on-hide invariant)', () => {
    const t = new LoadTracker();
    t.register('hero', 7).register('veyra', 2).register('ready', 1);
    t.completePhase('hero');
    t.completePhase('veyra');
    expect(t.fraction()).toBeLessThan(1);
    t.complete('ready'); // final item right before the cover hides
    expect(t.fraction()).toBe(1);
  });

  test('unsubscribe stops further notifications', () => {
    const t = new LoadTracker();
    t.register('a', 2);
    const seen: number[] = [];
    const off = t.onChange((f) => seen.push(f));
    t.complete('a');
    off();
    t.complete('a');
    expect(seen).toEqual([0.5]);
  });
});
