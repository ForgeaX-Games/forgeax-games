/**
 * MarsCraft -> forgeax-engine — HazardSystem (Milestone M9 chunk 3)
 * =============================================================================
 * Port of the Three.js source `web/systems/HazardSystem.ts`. Hazard zones are
 * destructible/timed area obstacles (lurker spines, mines, force fields):
 *   1. lifetime: count down duration; expire on HP==0 (destructible) or timeout
 *   2. periodic area effects: each `areaInterval`, apply the hazard's effects to
 *      enemies inside its shape (circle / arc->circle / line)
 *   3. collision queries: `checkMovementBlocked` / `checkProjectileBlocked` for
 *      the movement / projectile systems (ported 1:1; isPointInside on the system)
 *
 * RENDER: a flat/box tinted model ChildOf the hazard entity (renderer-agnostic;
 * the source's energy-shield/solid shader is a renderer-detail seam, noted). The
 * LOGIC (lifetime + interval effects + collision predicates) is 1:1.
 *
 * ⚠️ ECS rules: qr[N] is Batch[]; collect-then-despawn; area scan over a per-frame
 * CombatTarget[] snapshot from a Health+Faction query (no ad-hoc world.query).
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer, ChildOf,
  type Handle,
} from '@forgeax/engine-runtime';
import {
  Hazard, Health, Faction, HAZARD_SHAPE,
  hazardTypeId, hazardAreaEffects, type HazardShapeCode,
} from '../components';
import type { AbilityEffect } from '../data/abilities';
import { resolveArea } from './splash-resolver';
import { executeEffects, type CastContext, type HazardSpawnReq } from './effect-executor';
import { snapshotCombatTargets, type CombatTarget } from './combat-registry';
import type { UnitPrimitives } from '../world/unit-models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;
function rgbOf(packed: number): [number, number, number] {
  return [((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255];
}
type TintFn = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

/** Per-hazard-type tint (default neutral steel). */
const HAZARD_COLOR: Record<string, number> = {
  arc_barrier: 0x2288cc,
  force_field: 0x66aaff,
  lurker_spine: 0x884422,
  spider_mine: 0xaa3322,
};
const DEFAULT_HAZARD_COLOR = 0x888888;

const SHAPE_CODE: Record<'circle' | 'arc' | 'line', HazardShapeCode> = {
  circle: HAZARD_SHAPE.CIRCLE, arc: HAZARD_SHAPE.ARC, line: HAZARD_SHAPE.LINE,
};

export interface HazardDeps {
  prims: UnitPrimitives;
  tint: TintFn;
  heightAt: (x: number, z: number) => number;
}

export interface HazardHandle {
  spawnHazard(req: HazardSpawnReq): EntityHandle | null;
  /** Hazard entity blocking ground movement of `unitEntity` to (x,z), or null. */
  checkMovementBlocked(world: World, unitEntity: EntityHandle, x: number, z: number, unitRadius?: number): EntityHandle | null;
  /** Hazard entity intercepting a projectile, or null. */
  checkProjectileBlocked(world: World, sourcePlayerId: number, x: number, y: number, z: number, baseY: number): EntityHandle | null;
  probe(): Array<Record<string, unknown>>;
}

/** Snapshot of one live hazard (for collision queries between frames). */
interface HazardView {
  entity: EntityHandle;
  x: number; z: number;
  shape: HazardShapeCode;
  radius: number; angle: number; width: number; height: number;
  dirX: number; dirZ: number;
  playerId: number;
  blocksMovement: boolean; blocksProjectiles: boolean; blocksAllFactions: boolean;
}

export class HazardSystem implements HazardHandle {
  readonly name = 'HazardSystem';
  private _world!: World;
  private readonly _deps: HazardDeps;
  private _gameTime = 0;
  private readonly _snapshot: CombatTarget[] = [];
  private readonly _discOf = new Map<number, EntityHandle>();
  private readonly _matCache = new Map<number, Handle<'MaterialAsset', 'shared'>>();
  /** Live hazard snapshot, rebuilt each frame for collision queries. */
  private _hazards: HazardView[] = [];

  constructor(deps: HazardDeps) { this._deps = deps; }

  install(world: World): HazardHandle {
    this._world = world;
    world.addSystem(Update, {
      name: this.name,
      queries: [
        { with: [Entity, Transform, Hazard] },           // hazards (query 0)
        { with: [Entity, Transform, Health, Faction] },   // combat snapshot (query 1)
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        this._gameTime += dt;

        const batches = qr[0] as unknown as Batch[];
        // perf: no hazards on the field → skip the combat snapshot (it only feeds
        // hazard area-effect tests). Hazards are rare, so this is almost every frame.
        let anyHazard = false;
        for (const b of batches) { if ((b.Entity.self.length as number) > 0) { anyHazard = true; break; } }
        if (!anyHazard) return;

        snapshotCombatTargets(world, qr[1] as unknown as Batch[], this._snapshot);

        const expired: EntityHandle[] = [];
        const views: HazardView[] = [];
        // Per-hazard timers/effects must be applied; collect then apply after iter.
        const toApply: Array<{ e: EntityHandle; x: number; z: number; playerId: number; shape: HazardShapeCode; radius: number; width: number; dirX: number; dirZ: number }> = [];

        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            const maxDuration = b.Hazard.maxDuration[i] as number;
            let remaining = b.Hazard.remainingDuration[i] as number;
            if (maxDuration > 0) { remaining -= dt; b.Hazard.remainingDuration[i] = remaining; }
            const maxHp = b.Hazard.maxHp[i] as number;
            const hp = b.Hazard.hp[i] as number;
            const isExpired = (maxHp > 0 && hp <= 0) || (maxDuration > 0 && remaining <= 0);
            if (isExpired) { expired.push(e); continue; }

            const x = b.Transform.pos[i * 3] as number;
            const z = b.Transform.pos[i * 3 + 2] as number;
            const shape = b.Hazard.shape[i] as HazardShapeCode;
            const radius = b.Hazard.radius[i] as number;
            const width = b.Hazard.width[i] as number;
            const dirX = b.Hazard.dirX[i] as number;
            const dirZ = b.Hazard.dirZ[i] as number;
            const playerId = b.Hazard.playerId[i] as number;

            views.push({
              entity: e, x, z, shape, radius,
              angle: b.Hazard.angle[i] as number, width,
              height: b.Hazard.height[i] as number,
              dirX, dirZ, playerId,
              blocksMovement: !!b.Hazard.blocksMovement[i],
              blocksProjectiles: !!b.Hazard.blocksProjectiles[i],
              blocksAllFactions: !!b.Hazard.blocksAllFactions[i],
            });

            const effects = hazardAreaEffects.get(e) as AbilityEffect[] | undefined;
            if (effects && effects.length > 0) {
              let timer = (b.Hazard.areaTimer[i] as number) + dt;
              const interval = b.Hazard.areaInterval[i] as number;
              if (timer >= interval) {
                timer -= interval;
                toApply.push({ e, x, z, playerId, shape, radius, width, dirX, dirZ });
              }
              b.Hazard.areaTimer[i] = timer;
            }
          }
        }
        this._hazards = views;

        // apply area effects (after iteration; uses caster from companion).
        for (const h of toApply) {
          const effects = hazardAreaEffects.get(h.e) as AbilityEffect[] | undefined;
          if (!effects) continue;
          this._applyAreaEffects(world, h, effects);
        }

        // despawn expired (after iteration).
        for (const e of expired) {
          const disc = this._discOf.get(rawId(e));
          if (disc !== undefined && world.get(disc, Transform).ok) world.despawn(disc);
          this._discOf.delete(rawId(e));
          hazardTypeId.delete(e);
          hazardAreaEffects.delete(e);
          if (world.get(e, Transform).ok) world.despawn(e);
        }
      },
    });
    return this;
  }

  private _applyAreaEffects(
    world: World,
    h: { e: EntityHandle; x: number; z: number; playerId: number; shape: HazardShapeCode; radius: number; width: number; dirX: number; dirZ: number },
    effects: AbilityEffect[],
  ): void {
    const cr = world.get(h.e, Hazard);
    const caster = cr.ok ? (cr.value.casterEntity as number) : 0;
    const shape: 'circle' | 'line' = h.shape === HAZARD_SHAPE.LINE ? 'line' : 'circle';
    const hits = resolveArea(this._snapshot, h.x, h.z, h.playerId, {
      shape, radius: h.radius, falloff: [1.0], width: h.width,
      directionX: h.x + h.dirX, directionZ: h.z + h.dirZ,
    });
    for (const hit of hits) {
      const t = this._snapshot.find((c) => rawId(c.entity) === rawId(hit.entity));
      const ctx: CastContext = {
        caster: caster as unknown as EntityHandle,
        targetEntity: hit.entity,
        targetX: t?.x ?? h.x, targetZ: t?.z ?? h.z,
        gameTime: this._gameTime, targets: this._snapshot,
      };
      executeEffects(world, ctx, effects);
    }
  }

  // ── isPointInside (port of CHazard.isPointInside) ─────────────────────────
  private _isPointInside(h: HazardView, testX: number, testZ: number, unitRadius = 0): boolean {
    const dx = testX - h.x, dz = testZ - h.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    switch (h.shape) {
      case HAZARD_SHAPE.CIRCLE:
        return dist <= h.radius + unitRadius;
      case HAZARD_SHAPE.ARC: {
        const innerR = h.radius - h.width * 0.5 - unitRadius;
        const outerR = h.radius + h.width * 0.5 + unitRadius;
        if (dist < innerR || dist > outerR) return false;
        const testAngle = Math.atan2(dx, dz);
        const dirAngle = Math.atan2(h.dirX, h.dirZ);
        let angleDiff = testAngle - dirAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        const angularExpansion = dist > 0.01 ? Math.asin(Math.min(unitRadius / dist, 1)) : 0;
        return Math.abs(angleDiff) <= h.angle * 0.5 + angularExpansion;
      }
      case HAZARD_SHAPE.LINE: {
        const halfLen = h.radius + unitRadius;
        const proj = dx * h.dirX + dz * h.dirZ;
        if (Math.abs(proj) > halfLen) return false;
        const perpDist = Math.abs(dx * (-h.dirZ) + dz * h.dirX);
        return perpDist <= h.width * 0.5 + unitRadius;
      }
      default: return false;
    }
  }

  checkMovementBlocked(world: World, unitEntity: EntityHandle, x: number, z: number, unitRadius = 0): EntityHandle | null {
    const uf = world.get(unitEntity, Faction);
    const unitPlayer = uf.ok ? uf.value.playerId : -2;
    for (const h of this._hazards) {
      if (!h.blocksMovement) continue;
      if (!h.blocksAllFactions && h.playerId === unitPlayer) continue;
      if (this._isPointInside(h, x, z, unitRadius)) return h.entity;
    }
    return null;
  }

  checkProjectileBlocked(_world: World, sourcePlayerId: number, x: number, y: number, z: number, baseY: number): EntityHandle | null {
    const projectileHeight = y - baseY;
    for (const h of this._hazards) {
      if (!h.blocksProjectiles) continue;
      if (h.playerId === sourcePlayerId) continue;
      if (projectileHeight > h.height) continue;
      if (this._isPointInside(h, x, z)) return h.entity;
    }
    return null;
  }

  spawnHazard(req: HazardSpawnReq): EntityHandle | null {
    const world = this._world;
    const y = this._deps.heightAt(req.x, req.z);
    const res = world.spawn(
      { component: Transform, data: { pos: [req.x, y, req.z] } },
      {
        component: Hazard,
        data: {
          playerId: req.playerId,
          hp: req.hp, maxHp: req.hp,
          remainingDuration: req.duration, maxDuration: req.duration,
          shape: SHAPE_CODE[req.shape],
          radius: req.radius,
          angle: req.angle ?? Math.PI * 0.5,
          width: req.width ?? 0.5,
          height: req.height ?? 2.0,
          dirX: req.dirX ?? 0, dirZ: req.dirZ ?? 1,
          blocksMovement: req.blocksMovement ?? true,
          blocksProjectiles: req.blocksProjectiles ?? false,
          blocksAllFactions: req.blocksAllFactions ?? false,
          areaInterval: req.areaInterval ?? 1.0,
          areaTimer: 0,
          casterEntity: rawId(req.casterEntity),
        },
      },
    );
    if (!res.ok) { console.error('[marscraft][hazard] spawn failed'); return null; }
    const e = res.value;
    hazardTypeId.set(e, req.hazardTypeId);
    if (req.areaEffects && req.areaEffects.length > 0) hazardAreaEffects.set(e, req.areaEffects);

    // Tinted slab model: box prim scaled to ~ the hazard footprint, short.
    const color = HAZARD_COLOR[req.hazardTypeId] ?? DEFAULT_HAZARD_COLOR;
    const mat = this._tintFor(color);
    const span = req.radius * (req.shape === 'circle' ? 2 : 1);
    const d = world.spawn(
      {
        component: Transform,
        data: {
          pos: [0, (req.height ?? 2.0) * 0.5, 0],
          scale: [
            req.shape === 'line' ? (req.width ?? 0.5) : span,
            req.height ?? 2.0,
            req.shape === 'line' ? span * 2 : span,
          ],
        },
      },
      { component: MeshFilter, data: { assetHandle: this._deps.prims.box } },
      { component: MeshRenderer, data: { materials: [mat] } },
      { component: ChildOf, data: { parent: e } },
    );
    if (d.ok) this._discOf.set(rawId(e), d.value);
    return e;
  }

  private _tintFor(color: number): Handle<'MaterialAsset', 'shared'> {
    const cached = this._matCache.get(color);
    if (cached) return cached;
    const m = this._deps.tint(rgbOf(color), { metallic: 0.2, roughness: 0.7 });
    this._matCache.set(color, m);
    return m;
  }

  probe(): Array<Record<string, unknown>> {
    const world = this._world;
    const out: Array<Record<string, unknown>> = [];
    for (let raw = 0; raw < 9000; raw++) {
      const eh = raw as unknown as EntityHandle;
      const h = world.get(eh, Hazard);
      if (!h.ok) continue;
      const t = world.get(eh, Transform);
      out.push({
        entity: raw,
        typeId: hazardTypeId.get(eh) ?? null,
        playerId: h.value.playerId,
        hp: h.value.hp, radius: h.value.radius,
        remaining: Number(h.value.remainingDuration.toFixed(3)),
        x: t.ok ? Number(t.value.pos[0].toFixed(2)) : null,
        z: t.ok ? Number(t.value.pos[2].toFixed(2)) : null,
      });
    }
    return out;
  }
}
