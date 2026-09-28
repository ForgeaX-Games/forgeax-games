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

  test('tracks explicitly supplied folded-draw samples and pool high-water marks; reset clears', () => {
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

  test('reports the .38 folded-draw metric as unavailable without probing renderer state', () => {
    const probe = createPerfProbe(4);
    probe.recordFrame(0);
    probe.recordFrame(Number.NaN);
    probe.observeFoldedDraws(undefined);
    expect(probe.snapshot().samples).toBe(0);

    let inspectCalls = 0;
    let metricCalls = 0;
    const app = {
      renderer: {
        inspect: () => {
          inspectCalls += 1;
          return { instanceCollections: [{ count: 9 }] };
        },
        metrics: {
          snapshot: () => {
            metricCalls += 1;
            return { 'render.instancing.foldedDraws': 9 };
          },
        },
      },
    };

    expect(readFoldedDraws(null)).toBeNull();
    expect(readFoldedDraws(app)).toBeNull();
    expect(inspectCalls).toBe(0);
    expect(metricCalls).toBe(0);
  });

  test('reports full duration separately from a wrapped sampling window', () => {
    const probe = createPerfProbe(2);
    probe.recordFrame(0.01);
    probe.recordFrame(0.02);
    probe.recordFrame(0.03);
    const snapshot = probe.snapshot();
    expect(snapshot.recordedFrames).toBe(3);
    expect(snapshot.recordedSeconds).toBeCloseTo(0.06);
    expect(snapshot.windowSeconds).toBeCloseTo(0.05);
    expect(snapshot.samples).toBe(2);
    probe.reset();
    expect(probe.snapshot().recordedSeconds).toBe(0);
    expect(probe.snapshot().recordedFrames).toBe(0);
  });

  test('default probe retains one minute at 144 Hz', () => {
    const probe = createPerfProbe();
    for (let i = 0; i < 8640; i++) probe.recordFrame(1 / 144);
    expect(probe.snapshot().samples).toBe(8640);
    expect(probe.snapshot().windowSeconds).toBeCloseTo(60);
  });
});
