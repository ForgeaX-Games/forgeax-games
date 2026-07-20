// NavigationQuery — deterministic grid pathfinding for camp / wild / den.
// Authored 2D blockers only (obstacles.json / ashen-reach.layout.json /
// dungeon walk grid). Never samples render meshes per frame.

import { CELL, CELLS } from './dungeon-layout';

/** Must match `dungeon.ts` DUNGEON_ORIGIN (kept here so nav stays engine-free). */
const DUNGEON_ORIGIN = { x: 300, z: 300 } as const;

export interface NavigationQuery {
  path(
    from: readonly [number, number],
    to: readonly [number, number],
  ): readonly (readonly [number, number])[];
  walkable(point: readonly [number, number], radius: number): boolean;
}

export type NavBlocker =
  | { type: 'aabb'; min: readonly [number, number]; max: readonly [number, number]; label?: string }
  | { type: 'polygon'; points: ReadonlyArray<readonly [number, number]>; label?: string };

export interface ObstacleDoc {
  version: 1;
  blockers: readonly NavBlocker[];
}

export interface AshenReachLayout {
  version: 1;
  route: ReadonlyArray<{ id: string; pos: readonly [number, number] }>;
  blockers: readonly NavBlocker[];
  landmarks: ReadonlyArray<{ id: string; pos: readonly [number, number]; kind?: string }>;
  encounterMarkers?: ReadonlyArray<{
    id: string;
    pos: readonly [number, number];
    table?: string;
  }>;
  decorMarkers?: ReadonlyArray<{
    id: string;
    pos: readonly [number, number];
    pool?: string;
  }>;
}

export interface WorldBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface DungeonNavSource {
  contains(wx: number, wz: number): boolean;
  worldToCell(wx: number, wz: number): { cx: number; cy: number } | null;
  cellToWorld(cx: number, cy: number): readonly [number, number];
  isWalkCell(cx: number, cy: number): boolean;
  walkable(wx: number, wz: number): boolean;
}

type Grid = {
  cellSize: number;
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  walk: Uint8Array;
};

function pointInAabb(x: number, z: number, b: Extract<NavBlocker, { type: 'aabb' }>): boolean {
  const minX = Math.min(b.min[0], b.max[0]);
  const maxX = Math.max(b.min[0], b.max[0]);
  const minZ = Math.min(b.min[1], b.max[1]);
  const maxZ = Math.max(b.min[1], b.max[1]);
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

function pointInPolygon(x: number, z: number, pts: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]![0], zi = pts[i]![1];
    const xj = pts[j]![0], zj = pts[j]![1];
    const intersect = ((zi > z) !== (zj > z))
      && (x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointHitsBlocker(x: number, z: number, blockers: readonly NavBlocker[]): boolean {
  for (const b of blockers) {
    if (b.type === 'aabb' && pointInAabb(x, z, b)) return true;
    if (b.type === 'polygon' && pointInPolygon(x, z, b.points)) return true;
  }
  return false;
}

function rasterizeBlockers(bounds: WorldBounds, cellSize: number, blockers: readonly NavBlocker[]): Grid {
  const cols = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.z1 - bounds.z0) / cellSize));
  const walk = new Uint8Array(cols * rows);
  walk.fill(1);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = bounds.x0 + (cx + 0.5) * cellSize;
      const z = bounds.z0 + (cy + 0.5) * cellSize;
      if (pointHitsBlocker(x, z, blockers)) walk[cy * cols + cx] = 0;
    }
  }
  return { cellSize, originX: bounds.x0, originZ: bounds.z0, cols, rows, walk };
}

function worldToGrid(g: Grid, x: number, z: number): { cx: number; cy: number } | null {
  const cx = Math.floor((x - g.originX) / g.cellSize);
  const cy = Math.floor((z - g.originZ) / g.cellSize);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return null;
  return { cx, cy };
}

function gridToWorld(g: Grid, cx: number, cy: number): readonly [number, number] {
  return [g.originX + (cx + 0.5) * g.cellSize, g.originZ + (cy + 0.5) * g.cellSize];
}

function gridWalkable(g: Grid, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return false;
  return g.walk[cy * g.cols + cx] === 1;
}

/** Deterministic 8-connected A* (tie-break: lower f, then lower cy, then lower cx). */
export function astarGrid(
  isWalk: (cx: number, cy: number) => boolean,
  cols: number,
  rows: number,
  start: { cx: number; cy: number },
  goal: { cx: number; cy: number },
  toWorld: (cx: number, cy: number) => readonly [number, number],
): readonly (readonly [number, number])[] {
  if (!isWalk(start.cx, start.cy) || !isWalk(goal.cx, goal.cy)) return [];
  if (start.cx === goal.cx && start.cy === goal.cy) return [toWorld(goal.cx, goal.cy)];

  const N = cols * rows;
  const gScore = new Float64Array(N);
  gScore.fill(Infinity);
  const fScore = new Float64Array(N);
  fScore.fill(Infinity);
  const came = new Int32Array(N);
  came.fill(-1);
  const closed = new Uint8Array(N);
  const open: number[] = [];

  const idx = (cx: number, cy: number) => cy * cols + cx;
  const heuristic = (cx: number, cy: number) => {
    const dx = Math.abs(cx - goal.cx);
    const dy = Math.abs(cy - goal.cy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const s = idx(start.cx, start.cy);
  gScore[s] = 0;
  fScore[s] = heuristic(start.cx, start.cy);
  open.push(s);

  const neighbors = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ] as const;

  while (open.length > 0) {
    let bestI = 0;
    let bestF = fScore[open[0]!]!;
    let bestKey = open[0]!;
    for (let i = 1; i < open.length; i++) {
      const n = open[i]!;
      const f = fScore[n]!;
      if (f < bestF || (f === bestF && n < bestKey)) {
        bestF = f;
        bestKey = n;
        bestI = i;
      }
    }
    const current = open.splice(bestI, 1)[0]!;
    if (closed[current]) continue;
    closed[current] = 1;
    const ccx = current % cols;
    const ccy = (current / cols) | 0;
    if (ccx === goal.cx && ccy === goal.cy) {
      const path: Array<readonly [number, number]> = [];
      let c = current;
      while (c >= 0) {
        path.push(toWorld(c % cols, (c / cols) | 0));
        c = came[c]!;
      }
      path.reverse();
      return simplifyCollinear(path);
    }
    for (const [dx, dy, cost] of neighbors) {
      const nx = ccx + dx;
      const ny = ccy + dy;
      if (!isWalk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isWalk(ccx + dx, ccy) || !isWalk(ccx, ccy + dy)) continue;
      }
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const tent = gScore[current]! + cost;
      if (tent >= gScore[ni]!) continue;
      came[ni] = current;
      gScore[ni] = tent;
      fScore[ni] = tent + heuristic(nx, ny);
      open.push(ni);
    }
  }
  return [];
}

function simplifyCollinear(path: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
  if (path.length <= 2) return path;
  const out: Array<readonly [number, number]> = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = path[i]!;
    const c = path[i + 1]!;
    const abx = b[0] - a[0], abz = b[1] - a[1];
    const bcx = c[0] - b[0], bcz = c[1] - b[1];
    if (Math.abs(abx * bcz - abz * bcx) > 1e-6) out.push(b);
  }
  out.push(path[path.length - 1]!);
  return out;
}

function nearestWalkCell(
  isWalk: (cx: number, cy: number) => boolean,
  cols: number,
  rows: number,
  cx: number,
  cy: number,
): { cx: number; cy: number } | null {
  if (isWalk(cx, cy)) return { cx, cy };
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (isWalk(nx, ny)) return { cx: nx, cy: ny };
      }
    }
  }
  return null;
}

export function createOpenAreaNavigation(
  bounds: WorldBounds,
  blockers: readonly NavBlocker[],
  cellSize = 1,
): NavigationQuery {
  const grid = rasterizeBlockers(bounds, cellSize, blockers);
  const inBounds = (x: number, z: number) =>
    x > bounds.x0 && x < bounds.x1 && z > bounds.z0 && z < bounds.z1;

  return {
    walkable(point, radius) {
      const samples = radius <= 0
        ? [[0, 0] as const]
        : [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius], [0, 0]] as const;
      for (const [ox, oz] of samples) {
        const x = point[0] + ox, z = point[1] + oz;
        if (!inBounds(x, z)) return false;
        if (pointHitsBlocker(x, z, blockers)) return false;
      }
      return true;
    },
    path(from, to) {
      if (!inBounds(from[0], from[1]) || !inBounds(to[0], to[1])) return [];
      const s0 = worldToGrid(grid, from[0], from[1]);
      const g0 = worldToGrid(grid, to[0], to[1]);
      if (!s0 || !g0) return [];
      const start = nearestWalkCell((cx, cy) => gridWalkable(grid, cx, cy), grid.cols, grid.rows, s0.cx, s0.cy);
      const goal = nearestWalkCell((cx, cy) => gridWalkable(grid, cx, cy), grid.cols, grid.rows, g0.cx, g0.cy);
      if (!start || !goal) return [];
      const cells = astarGrid(
        (cx, cy) => gridWalkable(grid, cx, cy),
        grid.cols,
        grid.rows,
        start,
        goal,
        (cx, cy) => gridToWorld(grid, cx, cy),
      );
      if (cells.length === 0) return [];
      // Snap final waypoint to exact click when walkable.
      const last = cells[cells.length - 1]!;
      if (pointHitsBlocker(to[0], to[1], blockers) || !inBounds(to[0], to[1])) return cells;
      if (Math.hypot(last[0] - to[0], last[1] - to[1]) > 0.01) {
        return [...cells.slice(0, -1), [to[0], to[1]] as const];
      }
      return cells;
    },
  };
}

export function createDungeonNavigation(dungeon: DungeonNavSource): NavigationQuery {
  return {
    walkable(point, radius) {
      if (radius <= 0) return dungeon.walkable(point[0], point[1]);
      for (const [ox, oz] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]] as const) {
        if (!dungeon.walkable(point[0] + ox, point[1] + oz)) return false;
      }
      return true;
    },
    path(from, to) {
      const s0 = dungeon.worldToCell(from[0], from[1]);
      const g0 = dungeon.worldToCell(to[0], to[1]);
      if (!s0 || !g0) return [];
      const start = nearestWalkCell(
        (cx, cy) => dungeon.isWalkCell(cx, cy), CELLS, CELLS, s0.cx, s0.cy,
      );
      const goal = nearestWalkCell(
        (cx, cy) => dungeon.isWalkCell(cx, cy), CELLS, CELLS, g0.cx, g0.cy,
      );
      if (!start || !goal) return [];
      const cells = astarGrid(
        (cx, cy) => dungeon.isWalkCell(cx, cy),
        CELLS,
        CELLS,
        start,
        goal,
        (cx, cy) => dungeon.cellToWorld(cx, cy),
      );
      if (cells.length === 0) return [];
      if (dungeon.walkable(to[0], to[1])) {
        const last = cells[cells.length - 1]!;
        if (Math.hypot(last[0] - to[0], last[1] - to[1]) > 0.05) {
          return [...cells.slice(0, -1), [to[0], to[1]] as const];
        }
      }
      return cells;
    },
  };
}

export interface HellforgeNavOpts {
  dungeon: DungeonNavSource;
  campObstacles: ObstacleDoc;
  ashenLayout: AshenReachLayout;
  wildBounds: WorldBounds;
  openCellSize?: number;
}

/** Composite query: den grid inside DUNGEON_ORIGIN, authored blockers outside. */
export function createHellforgeNavigation(opts: HellforgeNavOpts): NavigationQuery {
  const den = createDungeonNavigation(opts.dungeon);
  const openBlockers = [...opts.campObstacles.blockers, ...opts.ashenLayout.blockers];
  const open = createOpenAreaNavigation(opts.wildBounds, openBlockers, opts.openCellSize ?? 1);

  const inDen = (x: number, z: number) => opts.dungeon.contains(x, z);

  return {
    walkable(point, radius) {
      if (inDen(point[0], point[1])) return den.walkable(point, radius);
      return open.walkable(point, radius);
    },
    path(from, to) {
      const fromDen = inDen(from[0], from[1]);
      const toDen = inDen(to[0], to[1]);
      // Portals teleport between den and camp/wild — no cross-region path.
      if (fromDen !== toDen) return [];
      return fromDen ? den.path(from, to) : open.path(from, to);
    },
  };
}

/** Cell centre helper shared with Dungeon.cellToWorld. */
export function dungeonCellToWorld(cx: number, cy: number): readonly [number, number] {
  return [
    (cx - CELLS / 2 + 0.5) * CELL + DUNGEON_ORIGIN.x,
    (cy - CELLS / 2 + 0.5) * CELL + DUNGEON_ORIGIN.z,
  ];
}
