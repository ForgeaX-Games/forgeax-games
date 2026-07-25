/**
 * MarsCraft -> forgeax-engine — FogSystem (Milestone M10)
 * =============================================================================
 * ADAPTED port of the Three.js source `web/world/FogOfWar.ts`.
 *
 * SEAM (documented, not faked) — the source's headline effect is a SCREEN-SPACE
 * post-process: it renders the scene to a RenderTarget with a depth texture, then
 * a fullscreen quad + fog fragment shader reconstructs each pixel's world XZ from
 * depth, samples the 128x128 vision DataTexture, and darkens unexplored (near
 * black) / explored-but-not-visible (dimmed) pixels uniformly across ground,
 * walls, units and decor (`fogFragmentShader` in the source, lines ~75-127).
 * forgeax does NOT expose a custom fullscreen post-process pass to a game (the
 * preview host owns the render pipeline; a game only spawns ECS entities), so the
 * exact depth-reprojection fog shader is UNREACHABLE from here and is left as a
 * marked seam. The shader source path: `web/world/FogOfWar.ts` `fogFragmentShader`.
 *
 * What this port DOES implement (the canonical RTS GAMEPLAY effect, in full):
 *   (a) ENEMY units & buildings outside the LOCAL player's VISIBLE set are HIDDEN
 *       (not rendered) and revealed when a player unit's vision reaches them. This
 *       is the gameplay-meaningful half of fog — you cannot see enemies in the
 *       dark. It reuses the M9 hide pattern (collapse the unit's parent Transform
 *       scale to 0; the ChildOf model parts inherit it, so the whole composite
 *       model vanishes; restored to the captured scale when revealed). Own units &
 *       neutral resources are ALWAYS shown. Cloaked-but-undetected enemies stay
 *       hidden via the M9 DetectionSystem (consulted here).
 *   (b) a ground-fog VISUAL via dark overlay quads on UNSEEN / EXPLORED terrain
 *       tiles — a coarse grid of flat dark cylinders (reusing the creep disc
 *       trick): black over UNEXPLORED cells, a dimmer tint over EXPLORED-not-
 *       visible cells, removed over VISIBLE cells. This approximates the source's
 *       screen-space darkening with world-space decals (the only world-space hook
 *       a game has). The fog tile grid is coarse (FOG_TILE_RES) for performance,
 *       updated on a throttle, and diffed (only changed tiles respawn).
 *
 * `toggleFog(false)` disables BOTH (a) and (b) — every entity is shown and the fog
 * decals are cleared — for verification (mirrors the source `fullVision` flag).
 *
 * ⚠️ ECS rules: qr[N] is Batch[] (iterate); hide/show via world.set on the parent
 * Transform scale (no despawn of the unit); fog-decal spawn/despawn happens OUTSIDE
 * the query loop (in _updateFogTiles, called after the per-entity pass).
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform,
} from '@forgeax/engine-scene';
import {
  MeshFilter,
  MeshRenderer,
} from '@forgeax/engine-render';
import {
  type Handle,
} from '@forgeax/engine-types';
import { type MeshAsset } from '@forgeax/engine-assets-runtime';
import { meshFromInterleaved } from '@forgeax/engine-geometry';
import { Faction, PLAYER_ID } from '../components';
import type { UnitPrimitives, TintFn } from '../world/unit-models';
import type { VisionHandle } from './vision-system';
import type { DetectionHandle } from './detection-system';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;

/** Fog grid resolution (cells per axis). One conforming mesh covers all
 *  unexplored cells, so a finer grid is cheap (no per-tile entity). */
const FOG_TILE_RES = 44;
/** Fog tile refresh interval (sec) — vision changes slowly. */
const FOG_TILE_INTERVAL = 0.4;
/** Fog decal color — rendered UNLIT (immune to lighting), so this is the literal
 *  on-screen color of unexplored terrain: near-black with a faint Mars-warm tint. */
const FOG_COLOR: [number, number, number] = [0.015, 0.01, 0.008];
/** EXPLORED-but-not-currently-visible ("fog of war memory") color — a dim warm grey,
 *  clearly darker than lit terrain but not black. Rendered UNLIT + opaque (a game
 *  can't alpha-dim), which reads as the classic RTS greyed-out explored area. */
const DIM_COLOR: [number, number, number] = [0.16, 0.12, 0.10];

export interface FogDeps {
  vision: VisionHandle;
  /** Optional detector handle (cloak gating); enemies cloaked+undetected stay hidden. */
  detection?: DetectionHandle;
  localPlayerId: number;
  /** Decal visuals. */
  prims: UnitPrimitives;
  tint: TintFn;
  /** UNLIT tint (renders baseColor directly) — the fog decal uses this so unexplored
   *  terrain reads truly dark instead of being washed to grey by the skylight. */
  unlitTint?: TintFn;
  heightAt: (x: number, z: number) => number;
  mapWidth: number;
  mapHeight: number;
  /** Draw the ground-fog decal layer (b). Default true. */
  drawDecals?: boolean;
}

export interface FogHandle {
  /** Enable/disable fog (false = full vision: show everything, clear decals). */
  toggleFog(on: boolean): void;
  /** Is fog currently on? */
  enabled(): boolean;
  probe(): { enabled: boolean; hidden: number; decals: number };
}

interface HiddenRec { sx: number; sy: number; sz: number }

export class FogSystem implements FogHandle {
  readonly name = 'FogSystem';
  private readonly _deps: FogDeps;
  private _enabled = true;
  /** entityId -> captured parent scale while hidden (so restore is exact). */
  private readonly _hidden = new Map<number, HiddenRec>();
  /** The single terrain-conforming unexplored-fog mesh entity (rebuilt on change). */
  private _fogMesh: EntityHandle | null = null;
  /** Signature of the last-built unexplored cell set (skip rebuild when unchanged). */
  private _fogSig = '';
  /** Second layer: EXPLORED-but-not-visible ("memory") dim mesh + its signature. */
  private _dimMesh: EntityHandle | null = null;
  private _dimSig = '';
  private _tileTimer = FOG_TILE_INTERVAL;
  private _blackMat: Handle<'MaterialAsset', 'shared'> | null = null;
  private _dimMat: Handle<'MaterialAsset', 'shared'> | null = null;

  constructor(deps: FogDeps) { this._deps = deps; }

  install(world: World): FogHandle {
    world.addSystem(Update, {
      name: this.name,
      // Units + buildings that may need hiding all carry Transform + Faction.
      queries: [{ with: [Entity, Transform, Faction] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        const { vision, detection, localPlayerId } = this._deps;

        // If disabled, ensure everything previously hidden is restored, then bail.
        if (!this._enabled) {
          if (this._hidden.size > 0) this._restoreAll(world);
          this._clearDecals(world);
          return;
        }

        const batches = qr[0] as unknown as Batch[];
        // collect-then-mutate: decide hide/show per entity, apply via world.set
        // (set is safe mid-iteration on a DIFFERENT-archetype entity, but we keep
        // the collected list to avoid touching the batch we are iterating).
        const toHide: EntityHandle[] = [];
        const toShow: EntityHandle[] = [];

        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            const playerId = b.Faction.playerId[i] as number;

            // Own units/buildings always visible.
            if (playerId === localPlayerId) { toShow.push(e); continue; }
            // Neutral resources (minerals/geysers) always visible (map features).
            if (playerId === PLAYER_ID.NEUTRAL) { toShow.push(e); continue; }

            const x = b.Transform.pos[i * 3] as number;
            const z = b.Transform.pos[i * 3 + 2] as number;
            // Visible to the local player AND not a cloaked-undetected unit.
            const inVision = vision.isVisible(x, z, localPlayerId);
            const cloakHidden = detection ? !detection.isVisibleToEnemy(e) : false;
            if (inVision && !cloakHidden) toShow.push(e);
            else toHide.push(e);
          }
        }

        for (const e of toHide) this._hide(world, e);
        for (const e of toShow) this._show(world, e);

        // ── ground-fog decal layer (b) ──
        if (this._deps.drawDecals !== false) {
          this._tileTimer += dt;
          if (this._tileTimer >= FOG_TILE_INTERVAL) {
            this._tileTimer = 0;
            this._updateFogTiles(world);
          }
        }
      },
    });
    return this;
  }

  // ── enemy hide / show (collapse parent Transform scale; restore captured) ────
  private _hide(world: World, e: EntityHandle): void {
    const id = rawId(e);
    if (this._hidden.has(id)) return; // already hidden
    const t = world.get(e, Transform);
    if (!t.ok) return;
    // capture the live scale so a restore is exact even if a form/morph changed it.
    const sx = t.value.scale[0], sy = t.value.scale[1], sz = t.value.scale[2];
    // A unit hidden by garrison (off-field, pos[1] very low) shouldn't be re-hidden
    // by scale — but scale-0 on an already-off-field unit is harmless. Capture is
    // the live scale (1,1,1 for a normal unit); never capture a 0 we wrote.
    if (sx === 0 && sy === 0 && sz === 0) return;
    this._hidden.set(id, { sx, sy, sz });
    world.set(e, Transform, { scale: [0, 0, 0] });
  }

  private _show(world: World, e: EntityHandle): void {
    const id = rawId(e);
    const rec = this._hidden.get(id);
    if (!rec) return; // not hidden
    this._hidden.delete(id);
    if (world.get(e, Transform).ok) {
      world.set(e, Transform, { scale: [rec.sx, rec.sy, rec.sz] });
    }
  }

  private _restoreAll(world: World): void {
    for (const [id, rec] of this._hidden) {
      const e = id as unknown as EntityHandle;
      if (world.get(e, Transform).ok) {
        world.set(e, Transform, { scale: [rec.sx, rec.sy, rec.sz] });
      }
    }
    this._hidden.clear();
  }

  // ── ground-fog decals (coarse dark tiles over unseen/explored terrain) ───────
  private _mat(): TintFn { return this._deps.unlitTint ?? this._deps.tint; }
  private _blackMaterial(): Handle<'MaterialAsset', 'shared'> {
    // UNLIT — a lit near-black material gets lifted to grey by the skylight IBL, so
    // the fog stopped reading as "dark". Unlit renders FOG_COLOR literally.
    if (!this._blackMat) this._blackMat = this._mat()(FOG_COLOR, { metallic: 0, roughness: 1 });
    return this._blackMat;
  }
  private _dimMaterial(): Handle<'MaterialAsset', 'shared'> {
    if (!this._dimMat) this._dimMat = this._mat()(DIM_COLOR, { metallic: 0, roughness: 1 });
    return this._dimMat;
  }

  /**
   * Rebuild the fog as TWO terrain-conforming meshes (each a quad per cell, corners
   * sampled at `heightAt` so the fog HUGS the ground incl. plateau tops; UNLIT so it
   * isn't washed to grey by the skylight):
   *   - UNEXPLORED (fog state 0)              → near-black (`FOG_COLOR`)
   *   - EXPLORED-but-not-visible (state 1)    → dim warm grey (`DIM_COLOR`) — the
   *     classic RTS "memory" fog (opaque, so it fully replaces the lit terrain color;
   *     a game can't alpha-dim — that screen-space blend is ENGINE-ISSUES #8).
   * VISIBLE (state 2) gets no decal (full terrain). Each layer is signature-diffed
   * and only rebuilt when its cell set changes.
   */
  private _updateFogTiles(world: World): void {
    const b = this._buildLayer(world, 0, this._blackMaterial(), this._fogSig, this._fogMesh);
    this._fogSig = b.sig; this._fogMesh = b.mesh;
    const d = this._buildLayer(world, 1, this._dimMaterial(), this._dimSig, this._dimMesh);
    this._dimSig = d.sig; this._dimMesh = d.mesh;
  }

  /** Build (or keep) the conforming decal mesh over every cell whose fog state == `want`. */
  private _buildLayer(
    world: World, want: number, material: Handle<'MaterialAsset', 'shared'>, prevSig: string, prevMesh: EntityHandle | null,
  ): { sig: string; mesh: EntityHandle | null } {
    const { vision, mapWidth, mapHeight, heightAt, localPlayerId } = this._deps;
    const res = FOG_TILE_RES;
    const cw = mapWidth / res, ch = mapHeight / res;
    const cellX = (c: number): number => c * cw - mapWidth / 2;
    const cellZ = (r: number): number => r * ch - mapHeight / 2;

    const cells: Array<[number, number]> = [];
    let sig = '';
    for (let row = 0; row < res; row++) {
      let runStart = -1;
      for (let col = 0; col <= res; col++) {
        const match = col < res
          && vision.getFogState(cellX(col) + cw / 2, cellZ(row) + ch / 2, localPlayerId) === want;
        if (match) { if (runStart < 0) runStart = col; cells.push([col, row]); }
        else if (runStart >= 0) { sig += `${row}:${runStart}-${col};`; runStart = -1; }
      }
    }
    if (sig === prevSig) return { sig, mesh: prevMesh }; // cell set unchanged → keep it

    if (prevMesh !== null && world.get(prevMesh, Transform).ok) world.despawn(prevMesh);
    if (cells.length === 0) return { sig, mesh: null };

    // interleaved mesh (pos3+normal3+uv2), 4 verts + 2 tris per cell. eps lifts it just
    // above the surface (incl. plateau tops) so bright ground doesn't z-fight through.
    const eps = 0.18;
    const vcount = cells.length * 4;
    const inter = new Float32Array(vcount * 8);
    const idxArr: number[] = [];
    let v = 0;
    const pushVert = (x: number, z: number): void => {
      const bb = v * 8;
      inter[bb] = x; inter[bb + 1] = heightAt(x, z) + eps; inter[bb + 2] = z;
      inter[bb + 3] = 0; inter[bb + 4] = 1; inter[bb + 5] = 0;
      inter[bb + 6] = 0; inter[bb + 7] = 0;
      v++;
    };
    for (const [col, row] of cells) {
      const x0 = cellX(col), x1 = cellX(col + 1), z0 = cellZ(row), z1 = cellZ(row + 1);
      const base = v;
      pushVert(x0, z0); pushVert(x1, z0); pushVert(x1, z1); pushVert(x0, z1);
      idxArr.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const indices = vcount > 65535 ? new Uint32Array(idxArr) : new Uint16Array(idxArr);
    const mesh = meshFromInterleaved(inter, indices) as MeshAsset;
    const handle: Handle<'MeshAsset', 'shared'> = world.allocSharedRef('MeshAsset', mesh);
    const r = world.spawn(
      { component: Transform, data: { pos: [0, 0, 0] } },
      { component: MeshFilter, data: { assetHandle: handle } },
      { component: MeshRenderer, data: { materials: [material] } },
    );
    return { sig, mesh: r.ok ? r.value : null };
  }

  private _clearDecals(world: World): void {
    for (const mh of [this._fogMesh, this._dimMesh]) {
      if (mh !== null && world.get(mh, Transform).ok) world.despawn(mh);
    }
    this._fogMesh = null; this._fogSig = '';
    this._dimMesh = null; this._dimSig = '';
  }

  // ── handle ───────────────────────────────────────────────────────────────
  toggleFog(on: boolean): void {
    this._enabled = on;
    // The next system tick applies the change (restore-all / clear-decals when off).
  }

  enabled(): boolean { return this._enabled; }

  probe(): { enabled: boolean; hidden: number; decals: number } {
    // `decals` = live fog-layer meshes (0..2: unexplored-black + explored-dim).
    return { enabled: this._enabled, hidden: this._hidden.size, decals: (this._fogMesh !== null ? 1 : 0) + (this._dimMesh !== null ? 1 : 0) };
  }
}
