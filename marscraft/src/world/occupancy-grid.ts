/**
 * MarsCraft -> forgeax-engine — OccupancyGrid port (Milestone M5)
 * =============================================================================
 * Port of the Three.js source `web/world/OccupancyGrid.ts` — the second grid
 * layer (independent of PathGrid) used for building-placement validation, mirror
 * of SC2's dual-grid architecture:
 *   - PathGrid:      unit pathing (passability)
 *   - OccupancyGrid: building footprints (which cells are taken)
 *
 * The static footprint API (markBuilding / markMineral / markGeyser / release,
 * + the `_terrainWalkable` snapshot that lets a destroyed building restore
 * PathGrid.walkable, + the pathingSize-vs-footprint distinction) is ported 1:1
 * from the source — M8 buildings consume it.
 *
 * ── M5 addition: dynamic unit-occupancy layer ────────────────────────────────
 * The source's local avoidance lives in MovementSystem's separation pass (which
 * reads live unit positions, not a grid). To satisfy M5's "dynamic per-cell unit
 * occupancy; update each frame from unit transforms" we add a SEPARATE
 * `unitCount` cell layer that the movement system refreshes every frame
 * (clearUnits + addUnit per mover). It does NOT touch PathGrid.walkable (units
 * are soft obstacles — separation force handles them, not hard blocking), so the
 * faithful static-footprint behaviour above is unaffected. `unitCountAt` lets a
 * mover cheaply sense local crowding for avoidance damping.
 */

import type { PathGrid } from './path-grid';
import { worldToGrid } from '../mapgen/geometry';

/** Cell occupancy type. */
export const CELL_FREE = 0;
export const CELL_BUILDING = 1;
export const CELL_MINERAL = 2;
export const CELL_GEYSER = 3;
export type CellOccupancy = typeof CELL_FREE | typeof CELL_BUILDING | typeof CELL_MINERAL | typeof CELL_GEYSER;

/** Footprint record: which cells a building / resource occupies. */
interface FootprintRecord {
  entity: number;
  startCol: number;
  startRow: number;
  gridSize: number;
  occupancy: CellOccupancy;
  /** Pathing-blocked region start col. */
  pathStartCol: number;
  /** Pathing-blocked region start row. */
  pathStartRow: number;
  /** Pathing-blocked region size. */
  pathGridSize: number;
}

export class OccupancyGrid {
  /** Per-cell occupancy type (static: buildings / resources). */
  public readonly cells: Uint8Array;
  /** Per-cell occupying entity id (0 = none). */
  public readonly entityAt: Int32Array;
  public readonly gridResolution: number;

  /** Per-cell live unit count (dynamic; refreshed each frame by movement). */
  public readonly unitCount: Uint16Array;

  private _pathGrid: PathGrid;
  /** Original terrain walkability snapshot (1 = walkable) for restore on release. */
  private _terrainWalkable: Uint8Array;
  private _footprints = new Map<number, FootprintRecord>();
  /** Map width/height for world<->grid (cached from the path grid's map). */
  private _mapWidth: number;
  private _mapHeight: number;

  constructor(pathGrid: PathGrid, mapWidth: number, mapHeight: number) {
    this._pathGrid = pathGrid;
    this.gridResolution = pathGrid.gridResolution;
    this._mapWidth = mapWidth;
    this._mapHeight = mapHeight;
    const total = this.gridResolution * this.gridResolution;

    this.cells = new Uint8Array(total);
    this.entityAt = new Int32Array(total);
    this.unitCount = new Uint16Array(total);

    this._terrainWalkable = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      this._terrainWalkable[i] = pathGrid.walkable[i] ? 1 : 0;
    }
  }

  // ============================================================
  // Static footprint queries
  // ============================================================

  /** Is the cell free (buildable)? */
  isFree(col: number, row: number): boolean {
    if (col < 0 || col >= this.gridResolution || row < 0 || row >= this.gridResolution) return false;
    return this.cells[row * this.gridResolution + col] === CELL_FREE;
  }

  getOccupancy(col: number, row: number): CellOccupancy {
    if (col < 0 || col >= this.gridResolution || row < 0 || row >= this.gridResolution) return CELL_FREE;
    return this.cells[row * this.gridResolution + col] as CellOccupancy;
  }

  getEntityAt(col: number, row: number): number {
    if (col < 0 || col >= this.gridResolution || row < 0 || row >= this.gridResolution) return 0;
    return this.entityAt[row * this.gridResolution + col];
  }

  isTerrainWalkable(col: number, row: number): boolean {
    if (col < 0 || col >= this.gridResolution || row < 0 || row >= this.gridResolution) return false;
    return this._terrainWalkable[row * this.gridResolution + col] === 1;
  }

  getFootprint(entity: number): FootprintRecord | undefined {
    return this._footprints.get(entity);
  }

  getAllOccupiedEntities(): number[] {
    return Array.from(this._footprints.keys());
  }

  // ============================================================
  // Dynamic unit-occupancy layer (M5)
  // ============================================================

  /** Reset the live unit-count layer (call once per frame before re-adding). */
  clearUnits(): void {
    this.unitCount.fill(0);
  }

  /** Stamp a unit's current cell into the live unit-count layer. */
  addUnit(worldX: number, worldZ: number): void {
    const { col, row } = worldToGrid(worldX, worldZ, this._mapWidth, this._mapHeight, this.gridResolution);
    const idx = row * this.gridResolution + col;
    if (idx >= 0 && idx < this.unitCount.length && this.unitCount[idx] < 0xffff) {
      this.unitCount[idx]++;
    }
  }

  /** Number of units currently stamped on the cell containing (worldX, worldZ). */
  unitCountAt(worldX: number, worldZ: number): number {
    const { col, row } = worldToGrid(worldX, worldZ, this._mapWidth, this._mapHeight, this.gridResolution);
    const idx = row * this.gridResolution + col;
    if (idx < 0 || idx >= this.unitCount.length) return 0;
    return this.unitCount[idx];
  }

  // ============================================================
  // Mark / release (static footprints)
  // ============================================================

  markBuilding(entity: number, startCol: number, startRow: number, gridSize: number, pathingGridSize?: number): void {
    const pgs = pathingGridSize ?? gridSize;
    this._mark(entity, startCol, startRow, gridSize, CELL_BUILDING, true, pgs);
  }

  markMineral(entity: number, col: number, row: number, gridSize = 1): void {
    const half = Math.floor(gridSize / 2);
    this._mark(entity, col - half, row - half, gridSize, CELL_MINERAL, false);
  }

  markGeyser(entity: number, centerCol: number, centerRow: number, gridSize = 3): void {
    const half = Math.floor(gridSize / 2);
    this._mark(entity, centerCol - half, centerRow - half, gridSize, CELL_GEYSER, false);
  }

  /** Release an entity's footprint (building destroyed) + restore walkability. */
  release(entity: number): void {
    const record = this._footprints.get(entity);
    if (!record) return;

    const res = this.gridResolution;

    for (let r = record.startRow; r < record.startRow + record.gridSize; r++) {
      for (let c = record.startCol; c < record.startCol + record.gridSize; c++) {
        if (c < 0 || c >= res || r < 0 || r >= res) continue;
        const idx = r * res + c;
        if (this.entityAt[idx] === entity) {
          this.cells[idx] = CELL_FREE;
          this.entityAt[idx] = 0;
        }
      }
    }

    if (record.occupancy === CELL_BUILDING) {
      for (let r = record.pathStartRow; r < record.pathStartRow + record.pathGridSize; r++) {
        for (let c = record.pathStartCol; c < record.pathStartCol + record.pathGridSize; c++) {
          if (c < 0 || c >= res || r < 0 || r >= res) continue;
          const idx = r * res + c;
          this._pathGrid.walkable[idx] = this._terrainWalkable[idx] === 1;
        }
      }
      this._pathGrid.walkableVersion++;
      this._pathGrid.updateClearance();
    }

    this._footprints.delete(entity);
  }

  // ============================================================
  // Internal
  // ============================================================

  private _mark(
    entity: number,
    startCol: number,
    startRow: number,
    gridSize: number,
    occupancy: CellOccupancy,
    blockPathing: boolean,
    pathingGridSize?: number,
  ): void {
    const res = this.gridResolution;
    const pgs = pathingGridSize ?? gridSize;
    const pathOffset = Math.floor((gridSize - pgs) / 2);
    const pathStartCol = startCol + pathOffset;
    const pathStartRow = startRow + pathOffset;

    this._footprints.set(entity, {
      entity, startCol, startRow, gridSize, occupancy,
      pathStartCol, pathStartRow, pathGridSize: pgs,
    });

    for (let r = startRow; r < startRow + gridSize; r++) {
      for (let c = startCol; c < startCol + gridSize; c++) {
        if (c < 0 || c >= res || r < 0 || r >= res) continue;
        const idx = r * res + c;
        this.cells[idx] = occupancy;
        this.entityAt[idx] = entity;
      }
    }

    if (blockPathing) {
      for (let r = pathStartRow; r < pathStartRow + pgs; r++) {
        for (let c = pathStartCol; c < pathStartCol + pgs; c++) {
          if (c < 0 || c >= res || r < 0 || r >= res) continue;
          const idx = r * res + c;
          this._pathGrid.walkable[idx] = false;
        }
      }
      this._pathGrid.walkableVersion++;
      this._pathGrid.updateClearance();
    }
  }
}
