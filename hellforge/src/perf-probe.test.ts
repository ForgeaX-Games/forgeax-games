import { describe, expect, test } from 'bun:test';
import { createPerfProbe, readFoldedDraws } from './perf-probe';

describe('createPerfProbe', () => {
  test('median and p95 from recorded frame times', () => {
    const probe = createPerfProbe(32);
    // 10 frames: 10..19 ms
    for (let i = 10; i <= 19; i += 1) probe.recordFrame(i / 1000);
    const snap = probe.snapshot();
    expect(snap.samples).toBe(10);
    expect(snap.medianMs).toBeCloseTo(14.5, 5);
    expect(snap.p95Ms).toBe(19);
    expect(snap.meanMs).toBeCloseTo(14.5, 5);
  });

  test('tracks foldedDraws and pool high-water marks; reset clears', () => {
    const probe = createPerfProbe(8);
    probe.observeFoldedDraws(3);
    probe.observeFoldedDraws(7);
    probe.observeFoldedDraws(2);
    probe.observePools({ projectiles: 4, particles: 12 });
    probe.observePools({ projectiles: 2, particles: 20 });
    let snap = probe.snapshot();
    expect(snap.foldedDrawsPeak).toBe(7);
    expect(snap.foldedDrawsLast).toBe(2);
    expect(snap.pools).toEqual({ projectiles: 4, particles: 20 });
    probe.reset();
    snap = probe.snapshot();
    expect(snap.samples).toBe(0);
    expect(snap.foldedDrawsPeak).toBeNull();
    expect(snap.pools).toEqual({});
  });

  test('ignores non-finite dt and unread metrics', () => {
    const probe = createPerfProbe(4);
    probe.recordFrame(0);
    probe.recordFrame(Number.NaN);
    probe.observeFoldedDraws(undefined);
    expect(probe.snapshot().samples).toBe(0);
    expect(readFoldedDraws(null)).toBeNull();
    expect(readFoldedDraws({ renderer: { metrics: { snapshot: () => ({ 'render.instancing.foldedDraws': 9 }) } } })).toBe(9);
  });
});
