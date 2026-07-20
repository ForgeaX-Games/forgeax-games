/**
 * MarsCraft -> forgeax-engine — BuffAuraSystem (M17 chunk C — persistent buff VFX)
 * =============================================================================
 * Port of the Three.js source `web/effects/AbilityVFX.ts` `_createBuffVFX` /
 * `_updateBuffVFX` / `_destroyBuffVFX` — the DECLARATIVE, per-entity buff aura
 * that "covers most at once": every buff/debuff whose data carries a
 * `BuffVFXConfig` gets, for as long as the buff is held, up to four visuals:
 *   • burst      — a one-shot activation flash + N outward motes (+ an expanding ring)
 *   • particles  — continuous motes drifting up / down / radially at an interval
 *   • marker     — an overhead token (circle / diamond / ring) that floats + spins
 *   • groundRing — a foot-ring that pulses
 * (`tint` — dyeing the whole unit model — needs a per-entity material instance the
 * shared-material model doesn't give us; noted below as the one honest seam.)
 *
 * WIRING (SSOT already in place): `ability:buff_applied` carries the buff's `vfx`
 * config (emitted by effect-executor on apply_buff/apply_debuff); `ability:buff_removed`
 * fires on expiry. This system is the CONSUMER: it creates the aura on apply and
 * tears it down on removal OR when `hasBuff` goes false OR when the host despawns.
 *
 * RENDER: Three.js added meshes to a scene + animated material.opacity. forgeax is
 * ECS + shared materials, so the marker / groundRing / burst-ring are FREE entities
 * (Transform + MeshFilter + MeshRenderer, flat XZ-plane geometry from the shared
 * FlatMeshCache) that this system REPOSITIONS onto the host each frame and
 * despawns on teardown (free, not ChildOf — sidesteps the ChildOf-orphan class
 * entirely). Opacity pulse → a scale pulse (no per-entity material to fade). The
 * continuous particles delegate to the proven VfxSystem (`buff_mote` kind), so their
 * lifecycle/GC is shared, not re-implemented.
 *
 * ⚠️ ECS rules: event handlers only BUFFER create/remove requests; all world
 * spawn/despawn happens at the top of this system's own tick (mirrors VfxSystem's
 * safe-spawn discipline). No despawn mid-iteration of our own tracked set.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer,
  type Handle,
} from '@forgeax/engine-runtime';
import { hasBuff } from './abilities-runtime';
import { eventBus, type GameEvents } from '../core/event-bus';
import { FlatMeshCache } from '../world/flat-meshes';
import type { VfxHandle } from './vfx-system';
import type { BuffVFXConfig } from '../data/abilities';

const toHandle = (id: number): EntityHandle => id as unknown as EntityHandle;
/** packed 0xRRGGBB -> [r,g,b] 0..1 (the source stores buff colors as hex). */
function rgbOf(packed: number): [number, number, number] {
  return [((packed >> 16) & 0xff) / 255, ((packed >> 8) & 0xff) / 255, (packed & 0xff) / 255];
}

type TintFn = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

interface AuraInstance {
  entity: EntityHandle;
  entityId: number;
  buffId: string;
  config: BuffVFXConfig;
  elapsed: number;
  particleTimer: number;
  marker: EntityHandle | null;
  ground: EntityHandle | null;
}
interface TransientRing { entity: EntityHandle; life: number; maxLife: number; radius: number; }
interface CreateReq { entityId: number; buffId: string; config: BuffVFXConfig; }

export interface BuffAuraDeps { tint: TintFn; }

export interface BuffAuraHandle {
  /** Number of live buff auras (verify). */
  count(): number;
  /** Per-aura snapshot (verify): which visuals each carries. */
  probe(): Array<{ entity: number; buffId: string; marker: boolean; ground: boolean }>;
}

export class BuffAuraSystem implements BuffAuraHandle {
  readonly name = 'BuffAuraSystem';
  private _world!: World;
  private readonly _vfx: VfxHandle;
  private readonly _tint: TintFn;
  private readonly _auras = new Map<string, AuraInstance>();
  private readonly _rings: TransientRing[] = [];
  private _flat!: FlatMeshCache;
  private readonly _pendingCreate: CreateReq[] = [];
  private readonly _pendingRemove: string[] = [];
  private _rngS = 0x1a2b3c4d;

  constructor(vfx: VfxHandle, deps: BuffAuraDeps) { this._vfx = vfx; this._tint = deps.tint; }

  install(world: World): BuffAuraHandle {
    this._world = world;
    this._flat = new FlatMeshCache(world);
    eventBus.on('ability:buff_applied', this._onApplied);
    eventBus.on('ability:buff_removed', this._onRemoved);
    world.addSystem({
      name: this.name,
      queries: [{ with: [Entity, Transform] }], // unused — we iterate our own tracked set
      resources: ['Time'],
      fn: () => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        this._flush();
        if (dt <= 0) return;
        this._tick(dt);
      },
    });
    return this;
  }

  count(): number { return this._auras.size; }
  probe(): Array<{ entity: number; buffId: string; marker: boolean; ground: boolean }> {
    return [...this._auras.values()].map((a) => ({
      entity: a.entityId, buffId: a.buffId, marker: a.marker !== null, ground: a.ground !== null,
    }));
  }

  // ── event handlers: BUFFER only (spawn happens in the tick) ─────────────────
  private readonly _onApplied = (d: GameEvents['ability:buff_applied']): void => {
    if (!d.vfx) return; // only buffs that declare a VFX get an aura
    this._pendingCreate.push({ entityId: d.entity, buffId: d.buffId, config: d.vfx });
  };
  private readonly _onRemoved = (d: GameEvents['ability:buff_removed']): void => {
    this._pendingRemove.push(this._key(d.entity, d.buffId));
  };

  private _key(entityId: number, buffId: string): string { return `${entityId}:${buffId}`; }
  private _rng(): number {
    let s = this._rngS | 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this._rngS = s;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ── drain pending create/remove (safe spawn point) ──────────────────────────
  private _flush(): void {
    if (this._pendingRemove.length) {
      for (const k of this._pendingRemove.splice(0)) this._destroy(k);
    }
    if (this._pendingCreate.length) {
      for (const r of this._pendingCreate.splice(0)) this._create(r);
    }
  }

  private _create(req: CreateReq): void {
    const key = this._key(req.entityId, req.buffId);
    if (this._auras.has(key)) return; // refresh: keep the existing aura
    const e = toHandle(req.entityId);
    const tr = this._world.get(e, Transform);
    if (!tr.ok) return;
    const tf = tr.value;
    const cfg = req.config;
    const inst: AuraInstance = {
      entity: e, entityId: req.entityId, buffId: req.buffId, config: cfg,
      elapsed: 0, particleTimer: 0, marker: null, ground: null,
    };

    // activation burst (one-shot flash + motes, delegated to VfxSystem) + ring
    if (cfg.burst) {
      const b = cfg.burst;
      this._vfx.spawnVfx('buff_burst', tf.pos[0], tf.pos[1] + 0.3, tf.pos[2], {
        color: rgbOf(b.color), count: b.count, size: b.size, speed: b.speed,
      });
      if (b.ring) {
        const mesh = this._flat.ring(0.82, 1.0, 32);
        const mat = this._tint(rgbOf(b.ring.color), { metallic: 0, roughness: 1 });
        const res = this._world.spawn(
          { component: Transform, data: { pos: [tf.pos[0], tf.pos[1] + 0.05, tf.pos[2]], scale: [0.01, 1, 0.01] } },
          { component: MeshFilter, data: { assetHandle: mesh } },
          { component: MeshRenderer, data: { materials: [mat] } },
        );
        if (res.ok) this._rings.push({ entity: res.value as EntityHandle, life: b.ring.duration, maxLife: b.ring.duration, radius: b.ring.radius });
      }
    }

    // overhead marker (circle / diamond / ring)
    if (cfg.marker) {
      const m = cfg.marker;
      const mesh = m.shape === 'ring' ? this._flat.ring(m.size * 0.7, m.size, 32)
        : this._flat.disc(m.size, m.shape === 'diamond' ? 4 : 16);
      const mat = this._tint(rgbOf(m.color), { metallic: 0, roughness: 1 });
      const res = this._world.spawn(
        { component: Transform, data: { pos: [tf.pos[0], tf.pos[1] + 1.0, tf.pos[2]] } },
        { component: MeshFilter, data: { assetHandle: mesh } },
        { component: MeshRenderer, data: { materials: [mat] } },
      );
      if (res.ok) inst.marker = res.value as EntityHandle;
    }

    // foot ground-ring
    if (cfg.groundRing) {
      const gr = cfg.groundRing;
      const mesh = this._flat.ring(gr.radius * 0.85, gr.radius, 32);
      const mat = this._tint(rgbOf(gr.color), { metallic: 0, roughness: 1 });
      const res = this._world.spawn(
        { component: Transform, data: { pos: [tf.pos[0], tf.pos[1] + 0.05, tf.pos[2]] } },
        { component: MeshFilter, data: { assetHandle: mesh } },
        { component: MeshRenderer, data: { materials: [mat] } },
      );
      if (res.ok) inst.ground = res.value as EntityHandle;
    }

    this._auras.set(key, inst);
  }

  private _destroy(key: string): void {
    const inst = this._auras.get(key);
    if (!inst) return;
    if (inst.marker && this._world.get(inst.marker, Transform).ok) this._world.despawn(inst.marker);
    if (inst.ground && this._world.get(inst.ground, Transform).ok) this._world.despawn(inst.ground);
    this._auras.delete(key);
  }

  // ── per-frame update ────────────────────────────────────────────────────────
  private _tick(dt: number): void {
    const world = this._world;
    const dead: string[] = [];
    for (const [key, inst] of this._auras) {
      const tr = world.get(inst.entity, Transform);
      // host gone OR buff expired -> tear down
      if (!tr.ok || !hasBuff(inst.entity as unknown as never, inst.buffId)) { dead.push(key); continue; }
      const tf = tr.value;
      inst.elapsed += dt;
      const cfg = inst.config;

      // continuous particles (source _updateBuffVFX config.particles)
      if (cfg.particles) {
        const p = cfg.particles;
        inst.particleTimer += dt;
        if (inst.particleTimer >= p.interval) {
          inst.particleTimer = 0;
          const ox = (this._rng() - 0.5) * 0.2;
          const oz = (this._rng() - 0.5) * 0.2;
          const packed = p.color2 !== undefined && this._rng() > 0.5 ? p.color2 : p.color;
          let vel: [number, number, number];
          if (p.direction === 'up') vel = [0, p.speed, 0];
          else if (p.direction === 'down') vel = [(this._rng() - 0.5) * p.speed * 0.2, -p.speed, (this._rng() - 0.5) * p.speed * 0.2];
          else vel = [Math.cos(this._rng() * Math.PI * 2) * p.speed * 0.5, p.speed * 0.3, Math.sin(this._rng() * Math.PI * 2) * p.speed * 0.5];
          this._vfx.spawnVfx('buff_mote', tf.pos[0] + ox, tf.pos[1] + 0.4, tf.pos[2] + oz, {
            color: rgbOf(packed), size: p.size, vel, lifetime: p.lifetime,
          });
        }
      }

      // overhead marker: follow + float + spin
      if (inst.marker && cfg.marker) {
        const m = cfg.marker;
        const floatY = m.pulse ? Math.sin(inst.elapsed * 3) * 0.05 : 0;
        const patch: { pos: [number, number, number]; quat?: [number, number, number, number] } = {
          pos: [tf.pos[0], tf.pos[1] + 1.0 + floatY, tf.pos[2]],
        };
        if (m.spin) {
          const half = inst.elapsed * 0.5 * 0.5; // θ/2, θ = elapsed*0.5
          patch.quat = [0, Math.sin(half), 0, Math.cos(half)];
        }
        world.set(inst.marker, Transform, patch);
      }

      // foot ground-ring: follow + pulse (opacity->scale)
      if (inst.ground && cfg.groundRing) {
        const gr = cfg.groundRing;
        const patch: { pos: [number, number, number]; scale?: [number, number, number] } = {
          pos: [tf.pos[0], tf.pos[1] + 0.05, tf.pos[2]],
        };
        // ground ring spawned with default scale [1,1,1]; pulse drives X/Z, Y stays 1.
        if (gr.pulse) { const s = 1 + Math.sin(inst.elapsed * 4) * 0.15; patch.scale = [s, 1, s]; }
        world.set(inst.ground, Transform, patch);
      }
    }
    for (const k of dead) this._destroy(k);

    // transient burst rings: expand + fade (source burstRing animation)
    if (this._rings.length) {
      const keepRings: TransientRing[] = [];
      for (const r of this._rings) {
        r.life -= dt;
        if (r.life <= 0) { if (world.get(r.entity, Transform).ok) world.despawn(r.entity); continue; }
        const progress = 1 - r.life / r.maxLife;
        const s = Math.max(0.01, r.radius * progress);
        // burst ring spawned with scale [0.01, 1, 0.01]; expand drives X/Z, Y stays 1.
        world.set(r.entity, Transform, { scale: [s, 1, s] });
        keepRings.push(r);
      }
      this._rings.length = 0;
      this._rings.push(...keepRings);
    }
  }
}
