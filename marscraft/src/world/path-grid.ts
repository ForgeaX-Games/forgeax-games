/**
 * MarsCraft -> forgeax-engine — PathGrid port (Milestone M5)
 * =============================================================================
 * Port of the Three.js source `web/world/PathGrid.ts`. A passability grid built
 * from the map's `pathingGrid` (0 = walkable, 1 = blocked) plus a two-level
 * region/portal graph used by the A* `Pathfinder` and a chebyshev clearance map
 * used by the `FlowField` to filter narrow corridors by unit footprint.
 *
 * Source-fidelity notes:
 * - `walkable[]` is derived from `MapConfig.pathingGrid` (the new-system path,
 *   already buffered) when present, else from `terrainTypes` with a 1-cell
 *   anti-cliff buffer (legacy fallback) — both branches ported verbatim.
 * - Region build = per-SECTOR flood fill (4-connected), portal discovery between
 *   adjacent differing regions, region adjacency graph. 1:1 with the source.
 * - Clearance = multi-source BFS chebyshev distance from all blocked cells.
 *
 * The only translation vs the Three.js original is the dependency surface: the
 * source imported `MapConfig` + grid helpers from `./MapData`; here they come
 * from `../mapgen` (engine-agnostic, ported wholesale in M1).
 */

import type { MapConfig } from '../mapgen/types';
import { isWalkable } from '../mapgen/types';
import { worldToGrid, gridToWorld } from '../mapgen/geometry';

// ============================================================
// Sector / region constants + types
// ============================================================

/** Sector size in cells (the source default; regions are built per sector). */
export const SECTOR_SIZE = 16;

/** A connected walkable region within a sector. */
export interface RegionInfo {
  id: number;
  sectorCol: number;
  sectorRow: number;
  centerCol: number;
  centerRow: number;
  centerWorldX: number;
  centerWorldZ: number;
  cellCount: number;
}

/** A portal: the shared border between two adjacent regions. */
export interface PortalInfo {
  /** Region A (lower id). */
  regionA: number;
  /** Region B (higher id). */
  regionB: number;
  /** Portal center world X. */
  worldX: number;
  /** Portal center world Z. */
  worldZ: number;
  /** Traversal cost (euclidean distance between the two region centers). */
  cost: number;
}

// ============================================================
// PathGrid
// ============================================================

export class PathGrid {
  /** Passability grid (true = walkable). */
  public readonly walkable: boolean[];
  public readonly gridResolution: number;
  private _mapConfig: MapConfig;

  /**
   * Version bumped each time `walkable` is mutated (building placed/removed).
   * FlowField compares this to invalidate cached fields.
   */
  public walkableVersion = 0;

  /**
   * Clearance map — chebyshev distance (in cells) from each cell to the nearest
   * blocked cell. Blocked cells have clearance 0. FlowField uses it to keep wide
   * units out of narrow corridors.
   */
  public readonly clearance: Float32Array;

  /** World-units size of one cell (mapWidth / gridResolution). */
  public readonly cellSize: number;

  // ---- region data (two-level pathfinding) ----

  /** Per-cell region id (-1 = blocked / no region). */
  public readonly regionMap: Int16Array;
  public readonly regions = new Map<number, RegionInfo>();
  public readonly portals: PortalInfo[] = [];
  /** Adjacency list: regionId -> [{ neighborId, portalIdx }]. */
  public readonly adjacency = new Map<number, { neighborId: number; portalIdx: number }[]>();

  constructor(mapConfig: MapConfig) {
    this._mapConfig = mapConfig;
    this.gridResolution = mapConfig.gridResolution;
    this.cellSize = mapConfig.width / mapConfig.gridResolution;
    const res = this.gridResolution;

    // ---- derive walkability from pathingGrid (new) or terrainTypes (legacy) ----
    this.walkable = new Array<boolean>(res * res);
    this.clearance = new Float32Array(res * res);

    if (mapConfig.pathingGrid && mapConfig.pathingGrid.length === res * res) {
      // New system: pathingGrid is authoritative (0 = walkable, already buffered).
      for (let i = 0; i < res * res; i++) {
        this.walkable[i] = mapConfig.pathingGrid[i] === 0;
      }
    } else {
      // Legacy fallback: derive from terrainTypes + a 1-cell anti-cliff buffer.
      const rawWalkable = new Array<boolean>(res * res);
      for (let i = 0; i < res * res; i++) {
        rawWalkable[i] = isWalkable(mapConfig.terrainTypes[i]);
      }
      for (let row = 0; row < res; row++) {
        for (let col = 0; col < res; col++) {
          const idx = row * res + col;
          if (!rawWalkable[idx]) {
            this.walkable[idx] = false;
            continue;
          }
          let nearCliff = false;
          for (let dr = -1; dr <= 1 && !nearCliff; dr++) {
            for (let dc = -1; dc <= 1 && !nearCliff; dc++) {
              if (dr === 0 && dc === 0) continue;
              const r = row + dr;
              const c = col + dc;
              if (r >= 0 && r < res && c >= 0 && c < res) {
                if (!rawWalkable[r * res + c]) nearCliff = true;
              }
            }
          }
          this.walkable[idx] = !nearCliff;
        }
      }
    }

    // ---- build regions ----
    this.regionMap = new Int16Array(res * res).fill(-1);
    this._buildRegions();

    // ---- compute clearance map ----
    this._computeClearance();
  }

  // ============================================================
  // Public queries
  // ============================================================

  /** Is the world coordinate walkable? */
  isWalkableAt(worldX: number, worldZ: number): boolean {
    const map = this._mapConfig;
    const { col, row } = worldToGrid(worldX, worldZ, map.width, map.height, map.gridResolution);
    return this.walkable[row * map.gridResolution + col];
  }

  /** Clamp a world coordinate to the nearest walkable point. */
  clampToWalkable(worldX: number, worldZ: number): { x: number; z: number } {
    if (this.isWalkableAt(worldX, worldZ)) {
      return { x: worldX, z: worldZ };
    }

    const map = this._mapConfig;
    const res = map.gridResolution;
    const { col: cx, row: cz } = worldToGrid(worldX, worldZ, map.width, map.height, res);

    let bestDist = Infinity;
    let bestCol = cx;
    let bestRow = cz;
    const searchRadius = 10;

    for (let dr = -searchRadius; dr <= searchRadius; dr++) {
      for (let dc = -searchRadius; dc <= searchRadius; dc++) {
        const r = cz + dr;
        const c = cx + dc;
        if (r < 0 || r >= res || c < 0 || c >= res) continue;
        if (!this.walkable[r * res + c]) continue;

        const d = dr * dr + dc * dc;
        if (d < bestDist) {
          bestDist = d;
          bestCol = c;
          bestRow = r;
        }
      }
    }

    return gridToWorld(bestCol, bestRow, map.width, map.height, res);
  }

  /** Terrain height at a world coordinate (from the map heightData). */
  getHeightAt(worldX: number, worldZ: number): number {
    const map = this._mapConfig;
    const { col, row } = worldToGrid(worldX, worldZ, map.width, map.height, map.gridResolution);
    const idx = row * map.gridResolution + col;
    return map.heightData[idx] ?? 0;
  }

  /** Region id at a world coordinate (-1 = not in any walkable region). */
  getRegionAt(worldX: number, worldZ: number): number {
    const map = this._mapConfig;
    const { col, row } = worldToGrid(worldX, worldZ, map.width, map.height, map.gridResolution);
    const idx = row * map.gridResolution + col;
    if (idx < 0 || idx >= this.regionMap.length) return -1;
    return this.regionMap[idx];
  }

  /** Clearance (cells) at a world coordinate. 0 = blocked or wall-adjacent. */
  getClearanceAt(worldX: number, worldZ: number): number {
    const map = this._mapConfig;
    const { col, row } = worldToGrid(worldX, worldZ, map.width, map.height, map.gridResolution);
    const idx = row * map.gridResolution + col;
    if (idx < 0 || idx >= this.clearance.length) return 0;
    return this.clearance[idx];
  }

  /** Recompute the whole clearance map (call after walkable mutation). */
  updateClearance(): void {
    this._computeClearance();
  }

  // ============================================================
  // Clearance map (internal)
  // ============================================================

  /**
   * Multi-source BFS chebyshev distance. All blocked cells seed the frontier
   * (distance 0); the wave spreads into walkable cells. O(N).
   */
  private _computeClearance(): void {
    const res = this.gridResolution;
    const total = res * res;
    const cl = this.clearance;

    cl.fill(Infinity);

    const queue: number[] = [];
    let head = 0;

    for (let i = 0; i < total; i++) {
      if (!this.walkable[i]) {
        cl[i] = 0;
        queue.push(i);
      }
    }

    while (head < queue.length) {
      const idx = queue[head++];
      const row = Math.floor(idx / res);
      const col = idx % res;
      const nextDist = cl[idx] + 1;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = row + dr;
          const nc = col + dc;
          if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue;
          const nIdx = nr * res + nc;
          if (nextDist < cl[nIdx]) {
            cl[nIdx] = nextDist;
            queue.push(nIdx);
          }
        }
      }
    }
  }

  // ============================================================
  // Region build (internal)
  // ============================================================

  private _buildRegions(): void {
    const res = this.gridResolution;
    const sectorsPerAxis = Math.ceil(res / SECTOR_SIZE);
    const map = this._mapConfig;
    let nextRegionId = 0;

    // ---- 1. per-sector flood fill -> region ids ----
    for (let sz = 0; sz < sectorsPerAxis; sz++) {
      for (let sx = 0; sx < sectorsPerAxis; sx++) {
        const minRow = sz * SECTOR_SIZE;
        const maxRow = Math.min(minRow + SECTOR_SIZE, res);
        const minCol = sx * SECTOR_SIZE;
        const maxCol = Math.min(minCol + SECTOR_SIZE, res);

        for (let row = minRow; row < maxRow; row++) {
          for (let col = minCol; col < maxCol; col++) {
            const idx = row * res + col;
            if (!this.walkable[idx] || this.regionMap[idx] >= 0) continue;

            // Flood fill from this cell (4-connected, clamped to the sector).
            const regionId = nextRegionId++;
            let sumCol = 0;
            let sumRow = 0;
            let count = 0;
            const queue = [idx];
            this.regionMap[idx] = regionId;

            while (queue.length > 0) {
              const ci = queue.pop()!;
              const cr = Math.floor(ci / res);
              const cc = ci % res;
              sumCol += cc;
              sumRow += cr;
              count++;

              const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
              for (const [dr, dc] of dirs) {
                const nr = cr + dr;
                const nc = cc + dc;
                if (nr < minRow || nr >= maxRow || nc < minCol || nc >= maxCol) continue;
                const ni = nr * res + nc;
                if (!this.walkable[ni] || this.regionMap[ni] >= 0) continue;
                this.regionMap[ni] = regionId;
                queue.push(ni);
              }
            }

            const centerCol = Math.round(sumCol / count);
            const centerRow = Math.round(sumRow / count);
            const world = gridToWorld(centerCol, centerRow, map.width, map.height, res);

            this.regions.set(regionId, {
              id: regionId,
              sectorCol: sx,
              sectorRow: sz,
              centerCol,
              centerRow,
              centerWorldX: world.x,
              centerWorldZ: world.z,
              cellCount: count,
            });
          }
        }
      }
    }

    // ---- 2. discover portals (adjacent cells in different regions) ----
    this._findPortals();

    // ---- 3. build adjacency list ----
    for (let i = 0; i < this.portals.length; i++) {
      const p = this.portals[i];

      let listA = this.adjacency.get(p.regionA);
      if (!listA) { listA = []; this.adjacency.set(p.regionA, listA); }
      listA.push({ neighborId: p.regionB, portalIdx: i });

      let listB = this.adjacency.get(p.regionB);
      if (!listB) { listB = []; this.adjacency.set(p.regionB, listB); }
      listB.push({ neighborId: p.regionA, portalIdx: i });
    }
  }

  /**
   * Scan the whole grid for adjacent cells belonging to different regions; one
   * portal per region pair, positioned at the average of its boundary cells.
   */
  private _findPortals(): void {
    const res = this.gridResolution;
    const map = this._mapConfig;

    const portalGroups = new Map<string, {
      sumCol: number;
      sumRow: number;
      count: number;
      regionA: number;
      regionB: number;
    }>();

    for (let row = 0; row < res; row++) {
      for (let col = 0; col < res; col++) {
        const idx = row * res + col;
        const regA = this.regionMap[idx];
        if (regA < 0) continue;

        // Only check right + down to avoid double counting.
        const neighbors: [number, number][] = [[0, 1], [1, 0]];
        for (const [dr, dc] of neighbors) {
          const nr = row + dr;
          const nc = col + dc;
          if (nr >= res || nc >= res) continue;
          const nIdx = nr * res + nc;
          const regB = this.regionMap[nIdx];
          if (regB < 0 || regB === regA) continue;

          const minR = Math.min(regA, regB);
          const maxR = Math.max(regA, regB);
          const key = `${minR}_${maxR}`;

          let g = portalGroups.get(key);
          if (!g) {
            g = { sumCol: 0, sumRow: 0, count: 0, regionA: minR, regionB: maxR };
            portalGroups.set(key, g);
          }
          g.sumCol += (col + nc) * 0.5;
          g.sumRow += (row + nr) * 0.5;
          g.count++;
        }
      }
    }

    for (const g of portalGroups.values()) {
      if (g.count === 0) continue;

      const avgCol = Math.round(g.sumCol / g.count);
      const avgRow = Math.round(g.sumRow / g.count);
      const world = gridToWorld(avgCol, avgRow, map.width, map.height, res);

      const regInfoA = this.regions.get(g.regionA)!;
      const regInfoB = this.regions.get(g.regionB)!;
      const dx = regInfoA.centerWorldX - regInfoB.centerWorldX;
      const dz = regInfoA.centerWorldZ - regInfoB.centerWorldZ;

      this.portals.push({
        regionA: g.regionA,
        regionB: g.regionB,
        worldX: world.x,
        worldZ: world.z,
        cost: Math.sqrt(dx * dx + dz * dz),
      });
    }
  }
}
