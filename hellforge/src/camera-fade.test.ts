import { describe, expect, test } from 'bun:test';
import {
  FADE_IN_RATE,
  FADE_OUT_RATE,
  blockerIdFromEntityName,
  buildCampFadeRegistry,
  createFadeDriver,
  fadeWeight,
  playerCapsuleAabb,
  selectBlockersNeedingFade,
  xzAabbOverlapAmount,
  type FadeAabb2,
  type FadeBlockerEntry,
} from './camera-fade';
import type { ProbeBlocker } from './camera-probe';

describe('xzAabbOverlapAmount', () => {
  test('returns 0 when rectangles are separated', () => {
    const a: FadeAabb2 = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const b: FadeAabb2 = { minX: 3, maxX: 5, minZ: -1, maxZ: 1 };
    expect(xzAabbOverlapAmount(a, b)).toBe(0);
  });

  test('returns positive amount when rectangles overlap', () => {
    const a: FadeAabb2 = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const b: FadeAabb2 = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 };
    expect(xzAabbOverlapAmount(a, b)).toBeGreaterThan(0);
    expect(xzAabbOverlapAmount(a, b)).toBeLessThanOrEqual(1);
  });

  test('returns 1 when one fully contains the other', () => {
    const outer: FadeAabb2 = { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
    const inner: FadeAabb2 = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    expect(xzAabbOverlapAmount(inner, outer)).toBe(1);
  });
});

describe('fadeWeight', () => {
  test('ramps toward 1 while overlapping (no pop)', () => {
    let w = 0;
    w = fadeWeight(1, 1 / 60, w);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(1);
    for (let i = 0; i < 120; i++) w = fadeWeight(1, 1 / 60, w);
    expect(w).toBeCloseTo(1, 2);
  });

  test('ramps toward 0 when clear (no pop)', () => {
    let w = 1;
    w = fadeWeight(0, 1 / 60, w);
    expect(w).toBeLessThan(1);
    expect(w).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) w = fadeWeight(0, 1 / 60, w);
    expect(w).toBeCloseTo(0, 2);
  });

  test('uses documented ramp rates', () => {
    expect(FADE_IN_RATE).toBeGreaterThan(0);
    expect(FADE_OUT_RATE).toBeGreaterThan(0);
    const stepIn = fadeWeight(1, 0.1, 0);
    expect(stepIn).toBeCloseTo(Math.min(1, FADE_IN_RATE * 0.1), 5);
    const stepOut = fadeWeight(0, 0.1, 1);
    expect(stepOut).toBeCloseTo(Math.max(0, 1 - FADE_OUT_RATE * 0.1), 5);
  });
});

describe('blockerIdFromEntityName', () => {
  test('maps hut tile names to obstacle labels', () => {
    expect(blockerIdFromEntityName('Hut1_Roof__t0', ['Hut1', 'Hut2'])).toBe('Hut1');
    expect(blockerIdFromEntityName('Hut2_Wall_N__t1', ['Hut1', 'Hut2'])).toBe('Hut2');
  });

  test('ignores unrelated names', () => {
    expect(blockerIdFromEntityName('CampfireRing', ['Hut1'])).toBeNull();
    expect(blockerIdFromEntityName('TorchHut1_Post', ['Hut1'])).toBeNull();
  });
});

describe('buildCampFadeRegistry', () => {
  test('registers hut aabb blockers and leaves an extension point map', () => {
    const blockers: ProbeBlocker[] = [
      { type: 'aabb', label: 'Hut1', min: [-8.3, -10.15], max: [-3.7, -5.55], probeHeight: 3.5 },
      { type: 'aabb', label: 'FenceW', min: [-11.5, -2.7], max: [-11.1, 9.3] },
      { type: 'polygon', label: 'Weird', points: [[0, 0], [1, 0], [1, 1]] },
    ];
    const names = [
      { localId: 10, name: 'Hut1_Wall_N__t0' },
      { localId: 11, name: 'Hut1_Roof__t0' },
      { localId: 20, name: 'FenceW1__t0' },
    ];
    const reg = buildCampFadeRegistry(blockers, names);
    expect(reg.has('Hut1')).toBe(true);
    expect(reg.get('Hut1')!.entityLocalIds).toEqual([10, 11]);
    expect(reg.get('Hut1')!.aabb).toEqual({
      minX: -8.3, maxX: -3.7, minZ: -10.15, maxZ: -5.55,
    });
    // Fence is optional foreground; default camp registry keeps hut/mountain-class only.
    expect(reg.has('FenceW')).toBe(false);
    expect(reg.has('Weird')).toBe(false);
  });
});

describe('selectBlockersNeedingFade', () => {
  test('selects blockers that still occlude the eye→player segment after contraction', () => {
    const entries: FadeBlockerEntry[] = [
      {
        blockerId: 'Hut1',
        entityLocalIds: [1],
        aabb: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
        height: 3,
      },
    ];
    // Player may stand in footprint; eye on +Z looking through hut.
    const needs = selectBlockersNeedingFade(entries, {
      eye: [0, 1.5, 6],
      playerPos: [0, 1.0, 0.2],
    });
    expect([...needs]).toContain('Hut1');
  });

  test('selects when player is outside hut but contracted eye→player still hits blocker', () => {
    const entries: FadeBlockerEntry[] = [
      {
        blockerId: 'Hut1',
        entityLocalIds: [1],
        aabb: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
        height: 3,
      },
    ];
    // Player south of hut (no footprint overlap); eye north — segment crosses hut.
    const playerOutside = playerCapsuleAabb(0, 4.5, 0.35);
    expect(xzAabbOverlapAmount(playerOutside, entries[0]!.aabb)).toBe(0);
    const needs = selectBlockersNeedingFade(entries, {
      eye: [0, 1.5, -5],
      playerPos: [0, 1.0, 4.5],
    });
    expect([...needs]).toContain('Hut1');
  });

  test('skips blockers that miss the eye→player segment', () => {
    const entries: FadeBlockerEntry[] = [
      {
        blockerId: 'Hut1',
        entityLocalIds: [1],
        aabb: { minX: -8, maxX: -4, minZ: -10, maxZ: -6 },
        height: 3,
      },
    ];
    const needs = selectBlockersNeedingFade(entries, {
      eye: [0, 1.5, 8],
      playerPos: [0, 1.0, 0],
    });
    expect(needs.size).toBe(0);
  });
});

describe('createFadeDriver', () => {
  test('updates registered prop alpha via callback with ramped weights', () => {
    const applied: Array<{ id: string; alpha: number }> = [];
    const driver = createFadeDriver({
      blockerIds: ['Hut1', 'Hut2'],
      setAlpha: (id, alpha) => {
        applied.push({ id, alpha });
      },
    });
    driver.update(new Set(['Hut1']), 0.05);
    expect(driver.weight('Hut1')).toBeGreaterThan(0);
    expect(driver.weight('Hut2')).toBe(0);
    const hut1Alpha = applied.find((a) => a.id === 'Hut1')?.alpha;
    expect(hut1Alpha).toBeDefined();
    expect(hut1Alpha!).toBeLessThan(1);
    expect(hut1Alpha!).toBeGreaterThan(0);
    // Clear → restore toward opaque.
    applied.length = 0;
    for (let i = 0; i < 80; i++) driver.update(new Set(), 1 / 60);
    expect(driver.weight('Hut1')).toBeCloseTo(0, 2);
    const last = applied.filter((a) => a.id === 'Hut1').at(-1);
    expect(last?.alpha).toBeCloseTo(1, 2);
  });
});
