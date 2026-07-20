import { describe, expect, test } from 'bun:test';
import { CELL, CELLS, DUNGEON_SEED, generateLayout } from './dungeon-layout';
import {
  astarGrid,
  createDungeonNavigation,
  createHellforgeNavigation,
  createOpenAreaNavigation,
  dungeonCellToWorld,
  pointHitsBlocker,
  type AshenReachLayout,
  type ObstacleDoc,
} from './navigation';

/** Must match dungeon.ts / navigation.ts DUNGEON_ORIGIN. */
const DUNGEON_ORIGIN = { x: 300, z: 300 };

const campObstacles: ObstacleDoc = {
  version: 1,
  blockers: [
    { type: 'aabb', label: 'Hut1', min: [-8.3, -10.15], max: [-3.7, -5.55] },
    { type: 'aabb', label: 'FenceW', min: [-11.5, -2.7], max: [-11.1, 9.3] },
  ],
};

const ashenLayout: AshenReachLayout = {
  version: 1,
  route: [
    { id: 'camp-gate', pos: [0, 14] },
    { id: 'cave-mouth', pos: [14, 24] },
  ],
  blockers: [
    { type: 'aabb', label: 'SlagRidgeWest', min: [-28, 18], max: [-18, 32] },
  ],
  landmarks: [{ id: 'landmark-cinder-spire', pos: [-10, 40], kind: 'stub' }],
};

function dungeonSourceFromSeed() {
  const layout = generateLayout(DUNGEON_SEED);
  return {
    contains(wx: number, wz: number) {
      return Math.abs(wx - DUNGEON_ORIGIN.x) < (CELLS / 2 + 2) * CELL
        && Math.abs(wz - DUNGEON_ORIGIN.z) < (CELLS / 2 + 2) * CELL;
    },
    worldToCell(wx: number, wz: number) {
      const cx = Math.floor((wx - DUNGEON_ORIGIN.x) / CELL + CELLS / 2);
      const cy = Math.floor((wz - DUNGEON_ORIGIN.z) / CELL + CELLS / 2);
      if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return null;
      return { cx, cy };
    },
    cellToWorld: dungeonCellToWorld,
    isWalkCell(cx: number, cy: number) {
      if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return false;
      return !!layout.walk[cy * CELLS + cx];
    },
    walkable(wx: number, wz: number) {
      for (const [ox, oz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]] as const) {
        const cx = Math.floor((wx + ox - DUNGEON_ORIGIN.x) / CELL + CELLS / 2);
        const cy = Math.floor((wz + oz - DUNGEON_ORIGIN.z) / CELL + CELLS / 2);
        if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return false;
        if (!layout.walk[cy * CELLS + cx]) return false;
      }
      return true;
    },
  };
}

describe('astarGrid', () => {
  test('is deterministic for the same start/goal', () => {
    const walk = (cx: number, cy: number) => !(cx === 2 && cy === 1) && cx >= 0 && cy >= 0 && cx < 5 && cy < 3;
    const a = astarGrid(walk, 5, 3, { cx: 0, cy: 1 }, { cx: 4, cy: 1 }, (cx, cy) => [cx, cy]);
    const b = astarGrid(walk, 5, 3, { cx: 0, cy: 1 }, { cx: 4, cy: 1 }, (cx, cy) => [cx, cy]);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
    // Must not step through the blocked cell (2,1).
    expect(a.some((p) => p[0] === 2 && p[1] === 1)).toBe(false);
  });
});

describe('createOpenAreaNavigation', () => {
  test('camp obstacles block walkability and force a detour', () => {
    const nav = createOpenAreaNavigation(
      { x0: -20, x1: 20, z0: -20, z1: 20 },
      campObstacles.blockers,
      1,
    );
    expect(nav.walkable([-6, -8], 0)).toBe(false);
    expect(nav.walkable([0, 0], 0)).toBe(true);

    const path = nav.path([-10, -8], [-2, -8]);
    expect(path.length).toBeGreaterThan(1);
    // Path must go around Hut1 (not through its AABB centre).
    for (const p of path) {
      expect(pointHitsBlocker(p[0], p[1], campObstacles.blockers)).toBe(false);
    }
  });

  test('ashen-reach blockers are consumed the same way', () => {
    const nav = createOpenAreaNavigation(
      { x0: -52, x1: 52, z0: -48, z1: 58 },
      ashenLayout.blockers,
      1,
    );
    expect(nav.walkable([-22, 24], 0)).toBe(false);
    const path = nav.path([-30, 24], [-10, 24]);
    expect(path.length).toBeGreaterThan(1);
    for (const p of path) {
      expect(pointHitsBlocker(p[0], p[1], ashenLayout.blockers)).toBe(false);
    }
  });
});

describe('createDungeonNavigation', () => {
  test('paths between walkable dungeon cells on the seeded layout', () => {
    const nav = createDungeonNavigation(dungeonSourceFromSeed());
    const layout = generateLayout(DUNGEON_SEED);
    const entry = [
      layout.entry.x + DUNGEON_ORIGIN.x,
      layout.entry.z + DUNGEON_ORIGIN.z,
    ] as const;
    // Walk a few cells south of entry if walkable; else path to entry itself.
    let goal: readonly [number, number] = entry;
    for (const [dx, dz] of [[0, 4], [4, 0], [-4, 0], [0, -4], [6, 6]] as const) {
      const cand: readonly [number, number] = [entry[0] + dx, entry[1] + dz];
      if (nav.walkable(cand, 0.35)) { goal = cand; break; }
    }
    const path = nav.path(entry, goal);
    expect(path.length).toBeGreaterThan(0);
    expect(nav.walkable(entry, 0.35)).toBe(true);
  });
});

describe('createHellforgeNavigation', () => {
  test('routes camp clicks around authored blockers', () => {
    const nav = createHellforgeNavigation({
      dungeon: dungeonSourceFromSeed(),
      campObstacles,
      ashenLayout,
      wildBounds: { x0: -52, x1: 52, z0: -48, z1: 58 },
      openCellSize: 1,
    });
    const path = nav.path([-10, -8], [-2, -8]);
    expect(path.length).toBeGreaterThan(1);
    for (const p of path) {
      expect(nav.walkable(p, 0)).toBe(true);
    }
  });
});
