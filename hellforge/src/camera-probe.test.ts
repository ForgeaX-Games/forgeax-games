import { describe, expect, test } from 'bun:test';
import {
  createObstacleCameraProbe,
  rayAabbHitT,
  type ProbeBlocker,
} from './camera-probe';

describe('rayAabbHitT', () => {
  test('hits a unit cube along +Z', () => {
    const t = rayAabbHitT(
      0, 1, -2,
      0, 0, 4,
      { minX: -1, minY: 0, minZ: 0, maxX: 1, maxY: 2, maxZ: 1 },
    );
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0.5, 5);
  });

  test('misses when ray is beside the box', () => {
    const t = rayAabbHitT(
      3, 1, -2,
      0, 0, 4,
      { minX: -1, minY: 0, minZ: 0, maxX: 1, maxY: 2, maxZ: 1 },
    );
    expect(t).toBeNull();
  });
});

describe('createObstacleCameraProbe', () => {
  const hut: ProbeBlocker = {
    type: 'aabb',
    label: 'Hut1',
    min: [-2, -2],
    max: [2, 2],
    probeHeight: 3,
    probePad: 0,
  };

  test('returns full arm length when the ray is clear', () => {
    const probe = createObstacleCameraProbe([hut]);
    const origin = [0, 1.4, 10] as const;
    const eye = [0, 1.4, 12.6] as const; // behind player, away from hut at origin
    const d = probe.maxDistance(origin, eye, 0.15);
    expect(d).toBeCloseTo(2.6, 4);
  });

  test('contracts arm when the desired eye is behind a wall', () => {
    const probe = createObstacleCameraProbe([hut]);
    // Origin at camp centre looking through Hut1 toward -Z.
    const origin = [0, 1.4, 5] as const;
    const desired = [0, 1.4, -5] as const;
    const full = Math.hypot(desired[0] - origin[0], desired[1] - origin[1], desired[2] - origin[2]);
    const d = probe.maxDistance(origin, desired, 0.15);
    expect(d).toBeLessThan(full);
    expect(d).toBeGreaterThan(0);
    // Hit the near face of hut at z=2 → distance ≈ |5-2| - skin = 2.85
    expect(d).toBeCloseTo(3 - 0.15, 1);
  });

  test('probePad thickens the volume', () => {
    const thin = createObstacleCameraProbe([{ ...hut, probePad: 0 }]);
    const fat = createObstacleCameraProbe([{ ...hut, probePad: 0.5 }]);
    const origin = [0, 1.4, 5] as const;
    const desired = [0, 1.4, -5] as const;
    expect(fat.maxDistance(origin, desired, 0)).toBeLessThan(
      thin.maxDistance(origin, desired, 0),
    );
  });

  test('camp hut blockers from obstacles.json shape contract the arm', () => {
    const blockers: ProbeBlocker[] = [
      { type: 'aabb', label: 'Hut1', min: [-8.3, -10.15], max: [-3.7, -5.55], probeHeight: 3.5, probePad: 0.18 },
    ];
    const probe = createObstacleCameraProbe(blockers);
    const origin = [-6, 1.5, -3] as const;
    const desired = [-6, 1.5, -8] as const;
    const d = probe.maxDistance(origin, desired, 0.2);
    expect(d).toBeLessThan(5);
    expect(d).toBeGreaterThan(0.5);
  });
});
