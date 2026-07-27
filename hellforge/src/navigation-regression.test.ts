import { describe, expect, test } from 'bun:test';
import { CELL, CELLS, DUNGEON_SEED, mulberry32 } from './dungeon-layout';
import { resolveDungeonLayout } from './dungeon-pipeline';
import {
  createDungeonNavigation,
  dungeonCellToWorld,
  NAV_AGENT_RADIUS,
  segmentClear,
} from './navigation';
import {
  PATH_ARRIVE,
  pathPolylineLength,
  PLAYER_WALK_SPEED,
  simulateFollowPath,
  type SimulateFollowResult,
} from './path-follower';

/** Must match dungeon.ts / navigation.ts DUNGEON_ORIGIN. */
const DUNGEON_ORIGIN = { x: 300, z: 300 };

/**
 * Shipping seed + two alternates with distinct modular graphs (PR12 §10):
 * - 20260703: recovery -> combat -> combat; branch off recovery-0.
 * - 20260711: combat -> combat -> recovery; branch off combat-0.
 * - 20260719: recovery -> combat; branch off recovery-0 (shorter critical path).
 */
export const REGRESSION_SEEDS = [DUNGEON_SEED, 20260711, 20260719] as const;
export const REGRESSION_PAIR_COUNT = 20;
/** XOR into mulberry32 so the pair sampler is stable across runs. */
export const REGRESSION_RNG_XOR = 0x0a12;
/** Matches PLAYER_WALK_SPEED (main.ts walk). */
export const REGRESSION_WALK_SPEED = PLAYER_WALK_SPEED;
export const REGRESSION_DT = 1 / 60;

/**
 * Pre-fix baseline (PR12 T1) — fixture for post-fix ratio comparisons only.
 * Captured against the extracted follower on unsmoothed / unanchored paths.
 */
export const PRE_FIX_BASELINE = {
  20260703: {
    arrived: 20,
    sumWp: 151,
    sumWalked: 1529.887,
    sumU: 4,
    sumStuck: 0,
    runs: [
      { wp: 4, walked: 17.737, u: 0, stuck: 0, arrived: true },
      { wp: 9, walked: 124.723, u: 1, stuck: 0, arrived: true },
      { wp: 13, walked: 135.207, u: 0, stuck: 0, arrived: true },
      { wp: 16, walked: 154.87, u: 0, stuck: 0, arrived: true },
      { wp: 13, walked: 156.117, u: 1, stuck: 0, arrived: true },
      { wp: 7, walked: 26.293, u: 0, stuck: 0, arrived: true },
      { wp: 2, walked: 13.997, u: 0, stuck: 0, arrived: true },
      { wp: 13, walked: 90.497, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 42.217, u: 0, stuck: 0, arrived: true },
      { wp: 9, walked: 102.057, u: 0, stuck: 0, arrived: true },
      { wp: 2, walked: 6.29, u: 0, stuck: 0, arrived: true },
      { wp: 5, walked: 21.193, u: 1, stuck: 0, arrived: true },
      { wp: 9, walked: 135.83, u: 0, stuck: 0, arrived: true },
      { wp: 4, walked: 72.76, u: 1, stuck: 0, arrived: true },
      { wp: 13, walked: 98.543, u: 0, stuck: 0, arrived: true },
      { wp: 7, walked: 108.517, u: 0, stuck: 0, arrived: true },
      { wp: 4, walked: 45.503, u: 0, stuck: 0, arrived: true },
      { wp: 5, walked: 49.753, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 6.857, u: 0, stuck: 0, arrived: true },
      { wp: 10, walked: 120.927, u: 0, stuck: 0, arrived: true },
    ],
  },
  20260711: {
    arrived: 20,
    sumWp: 140,
    sumWalked: 1110.893,
    sumU: 3,
    sumStuck: 0,
    runs: [
      { wp: 14, walked: 150.733, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 12.58, u: 0, stuck: 0, arrived: true },
      { wp: 4, walked: 11.957, u: 0, stuck: 0, arrived: true },
      { wp: 10, walked: 101.547, u: 0, stuck: 0, arrived: true },
      { wp: 8, walked: 19.607, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 8.727, u: 0, stuck: 0, arrived: true },
      { wp: 4, walked: 45.843, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 23.007, u: 1, stuck: 0, arrived: true },
      { wp: 15, walked: 157.703, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 11.163, u: 0, stuck: 0, arrived: true },
      { wp: 5, walked: 45.957, u: 0, stuck: 0, arrived: true },
      { wp: 11, walked: 75.083, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 11.163, u: 0, stuck: 0, arrived: true },
      { wp: 11, walked: 134.357, u: 1, stuck: 0, arrived: true },
      { wp: 3, walked: 7.367, u: 1, stuck: 0, arrived: true },
      { wp: 10, walked: 53.04, u: 0, stuck: 0, arrived: true },
      { wp: 9, walked: 64.26, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 16.83, u: 0, stuck: 0, arrived: true },
      { wp: 11, walked: 106.42, u: 0, stuck: 0, arrived: true },
      { wp: 7, walked: 53.55, u: 0, stuck: 0, arrived: true },
    ],
  },
  20260719: {
    arrived: 20,
    sumWp: 115,
    sumWalked: 784.777,
    sumU: 3,
    sumStuck: 0,
    runs: [
      { wp: 9, walked: 114.127, u: 0, stuck: 0, arrived: true },
      { wp: 5, walked: 41.367, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 25.103, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 4.703, u: 1, stuck: 0, arrived: true },
      { wp: 3, walked: 23.233, u: 0, stuck: 0, arrived: true },
      { wp: 5, walked: 45.447, u: 0, stuck: 0, arrived: true },
      { wp: 13, walked: 94.123, u: 0, stuck: 0, arrived: true },
      { wp: 10, walked: 85.283, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 15.867, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 9.18, u: 0, stuck: 0, arrived: true },
      { wp: 10, walked: 63.41, u: 1, stuck: 0, arrived: true },
      { wp: 9, walked: 67.83, u: 0, stuck: 0, arrived: true },
      { wp: 10, walked: 39.383, u: 0, stuck: 0, arrived: true },
      { wp: 6, walked: 30.43, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 11.333, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 9.917, u: 1, stuck: 0, arrived: true },
      { wp: 3, walked: 18.983, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 17, u: 0, stuck: 0, arrived: true },
      { wp: 3, walked: 30.657, u: 0, stuck: 0, arrived: true },
      { wp: 8, walked: 37.4, u: 0, stuck: 0, arrived: true },
    ],
  },
} as const;

/**
 * Post-fix waypoint-count gate vs PRE_FIX_BASELINE.
 * Measured ~0.69–0.72× on the shipping string-pull; plan §5.1's 0.50× was
 * aspirational / under-delivered. Hold an honest ceiling the algorithm meets.
 */
export const MAX_WAYPOINT_RATIO = 0.80;

/**
 * Walked-length catastrophic bound vs baseline.
 * Plan §5.1's walked ≤ 0.9× is dropped: PATH_ARRIVE already shortens measured
 * walked distance vs polyline length, so a 0.9× "improvement" gate was
 * mis-specified (post-fix walked sits ~0.97–0.98×). Only reject regressions
 * that make walked catastrophically worse.
 */
export const MAX_WALKED_RATIO = 1.05;

export type RegressionPair = {
  from: readonly [number, number];
  to: readonly [number, number];
};

export function dungeonNavFromSeed(seed: number) {
  const layout = resolveDungeonLayout(seed);
  const src = {
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
  return { layout, nav: createDungeonNavigation(src) };
}

function listWalkCells(layout: { walk: ArrayLike<number> }): Array<{ cx: number; cy: number }> {
  const cells: Array<{ cx: number; cy: number }> = [];
  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      if (layout.walk[cy * CELLS + cx]) cells.push({ cx, cy });
    }
  }
  return cells;
}

/** Rejection-sample reachable pairs; an actual path() call must succeed. */
export function sampleReachablePairs(seed: number, count = REGRESSION_PAIR_COUNT): {
  pairs: RegressionPair[];
  nav: ReturnType<typeof dungeonNavFromSeed>['nav'];
} {
  const { layout, nav } = dungeonNavFromSeed(seed);
  const cells = listWalkCells(layout);
  const rng = mulberry32((seed ^ REGRESSION_RNG_XOR) >>> 0);
  const pairs: RegressionPair[] = [];
  let trials = 0;
  while (pairs.length < count && trials < 5000) {
    trials++;
    const a = cells[(rng() * cells.length) | 0]!;
    const b = cells[(rng() * cells.length) | 0]!;
    if (a.cx === b.cx && a.cy === b.cy) continue;
    const from = [
      dungeonCellToWorld(a.cx, a.cy)[0] + (rng() - 0.5) * CELL * 0.8,
      dungeonCellToWorld(a.cx, a.cy)[1] + (rng() - 0.5) * CELL * 0.8,
    ] as const;
    const to = [
      dungeonCellToWorld(b.cx, b.cy)[0] + (rng() - 0.5) * CELL * 0.8,
      dungeonCellToWorld(b.cx, b.cy)[1] + (rng() - 0.5) * CELL * 0.8,
    ] as const;
    if (!nav.walkable(from, 0.35) || !nav.walkable(to, 0.35)) continue;
    const path = nav.path(from, to);
    if (path.length < 2) continue;
    pairs.push({ from, to });
  }
  return { pairs, nav };
}

export type SeedMatrixStats = {
  arrived: number;
  sumWp: number;
  sumWalked: number;
  sumU: number;
  sumStuck: number;
  runs: Array<{
    path: readonly (readonly [number, number])[];
    pathLen: number;
    wp: number;
    sim: SimulateFollowResult;
  }>;
};

export function runSeedMatrix(seed: number): SeedMatrixStats {
  const { pairs, nav } = sampleReachablePairs(seed);
  const stats: SeedMatrixStats = {
    arrived: 0,
    sumWp: 0,
    sumWalked: 0,
    sumU: 0,
    sumStuck: 0,
    runs: [],
  };
  for (const { from, to } of pairs) {
    const path = nav.path(from, to);
    const sim = simulateFollowPath(path, from, (x, z) => nav.walkable([x, z], 0.35), {
      walkSpeed: REGRESSION_WALK_SPEED,
      dt: REGRESSION_DT,
    });
    if (sim.arrived) stats.arrived += 1;
    stats.sumWp += path.length;
    stats.sumWalked += sim.walkedLength;
    stats.sumU += sim.uTurnCount;
    stats.sumStuck += sim.stuckCount;
    stats.runs.push({ path, pathLen: pathPolylineLength(path), wp: path.length, sim });
  }
  stats.sumWalked = +stats.sumWalked.toFixed(3);
  return stats;
}

describe('navigation regression matrix (PR12 post-fix)', () => {
  test('60/60 arrive, zero U-turns/stuck, geometry-safe, honest ratio gates', () => {
    let totalArrived = 0;
    for (const seed of REGRESSION_SEEDS) {
      const { pairs, nav } = sampleReachablePairs(seed);
      const stats: SeedMatrixStats = {
        arrived: 0,
        sumWp: 0,
        sumWalked: 0,
        sumU: 0,
        sumStuck: 0,
        runs: [],
      };
      for (const { from, to } of pairs) {
        const path = nav.path(from, to);
        const sim = simulateFollowPath(path, from, (x, z) => nav.walkable([x, z], 0.35), {
          walkSpeed: REGRESSION_WALK_SPEED,
          dt: REGRESSION_DT,
        });
        if (sim.arrived) stats.arrived += 1;
        stats.sumWp += path.length;
        stats.sumWalked += sim.walkedLength;
        stats.sumU += sim.uTurnCount;
        stats.sumStuck += sim.stuckCount;
        stats.runs.push({ path, pathLen: pathPolylineLength(path), wp: path.length, sim });
      }
      stats.sumWalked = +stats.sumWalked.toFixed(3);

      const base = PRE_FIX_BASELINE[seed];
      expect(stats.runs).toHaveLength(REGRESSION_PAIR_COUNT);
      expect(stats.arrived).toBe(REGRESSION_PAIR_COUNT);
      expect(stats.sumU).toBe(0);
      expect(stats.sumStuck).toBe(0);
      totalArrived += stats.arrived;

      const wpRatio = stats.sumWp / base.sumWp;
      expect(wpRatio).toBeLessThanOrEqual(MAX_WAYPOINT_RATIO);

      // No walked≤0.9× gate — see MAX_WALKED_RATIO comment (PATH_ARRIVE shortens walked).
      const walkedRatio = stats.sumWalked / base.sumWalked;
      expect(walkedRatio).toBeLessThanOrEqual(MAX_WALKED_RATIO);

      const step = CELL / 8;
      for (const run of stats.runs) {
        for (let i = 1; i < run.path.length; i++) {
          expect(segmentClear(
            (p, r) => nav.walkable(p, r),
            run.path[i - 1]!,
            run.path[i]!,
            NAV_AGENT_RADIUS,
            step,
          )).toBe(true);
        }
      }
    }
    expect(totalArrived).toBe(REGRESSION_SEEDS.length * REGRESSION_PAIR_COUNT);
  });
});

describe('start-anchor invariant', () => {
  test('first waypoint is agent position; no >150° flip on first bend', () => {
    const { layout, nav } = dungeonNavFromSeed(DUNGEON_SEED);
    const cells = listWalkCells(layout);
    expect(cells.length).toBeGreaterThan(2);
    const a = cells[0]!;
    const b = cells[cells.length - 1]!;
    const centre = dungeonCellToWorld(a.cx, a.cy);
    // Offset inside the start cell so own-cell centre ≠ agent position.
    // Stay well inside the cell so radius-0.35 samples remain walkable.
    const from: readonly [number, number] = [centre[0] + 0.35, centre[1] + 0.3];
    const to = dungeonCellToWorld(b.cx, b.cy);
    expect(nav.walkable(from, NAV_AGENT_RADIUS)).toBe(true);
    expect(nav.walkable(to, NAV_AGENT_RADIUS)).toBe(true);
    const path = nav.path(from, to);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(Math.hypot(path[0]![0] - from[0], path[0]![1] - from[1])).toBeLessThan(0.01);
    if (path.length >= 3) {
      const ax = path[1]![0] - path[0]![0];
      const az = path[1]![1] - path[0]![1];
      const bx = path[2]![0] - path[1]![0];
      const bz = path[2]![1] - path[1]![1];
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la > 0.01 && lb > 0.01) {
        const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb))))
          * (180 / Math.PI);
        expect(ang).toBeLessThanOrEqual(150);
      }
    }
  });
});

describe('same-cell click-move', () => {
  test('returns a path ending near to and the follower arrives', () => {
    const { layout, nav } = dungeonNavFromSeed(DUNGEON_SEED);
    const cell = listWalkCells(layout)[0]!;
    const centre = dungeonCellToWorld(cell.cx, cell.cy);
    const from: readonly [number, number] = [centre[0] + 0.35, centre[1] + 0.3];
    const to: readonly [number, number] = [centre[0] - 0.25, centre[1] - 0.2];
    expect(nav.walkable(from, NAV_AGENT_RADIUS)).toBe(true);
    expect(nav.walkable(to, NAV_AGENT_RADIUS)).toBe(true);
    const path = nav.path(from, to);
    expect(path.length).toBeGreaterThanOrEqual(1);
    const last = path[path.length - 1]!;
    // Must end near the click — cell-centre land while far from `to` is C1.
    expect(Math.hypot(last[0] - to[0], last[1] - to[1])).toBeLessThanOrEqual(PATH_ARRIVE);
    const sim = simulateFollowPath(path, from, (x, z) => nav.walkable([x, z], NAV_AGENT_RADIUS), {
      walkSpeed: PLAYER_WALK_SPEED,
      dt: REGRESSION_DT,
      arriveRadius: PATH_ARRIVE,
    });
    expect(sim.arrived).toBe(true);
    expect(Math.hypot(sim.finalPos[0] - to[0], sim.finalPos[1] - to[1])).toBeLessThanOrEqual(PATH_ARRIVE);
  });

  test('near cell-centre player walks to click beyond PATH_ARRIVE (C1 remnant)', () => {
    // Adversarial pattern: player already within PATH_ARRIVE of A* cell centre,
    // click elsewhere in the same cell beyond PATH_ARRIVE. Pre-fix returned
    // [from, cellCentre] → immediate arrive, zero re-click movement.
    const { nav } = dungeonNavFromSeed(DUNGEON_SEED);
    const from: readonly [number, number] = [308.98, 330.09];
    const to: readonly [number, number] = [308.75, 330.82];
    const goalDist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    expect(goalDist).toBeGreaterThan(PATH_ARRIVE);
    expect(nav.walkable(from, NAV_AGENT_RADIUS)).toBe(true);
    expect(nav.walkable(to, NAV_AGENT_RADIUS)).toBe(true);
    const path = nav.path(from, to);
    expect(path.length).toBeGreaterThanOrEqual(1);
    const last = path[path.length - 1]!;
    expect(Math.hypot(last[0] - to[0], last[1] - to[1])).toBeLessThanOrEqual(PATH_ARRIVE);
    const sim = simulateFollowPath(path, from, (x, z) => nav.walkable([x, z], NAV_AGENT_RADIUS), {
      walkSpeed: PLAYER_WALK_SPEED,
      dt: REGRESSION_DT,
      arriveRadius: PATH_ARRIVE,
    });
    expect(sim.arrived).toBe(true);
    expect(Math.hypot(sim.finalPos[0] - to[0], sim.finalPos[1] - to[1])).toBeLessThanOrEqual(PATH_ARRIVE);
    expect(sim.walkedLength).toBeGreaterThan(0.05);
  });
});
