/**
 * MarsCraft -> forgeax-engine — FlowField port (Milestone M5)
 * =============================================================================
 * Port of the Three.js source `web/systems/FlowField.ts`. Local flow-field
 * steering toward a target:
 *   1. reverse BFS from the goal cell -> cost field (distance to goal)
 *   2. cost field -> direction field (each cell points to its lowest-cost neighbor)
 *   3. cache: targetKey -> FlowFieldData (10s TTL, max 64) so a whole group
 *      sharing a target shares one field (cost is independent of unit count)
 *
 * Ported 1:1: same 8-direction offsets/costs, diagonal corner-cutting guard,
 * MAX_BFS_STEPS cap, clearance-aware passability, goal-cell relocation when the
 * exact goal is blocked, pre-allocated cost buffer, cache eviction. `gameTimeMs`
 * is fed each frame by the CommandExecutor (deterministic game time).
 *
 * Pure logic — no rendering. Depends only on the ported PathGrid.
 */

import type { PathGrid } from '../world/path-grid';

/** 8-direction offsets (matches the source). */
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DZ = [1, 1, 0, -1, -1, -1, 0, 1];
const COST = [1, 1.41, 1, 1.41, 1, 1.41, 1, 1.41];

/** Direction code -> normalized direction vector. */
const DIR_VECTORS: [number, number][] = DX.map((dx, i) => {
  const dz = DZ[i];
  const len = Math.sqrt(dx * dx + dz * dz);
  return [dx / len, dz / len];
});

/** Flow-field data. */
export interface FlowFieldData {
  targetCol: number;
  targetRow: number;
  /** Direction field: one direction code per cell (0-7), -1 = no direction. */
  directions: Int8Array;
  /** Creation timestamp (game ms). */
  timestamp: number;
  /** walkableVersion at creation (detects building-change invalidation). */
  walkableVersion: number;
  /** Min clearance (cells) used; 0 = point-level (no filtering). */
  minClearance: number;
}

/**
 * Max BFS expansion steps — caps the cost-field spread so a single field stays
 * cheap; long-distance routing is handled by the region A* Pathfinder.
 */
const MAX_BFS_STEPS = 20000;

export class FlowField {
  private _pathGrid: PathGrid;
  private _res: number;
  private _mapWidth: number;
  private _mapHeight: number;

  private _cache = new Map<string, FlowFieldData>();
  private _cacheTTL = 10_000;
  private _maxCache = 64;

  /** Pre-allocated cost buffer (filled each compute, avoids re-alloc). */
  private _costs: Float32Array;

  /** Deterministic game time (ms), set each frame by the owner. */
  public gameTimeMs = 0;

  constructor(pathGrid: PathGrid, mapWidth: number, mapHeight: number) {
    this._pathGrid = pathGrid;
    this._res = pathGrid.gridResolution;
    this._mapWidth = mapWidth;
    this._mapHeight = mapHeight;
    this._costs = new Float32Array(this._res * this._res);
  }

  /**
   * Get a flow field (cached when fresh + same walkableVersion).
   * @param minClearance min clearance (cells); 0 = point-level.
   */
  getField(worldX: number, worldZ: number, minClearance = 0): FlowFieldData | null {
    const col = this._worldToCol(worldX);
    const row = this._worldToRow(worldZ);
    if (col < 0 || col >= this._res || row < 0 || row >= this._res) return null;

    const key = `${col},${row},${minClearance}`;
    const now = this.gameTimeMs;

    const cached = this._cache.get(key);
    if (cached && now - cached.timestamp < this._cacheTTL
        && cached.walkableVersion === this._pathGrid.walkableVersion) {
      return cached;
    }

    const field = this._compute(col, row, minClearance);
    if (!field) return null;

    this._cache.set(key, field);
    if (this._cache.size > this._maxCache) {
      // Evict the oldest.
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [k, v] of this._cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }
      if (oldestKey) this._cache.delete(oldestKey);
    }

    return field;
  }

  /**
   * Flow direction at a world coordinate.
   * @returns [dirX, dirZ] normalized; [0,0] = no direction.
   */
  getDirection(field: FlowFieldData, worldX: number, worldZ: number): [number, number] {
    const col = this._worldToCol(worldX);
    const row = this._worldToRow(worldZ);

    if (col < 0 || col >= this._res || row < 0 || row >= this._res) return [0, 0];

    const dir = field.directions[row * this._res + col];
    if (dir < 0 || dir > 7) return [0, 0];

    return DIR_VECTORS[dir];
  }

  /** Current walkable version (lets the owner detect building changes). */
  get walkableVersion(): number {
    return this._pathGrid.walkableVersion;
  }

  clearCache(): void {
    this._cache.clear();
  }

  // ----------------------------------------------------------
  // Internal
  // ----------------------------------------------------------

  private _compute(targetCol: number, targetRow: number, minClearance: number): FlowFieldData | null {
    const res = this._res;
    const walkable = this._pathGrid.walkable;
    const clearance = this._pathGrid.clearance;
    const total = res * res;

    const passable = (idx: number) => walkable[idx] && clearance[idx] >= minClearance;

    const costs = this._costs;
    costs.fill(Infinity);

    // Goal blocked -> find the nearest passable cell.
    let goalIdx = targetRow * res + targetCol;
    if (!passable(goalIdx)) {
      let found = false;
      for (let r = 1; r <= 5 && !found; r++) {
        for (let dr = -r; dr <= r && !found; dr++) {
          for (let dc = -r; dc <= r && !found; dc++) {
            if (Math.abs(dr) !== r && Math.abs(dc) !== r) continue;
            const nr = targetRow + dr;
            const nc = targetCol + dc;
            if (nr >= 0 && nr < res && nc >= 0 && nc < res && passable(nr * res + nc)) {
              targetRow = nr;
              targetCol = nc;
              goalIdx = nr * res + nc;
              found = true;
            }
          }
        }
      }
      if (!found) return null;
    }

    // ── reverse BFS (spread out from the goal, step-capped) ──
    costs[goalIdx] = 0;
    const queue: number[] = [goalIdx];
    let head = 0;

    while (head < queue.length && head < MAX_BFS_STEPS) {
      const idx = queue[head++];
      const row = Math.floor(idx / res);
      const col = idx % res;
      const curCost = costs[idx];

      for (let d = 0; d < 8; d++) {
        const nc = col + DX[d];
        const nr = row + DZ[d];
        if (nc < 0 || nc >= res || nr < 0 || nr >= res) continue;

        const nIdx = nr * res + nc;
        if (!passable(nIdx)) continue;

        // Diagonal: both orthogonal neighbors must be passable (no corner cut).
        if (d % 2 === 1) {
          if (!passable(row * res + nc) || !passable(nr * res + col)) continue;
        }

        const newCost = curCost + COST[d];
        if (newCost < costs[nIdx]) {
          costs[nIdx] = newCost;
          queue.push(nIdx);
        }
      }
    }

    // ── direction field: only for BFS-visited cells (skip full-grid scan) ──
    const directions = new Int8Array(total).fill(-1);
    const visitedCount = Math.min(queue.length, MAX_BFS_STEPS);

    for (let i = 0; i < visitedCount; i++) {
      const idx = queue[i];
      if (costs[idx] === Infinity || costs[idx] === 0) continue;

      const r = Math.floor(idx / res);
      const c = idx % res;

      let bestDir = -1;
      let bestCost = costs[idx];

      for (let d = 0; d < 8; d++) {
        const nc2 = c + DX[d];
        const nr2 = r + DZ[d];
        if (nc2 < 0 || nc2 >= res || nr2 < 0 || nr2 >= res) continue;

        if (d % 2 === 1) {
          if (!passable(r * res + nc2) || !passable(nr2 * res + c)) continue;
        }

        const nCost = costs[nr2 * res + nc2];
        if (nCost < bestCost) {
          bestCost = nCost;
          bestDir = d;
        }
      }

      directions[idx] = bestDir;
    }

    return {
      targetCol,
      targetRow,
      directions,
      timestamp: this.gameTimeMs,
      walkableVersion: this._pathGrid.walkableVersion,
      minClearance,
    };
  }

  private _worldToCol(worldX: number): number {
    return Math.round(((worldX + this._mapWidth / 2) / this._mapWidth) * (this._res - 1));
  }

  private _worldToRow(worldZ: number): number {
    return Math.round(((worldZ + this._mapHeight / 2) / this._mapHeight) * (this._res - 1));
  }
}
