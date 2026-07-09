/**
 * MarsCraft -> forgeax-engine — GroundEffectSystem (Milestone M9 chunk 3)
 * =============================================================================
 * Port of the Three.js source `web/systems/GroundEffectSystem.ts`. Manages
 * persistent ground-area effects (flame trail, corrosive bile, ...):
 *   1. lifetime: count down `remainingDuration`, despawn expired zones
 *   2. same-(typeId, playerId) overlap does NOT stack — enemies inside any zone
 *      of one group receive the type's effects exactly once per tick (deduped)
 *   3. periodic effects: each group ticks its `tickInterval`, applying the
 *      type's effects to every enemy inside any of its zones
 *
 * RENDER: the Three.js source merged each group into a procedural fire/poison
 * shader mesh. forgeax has no custom shader pipeline here, so each zone carries
 * its OWN flat tinted disc (cylinder prim scaled flat) ChildOf the zone entity —
 * a recognizable colored ground patch, cheap, renderer-agnostic. The grouped
 * shader-merge is a renderer-detail seam (noted); the LOGIC (group dedup + tick)
 * is 1:1.
 *
 * ⚠️ ECS rules: qr[N] is Batch[]; collect-then-despawn (never despawn mid-iter);
 * area scan over a per-frame CombatTarget[] snapshot built from a Health+Faction
 * query (no ad-hoc world.query).
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer, ChildOf,
  type Handle,
} from '@forgeax/engine-runtime';
import { GroundEffect, Health, Faction, groundEffectTypeId } from '../components';
import { getGroundEffectDef, type GroundEffectTypeDef } from '../data/groundEffects';
import { resolveArea } from './splash-resolver';
import { executeEffects, type CastContext } from './effect-executor';
import { snapshotCombatTargets, type CombatTarget } from './combat-registry';
import type { UnitPrimitives } from '../world/unit-models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;
function rgbOf(packed: number): [number, number, number] {
  return [((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255];
}

type TintFn = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

export interface GroundEffectDeps {
  prims: UnitPrimitives;
  tint: TintFn;
  heightAt: (x: number, z: number) => number;
}

export interface GroundEffectSpawnArgs {
  typeId: string;
  x: number;
  z: number;
  playerId: number;
  radius: number;
  duration: number;
  casterEntity?: EntityHandle;
}

export interface GroundEffectHandle {
  spawnGroundEffect(args: GroundEffectSpawnArgs): EntityHandle | null;
  probe(): Array<Record<string, unknown>>;
}

interface EffectGroup { tickTimer: number; typeDef: GroundEffectTypeDef; }

export class GroundEffectSystem implements GroundEffectHandle {
  readonly name = 'GroundEffectSystem';
  private _world!: World;
  private readonly _deps: GroundEffectDeps;
  private _gameTime = 0;
  private readonly _groups = new Map<string, EffectGroup>();
  private readonly _snapshot: CombatTarget[] = [];
  private readonly _discOf = new Map<number, EntityHandle>();
  private readonly _discMat = new Map<number, Handle<'MaterialAsset', 'shared'>>();

  constructor(deps: GroundEffectDeps) { this._deps = deps; }

  install(world: World): GroundEffectHandle {
    this._world = world;
    world.addSystem({
      name: this.name,
      queries: [
        { with: [Entity, Transform, GroundEffect] },          // zones (query 0)
        { with: [Entity, Transform, Health, Faction] },        // combat snapshot (query 1)
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        this._gameTime += dt;

        // 1. lifetime tick + collect expired + collect live (no despawn mid-iter).
        const zoneBatches = qr[0] as unknown as Batch[];
        // perf: no ground-effect zones → skip the combat snapshot (only feeds the
        // zone area-effect tests). Zones are transient/rare, so this skips most frames.
        let anyZone = false;
        for (const b of zoneBatches) { if ((b.Entity.self.length as number) > 0) { anyZone = true; break; } }
        if (!anyZone) return;

        snapshotCombatTargets(world, qr[1] as unknown as Batch[], this._snapshot);

        const expired: EntityHandle[] = [];
        type LiveZone = { x: number; z: number; playerId: number; radius: number; caster: number; key: string; typeId: string };
        const live: LiveZone[] = [];
        for (const b of zoneBatches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            const remaining = (b.GroundEffect.remainingDuration[i] as number) - dt;
            b.GroundEffect.remainingDuration[i] = remaining;
            if (remaining <= 0) { expired.push(e); continue; }
            const playerId = b.GroundEffect.playerId[i] as number;
            const typeId = groundEffectTypeId.get(e) ?? '';
            live.push({
              x: b.Transform.pos[i * 3] as number,
              z: b.Transform.pos[i * 3 + 2] as number,
              playerId,
              radius: b.GroundEffect.radius[i] as number,
              caster: b.GroundEffect.casterEntity[i] as number,
              key: `${typeId}:${playerId}`,
              typeId,
            });
          }
        }

        // 2. group by (typeId, playerId); per-group tick the interval + apply.
        const grouped = new Map<string, LiveZone[]>();
        for (const z of live) {
          let g = grouped.get(z.key);
          if (!g) { g = []; grouped.set(z.key, g); }
          g.push(z);
        }
        const activeKeys = new Set<string>();
        for (const [key, zones] of grouped) {
          const typeDef = getGroundEffectDef(zones[0].typeId);
          if (!typeDef) continue;
          activeKeys.add(key);
          let group = this._groups.get(key);
          if (!group) { group = { tickTimer: 0, typeDef }; this._groups.set(key, group); }
          group.tickTimer += dt;
          if (group.tickTimer >= typeDef.tickInterval) {
            group.tickTimer -= typeDef.tickInterval;
            this._applyGroupEffects(world, zones, typeDef);
          }
        }
        for (const key of [...this._groups.keys()]) {
          if (!activeKeys.has(key)) this._groups.delete(key);
        }

        // 3. despawn expired zones + their disc child (after iteration).
        for (const e of expired) {
          const disc = this._discOf.get(rawId(e));
          if (disc !== undefined && world.get(disc, Transform).ok) world.despawn(disc);
          this._discOf.delete(rawId(e));
          groundEffectTypeId.delete(e);
          if (world.get(e, Transform).ok) world.despawn(e);
        }
      },
    });
    return this;
  }

  /** Apply the group's effects once per deduped enemy across all its zones. */
  private _applyGroupEffects(
    world: World,
    zones: Array<{ x: number; z: number; playerId: number; radius: number; caster: number }>,
    typeDef: GroundEffectTypeDef,
  ): void {
    const targetById = new Map<number, CombatTarget>();
    let anyCaster = 0;
    for (const z of zones) {
      anyCaster = z.caster;
      const sourcePlayer = typeDef.affectsFriendly ? -1 : z.playerId;
      const found = resolveArea(this._snapshot, z.x, z.z, sourcePlayer, { shape: 'circle', radius: z.radius, falloff: [1.0] });
      for (const h of found) {
        const id = rawId(h.entity);
        if (!targetById.has(id)) {
          const t = this._snapshot.find((c) => rawId(c.entity) === id);
          if (t) targetById.set(id, t);
        }
      }
    }
    for (const [, t] of targetById) {
      const ctx: CastContext = {
        caster: anyCaster as unknown as EntityHandle,
        targetEntity: t.entity,
        targetX: t.x,
        targetZ: t.z,
        gameTime: this._gameTime,
        targets: this._snapshot,
      };
      executeEffects(world, ctx, typeDef.effects);
    }
  }

  spawnGroundEffect(args: GroundEffectSpawnArgs): EntityHandle | null {
    const world = this._world;
    const def = getGroundEffectDef(args.typeId);
    if (!def) { console.warn(`[marscraft][ground-effect] unknown type "${args.typeId}"`); return null; }
    const y = this._deps.heightAt(args.x, args.z);
    const res = world.spawn(
      { component: Transform, data: { pos: [args.x, y, args.z] } },
      {
        component: GroundEffect,
        data: {
          playerId: args.playerId,
          casterEntity: args.casterEntity !== undefined ? rawId(args.casterEntity) : 0,
          radius: args.radius,
          remainingDuration: args.duration,
          maxDuration: args.duration,
        },
      },
    );
    if (!res.ok) { console.error('[marscraft][ground-effect] spawn failed'); return null; }
    const e = res.value;
    groundEffectTypeId.set(e, args.typeId);

    // Flat tinted disc child: cylinder prim (Y-up) scaled wide + very thin.
    const mat = this._tintFor(def.color);
    const d = world.spawn(
      {
        component: Transform,
        data: {
          pos: [0, 0.12, 0],
          scale: [args.radius * 2, 0.05, args.radius * 2],
        },
      },
      { component: MeshFilter, data: { assetHandle: this._deps.prims.cylinder } },
      { component: MeshRenderer, data: { materials: [mat] } },
      { component: ChildOf, data: { parent: e } },
    );
    if (d.ok) this._discOf.set(rawId(e), d.value);
    return e;
  }

  private _tintFor(color: number): Handle<'MaterialAsset', 'shared'> {
    const cached = this._discMat.get(color);
    if (cached) return cached;
    const m = this._deps.tint(rgbOf(color), { metallic: 0, roughness: 1 });
    this._discMat.set(color, m);
    return m;
  }

  probe(): Array<Record<string, unknown>> {
    const world = this._world;
    const out: Array<Record<string, unknown>> = [];
    for (let raw = 0; raw < 9000; raw++) {
      const eh = raw as unknown as EntityHandle;
      const g = world.get(eh, GroundEffect);
      if (!g.ok) continue;
      const t = world.get(eh, Transform);
      out.push({
        entity: raw,
        typeId: groundEffectTypeId.get(eh) ?? null,
        playerId: g.value.playerId,
        radius: g.value.radius,
        remaining: Number(g.value.remainingDuration.toFixed(3)),
        x: t.ok ? Number(t.value.pos[0].toFixed(2)) : null,
        z: t.ok ? Number(t.value.pos[2].toFixed(2)) : null,
      });
    }
    return out;
  }
}
