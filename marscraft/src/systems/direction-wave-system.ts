/**
 * MarsCraft -> forgeax-engine — DirectionWaveSystem (M17 chunk C — M9 seam close)
 * =============================================================================
 * Port of the Three.js source `direction_wave` projectile branch (Projectile.ts
 * `direction_wave` params + ProjectileSystem `_updateDirectionWave`). A direction
 * wave is spawned by the `spawn_direction_wave` ability effect (only user:
 * Corruptor `sonar_pulse`). It travels from the caster along a fixed NORMALIZED
 * direction at `speed` up to `maxRange`, and each frame:
 *   1. advances the wavefront + faces the travel direction,
 *   2. path-reveals fog (temporary vision points every revealRange*0.6 along the
 *      traveled path — de-fogs the corridor, source `waveRevealLastDist` loop),
 *   3. scans the corridor from origin→wavefront (width `width`, unit radius aware)
 *      for enemy units not yet hit, running `hitEffects` once per new hit
 *      (source: rectangular longitudinal/lateral projection test + waveHitSet),
 *   4. despawns when `traveled >= maxRange`.
 *
 * RENDER: the source drew a wave sprite; forgeax has no sprite/shader pipeline
 * here, so the wave carries a flat wide tinted slab (box prim, ChildOf) sized to
 * the wave width, oriented across the travel direction and sitting at the
 * wavefront — a recognizable moving pulse. The visual is cosmetic; the LOGIC
 * (path reveal + corridor hit-once) is 1:1 with the source.
 *
 * ⚠️ ECS rules: qr[N] is Batch[]; collect-then-despawn (never despawn mid-iter);
 * corridor scan uses a per-frame CombatTarget[] snapshot (no ad-hoc world.query).
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer, ChildOf, quat,
  type Handle,
} from '@forgeax/engine-runtime';
import {
  DirectionWave, Health, Faction, Garrisoned,
  directionWaveHitEffects, directionWaveHitSet,
} from '../components';
import { executeEffects, type CastContext } from './effect-executor';
import { snapshotCombatTargets, type CombatTarget } from './combat-registry';
import type { AbilityEffect } from '../data/abilities';
import type { UnitPrimitives } from '../world/unit-models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;
function rgbOf(packed: number): [number, number, number] {
  return [((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255];
}

type TintFn = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

export interface VisionLike {
  addTemporaryVision(playerId: number, x: number, z: number, range: number, duration: number, height?: number): void;
}

export interface DirectionWaveDeps {
  prims: UnitPrimitives;
  tint: TintFn;
  heightAt: (x: number, z: number) => number;
  /** Optional — fog reveal along the wave path (null = no reveal, still hits). */
  vision: VisionLike | null;
}

export interface DirectionWaveSpawnArgs {
  casterEntity: EntityHandle;
  playerId: number;
  x: number;
  z: number;
  /** Normalized travel direction (the ability system normalizes direction casts). */
  dirX: number;
  dirZ: number;
  speed: number;
  maxRange: number;
  width: number;
  hitEffects: AbilityEffect[];
  revealRange?: number;
  revealDuration?: number;
  /** Slab tint (0xRRGGBB), default sonar cyan. */
  color?: number;
}

export interface DirectionWaveHandle {
  spawnDirectionWave(args: DirectionWaveSpawnArgs): EntityHandle | null;
  probe(): Array<Record<string, unknown>>;
}

const DEFAULT_WAVE_COLOR = 0x66ddff;

export class DirectionWaveSystem implements DirectionWaveHandle {
  readonly name = 'DirectionWaveSystem';
  private _world!: World;
  private readonly _deps: DirectionWaveDeps;
  private _gameTime = 0;
  private readonly _snapshot: CombatTarget[] = [];
  private readonly _slabOf = new Map<number, EntityHandle>();
  private readonly _slabMat = new Map<number, Handle<'MaterialAsset', 'shared'>>();

  constructor(deps: DirectionWaveDeps) { this._deps = deps; }

  install(world: World): DirectionWaveHandle {
    this._world = world;
    world.addSystem({
      name: this.name,
      queries: [
        { with: [Entity, Transform, DirectionWave] },   // waves (query 0)
        { with: [Entity, Transform, Health, Faction] },  // combat snapshot (query 1)
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        this._gameTime += dt;

        const waveBatches = qr[0] as unknown as Batch[];
        // fast bail: no waves alive → skip the snapshot cost entirely.
        let anyWave = false;
        for (const b of waveBatches) { if ((b.Entity.self.length as number) > 0) { anyWave = true; break; } }
        if (!anyWave) return;

        snapshotCombatTargets(world, qr[1] as unknown as Batch[], this._snapshot);

        const expired: EntityHandle[] = [];
        for (const b of waveBatches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            if (this._tickWave(world, b, i, dt)) expired.push(b.Entity.self[i] as EntityHandle);
          }
        }

        // despawn finished waves (+ slab child) after iteration.
        for (const e of expired) {
          const slab = this._slabOf.get(rawId(e));
          if (slab !== undefined && world.get(slab, Transform).ok) world.despawn(slab);
          this._slabOf.delete(rawId(e));
          directionWaveHitEffects.delete(e);
          directionWaveHitSet.delete(e);
          if (world.get(e, Transform).ok) world.despawn(e);
        }
      },
    });
    return this;
  }

  /** Advance one wave; @returns true = reached maxRange (despawn). */
  private _tickWave(world: World, b: Batch, i: number, dt: number): boolean {
    const W = b.DirectionWave;
    const dirX = W.dirX[i] as number;
    const dirZ = W.dirZ[i] as number;
    const speed = W.speed[i] as number;
    const step = speed * dt;
    const traveled = (W.traveled[i] as number) + step;
    W.traveled[i] = traveled;

    // move the wavefront + face travel direction
    b.Transform.pos[i * 3] = (b.Transform.pos[i * 3] as number) + dirX * step;
    b.Transform.pos[i * 3 + 2] = (b.Transform.pos[i * 3 + 2] as number) + dirZ * step;
    if (dirX !== 0 || dirZ !== 0) {
      const ang = Math.atan2(dirX, dirZ);
      quat.fromEuler(_q, 0, (ang * 180) / Math.PI, 0, 'XYZ');
      b.Transform.quat[i * 4] = _q[0]; b.Transform.quat[i * 4 + 1] = _q[1];
      b.Transform.quat[i * 4 + 2] = _q[2]; b.Transform.quat[i * 4 + 3] = _q[3];
    }

    const originX = W.originX[i] as number;
    const originZ = W.originZ[i] as number;
    const y = b.Transform.pos[i * 3 + 1] as number;
    const playerId = W.playerId[i] as number;

    // ── path reveal (temporary vision every revealRange*0.6 along the path) ──
    const revealRange = W.revealRange[i] as number;
    if (revealRange > 0 && this._deps.vision) {
      const interval = revealRange * 0.6;
      const revealDur = W.revealDuration[i] as number;
      let last = W.revealLastDist[i] as number;
      // guard the loop (interval could be tiny) — cap iterations per frame.
      let guard = 0;
      while (last < traveled && guard < 64) {
        const px = originX + dirX * last;
        const pz = originZ + dirZ * last;
        this._deps.vision.addTemporaryVision(playerId, px, pz, revealRange, revealDur, y);
        last += interval > 0.01 ? interval : traveled + 1;
        guard++;
      }
      W.revealLastDist[i] = last;
    }

    // ── corridor hit detection (origin → wavefront, width W.width) ──
    const e = b.Entity.self[i] as EntityHandle;
    let hitSet = directionWaveHitSet.get(e);
    if (!hitSet) { hitSet = new Set<number>(); directionWaveHitSet.set(e, hitSet); }
    // companion map value type is erased to `unknown` in components.ts (circular-import
    // avoidance); the concrete element type is known here.
    const effects = directionWaveHitEffects.get(e) as AbilityEffect[] | undefined;
    const halfWidth = (W.width[i] as number) / 2;
    // perpendicular = (-dirZ, dirX)
    for (const c of this._snapshot) {
      if (c.isDead || c.isPlacing) continue;
      if (c.playerId === playerId || c.playerId === 99) continue;
      const id = rawId(c.entity);
      if (hitSet.has(id)) continue;
      if (world.get(c.entity, Garrisoned).ok) continue;
      const relX = c.x - originX;
      const relZ = c.z - originZ;
      const targetRadius = c.radius;
      // longitudinal projection along travel dir must lie within [−r, traveled+r]
      const longitudinal = relX * dirX + relZ * dirZ;
      if (longitudinal < -targetRadius || longitudinal > traveled + targetRadius) continue;
      // lateral distance from the wave axis (edge-aware)
      const lateral = Math.abs(relX * -dirZ + relZ * dirX);
      if (Math.max(0, lateral - targetRadius) > halfWidth) continue;

      // hit! record + run the hit effects once.
      hitSet.add(id);
      if (effects && effects.length > 0) {
        const ctx: CastContext = {
          caster: (W.casterEntity[i] as number) as unknown as EntityHandle,
          targetEntity: c.entity,
          targetX: c.x,
          targetZ: c.z,
          gameTime: this._gameTime,
          targets: this._snapshot,
        };
        executeEffects(world, ctx, effects);
      }
    }

    return traveled >= (W.maxRange[i] as number);
  }

  spawnDirectionWave(args: DirectionWaveSpawnArgs): EntityHandle | null {
    const world = this._world;
    const len = Math.hypot(args.dirX, args.dirZ);
    if (len < 1e-4) { console.warn('[marscraft][direction-wave] zero direction — skipped'); return null; }
    const dirX = args.dirX / len, dirZ = args.dirZ / len;
    const y = this._deps.heightAt(args.x, args.z) + 0.5;
    const res = world.spawn(
      {
        component: Transform,
        data: { pos: [args.x, y, args.z] },
      },
      {
        component: DirectionWave,
        data: {
          playerId: args.playerId,
          casterEntity: rawId(args.casterEntity),
          dirX, dirZ,
          originX: args.x, originZ: args.z,
          speed: args.speed,
          width: args.width,
          maxRange: args.maxRange,
          traveled: 0,
          revealRange: args.revealRange ?? 0,
          revealDuration: args.revealDuration ?? 5,
          revealLastDist: 0,
        },
      },
    );
    if (!res.ok) { console.error('[marscraft][direction-wave] spawn failed'); return null; }
    const e = res.value;
    directionWaveHitEffects.set(e, args.hitEffects);
    directionWaveHitSet.set(e, new Set<number>());

    // wave-front slab: box prim, wide across the travel dir + thin along it.
    const mat = this._tintFor(args.color ?? DEFAULT_WAVE_COLOR);
    const slab = world.spawn(
      {
        component: Transform,
        data: {
          pos: [0, 0, 0],
          scale: [args.width, 0.4, 0.25],
        },
      },
      { component: MeshFilter, data: { assetHandle: this._deps.prims.box } },
      { component: MeshRenderer, data: { materials: [mat] } },
      { component: ChildOf, data: { parent: e } },
    );
    if (slab.ok) this._slabOf.set(rawId(e), slab.value);
    return e;
  }

  private _tintFor(color: number): Handle<'MaterialAsset', 'shared'> {
    const cached = this._slabMat.get(color);
    if (cached) return cached;
    const m = this._deps.tint(rgbOf(color), { metallic: 0, roughness: 1 });
    this._slabMat.set(color, m);
    return m;
  }

  probe(): Array<Record<string, unknown>> {
    const world = this._world;
    const out: Array<Record<string, unknown>> = [];
    // Iterate the live-wave set (its keys are the real handles) rather than a
    // raw 0..N id scan — waves get recycled (gen>0) handles a raw scan misses.
    for (const rawHandle of this._slabOf.keys()) {
      const eh = rawHandle as unknown as EntityHandle;
      const w = world.get(eh, DirectionWave);
      if (!w.ok) continue;
      const t = world.get(eh, Transform);
      out.push({
        entity: rawHandle,
        playerId: w.value.playerId,
        traveled: Number(w.value.traveled.toFixed(2)),
        maxRange: Number(w.value.maxRange.toFixed(2)),
        hits: directionWaveHitSet.get(eh)?.size ?? 0,
        x: t.ok ? Number(t.value.pos[0].toFixed(2)) : null,
        z: t.ok ? Number(t.value.pos[2].toFixed(2)) : null,
      });
    }
    return out;
  }
}

// scratch quat for wave orientation (module-scope, no per-frame alloc).
const _q = quat.create();
