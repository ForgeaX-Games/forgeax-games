/**
 * MarsCraft -> forgeax-engine — A* region Pathfinder port (Milestone M5)
 * =============================================================================
 * Port of the Three.js source `web/systems/Pathfinder.ts`. The upper level of
 * the two-level pathing scheme: A* over PathGrid's region adjacency graph,
 * returning a portal-center waypoint list (in world coords) that CommandExecutor
 * drives the FlowField through segment by segment.
 *
 * Pure logic, no rendering, no ECS. Ported 1:1 from the source (same
 * MAX_ITERATIONS, euclidean heuristic, open/closed-set A*, path reconstruction).
 */

import type { PathGrid, PortalInfo } from '../world/path-grid';

/** A* waypoint (world coords). */
export interface Waypoint {
  x: number;
  z: number;
}

/** Max search nodes (guards huge maps). */
const MAX_ITERATIONS = 500;

export class Pathfinder {
  private _pathGrid: PathGrid;

  constructor(pathGrid: PathGrid) {
    this._pathGrid = pathGrid;
  }

  /**
   * Two-level pathfinding: region-level A*.
   *
   * @returns waypoint array (portal centers + end), `null` = unreachable,
   *          empty array `[]` = same region (direct, no portals needed).
   */
  findPath(startX: number, startZ: number, endX: number, endZ: number): Waypoint[] | null {
    const grid = this._pathGrid;
    const startRegion = grid.getRegionAt(startX, startZ);
    const endRegion = grid.getRegionAt(endX, endZ);

    // Start or end outside any walkable region.
    if (startRegion < 0 || endRegion < 0) return null;

    // Same region -> no portal waypoints needed.
    if (startRegion === endRegion) return [];

    // ---- A* on the region adjacency graph ----

    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();
    const cameFrom = new Map<number, { fromRegion: number; portal: PortalInfo }>();
    const openSet = new Set<number>();
    const closedSet = new Set<number>();

    const endInfo = grid.regions.get(endRegion);
    if (!endInfo) return null;

    gScore.set(startRegion, 0);
    fScore.set(startRegion, this._heuristic(startX, startZ, endInfo.centerWorldX, endInfo.centerWorldZ));
    openSet.add(startRegion);

    let iterations = 0;

    while (openSet.size > 0 && iterations < MAX_ITERATIONS) {
      iterations++;

      // Pick the open node with the lowest fScore.
      let current = -1;
      let currentF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) ?? Infinity;
        if (f < currentF) {
          currentF = f;
          current = id;
        }
      }
      if (current < 0) break;

      // Reached the goal region -> reconstruct.
      if (current === endRegion) {
        return this._reconstructPath(cameFrom, startRegion, endRegion, endX, endZ);
      }

      openSet.delete(current);
      closedSet.add(current);

      const neighbors = grid.adjacency.get(current);
      if (!neighbors) continue;

      const currentG = gScore.get(current) ?? Infinity;

      for (const { neighborId, portalIdx } of neighbors) {
        if (closedSet.has(neighborId)) continue;

        const portal = grid.portals[portalIdx];
        const tentativeG = currentG + portal.cost;

        const prevG = gScore.get(neighborId) ?? Infinity;
        if (tentativeG >= prevG) continue;

        cameFrom.set(neighborId, { fromRegion: current, portal });
        gScore.set(neighborId, tentativeG);

        const neighborInfo = grid.regions.get(neighborId)!;
        fScore.set(neighborId, tentativeG + this._heuristic(
          neighborInfo.centerWorldX, neighborInfo.centerWorldZ,
          endInfo.centerWorldX, endInfo.centerWorldZ,
        ));

        openSet.add(neighborId);
      }
    }

    // Searched out without reaching the goal -> unreachable.
    return null;
  }

  /** Quick connectivity check. */
  isReachable(startX: number, startZ: number, endX: number, endZ: number): boolean {
    return this.findPath(startX, startZ, endX, endZ) !== null;
  }

  // ============================================================
  // Internal
  // ============================================================

  private _heuristic(ax: number, az: number, bx: number, bz: number): number {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private _reconstructPath(
    cameFrom: Map<number, { fromRegion: number; portal: PortalInfo }>,
    startRegion: number,
    endRegion: number,
    endX: number,
    endZ: number,
  ): Waypoint[] {
    const portalWaypoints: Waypoint[] = [];

    let current = endRegion;
    while (cameFrom.has(current)) {
      const { fromRegion, portal } = cameFrom.get(current)!;
      portalWaypoints.push({ x: portal.worldX, z: portal.worldZ });
      current = fromRegion;
      if (current === startRegion) break;
    }

    // Reverse: start -> end direction.
    portalWaypoints.reverse();

    // Append the final destination.
    portalWaypoints.push({ x: endX, z: endZ });

    return portalWaypoints;
  }
}
