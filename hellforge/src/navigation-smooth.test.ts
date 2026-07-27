import { describe, expect, test } from 'bun:test';
import {
  anchorPathAtStart,
  createOpenAreaNavigation,
  NAV_AGENT_RADIUS,
  segmentClear,
  stringPullPath,
} from './navigation';

describe('segmentClear / stringPullPath', () => {
  test('string-pull removes midpoints when the chord is clear', () => {
    const walkable = () => true;
    const path = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ] as const;
    const pulled = stringPullPath(path, walkable, NAV_AGENT_RADIUS, 0.125);
    expect(pulled.length).toBe(2);
    expect(pulled[0]).toEqual([0, 0]);
    expect(pulled[1]).toEqual([4, 0]);
  });

  test('segmentClear rejects a chord through a blocker', () => {
    const nav = createOpenAreaNavigation(
      { x0: -10, x1: 10, z0: -10, z1: 10 },
      [{ type: 'aabb', min: [-0.5, -2], max: [0.5, 2] }],
      1,
    );
    expect(segmentClear(
      (p, r) => nav.walkable(p, r),
      [-3, 0],
      [3, 0],
      NAV_AGENT_RADIUS,
      0.125,
    )).toBe(false);
  });
});

describe('validated click snap', () => {
  test('does not keep an unvalidated chord through a solid wall AABB', () => {
    const blockers = [{ type: 'aabb' as const, min: [-0.5, -4] as const, max: [0.5, 4] as const }];
    const nav = createOpenAreaNavigation(
      { x0: -10, x1: 10, z0: -10, z1: 10 },
      blockers,
      1,
    );
    const from: readonly [number, number] = [-4, 0];
    const to: readonly [number, number] = [4, 0];
    // Direct chord is blocked.
    expect(segmentClear(
      (p, r) => nav.walkable(p, r),
      from,
      to,
      NAV_AGENT_RADIUS,
      0.125,
    )).toBe(false);
    const path = nav.path(from, to);
    expect(path.length).toBeGreaterThan(1);
    // Every kept segment must be clear (snap/pull may not invent a wall chord).
    for (let i = 1; i < path.length; i++) {
      expect(segmentClear(
        (p, r) => nav.walkable(p, r),
        path[i - 1]!,
        path[i]!,
        NAV_AGENT_RADIUS,
        0.125,
      )).toBe(true);
    }
  });

  test('clear LOS keeps the click point as the final waypoint', () => {
    const nav = createOpenAreaNavigation(
      { x0: -10, x1: 10, z0: -10, z1: 10 },
      [],
      1,
    );
    const from: readonly [number, number] = [-4, 0];
    const to: readonly [number, number] = [4.2, 0.35];
    expect(nav.walkable(to, NAV_AGENT_RADIUS)).toBe(true);
    const path = nav.path(from, to);
    expect(path.length).toBeGreaterThanOrEqual(2);
    const last = path[path.length - 1]!;
    expect(Math.hypot(last[0] - to[0], last[1] - to[1])).toBeLessThan(0.02);
  });
});

describe('anchorPathAtStart', () => {
  test('keeps the goal on length-1 same-cell paths', () => {
    const from: readonly [number, number] = [1, 0];
    const goal: readonly [number, number] = [0, 0];
    expect(anchorPathAtStart(from, [goal])).toEqual([from, goal]);
  });
});
