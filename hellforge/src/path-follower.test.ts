import { describe, expect, test } from 'bun:test';
import {
  followPathDirection,
  integratePerAxisSlide,
  PATH_ARRIVE,
  PURSUIT_REPATH_DIST,
  pathPolylineLength,
  shouldRepathPursuit,
  simulateFollowPath,
} from './path-follower';

describe('followPathDirection', () => {
  test('advances past arrived waypoints and aims at the next', () => {
    const path = [
      [0, 0],
      [0.2, 0],
      [3, 0],
    ] as const;
    // Within arrive of wp0 and wp1; aim at wp2.
    const step = followPathDirection(path, 0, 0.1, 0, PATH_ARRIVE);
    expect(step.idx).toBe(2);
    expect(step.complete).toBe(false);
    expect(step.dirX).toBeGreaterThan(0.9);
    expect(Math.abs(step.dirZ)).toBeLessThan(0.1);
  });

  test('reports complete when every waypoint is within arrive radius', () => {
    const path = [[0, 0], [0.2, 0]] as const;
    const step = followPathDirection(path, 0, 0.1, 0, PATH_ARRIVE);
    expect(step.complete).toBe(true);
    expect(step.idx).toBe(2);
  });
});

describe('integratePerAxisSlide', () => {
  test('slides along a wall when one axis is blocked', () => {
    // Wall at x >= 1: can move in z, not x.
    const walkable = (x: number, _z: number) => x < 1;
    const next = integratePerAxisSlide(0.9, 0, 1, 1, 0.5, walkable);
    expect(next.px).toBe(0.9);
    expect(next.pz).toBeGreaterThan(0);
  });
});

describe('simulateFollowPath', () => {
  test('arrives on an open straight path', () => {
    const path = [[0, 0], [5, 0], [10, 0]] as const;
    const sim = simulateFollowPath(path, [0, 0], () => true, {
      walkSpeed: 3.4,
      dt: 1 / 60,
    });
    expect(sim.arrived).toBe(true);
    expect(sim.walkedLength).toBeGreaterThan(9);
    expect(pathPolylineLength(path)).toBeCloseTo(10, 5);
  });

  test('budgets the start→path[0] leg for single-waypoint paths', () => {
    // Polyline length is 0; without the start leg the ~0.01 m floor rejects.
    const path = [[1, 0]] as const;
    const sim = simulateFollowPath(path, [0, 0], () => true, {
      walkSpeed: 3.4,
      dt: 1 / 60,
    });
    expect(sim.arrived).toBe(true);
    expect(sim.walkedLength).toBeGreaterThan(0.4);
  });
});

describe('shouldRepathPursuit', () => {
  test('ignores sub-threshold target motion and repaths when empty/far', () => {
    expect(shouldRepathPursuit([0, 0], [0.2, 0], false)).toBe(false);
    expect(shouldRepathPursuit([0, 0], [PURSUIT_REPATH_DIST + 0.01, 0], false)).toBe(true);
    expect(shouldRepathPursuit(null, [0, 0], false)).toBe(true);
    expect(shouldRepathPursuit([0, 0], [0, 0], true)).toBe(true);
  });
});
