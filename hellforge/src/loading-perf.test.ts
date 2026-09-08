import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  HF_LOADING_MARKS,
  attachLoadingPerfToHf,
  beginLoadingPerfSession,
  detachHellforgeHf,
  endLoadingPerfSession,
  markLoading,
  preserveShellHfKeys,
  scheduleFirstStableFrame,
  snapshotLoadingPerf,
} from './loading-perf';

describe('loading-perf marks', () => {
  beforeEach(() => {
    beginLoadingPerfSession();
  });
  afterEach(() => {
    endLoadingPerfSession();
    detachHellforgeHf();
  });

  test('repeated mark() does not duplicate performance marks or snapshot times', () => {
    markLoading('hf:click-gate-visible');
    const first = snapshotLoadingPerf().marks['hf:click-gate-visible']?.startTime;
    expect(first).toBeTypeOf('number');
    markLoading('hf:click-gate-visible');
    markLoading('hf:click-gate-visible');
    expect(snapshotLoadingPerf().marks['hf:click-gate-visible']?.startTime).toBe(first);
    const entries = performance.getEntriesByName('hf:click-gate-visible', 'mark');
    expect(entries.length).toBe(1);
  });

  test('Stop/Play beginLoadingPerfSession isolates marks from the previous run', () => {
    markLoading('hf:bootstrap-start');
    markLoading('hf:click-gate-visible');
    expect(snapshotLoadingPerf().marks['hf:click-gate-visible']).toBeDefined();
    const gen1 = snapshotLoadingPerf().generation;

    beginLoadingPerfSession();
    const snap = snapshotLoadingPerf();
    expect(snap.generation).toBeGreaterThan(gen1);
    expect(snap.marks['hf:click-gate-visible']).toBeUndefined();
    expect(snap.marks['hf:bootstrap-start']).toBeUndefined();
    expect(performance.getEntriesByName('hf:click-gate-visible', 'mark')).toHaveLength(0);

    markLoading('hf:bootstrap-start');
    expect(snapshotLoadingPerf().marks['hf:bootstrap-start']).toBeDefined();
    expect(snapshotLoadingPerf().marks['hf:click-gate-visible']).toBeUndefined();
  });

  test('endLoadingPerfSession ignores later mark() (late rAF after Stop)', () => {
    markLoading('hf:camp-playable');
    endLoadingPerfSession();
    markLoading('hf:first-stable-frame');
    expect(snapshotLoadingPerf().generation).toBe(0);
    expect(snapshotLoadingPerf().marks['hf:first-stable-frame']).toBeUndefined();
  });

  test('loadingPerf() is a readonly snapshot function on __hf', () => {
    attachLoadingPerfToHf();
    markLoading('hf:bootstrap-start');
    const hf = (globalThis as { __hf?: { loadingPerf?: () => { marks: unknown } } }).__hf;
    const snap = hf?.loadingPerf?.();
    expect(snap?.marks).toMatchObject({ 'hf:bootstrap-start': { startTime: expect.any(Number) } });
    expect(Object.isFrozen(HF_LOADING_MARKS)).toBe(true);
  });

  test('runtime __hf replacement keeps loadingPerf (does not clobber shell-era keys)', () => {
    attachLoadingPerfToHf();
    markLoading('hf:title-interactive');
    const runtime = {
      state: 'playing',
      get witchRoot() { return 42; },
    };
    const merged = preserveShellHfKeys(runtime as unknown as Record<string, unknown>);
    (globalThis as { __hf?: unknown }).__hf = merged;
    const hf = merged as {
      loadingPerf?: () => { marks: Record<string, unknown> };
      state?: string;
      witchRoot?: number;
    };
    expect(hf.state).toBe('playing');
    expect(hf.witchRoot).toBe(42);
    expect(hf.loadingPerf?.().marks['hf:title-interactive']).toBeDefined();
  });

  test('scheduleFirstStableFrame marks once after two rAF and is generation-gated', () => {
    markLoading('hf:camp-playable');
    const queue: Array<(t: number) => void> = [];
    const raf = (cb: (t: number) => void): number => {
      queue.push(cb);
      return queue.length;
    };
    scheduleFirstStableFrame(raf);
    expect(snapshotLoadingPerf().marks['hf:first-stable-frame']).toBeUndefined();
    queue[0]!(0);
    expect(snapshotLoadingPerf().marks['hf:first-stable-frame']).toBeUndefined();
    queue[1]!(0);
    expect(snapshotLoadingPerf().marks['hf:first-stable-frame']).toBeDefined();
    expect(
      snapshotLoadingPerf().measures.some((m) => m.name === 'hf:measure:camp-playable-to-first-stable-frame'),
    ).toBe(true);
  });

  test('source must not open a long-lived PerformanceObserver', async () => {
    const src = await Bun.file(new URL('./loading-perf.ts', import.meta.url)).text();
    expect(src).not.toMatch(/new\s+PerformanceObserver/);
  });

  test('scheduleFirstStableFrame drops in-flight rAF after Stop/Play', () => {
    markLoading('hf:camp-playable');
    const queue: Array<(t: number) => void> = [];
    const raf = (cb: (t: number) => void): number => {
      queue.push(cb);
      return queue.length;
    };
    scheduleFirstStableFrame(raf);
    beginLoadingPerfSession();
    queue[0]!(0);
    queue[1]!(0);
    expect(snapshotLoadingPerf().marks['hf:first-stable-frame']).toBeUndefined();
  });
});
