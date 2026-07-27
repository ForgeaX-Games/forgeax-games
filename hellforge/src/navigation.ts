// NavigationQuery — deterministic grid pathfinding for camp / wild / den.
// Authored 2D blockers only (obstacles.json / ashen-reach.layout.json /
// dungeon walk grid). Never samples render meshes per frame.

import { CELL, CELLS } from './dungeon-layout';
import {
  NAV_VALIDATE_DT,
  NAV_VALIDATE_STRIDE,
  PATH_ARRIVE,
  PLAYER_SPRINT_SPEED,
  simulateFollowPath,
} from './path-follower';

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


/** Player collision radius shared with main.ts walkableAt. */
export const NAV_AGENT_RADIUS = 0.35;

/**
 * Erosion-aware segment clearance — supersample along a→b at `step` metres
 * (plan default: cellSize/8) using the same walkable(point, radius) contract
 * the follower uses.
 *
 * When `followerSlide` is set, also require per-axis slide (stride ≤ that
 * value) to reach b — catches corner-pinches that point samples miss.
 */
export function segmentClear(
  walkable: (point: readonly [number, number], radius: number) => boolean,
  a: readonly [number, number],
  b: readonly [number, number],
  radius: number,
  step: number,
  followerSlide?: number,
): boolean {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return walkable(a, radius);
  const sampleStep = Math.max(step, 1e-6);
  const n = Math.max(1, Math.ceil(len / sampleStep));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!walkable([a[0] + dx * t, a[1] + dz * t], radius)) return false;
  }
  if (followerSlide == null) return true;
  const at = (x: number, z: number) => walkable([x, z], radius);
  const dirX = dx / len;
  const dirZ = dz / len;
  const strideCap = Math.max(1e-4, Math.min(sampleStep, followerSlide));
  let px = a[0];
  let pz = a[1];
  let traveled = 0;
  let guard = 0;
  while (traveled < len - 0.05 && guard++ < 20000) {
    const stride = Math.min(strideCap, len - traveled);
    const nxp = px + dirX * stride;
    const nzp = pz + dirZ * stride;
    let x = px;
    let z = pz;
    if (at(nxp, z)) x = nxp;
    if (at(x, nzp)) z = nzp;
    const moved = Math.hypot(x - px, z - pz);
    if (moved < 1e-6) return false;
    const prog = (x - a[0]) * dirX + (z - a[1]) * dirZ;
    if (prog < traveled - 1e-4) return false;
    traveled = Math.max(traveled, prog);
    px = x;
    pz = z;
  }
  return Math.hypot(px - b[0], pz - b[1]) <= PATH_ARRIVE;
}

/**
 * LOS string-pulling over an A* polyline. A* remains the source of truth;
 * this only removes vertices when the shortcut is eroded-walkable.
 */
export function stringPullPath(
  path: readonly (readonly [number, number])[],
  walkable: (point: readonly [number, number], radius: number) => boolean,
  radius: number,
  step: number,
): readonly (readonly [number, number])[] {
  if (path.length <= 2) return path;
  const out: Array<readonly [number, number]> = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    for (let j = path.length - 1; j > i + 1; j--) {
      if (segmentClear(walkable, path[i]!, path[j]!, radius, step)) {
        best = j;
        break;
      }
    }
    out.push(path[best]!);
    i = best;
  }
  return out;
}

/**
 * Replace the A* start (own-cell centre) with the agent's true position so
 * the first leg never backsteps (§0(a)/(c)).
 *
 * Same-cell A* returns a single goal centre — must keep that head when
 * prepending `from`, otherwise the destination is discarded.
 */
export function anchorPathAtStart(
  from: readonly [number, number],
  path: readonly (readonly [number, number])[],
): readonly (readonly [number, number])[] {
  if (path.length === 0) return path;
  const head = path[0]!;
  if (Math.hypot(from[0] - head[0], from[1] - head[1]) < 0.01) return path;
  if (path.length === 1) return [[from[0], from[1]] as const, head];
  return [[from[0], from[1]] as const, ...path.slice(1)];
}

function tryClickSnap(
  from: readonly [number, number],
  to: readonly [number, number],
  path: readonly (readonly [number, number])[],
  walkable: (point: readonly [number, number], radius: number) => boolean,
  step: number,
  snapOk: boolean,
): readonly (readonly [number, number])[] {
  if (!snapOk || path.length === 0) return path;
  const last = path[path.length - 1]!;
  if (Math.hypot(last[0] - to[0], last[1] - to[1]) <= 0.01) return path;
  const prev = path.length >= 2 ? path[path.length - 2]! : from;
  // Validate at sprint stride so Shift-held click-move cannot invent a chord
  // that walk-speed validation would accept but sprint overshoots into a pinch.
  // Keep ±0.4 m side probes for long multi-cell snaps (walk-speed pinches that
  // sprint accept misses). Same-cell false rejects are recovered by the direct
  // [from,to] fallback in postProcessPath.
  if (!segmentClear(walkable, prev, to, NAV_AGENT_RADIUS, step, NAV_VALIDATE_STRIDE)) return path;
  for (const [ox, oz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]] as const) {
    const p2 = [prev[0] + ox, prev[1] + oz] as const;
    if (!walkable(p2, NAV_AGENT_RADIUS)) continue;
    if (!segmentClear(walkable, p2, to, NAV_AGENT_RADIUS, step, NAV_VALIDATE_STRIDE)) return path;
  }
  return [...path.slice(0, -1), [to[0], to[1]] as const];
}

function followerAccepts(
  from: readonly [number, number],
  to: readonly [number, number],
  path: readonly (readonly [number, number])[],
  walkable: (point: readonly [number, number], radius: number) => boolean,
): boolean {
  if (path.length === 0) return false;
  const sim = simulateFollowPath(path, from, (x, z) => walkable([x, z], NAV_AGENT_RADIUS), {
    walkSpeed: PLAYER_SPRINT_SPEED,
    dt: NAV_VALIDATE_DT,
  });
  if (!sim.arrived || sim.uTurnCount !== 0 || sim.stuckCount !== 0) return false;
  // Must land near the click — arriving at an A* cell centre while still far
  // from `to` is a zero-move trap when the agent already sits in PATH_ARRIVE.
  if (Math.hypot(sim.finalPos[0] - to[0], sim.finalPos[1] - to[1]) > PATH_ARRIVE) {
    return false;
  }
  const goalDist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (goalDist > PATH_ARRIVE && sim.walkedLength < 1e-3) return false;
  return true;
}

/** Validated direct click path — used when A* + snap cannot land near `to`. */
function directClickPath(
  from: readonly [number, number],
  to: readonly [number, number],
): readonly (readonly [number, number])[] {
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) <= PATH_ARRIVE) {
    return [[to[0], to[1]] as const];
  }
  return [[from[0], from[1]] as const, [to[0], to[1]] as const];
}

function postProcessPath(
  from: readonly [number, number],
  to: readonly [number, number],
  cells: readonly (readonly [number, number])[],
  walkable: (point: readonly [number, number], radius: number) => boolean,
  cellSize: number,
  snapOk: boolean,
): readonly (readonly [number, number])[] {
  if (cells.length === 0) return cells;
  const step = cellSize / 8;
  const anchored = anchorPathAtStart(from, cells);
  const pulled = tryClickSnap(
    from,
    to,
    stringPullPath(anchored, walkable, NAV_AGENT_RADIUS, step),
    walkable,
    step,
    snapOk,
  );
  if (followerAccepts(from, to, pulled, walkable)) return pulled;
  const safe = tryClickSnap(from, to, anchored, walkable, step, snapOk);
  if (followerAccepts(from, to, safe, walkable)) return safe;
  // Same-cell / failed-snap: prefer a validated chord to the click over a
  // cell-centre path that "arrives" without reaching `to`.
  const direct = directClickPath(from, to);
  const directClear = direct.length < 2
    || segmentClear(walkable, direct[0]!, direct[1]!, NAV_AGENT_RADIUS, step, NAV_VALIDATE_STRIDE);
  if (directClear && followerAccepts(from, to, direct, walkable)) return direct;
  // Keep A* when it lands near the click.
  if (followerAccepts(from, to, anchored, walkable)) return anchored;
  // Important #3: reject only the zero-move trap (already at last wp, far from
  // click). Multi-cell A* that cannot snap still beats an empty path.
  const last = anchored[anchored.length - 1]!;
  const nearLast = Math.hypot(from[0] - last[0], from[1] - last[1]) <= PATH_ARRIVE;
  const farFromTo = Math.hypot(to[0] - from[0], to[1] - from[1]) > PATH_ARRIVE;
  if (nearLast && farFromTo) {
    if (directClear) return direct;
    return [];
  }
  return anchored;
}

export function createOpenAreaNavigation(
  bounds: WorldBounds,
  blockers: readonly NavBlocker[],
  cellSize = 1,
): NavigationQuery {
  const grid = rasterizeBlockers(bounds, cellSize, blockers);
  const inBounds = (x: number, z: number) =>
    x > bounds.x0 && x < bounds.x1 && z > bounds.z0 && z < bounds.z1;

  const walkable = (point: readonly [number, number], radius: number): boolean => {
    const samples = radius <= 0
      ? [[0, 0] as const]
      : [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius], [0, 0]] as const;
    for (const [ox, oz] of samples) {
      const x = point[0] + ox;
      const z = point[1] + oz;
      if (!inBounds(x, z)) return false;
      if (pointHitsBlocker(x, z, blockers)) return false;
    }
    return true;
  };

  return {
    walkable,
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
      return postProcessPath(from, to, cells, walkable, cellSize, walkable(to, NAV_AGENT_RADIUS));
    },
  };
}

export function createDungeonNavigation(dungeon: DungeonNavSource): NavigationQuery {
  const walkable = (point: readonly [number, number], radius: number): boolean => {
    if (radius <= 0) return dungeon.walkable(point[0], point[1]);
    for (const [ox, oz] of [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]] as const) {
      if (!dungeon.walkable(point[0] + ox, point[1] + oz)) return false;
    }
    return true;
  };

  return {
    walkable,
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
      return postProcessPath(from, to, cells, walkable, CELL, walkable(to, NAV_AGENT_RADIUS));
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
