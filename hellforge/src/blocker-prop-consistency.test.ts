import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_TOLERANCE,
  compareXzAabbs,
  matchEntityToBlockerLabel,
  unionXzAabbs,
  unitCubeWorldXzAabb,
  validateWildLayoutInternal,
  xzAabbFromMinMax,
  type XzAabb,
} from './blocker-prop-consistency';

describe('xzAabbFromMinMax', () => {
  test('normalizes unordered corners', () => {
    expect(xzAabbFromMinMax([2, 5], [-1, 1])).toEqual({
      minX: -1,
      maxX: 2,
      minZ: 1,
      maxZ: 5,
    });
  });
});

describe('unitCubeWorldXzAabb', () => {
  test('axis-aligned scale expands footprint around pos', () => {
    const box = unitCubeWorldXzAabb(
      [0, 1, 0],
      [0, 0, 0, 1],
      [2, 4, 6],
    );
    expect(box.minX).toBeCloseTo(-1, 5);
    expect(box.maxX).toBeCloseTo(1, 5);
    expect(box.minZ).toBeCloseTo(-3, 5);
    expect(box.maxZ).toBeCloseTo(3, 5);
  });

  test('applies yaw so extents follow rotated unit cube', () => {
    // 90° about Y: local +X → world −Z, local +Z → world +X
    const q90: readonly [number, number, number, number] = [
      0,
      Math.SQRT1_2,
      0,
      Math.SQRT1_2,
    ];
    const box = unitCubeWorldXzAabb([0, 0, 0], q90, [2, 1, 4]);
    expect(box.minX).toBeCloseTo(-2, 5);
    expect(box.maxX).toBeCloseTo(2, 5);
    expect(box.minZ).toBeCloseTo(-1, 5);
    expect(box.maxZ).toBeCloseTo(1, 5);
  });
});

describe('unionXzAabbs', () => {
  test('returns null for empty input', () => {
    expect(unionXzAabbs([])).toBeNull();
  });

  test('merges multiple boxes', () => {
    const a: XzAabb = { minX: -1, maxX: 0, minZ: -1, maxZ: 0 };
    const b: XzAabb = { minX: 0, maxX: 2, minZ: 0, maxZ: 3 };
    expect(unionXzAabbs([a, b])).toEqual({
      minX: -1,
      maxX: 2,
      minZ: -1,
      maxZ: 3,
    });
  });
});

describe('compareXzAabbs', () => {
  test('passes when center and extents are within tolerance', () => {
    const blocker = xzAabbFromMinMax([-8.3, -10.15], [-3.7, -5.55]);
    const prop = xzAabbFromMinMax([-8.2, -10.05], [-3.8, -5.65]);
    const r = compareXzAabbs(blocker, prop, DEFAULT_TOLERANCE);
    expect(r.ok).toBe(true);
    expect(r.centerDelta).toBeLessThan(DEFAULT_TOLERANCE.maxCenterDelta);
  });

  test('fails when centers diverge beyond tolerance', () => {
    const blocker = xzAabbFromMinMax([-2, -2], [2, 2]);
    const prop = xzAabbFromMinMax([10, -2], [14, 2]);
    const r = compareXzAabbs(blocker, prop, DEFAULT_TOLERANCE);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((s) => s.includes('center'))).toBe(true);
  });

  test('fails when footprint extents diverge beyond tolerance', () => {
    const blocker = xzAabbFromMinMax([-1, -1], [1, 1]);
    const prop = xzAabbFromMinMax([-5, -1], [5, 1]);
    const r = compareXzAabbs(blocker, prop, {
      maxCenterDelta: 10,
      maxExtentDelta: 0.5,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((s) => s.includes('extent'))).toBe(true);
  });
});

describe('matchEntityToBlockerLabel', () => {
  const labels = [
    'Hut1',
    'FenceW',
    'FenceE',
    'GateColumns',
    'GateColumnsR',
    'CampfireRing',
  ] as const;

  test('maps hut tile names via prefix', () => {
    expect(matchEntityToBlockerLabel('Hut1_Roof__t0', labels)).toBe('Hut1');
    expect(matchEntityToBlockerLabel('Hut1_Wall_N__t1', labels)).toBe('Hut1');
  });

  test('maps FenceW1 tiles to FenceW', () => {
    expect(matchEntityToBlockerLabel('FenceW1__t0', labels)).toBe('FenceW');
    expect(matchEntityToBlockerLabel('FenceE1__t3', labels)).toBe('FenceE');
  });

  test('maps gate column aliases', () => {
    expect(matchEntityToBlockerLabel('GateColumnL', labels)).toBe('GateColumns');
    expect(matchEntityToBlockerLabel('GateColumnR', labels)).toBe('GateColumnsR');
  });

  test('maps campfire props to CampfireRing', () => {
    expect(matchEntityToBlockerLabel('CampfireBase', labels)).toBe('CampfireRing');
    expect(matchEntityToBlockerLabel('CampfireLog1', labels)).toBe('CampfireRing');
  });

  test('skips torch/glow helpers', () => {
    expect(matchEntityToBlockerLabel('TorchHut1_Post', labels)).toBeNull();
    expect(matchEntityToBlockerLabel('CampfireGlow', labels)).toBeNull();
  });
});

describe('validateWildLayoutInternal', () => {
  test('accepts well-formed ashen-reach-shaped layout', () => {
    const violations = validateWildLayoutInternal({
      version: 1,
      route: [
        { id: 'camp-gate', pos: [0, 14] },
        { id: 'ashen-mid', pos: [6, 22] },
      ],
      blockers: [
        { type: 'aabb', label: 'SlagRidgeWest', min: [-28, 18], max: [-18, 32] },
        {
          type: 'polygon',
          label: 'LavaFissure',
          points: [
            [2, 28],
            [8, 30],
            [7, 36],
            [1, 34],
          ],
        },
      ],
      landmarks: [
        { id: 'slag-bridge', pos: [4, 20] },
        { id: 'fallen-forge', pos: [-8, 30] },
      ],
      decorMarkers: [
        { id: 'decor-bridge-ash', pos: [3.5, 19.5] },
        { id: 'decor-forge-slag', pos: [-7.5, 29.5] },
      ],
    });
    expect(violations).toEqual([]);
  });

  test('flags route points inside aabb blockers', () => {
    const violations = validateWildLayoutInternal({
      version: 1,
      route: [{ id: 'bad', pos: [0, 0] }],
      blockers: [
        { type: 'aabb', label: 'Wall', min: [-1, -1], max: [1, 1] },
      ],
      landmarks: [],
      decorMarkers: [],
    });
    expect(violations.some((v) => v.includes('route') && v.includes('Wall'))).toBe(true);
  });

  test('flags landmark without nearby decor marker', () => {
    const violations = validateWildLayoutInternal({
      version: 1,
      route: [],
      blockers: [
        { type: 'aabb', label: 'Ridge', min: [10, 10], max: [12, 12] },
      ],
      landmarks: [{ id: 'lonely', pos: [0, 0] }],
      decorMarkers: [{ id: 'far', pos: [50, 50] }],
    });
    expect(violations.some((v) => v.includes('lonely'))).toBe(true);
  });
});
