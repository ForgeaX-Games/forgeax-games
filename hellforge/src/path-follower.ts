// Pure path follower — arrive/advance + per-axis slide (extracted from main.ts
// so navigation regression can drive the same implementation the game uses).

/** Metres — waypoint considered reached (matches pre-PR12 main.ts). */
export const PATH_ARRIVE = 0.45;

/** Player ground speeds (m/s) — shared with main.ts / nav validation. */
export const PLAYER_WALK_SPEED = 3.4;
export const PLAYER_SPRINT_SPEED = 5.4;
/** Frame dt used when validating paths against the follower. */
export const NAV_VALIDATE_DT = 1 / 60;
/** Worst-case stride (sprint × dt) for snap / accept checks. */
export const NAV_VALIDATE_STRIDE = PLAYER_SPRINT_SPEED * NAV_VALIDATE_DT;

/** Metres — pursuit target must move at least this far to trigger a repath. */
export const PURSUIT_REPATH_DIST = 0.5;

/** Whether a pursuit repath should run (hysteresis gate). */
export function shouldRepathPursuit(
  lastTarget: readonly [number, number] | null,
  newTarget: readonly [number, number],
  pathEmpty: boolean,
  threshold = PURSUIT_REPATH_DIST,
): boolean {
  if (pathEmpty || lastTarget == null) return true;
  return Math.hypot(newTarget[0] - lastTarget[0], newTarget[1] - lastTarget[1]) > threshold;
}

export type NavPoint = readonly [number, number];

export type FollowDirectionResult = {
  /** Unit XZ direction toward the current waypoint, or (0,0) if complete. */
  dirX: number;
  dirZ: number;
  /** Advanced waypoint index (after skipping arrived waypoints). */
  idx: number;
  /** True when every waypoint has been arrived at. */
  complete: boolean;
};

/**
 * Advance along a waypoint list: skip waypoints within arriveRadius, then
 * return the unit direction toward the current one.
 */
export function followPathDirection(
  path: readonly NavPoint[],
  idx: number,
  px: number,
  pz: number,
  arriveRadius = PATH_ARRIVE,
): FollowDirectionResult {
  let i = idx;
  while (i < path.length) {
    const wp = path[i]!;
    const dx = wp[0] - px;
    const dz = wp[1] - pz;
    const dist = Math.hypot(dx, dz);
    if (dist <= arriveRadius) {
      i += 1;
      continue;
    }
    return { dirX: dx / dist, dirZ: dz / dist, idx: i, complete: false };
  }
  return { dirX: 0, dirZ: 0, idx: i, complete: true };
}

/**
 * Integrate a desired direction with per-axis walkability so walls slide
 * instead of sticking (both axes checked independently).
 *
 * `step` is the distance to attempt this frame (speed × dt).
 */
export function integratePerAxisSlide(
  px: number,
  pz: number,
  dirX: number,
  dirZ: number,
  step: number,
  walkableAt: (x: number, z: number) => boolean,
): { px: number; pz: number } {
  const len = Math.hypot(dirX, dirZ);
  if (len <= 0 || step <= 0) return { px, pz };
  const nx = dirX / len;
  const nz = dirZ / len;
  let x = px;
  let z = pz;
  const nxp = x + nx * step;
  const nzp = z + nz * step;
  if (walkableAt(nxp, z)) x = nxp;
  if (walkableAt(x, nzp)) z = nzp;
  return { px: x, pz: z };
}

/** Walked length of a polyline (sum of segment lengths). */
export function pathPolylineLength(path: readonly NavPoint[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

export type SimulateFollowOptions = {
  walkSpeed: number;
  dt: number;
  /** Simulated-time budget multiplier of (pathLength / walkSpeed). Default 3. */
  timeBudgetMul?: number;
  arriveRadius?: number;
  /** Heading flip (degrees) that counts as a U-turn. Default 150. */
  uTurnDegrees?: number;
  /** Displacement window for stuck detection (seconds). Default 1.0. */
  stuckWindowSec?: number;
  /** Displacement below this over stuckWindowSec → stuck. Default 0.05. */
  stuckDisplaceM?: number;
};

export type SimulateFollowResult = {
  arrived: boolean;
  walkedLength: number;
  simTime: number;
  uTurnCount: number;
  stuckCount: number;
  finalPos: NavPoint;
  finalIdx: number;
};

/**
 * Drive {@link followPathDirection} + {@link integratePerAxisSlide} until the
 * path completes or the time budget expires. Used by navigation regression.
 */
export function simulateFollowPath(
  path: readonly NavPoint[],
  start: NavPoint,
  walkableAt: (x: number, z: number) => boolean,
  opts: SimulateFollowOptions,
): SimulateFollowResult {
  const arriveRadius = opts.arriveRadius ?? PATH_ARRIVE;
  const timeBudgetMul = opts.timeBudgetMul ?? 3;
  const uTurnDeg = opts.uTurnDegrees ?? 150;
  const stuckWindow = opts.stuckWindowSec ?? 1.0;
  const stuckDisplace = opts.stuckDisplaceM ?? 0.05;
  // Include start→path[0]: same-cell / single-wp paths have polyline length 0
  // but still need a real travel budget (otherwise followerAccepts always rejects).
  const head = path[0];
  const startLeg = head
    ? Math.hypot(head[0] - start[0], head[1] - start[1])
    : 0;
  const pathLen = Math.max(startLeg + pathPolylineLength(path), 0.01);
  const budget = timeBudgetMul * (pathLen / opts.walkSpeed);

  let px = start[0];
  let pz = start[1];
  let idx = 0;
  let simTime = 0;
  let walked = 0;
  let uTurns = 0;
  let stuckEvents = 0;
  let prevDirX = 0;
  let prevDirZ = 0;
  let windowStartT = 0;
  let windowStartX = px;
  let windowStartZ = pz;
  let inStuckWindow = false;

  while (simTime < budget) {
    const step = followPathDirection(path, idx, px, pz, arriveRadius);
    idx = step.idx;
    if (step.complete) {
      return {
        arrived: true,
        walkedLength: walked,
        simTime,
        uTurnCount: uTurns,
        stuckCount: stuckEvents,
        finalPos: [px, pz],
        finalIdx: idx,
      };
    }

    if (prevDirX !== 0 || prevDirZ !== 0) {
      const dot = prevDirX * step.dirX + prevDirZ * step.dirZ;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
      if (ang > uTurnDeg) uTurns += 1;
    }
    prevDirX = step.dirX;
    prevDirZ = step.dirZ;

    const beforeX = px;
    const beforeZ = pz;
    const next = integratePerAxisSlide(px, pz, step.dirX, step.dirZ, opts.walkSpeed * opts.dt, walkableAt);
    px = next.px;
    pz = next.pz;
    walked += Math.hypot(px - beforeX, pz - beforeZ);
    simTime += opts.dt;

    // Stuck window: < stuckDisplace over stuckWindow while still following.
    if (!inStuckWindow) {
      inStuckWindow = true;
      windowStartT = simTime;
      windowStartX = px;
      windowStartZ = pz;
    } else if (simTime - windowStartT >= stuckWindow) {
      const disp = Math.hypot(px - windowStartX, pz - windowStartZ);
      if (disp < stuckDisplace) stuckEvents += 1;
      windowStartT = simTime;
      windowStartX = px;
      windowStartZ = pz;
    }
  }

  return {
    arrived: false,
    walkedLength: walked,
    simTime,
    uTurnCount: uTurns,
    stuckCount: stuckEvents,
    finalPos: [px, pz],
    finalIdx: idx,
  };
}
