/**
 * MarsCraft -> forgeax-engine — VisionSystem (Milestone M10)
 * =============================================================================
 * Port of the Three.js source `web/systems/DeterministicVision.ts` — the SINGLE
 * source of truth for per-player vision. Each frame it rebuilds, per registered
 * player, a coarse vision grid (Float32Array, 0..1 visibility with a feathered
 * edge) by painting a circle for every owned unit / building at its visionRange,
 * with high-ground occlusion. A grid cell that has ever been > 0 is also marked
 * EXPLORED (Uint8Array, sticky).
 *
 * It is engine-AGNOSTIC logic; only the data source changes from the source's
 * `world.query(...)` to a forgeax system query (qr[0] = Batch[], iterated). No
 * Three.js / rendering here — consumers (fog application + minimap) read the grid.
 *
 * Mapping from the source (1:1 unless noted):
 *   - resolution / FEATHER_RATIO / VISIBLE_THRESHOLD / smoothstep / _paintCircle
 *     are verbatim.
 *   - vision range per entity: prefer UnitStats.finalVisionRange (buff/upgrade
 *     corrected), else UnitType.visionRange + the additive `visionRange` buff
 *     modifier (creep/cloak bonuses) — same precedence as the source.
 *   - the `detection_revealed` debuff reveal pass (an enemy unit flagged revealed
 *     grants vision of its tile to all OTHER players) is ported — it reuses the
 *     same buff the M9 DetectionSystem applies (`isRevealed` modifier).
 *   - height grid is baked lazily on the first tick (terrain sampler injected).
 *   - temporary vision points (sonar-pulse path reveal) are ported (addTemporaryVision
 *     + countdown each frame) so the M9 spawn_direction_wave seam can light them up.
 *
 * Priority: installed EARLY (before combat / health-bar / minimap) so downstream
 * systems read an up-to-date grid the same frame — matching the source priority 5.
 *
 * ⚠️ ECS rules: qr[N] is Batch[] (iterate); no spawn/despawn here; vision range
 * extras (buffs) read via world.get / the runtime helper, never an ad-hoc query.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Faction, UnitType, UnitStats, Garrisoned, Abilities, PLAYER_ID,
} from '../components';
import { getStatModifier, hasBuff } from './abilities-runtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/** Vision grid resolution (matches the source DEFAULT_RES). */
const DEFAULT_RES = 128;
/** Outer-ring feather fraction (matches the source). */
const FEATHER_RATIO = 0.35;
/** Visibility threshold for isVisible (matches the source > 0.1). */
const VISIBLE_THRESHOLD = 0.1;
/** High-ground occlusion: a cell higher than the viewer by this is blocked. */
const HIGH_GROUND_THRESHOLD = 1.5;
/** Default vision range for an entity with no UnitType. */
const DEFAULT_VISION_RANGE = 12;
/** Reveal range granted by a `detection_revealed` enemy (source: 3 * RANGE_SCALE). */
const REVEAL_RANGE = 3 * 1.84;

/** smoothstep(t) = t^2 (3 - 2t) — identical to the source. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export interface VisionDeps {
  mapWidth: number;
  mapHeight: number;
  /** Terrain height sampler (high-ground occlusion). Optional — flat if absent. */
  getTerrainHeight?: (x: number, z: number) => number;
  /** Players to track. The local player MUST be included. */
  players: number[];
  resolution?: number;
}

export interface VisionHandle {
  /** Local player's grid resolution (cells per axis). */
  readonly resolution: number;
  /** Is (worldX,worldZ) currently VISIBLE to `playerId` (default = local)? */
  isVisible(worldX: number, worldZ: number, playerId?: number): boolean;
  /** Has (worldX,worldZ) ever been EXPLORED by `playerId` (default = local)? */
  isExplored(worldX: number, worldZ: number, playerId?: number): boolean;
  /** Raw visibility grid (Float32Array, 0..1) for `playerId` (default = local). */
  getGrid(playerId?: number): Float32Array | null;
  /** Sticky "ever explored" grid (Uint8Array, 0/1) for `playerId` (default = local). */
  getExplored(playerId?: number): Uint8Array | null;
  /** Fog state 0=unexplored / 1=explored / 2=visible at (x,z) for local player. */
  getFogState(worldX: number, worldZ: number, playerId?: number): 0 | 1 | 2;
  /** Add a temporary vision point (sonar pulse path reveal). */
  addTemporaryVision(playerId: number, x: number, z: number, range: number, duration: number, height?: number): void;
  /** Counts of visible / explored cells for the local player (verify aid). */
  probe(playerId?: number): { resolution: number; visible: number; explored: number; total: number };
}

export class VisionSystem implements VisionHandle {
  readonly name = 'VisionSystem';
  readonly resolution: number;

  private readonly _mapWidth: number;
  private readonly _mapHeight: number;
  private readonly _localPlayerId: number;
  private readonly _getTerrainHeight?: (x: number, z: number) => number;

  /** playerId -> current visibility grid (0..1). */
  private readonly _grids = new Map<number, Float32Array>();
  /** playerId -> sticky explored grid (0/1). */
  private readonly _explored = new Map<number, Uint8Array>();
  /** Baked terrain heights per cell (terrain is static; baked once). */
  private _heightGrid: Float32Array | null = null;
  /** Temporary vision points (path reveal); counted down each frame. */
  private readonly _tempPoints: Array<{ playerId: number; x: number; z: number; height: number; range: number; remaining: number }> = [];

  constructor(deps: VisionDeps) {
    this.resolution = deps.resolution ?? DEFAULT_RES;
    this._mapWidth = deps.mapWidth;
    this._mapHeight = deps.mapHeight;
    this._getTerrainHeight = deps.getTerrainHeight;
    this._localPlayerId = deps.players[0] ?? PLAYER_ID.PLAYER;
    const res = this.resolution;
    for (const p of deps.players) {
      this._grids.set(p, new Float32Array(res * res));
      this._explored.set(p, new Uint8Array(res * res));
    }
  }

  install(world: World): VisionHandle {
    world.addSystem({
      name: this.name,
      // All vision-casting entities carry Transform + Faction (units + buildings).
      queries: [{ with: [Entity, Transform, Faction] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;

        // Bake terrain heights on the first real tick (sampler set at construction).
        if (!this._heightGrid && this._getTerrainHeight) this._bakeHeightGrid();

        // Count down temporary vision points (every frame, regardless of dt sign).
        for (let i = this._tempPoints.length - 1; i >= 0; i--) {
          this._tempPoints[i].remaining -= dt;
          if (this._tempPoints[i].remaining <= 0) this._tempPoints.splice(i, 1);
        }

        const res = this.resolution;
        const mw = this._mapWidth, mh = this._mapHeight;

        // Reset current visibility (explored is sticky, never cleared).
        for (const grid of this._grids.values()) grid.fill(0);

        const batches = qr[0] as unknown as Batch[];

        // Pass 1 — every owned entity paints a vision circle into its player grid.
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            if (world.get(e, Garrisoned).ok) continue; // garrisoned units see nothing
            const playerId = b.Faction.playerId[i] as number;
            const grid = this._grids.get(playerId);
            if (!grid) continue;

            const x = b.Transform.posX[i] as number;
            const z = b.Transform.posZ[i] as number;
            const range = this._visionRangeOf(world, e);
            const h = this._getTerrainHeight ? this._getTerrainHeight(x, z) : 0;
            this._paintCircle(grid, x, z, range, mw, mh, res, h);
          }
        }

        // Pass 2 — a `revealed` enemy lights its tile up for all OTHER players.
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            if (world.get(e, Garrisoned).ok) continue;
            const playerId = b.Faction.playerId[i] as number;
            if (playerId === PLAYER_ID.NEUTRAL) continue;
            if (!world.get(e, Abilities).ok) continue;
            if (!hasBuff(e, 'detection_revealed')) continue;
            const x = b.Transform.posX[i] as number;
            const z = b.Transform.posZ[i] as number;
            for (const [pid, grid] of this._grids) {
              if (pid === playerId) continue;
              this._paintCircle(grid, x, z, REVEAL_RANGE, mw, mh, res, 0);
            }
          }
        }

        // Pass 3 — temporary vision points (path reveal).
        for (const pt of this._tempPoints) {
          const grid = this._grids.get(pt.playerId);
          if (!grid) continue;
          this._paintCircle(grid, pt.x, pt.z, pt.range, mw, mh, res, pt.height);
        }

        // Fold current visibility into the sticky explored grids.
        for (const [pid, grid] of this._grids) {
          const ex = this._explored.get(pid);
          if (!ex) continue;
          for (let k = 0; k < grid.length; k++) if (grid[k] > 0) ex[k] = 1;
        }
      },
    });
    return this;
  }

  /** Vision range for one entity: finalVisionRange, else UnitType + buff bonus. */
  private _visionRangeOf(world: World, e: EntityHandle): number {
    const ss = world.get(e, UnitStats);
    if (ss.ok && ss.value.finalVisionRange > 0) return ss.value.finalVisionRange;
    const ut = world.get(e, UnitType);
    const bonus = world.get(e, Abilities).ok ? getStatModifier(e, 'visionRange').additive : 0;
    return (ut.ok ? ut.value.visionRange : DEFAULT_VISION_RANGE) + bonus;
  }

  /** Bake the static terrain heightfield onto the grid (source `_bakeHeightGrid`). */
  private _bakeHeightGrid(): void {
    if (!this._getTerrainHeight) return;
    const res = this.resolution, mw = this._mapWidth, mh = this._mapHeight;
    const hg = new Float32Array(res * res);
    for (let row = 0; row < res; row++) {
      for (let col = 0; col < res; col++) {
        const worldX = (col / (res - 1)) * mw - mw / 2;
        const worldZ = (row / (res - 1)) * mh - mh / 2;
        hg[row * res + col] = this._getTerrainHeight(worldX, worldZ);
      }
    }
    this._heightGrid = hg;
  }

  /** Paint a feathered vision circle into `grid` (source `_paintCircle`, 1:1). */
  private _paintCircle(
    grid: Float32Array,
    wx: number, wz: number, range: number,
    mw: number, mh: number, res: number,
    unitHeight: number,
  ): void {
    const cx = ((wx + mw / 2) / mw) * (res - 1);
    const cz = ((wz + mh / 2) / mh) * (res - 1);
    const pr = (range / mw) * (res - 1);
    if (pr <= 0) return;
    const feather = pr * FEATHER_RATIO;
    const innerR = pr - feather;
    const outerR2 = pr * pr;
    const hGrid = this._heightGrid;

    const r0 = Math.max(0, Math.floor(cz - pr));
    const r1 = Math.min(res - 1, Math.ceil(cz + pr));
    const c0 = Math.max(0, Math.floor(cx - pr));
    const c1 = Math.min(res - 1, Math.ceil(cx + pr));

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const dx = col - cx, dz = row - cz;
        const dist2 = dx * dx + dz * dz;
        if (dist2 > outerR2) continue;
        if (hGrid && hGrid[row * res + col] - unitHeight > HIGH_GROUND_THRESHOLD) continue;
        const dist = Math.sqrt(dist2);
        const vis = dist <= innerR ? 1.0 : 1.0 - smoothstep(feather > 0 ? (dist - innerR) / feather : 1);
        const idx = row * res + col;
        if (vis > grid[idx]) grid[idx] = vis;
      }
    }
  }

  // ── public reads (source isVisible / isExplored, world-coord -> cell) ────────
  private _cell(worldX: number, worldZ: number): number {
    const res = this.resolution;
    const col = Math.round(((worldX + this._mapWidth / 2) / this._mapWidth) * (res - 1));
    const row = Math.round(((worldZ + this._mapHeight / 2) / this._mapHeight) * (res - 1));
    if (col < 0 || col >= res || row < 0 || row >= res) return -1;
    return row * res + col;
  }

  isVisible(worldX: number, worldZ: number, playerId = this._localPlayerId): boolean {
    const grid = this._grids.get(playerId);
    if (!grid) return false;
    const idx = this._cell(worldX, worldZ);
    return idx >= 0 && grid[idx] > VISIBLE_THRESHOLD;
  }

  isExplored(worldX: number, worldZ: number, playerId = this._localPlayerId): boolean {
    const ex = this._explored.get(playerId);
    if (!ex) return false;
    const idx = this._cell(worldX, worldZ);
    return idx >= 0 && ex[idx] === 1;
  }

  getGrid(playerId = this._localPlayerId): Float32Array | null {
    return this._grids.get(playerId) ?? null;
  }

  getExplored(playerId = this._localPlayerId): Uint8Array | null {
    return this._explored.get(playerId) ?? null;
  }

  getFogState(worldX: number, worldZ: number, playerId = this._localPlayerId): 0 | 1 | 2 {
    if (this.isVisible(worldX, worldZ, playerId)) return 2;
    if (this.isExplored(worldX, worldZ, playerId)) return 1;
    return 0;
  }

  addTemporaryVision(playerId: number, x: number, z: number, range: number, duration: number, height?: number): void {
    const h = height ?? (this._getTerrainHeight ? this._getTerrainHeight(x, z) : 0);
    this._tempPoints.push({ playerId, x, z, height: h, range, remaining: duration });
  }

  probe(playerId = this._localPlayerId): { resolution: number; visible: number; explored: number; total: number } {
    const grid = this._grids.get(playerId);
    const ex = this._explored.get(playerId);
    let visible = 0, explored = 0;
    if (grid) for (let k = 0; k < grid.length; k++) if (grid[k] > VISIBLE_THRESHOLD) visible++;
    if (ex) for (let k = 0; k < ex.length; k++) if (ex[k] === 1) explored++;
    return { resolution: this.resolution, visible, explored, total: this.resolution * this.resolution };
  }
}
