/**
 * MarsCraft -> forgeax-engine — VFX framework + core combat/death effects (M11 ch1)
 * =============================================================================
 * Port of the Three.js effect layer (`effects/CombatVFX.ts` 2294 LOC +
 * `effects/DestructionDebris.ts` 411 LOC + a slice of `effects/AbilityVFX.ts`
 * 2960 LOC). The source drives a bespoke THREE particle / sprite / shader layer
 * (additive-blended billboards, `BufferGeometry` slash arcs, GPU point clouds,
 * fog-reprojection shaders). forgeax games CANNOT add a custom THREE renderer,
 * particle system, or post-process pass — the preview host owns the pipeline. So
 * this is the **faithful-in-spirit** translation the rest of the port already uses
 * (units, ground-effects, hazards): each VFX is one or more **transient mesh
 * entities** (a cached `prims` box/sphere/cone/cylinder + a shared tinted UNLIT
 * material) that animate over a lifetime then self-despawn.
 *
 * ── source animation model -> forgeax ────────────────────────────────────────
 * The source animated every effect by `age/maxAge` and faded via material
 * `opacity` + additive blending (`spawnImpactFlash` IMPACT_FLASH_TIME=0.2,
 * `spawnGroundShockwave` expanding ring, `DestructionDebris.spawnDebris` 4-8 box
 * chunks + a flash sphere + a GPU explosion particle burst with `vy -= 6*dt`
 * gravity, `EXPLOSION_LIFETIME=1.2`). We keep the SAME age/lifetime + velocity +
 * gravity + spin physics, but a game can't mutate per-frame opacity on a SHARED
 * material (that material is reused by every particle of that color — mutating it
 * would flicker all of them) and additive blending isn't available without the
 * custom pipeline (and additive-bloom-to-white is a known trap — see memory note).
 * So we **fade by shrinking scale start->end** (lerped over the lifetime) instead
 * of opacity, and use UNLIT materials so glows read bright without bloom buildup.
 * Visually faithful (the burst expands/rises then collapses+vanishes); mechanically
 * a clean transient-entity lifecycle with zero leaks.
 *
 * ── architecture ─────────────────────────────────────────────────────────────
 * - `spawnVfx(kind, x, y, z, opts)` is the public entry: it BUFFERS a spawn
 *   request (does not touch the world). VFX are spawned from EventBus handlers
 *   that fire MID-FRAME inside other systems' query iterations (attack /
 *   projectile / damage / death / ability) — spawning an entity mid-iteration
 *   corrupts the batches (cheatsheet ⚠️). The buffer is FLUSHED at the top of the
 *   vfx-system's own tick (outside any query loop), where spawning is safe.
 * - The per-frame ECS system: (1) flush buffered spawns -> create each effect's
 *   transient `Vfx`-tagged entities; (2) iterate the `Vfx` query, advance every
 *   particle (move by velocity + gravity, lerp scale, optional spin), collect the
 *   ones whose age>=lifetime; (3) despawn the expired ones AFTER the loop.
 * - Particle counts are modest (<=12 per burst) for perf.
 *
 * ── scope (M11 chunk 1 — CORE only; per-weapon/per-ability catalog = chunk 2) ──
 * REAL here: impact, explosion, muzzle, spark, blood, shield_hit, cast_flash,
 * death_debris. The long bespoke tail of `CombatVFX.ts` (per-weapon melee-slash
 * arcs, slime splatter, flame streams, tethers, bounce-arc trails, stomp/shockwave
 * variants) and the per-ability visuals of `AbilityVFX.ts` (EMP, psi-storm, nuke,
 * ...) are **M11 chunk 2** — a `spawnVfx` kind table extension. They are NOT faked
 * here; the framework + the 8 core kinds are complete.
 */

import { defineComponent, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer,
  type Handle,
} from '@forgeax/engine-runtime';
import type { UnitPrimitives, PartShape, TintFn } from '../world/unit-models';
import { eventBus } from '../core/event-bus';
import { UnitType, Faction, Renderable, COMBAT_TYPE, RACE, attackWeaponId } from '../components';
import { getWeaponVFX, hexRgb } from '../data/weapon-vfx';
import { getWeaponDef } from '../data/weapons';
import { getAbilityDef } from '../data/abilities';
import { getAbilityVfx } from '../data/ability-vfx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;

/**
 * Per-particle transient VFX state (SoA, numeric-only — matches the engine's
 * component constraints). Each VFX entity carries Transform + MeshFilter +
 * MeshRenderer + Vfx. The system advances it every frame and despawns at expiry.
 *
 *   age/lifetime  — seconds; despawn when age>=lifetime
 *   velX/Y/Z      — world units/sec; integrated each frame
 *   gravity       — subtracted from velY each second (downward; 0 = no gravity)
 *   drag          — multiplicative velocity decay per second (1 = none; <1 slows)
 *   startScale/endScale — uniform scale lerped start->end over the lifetime
 *                          (fade-by-shrink replaces the source opacity fade)
 *   spinRate      — radians/sec spin about a fixed tumble axis (debris tumble)
 *   axisX/Y/Z     — normalized spin axis
 *   spinAngle     — accumulated spin (rebuilt into the quat each frame)
 */
export const Vfx = defineComponent('Vfx', {
  age: 'f32',
  lifetime: 'f32',
  velX: 'f32', velY: 'f32', velZ: 'f32',
  gravity: 'f32',
  drag: { type: 'f32', default: 1 },
  startScale: 'f32',
  endScale: 'f32',
  spinRate: 'f32',
  axisX: 'f32', axisY: 'f32', axisZ: 'f32',
  spinAngle: 'f32',
});

/** CORE effect kinds (M11 chunk 1) + bespoke per-weapon/ability kinds (chunk 2). */
export type VfxKind =
  // ── core (chunk 1) ──
  | 'impact'        // small spark burst at a hit point
  | 'explosion'     // expanding fading sphere + debris bits
  | 'muzzle'        // brief cone flash at the attacker (toward the target)
  | 'spark'         // a few flying metallic bits (mechanical damage)
  | 'blood'         // a few flying organic bits (biological damage)
  | 'shield_hit'    // a quick expanding ring (energy-shield deflection)
  | 'cast_flash'    // ability-cast glow + rising motes at the caster
  | 'death_debris'  // unit/building death: flying chunks + dust + flash
  // ── bespoke per-weapon (chunk 2, source CombatVFX) ──
  | 'slash'         // melee arc: N elongated claw/blade marks across the target
  | 'flame'         // flamethrower: cone of flame particles toward the target
  | 'slime'         // acid/slime splatter hit (dripping organic gobs)
  | 'shockwave'     // ground stomp: expanding ring + rock bits + dust ring
  | 'trail'         // one fading projectile-trail mote (emitted per frame in flight)
  | 'emp'           // EMP burst: expanding blue pulse rings + flash + electric arcs
  | 'blink_out'     // blink departure: imploding ring + inward-converging motes
  | 'blink_in'      // blink arrival: expanding ring + outward-bursting motes
  | 'shield_burst'  // shield-restore: blue expanding ring + flash + outward motes
  | 'energy_flash'  // energy-gain: gold flash + ring + outward motes
  // ── persistent buff auras (M17 chunk C, source AbilityVFX._createBuffVFX) ──
  | 'buff_burst'    // buff activation: central flash + N outward motes (config'd)
  | 'buff_mote';    // one continuous aura particle (emitted per-interval by BuffAuraSystem)

export interface VfxOpts {
  /** RGB 0..1 base color override (else the kind's default). */
  color?: [number, number, number];
  /** Secondary RGB (gradient effects — flame/slime/shockwave). */
  color2?: [number, number, number];
  /** Direction (world XZ) the effect points/sprays toward (muzzle/blood/spark/slash/flame). */
  dirX?: number;
  dirZ?: number;
  /** Scale multiplier (e.g. modelSize for death_debris / explosion; impactSize for slash). */
  size?: number;
  /** Count override (slash marks; shockwave radius in world units; buff_burst mote count). */
  count?: number;
  /** Explicit velocity (buff_mote continuous aura particle drift). */
  vel?: [number, number, number];
  /** Particle lifetime override in seconds (buff_mote / buff_burst). */
  lifetime?: number;
  /** Outward spray speed (buff_burst activation motes). */
  speed?: number;
  /** Downward accel for a buff_mote (rock/dirt debris arcs); default 0. */
  gravity?: number;
  /** Mote shape override (buff_mote): 'sphere' (default) or 'box' (chunky debris). */
  shape?: PartShape;
}

interface SpawnReq {
  kind: VfxKind;
  x: number; y: number; z: number;
  opts: VfxOpts;
}

interface ParticleSpec {
  shape: PartShape;
  color: [number, number, number];
  pos: [number, number, number];
  vel: [number, number, number];
  gravity: number;
  drag: number;
  startScale: number;
  endScale: number;
  lifetime: number;
  spinRate: number;
  axis: [number, number, number];
}

// ── default kind colors (from the source effect palettes) ────────────────────
const COLOR_IMPACT: [number, number, number] = [1.0, 0.85, 0.4];   // bright spark
const COLOR_EXPLOSION: [number, number, number] = [1.0, 0.55, 0.12]; // fire orange
const COLOR_MUZZLE: [number, number, number] = [1.0, 0.92, 0.5];   // muzzle flash
const COLOR_SPARK: [number, number, number] = [1.0, 0.8, 0.3];     // metal spark
const COLOR_BLOOD: [number, number, number] = [0.6, 0.05, 0.05];   // dark red
const COLOR_SHIELD: [number, number, number] = [0.35, 0.7, 1.0];   // energy blue
const COLOR_CAST: [number, number, number] = [0.5, 0.8, 1.0];      // arcane glow
const COLOR_DUST: [number, number, number] = [0.25, 0.2, 0.16];    // charred dust

/**
 * Deterministic PRNG (mulberry32) so VFX bursts are reproducible for verify and
 * don't depend on Math.random (matches the rest of the port's seeding style).
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface VfxDeps {
  prims: UnitPrimitives;
  tint: TintFn;
  /** Terrain sampler — `spawnVfxOnGround` sites effects at terrain height. */
  heightAt: (x: number, z: number) => number;
}

export interface VfxHandle {
  /** Buffer a VFX spawn at a world point (safe to call mid-frame / from events). */
  spawnVfx(kind: VfxKind, x: number, y: number, z: number, opts?: VfxOpts): void;
  /** Buffer a VFX at terrain height under (x,z) — deterministic test entry. */
  spawnVfxOnGround(kind: VfxKind, x: number, z: number, opts?: VfxOpts): void;
  /** Buffer a straight beam of fading motes between two world points (nexus bolt). */
  spawnBeam(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: [number, number, number]): void;
  /** Count of live VFX particle entities (verify: returns to ~0 after effects). */
  active(): number;
}

export class VfxSystem implements VfxHandle {
  readonly name = 'VfxSystem';
  private _world!: World;
  private readonly _deps: VfxDeps;
  private readonly _queue: SpawnReq[] = [];
  private readonly _rng = makeRng(0x5eed11);
  /** Cached shared UNLIT-ish material per packed color (NO per-particle alloc). */
  private readonly _matCache = new Map<number, Handle<'MaterialAsset', 'shared'>>();
  /** Live count, maintained on spawn/despawn (cheap probe). */
  private _liveCount = 0;

  constructor(deps: VfxDeps) { this._deps = deps; }

  install(world: World): VfxHandle {
    this._world = world;
    world.addSystem({
      name: this.name,
      queries: [{ with: [Entity, Transform, Vfx] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;

        // (1) flush buffered spawns FIRST, before iterating the Vfx query — this
        // is the only place spawning is safe (event handlers buffer mid-frame).
        if (this._queue.length > 0) {
          const reqs = this._queue.splice(0, this._queue.length);
          for (const r of reqs) this._materialize(r);
        }

        if (dt <= 0) return;

        // (2) advance every live particle; collect the expired (no despawn mid-iter).
        const batches = qr[0] as unknown as Batch[];
        const expired: EntityHandle[] = [];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            if (this._tick(b, i, dt)) expired.push(b.Entity.self[i] as EntityHandle);
          }
        }

        // (3) despawn expired particles AFTER the loop.
        for (const e of expired) {
          if (world.get(e, Transform).ok) { world.despawn(e); this._liveCount--; }
        }
      },
    });

    // Auto-wire the EventBus combat/ability events -> core VFX (M11 ch1 req 2).
    this._wireEvents();
    return this;
  }

  // ── public API ───────────────────────────────────────────────────────────

  spawnVfx(kind: VfxKind, x: number, y: number, z: number, opts: VfxOpts = {}): void {
    this._queue.push({ kind, x, y, z, opts });
  }

  spawnVfxOnGround(kind: VfxKind, x: number, z: number, opts: VfxOpts = {}): void {
    const y = this._deps.heightAt(x, z) + 0.3;
    this._queue.push({ kind, x, y, z, opts });
  }

  active(): number { return this._liveCount; }

  // ── per-particle tick ──────────────────────────────────────────────────────

  /** @returns true = this particle expired (despawn). */
  private _tick(b: Batch, i: number, dt: number): boolean {
    const V = b.Vfx;
    const age = (V.age[i] as number) + dt;
    V.age[i] = age;
    const life = V.lifetime[i] as number;
    if (age >= life) return true;

    const t = life > 0 ? age / life : 1;

    // integrate velocity (+ gravity, + drag)
    let vx = V.velX[i] as number;
    let vy = V.velY[i] as number;
    let vz = V.velZ[i] as number;
    vy -= (V.gravity[i] as number) * dt;
    const drag = V.drag[i] as number;
    if (drag !== 1) {
      const k = Math.pow(drag, dt);
      vx *= k; vy *= k; vz *= k;
    }
    V.velX[i] = vx; V.velY[i] = vy; V.velZ[i] = vz;

    b.Transform.pos[i * 3] = (b.Transform.pos[i * 3] as number) + vx * dt;
    b.Transform.pos[i * 3 + 1] = (b.Transform.pos[i * 3 + 1] as number) + vy * dt;
    b.Transform.pos[i * 3 + 2] = (b.Transform.pos[i * 3 + 2] as number) + vz * dt;

    // fade-by-shrink: lerp uniform scale start->end (replaces source opacity fade)
    const s = (V.startScale[i] as number) + ((V.endScale[i] as number) - (V.startScale[i] as number)) * t;
    b.Transform.scale[i * 3] = s; b.Transform.scale[i * 3 + 1] = s; b.Transform.scale[i * 3 + 2] = s;

    // optional tumble spin about a fixed axis
    const spinRate = V.spinRate[i] as number;
    if (spinRate !== 0) {
      const ang = (V.spinAngle[i] as number) + spinRate * dt;
      V.spinAngle[i] = ang;
      const ax = V.axisX[i] as number, ay = V.axisY[i] as number, az = V.axisZ[i] as number;
      const half = ang * 0.5;
      const sn = Math.sin(half);
      b.Transform.quat[i * 4] = ax * sn;
      b.Transform.quat[i * 4 + 1] = ay * sn;
      b.Transform.quat[i * 4 + 2] = az * sn;
      b.Transform.quat[i * 4 + 3] = Math.cos(half);
    }
    return false;
  }

  // ── spawn (materialize a buffered request into transient entities) ──────────

  private _materialize(r: SpawnReq): void {
    const specs = this._buildSpecs(r);
    for (const sp of specs) this._spawnParticle(r.x, r.y, r.z, sp);
  }

  private _spawnParticle(ox: number, oy: number, oz: number, sp: ParticleSpec): void {
    const world = this._world;
    const mesh = this._meshFor(sp.shape);
    const mat = this._material(sp.color);
    const res = world.spawn(
      {
        component: Transform,
        data: {
          pos: [ox + sp.pos[0], oy + sp.pos[1], oz + sp.pos[2]],
          scale: [sp.startScale, sp.startScale, sp.startScale],
        },
      },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [mat] } },
      {
        component: Vfx,
        data: {
          age: 0, lifetime: sp.lifetime,
          velX: sp.vel[0], velY: sp.vel[1], velZ: sp.vel[2],
          gravity: sp.gravity, drag: sp.drag,
          startScale: sp.startScale, endScale: sp.endScale,
          spinRate: sp.spinRate,
          axisX: sp.axis[0], axisY: sp.axis[1], axisZ: sp.axis[2], spinAngle: 0,
        },
      },
    );
    if (res.ok) this._liveCount++;
  }

  private _meshFor(shape: PartShape): Handle<'MeshAsset', 'shared'> {
    const p = this._deps.prims;
    return shape === 'box' ? p.box : shape === 'sphere' ? p.sphere : shape === 'cone' ? p.cone : p.cylinder;
  }

  /**
   * Shared material per color (cached). UNLIT-ish: roughness 1 / metallic 0 so
   * glows read bright + flat without bloom accumulation (memory note: additive +
   * bloom -> white drift). The `tint` closure mints a child of the PBR base; for
   * a true unlit look the bright base colors carry the glow.
   */
  private _material(color: [number, number, number]): Handle<'MaterialAsset', 'shared'> {
    const packed =
      ((Math.round(color[0] * 255) & 0xff) << 16) |
      ((Math.round(color[1] * 255) & 0xff) << 8) |
      (Math.round(color[2] * 255) & 0xff);
    const cached = this._matCache.get(packed);
    if (cached) return cached;
    const m = this._deps.tint(color, { metallic: 0, roughness: 1 });
    this._matCache.set(packed, m);
    return m;
  }

  // ── effect builders (one per CORE kind) ─────────────────────────────────────

  private _buildSpecs(r: SpawnReq): ParticleSpec[] {
    switch (r.kind) {
      case 'impact': return this._impact(r.opts);
      case 'explosion': return this._explosion(r.opts);
      case 'muzzle': return this._muzzle(r.opts);
      case 'spark': return this._bits(r.opts, r.opts.color ?? COLOR_SPARK, 'box', 5, 0.09, 6, 5);
      case 'blood': return this._bits(r.opts, r.opts.color ?? COLOR_BLOOD, 'sphere', 5, 0.11, 9, 0);
      case 'shield_hit': return this._shieldHit(r.opts);
      case 'cast_flash': return this._castFlash(r.opts);
      case 'death_debris': return this._deathDebris(r.opts);
      case 'slash': return this._slash(r.opts);
      case 'flame': return this._flame(r.opts);
      case 'slime': return this._slime(r.opts);
      case 'shockwave': return this._shockwave(r.opts);
      case 'trail': return this._trail(r.opts);
      case 'emp': return this._emp(r.opts);
      case 'blink_out': return this._blink(r.opts, false);
      case 'blink_in': return this._blink(r.opts, true);
      case 'shield_burst': return this._radialBurst(r.opts, [0.27, 0.67, 1], [0.67, 0.8, 1], 16);
      case 'energy_flash': return this._radialBurst(r.opts, [1, 0.67, 0], [1, 0.93, 0.4], 12);
      case 'buff_burst': return this._buffBurst(r.opts);
      case 'buff_mote': return this._buffMote(r.opts);
      default: return [];
    }
  }

  /** Random unit direction (deterministic). */
  private _rng3(): [number, number, number] {
    const a = this._rng() * Math.PI * 2;
    const c = this._rng() * 2 - 1;
    const s = Math.sqrt(Math.max(0, 1 - c * c));
    return [Math.cos(a) * s, c, Math.sin(a) * s];
  }

  /**
   * impact — source `spawnImpactFlash` default sphere flash (IMPACT_FLASH_TIME=0.2)
   * + a few outward spark bits. Quick, small, bright.
   */
  private _impact(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? COLOR_IMPACT;
    const size = opts.size ?? 1;
    const out: ParticleSpec[] = [];
    // central flash (sphere: grows briefly then collapses)
    out.push({
      shape: 'sphere', color, pos: [0, 0, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: 0.5 * size, endScale: 0.05, lifetime: 0.2,
      spinRate: 0, axis: [0, 1, 0],
    });
    // outward spark bits
    const n = 4;
    for (let i = 0; i < n; i++) {
      const [dx, dy, dz] = this._rng3();
      const sp = 2.5 + this._rng() * 2;
      out.push({
        shape: 'box', color, pos: [0, 0, 0],
        vel: [dx * sp, Math.abs(dy) * sp * 0.6 + 1, dz * sp],
        gravity: 9, drag: 0.9, startScale: 0.12 * size, endScale: 0.01,
        lifetime: 0.3 + this._rng() * 0.15, spinRate: 12, axis: this._rng3(),
      });
    }
    return out;
  }

  /**
   * explosion — source `DestructionDebris._spawnExplosion` (50-particle GPU burst,
   * vy gravity, bright-yellow->dark-red, EXPLOSION_LIFETIME=1.2) + the flash sphere.
   * Condensed to <=12 transient entities: 1 fireball + ~10 outward fire bits.
   */
  private _explosion(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? COLOR_EXPLOSION;
    const size = opts.size ?? 1;
    const out: ParticleSpec[] = [];
    // expanding fireball (grows then collapses — the source flash sphere)
    out.push({
      shape: 'sphere', color: [1, 0.7, 0.25], pos: [0, 0.2 * size, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: 0.4 * size, endScale: 1.6 * size, lifetime: 0.35,
      spinRate: 0, axis: [0, 1, 0],
    });
    // outward fire bits (source: speed 2-6, upSpeed 1.5-4.5, vy -= 6*dt)
    const n = 10;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this._rng() * 0.5;
      const speed = (2 + this._rng() * 4) * 0.6;
      const up = 1.5 + this._rng() * 3;
      out.push({
        shape: 'box', color, pos: [0, 0.1 * size, 0],
        vel: [Math.cos(ang) * speed * size, up, Math.sin(ang) * speed * size],
        gravity: 6, drag: 1, startScale: 0.25 * size, endScale: 0.02,
        lifetime: 0.7 + this._rng() * 0.5, spinRate: 8, axis: this._rng3(),
      });
    }
    return out;
  }

  /**
   * muzzle — a brief cone flash at the attacker pointing toward the target, plus a
   * tiny spark. The source wove muzzle flashes into the per-weapon trail/bespoke
   * layer; this is the generic core flash (the per-weapon variants are chunk 2).
   */
  private _muzzle(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? COLOR_MUZZLE;
    const size = opts.size ?? 1;
    // a cone points +Y by default; orient it along the firing direction by giving
    // it a forward velocity (the brief flash also drifts toward the target).
    const dx = opts.dirX ?? 0, dz = opts.dirZ ?? 1;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len, fz = dz / len;
    return [
      {
        shape: 'cone', color, pos: [fx * 0.3 * size, 0, fz * 0.3 * size],
        vel: [fx * 3 * size, 0, fz * 3 * size],
        gravity: 0, drag: 0.6, startScale: 0.45 * size, endScale: 0.05, lifetime: 0.12,
        spinRate: 0, axis: [0, 1, 0],
      },
      {
        shape: 'sphere', color, pos: [fx * 0.3 * size, 0, fz * 0.3 * size], vel: [0, 0, 0],
        gravity: 0, drag: 1, startScale: 0.3 * size, endScale: 0.02, lifetime: 0.1,
        spinRate: 0, axis: [0, 1, 0],
      },
    ];
  }

  /**
   * spark / blood — a few flying bits, biased along the damage direction if given
   * (source impact-flash spark + slime-splatter spray). `shape` picks the bit look
   * (box=metal spark, sphere=organic gob); `grav` differs (sparks light, blood heavy).
   */
  private _bits(
    opts: VfxOpts, color: [number, number, number], shape: PartShape,
    count: number, scale: number, grav: number, _spin: number,
  ): ParticleSpec[] {
    const size = opts.size ?? 1;
    const dx = opts.dirX ?? 0, dz = opts.dirZ ?? 0;
    const len = Math.hypot(dx, dz);
    const out: ParticleSpec[] = [];
    for (let i = 0; i < count; i++) {
      let [vx, vy, vz] = this._rng3();
      // bias along the damage direction (the bits spray away from the attacker)
      if (len > 0.01) { vx += (dx / len) * 1.2; vz += (dz / len) * 1.2; }
      const sp = 2 + this._rng() * 2.5;
      out.push({
        shape, color, pos: [0, 0.2, 0],
        vel: [vx * sp, Math.abs(vy) * sp * 0.7 + 1.5, vz * sp],
        gravity: grav, drag: 0.95, startScale: scale * size, endScale: 0.01,
        lifetime: 0.4 + this._rng() * 0.3, spinRate: _spin, axis: this._rng3(),
      });
    }
    return out;
  }

  /**
   * shield_hit — a quick expanding ring (energy-shield deflection). The source used
   * an additive ring sprite; we expand a flat thin cylinder (disc) outward then
   * collapse. Blue energy tone.
   */
  private _shieldHit(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? COLOR_SHIELD;
    const size = opts.size ?? 1;
    return [
      // the ring: flat disc grows wide then shrinks (read as a ripple)
      {
        shape: 'cylinder', color, pos: [0, 0.1, 0], vel: [0, 0, 0],
        gravity: 0, drag: 1, startScale: 0.3 * size, endScale: 1.8 * size, lifetime: 0.3,
        spinRate: 0, axis: [0, 1, 0],
      },
      // a faint inner flash sphere
      {
        shape: 'sphere', color, pos: [0, 0.3, 0], vel: [0, 0, 0],
        gravity: 0, drag: 1, startScale: 0.5 * size, endScale: 0.05, lifetime: 0.2,
        spinRate: 0, axis: [0, 1, 0],
      },
    ];
  }

  /**
   * cast_flash — ability cast glow at the caster: a rising glow sphere + a few
   * rising motes (the generic cast visual; per-ability bespoke = chunk 2).
   */
  private _castFlash(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? COLOR_CAST;
    const size = opts.size ?? 1;
    const out: ParticleSpec[] = [];
    out.push({
      shape: 'sphere', color, pos: [0, 0.6 * size, 0], vel: [0, 1.2, 0],
      gravity: 0, drag: 1, startScale: 0.2 * size, endScale: 1.0 * size, lifetime: 0.5,
      spinRate: 0, axis: [0, 1, 0],
    });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rad = 0.5 * size;
      out.push({
        shape: 'box', color, pos: [Math.cos(ang) * rad, 0.1, Math.sin(ang) * rad],
        vel: [Math.cos(ang) * 0.5, 1.5 + this._rng(), Math.sin(ang) * 0.5],
        gravity: -1, drag: 1, startScale: 0.12 * size, endScale: 0.01, lifetime: 0.6,
        spinRate: 6, axis: this._rng3(),
      });
    }
    return out;
  }

  /**
   * death_debris — port of `DestructionDebris.spawnDebris`: 4-8 box chunks (random
   * size, scatter, tumble) + a charred ground disc + a flash sphere + an explosion
   * burst. The source kept debris 15s with a long fade; we keep it short-lived
   * (transient, no leak) — chunks tumble outward + settle (gravity) then shrink away.
   */
  private _deathDebris(opts: VfxOpts): ParticleSpec[] {
    const playerColor = opts.color ?? [0.4, 0.4, 0.4];
    const modelSize = opts.size ?? 1;
    const half = modelSize / 2;
    const out: ParticleSpec[] = [];

    // 4-8 box chunks (dark or dimmed player color), tumbling outward
    const numPieces = 4 + Math.floor(this._rng() * 5);
    for (let i = 0; i < Math.min(numPieces, 8); i++) {
      const dark = this._rng() > 0.5;
      const color: [number, number, number] = dark
        ? [0.2, 0.2, 0.2]
        : [playerColor[0] * 0.4, playerColor[1] * 0.4, playerColor[2] * 0.4];
      const w = 0.2 + this._rng() * half * 0.4;
      const [dx, , dz] = this._rng3();
      const sp = 1.5 + this._rng() * 2;
      out.push({
        shape: 'box', color,
        pos: [(this._rng() - 0.5) * half, half * 0.4 + this._rng() * 0.2, (this._rng() - 0.5) * half],
        vel: [dx * sp, 2 + this._rng() * 2, dz * sp],
        gravity: 9, drag: 1, startScale: Math.max(0.12, w), endScale: 0.04,
        lifetime: 1.0 + this._rng() * 0.6, spinRate: 5 + this._rng() * 6, axis: this._rng3(),
      });
    }
    // charred ground disc (flat, fades)
    out.push({
      shape: 'cylinder', color: [0.08, 0.08, 0.08], pos: [0, 0.05, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: half * 1.4, endScale: half * 0.6, lifetime: 1.4,
      spinRate: 0, axis: [0, 1, 0],
    });
    // flash sphere (source spawnDebris flash: 0xffaa33, scale up + fade)
    out.push({
      shape: 'sphere', color: [1.0, 0.66, 0.2], pos: [0, half * 0.5, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: half * 0.8, endScale: half * 1.8, lifetime: 0.3,
      spinRate: 0, axis: [0, 1, 0],
    });
    // a few dust motes rising (source explosion dust)
    for (let i = 0; i < 3; i++) {
      const [dx, , dz] = this._rng3();
      out.push({
        shape: 'sphere', color: COLOR_DUST, pos: [0, 0.3, 0],
        vel: [dx * 1.2, 1.5 + this._rng(), dz * 1.2],
        gravity: -0.5, drag: 0.9, startScale: 0.3 * modelSize, endScale: 0.05,
        lifetime: 0.9 + this._rng() * 0.4, spinRate: 0, axis: [0, 1, 0],
      });
    }
    return out;
  }

  // ── bespoke per-weapon builders (M11 ch2, source CombatVFX) ─────────────────

  /**
   * slash — melee arc (source `_spawnMeleeSlash`): N elongated "claw/blade"
   * marks fanned across the target (zergling = 3 vertical claws, zealot = 2
   * crossed psi blades), oriented across the attacker→target axis, quick fade +
   * a small central spark. The source drew Sprites/BufferGeometry; here each
   * mark is a thin long box that sweeps outward then shrinks — same read.
   */
  private _slash(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? [1, 1, 1];
    const size = opts.size ?? 0.3;
    const count = Math.max(1, opts.count ?? 3);
    // perpendicular to the incoming attack dir (marks lie ACROSS the target)
    const dx = opts.dirX ?? 0, dz = opts.dirZ ?? 1;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len, pz = dx / len; // perpendicular unit
    const out: ParticleSpec[] = [];
    const slashLen = 0.8 + size;
    for (let s = 0; s < count; s++) {
      const off = (s - (count - 1) / 2) * 0.18;
      // a long thin box scaled along Y (startScale drives uniform scale, so we
      // approximate the elongated mark with a fast-expanding then-collapsing bit
      // biased along the perpendicular sweep).
      out.push({
        shape: 'box', color,
        pos: [px * off, 0.45 + off * 0.15, pz * off],
        vel: [px * 1.2, 0.3, pz * 1.2],
        gravity: 0, drag: 0.7, startScale: slashLen * 0.4, endScale: 0.02,
        lifetime: 0.22, spinRate: 0, axis: [0, 1, 0],
      });
    }
    // central spark (source: impactSize*0.5 flash)
    out.push({
      shape: 'sphere', color, pos: [0, 0.45, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: size * 0.5, endScale: 0.02, lifetime: 0.2,
      spinRate: 0, axis: [0, 1, 0],
    });
    return out;
  }

  /**
   * flame — flamethrower stream burst (source `updateFlameStreams` /
   * `_spawnFlameParticle`): a cone of layered flame particles thrown from the
   * attacker toward the target — a bright white core + orange mid + dark-red
   * outer, spreading within the splash cone. The source spawned continuously per
   * frame; the event-driven port emits one dense burst per attack (same look).
   */
  private _flame(opts: VfxOpts): ParticleSpec[] {
    const core: [number, number, number] = [1, 1, 1];
    const mid = opts.color ?? [1, 0.6, 0.15];
    const outer = opts.color2 ?? [1, 0.2, 0];
    const dx = opts.dirX ?? 0, dz = opts.dirZ ?? 1;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len, fz = dz / len;
    const halfCone = (40 * Math.PI) / 360; // source default splashAngle 40°
    const reach = opts.size ?? 2.5;
    const out: ParticleSpec[] = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const layer = i % 3; // 0=core,1=mid,2=outer
      const color = layer === 0 ? core : layer === 1 ? mid : outer;
      const jit = (this._rng() - 0.5) * 2 * halfCone;
      const ang = Math.atan2(fx, fz) + jit;
      const dirX = Math.sin(ang), dirZ = Math.cos(ang);
      const speed = (reach / 0.5) * (0.6 + this._rng() * 0.5);
      const startScale = layer === 0 ? 0.28 : layer === 1 ? 0.36 : 0.5;
      out.push({
        shape: 'sphere', color,
        pos: [dirX * 0.2, 0.35 + (this._rng() - 0.5) * 0.15, dirZ * 0.2],
        vel: [dirX * speed, 0.4 + this._rng() * 0.4, dirZ * speed],
        gravity: -1.2, drag: 0.85, startScale, endScale: 0.02,
        lifetime: 0.35 + this._rng() * 0.2, spinRate: 0, axis: [0, 1, 0],
      });
    }
    return out;
  }

  /**
   * slime — acid/slime splatter hit (source `_spawnSlimeSplatter`): a gob burst
   * of organic drops that arc out and fall, in the weapon's acid color +
   * secondary gradient. Replaces the spherical flash for slime weapons.
   */
  private _slime(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? [0.4, 0.8, 0.2];
    const color2 = opts.color2 ?? [0.13, 0.67, 0.2];
    const size = opts.size ?? 0.45;
    const out: ParticleSpec[] = [];
    // central splat sphere
    out.push({
      shape: 'sphere', color, pos: [0, 0.3, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: size, endScale: 0.05, lifetime: 0.25,
      spinRate: 0, axis: [0, 1, 0],
    });
    // arcing drops (alternate the two gradient tones)
    const n = 7;
    for (let i = 0; i < n; i++) {
      const [dx, dy, dz] = this._rng3();
      const sp = 2 + this._rng() * 2;
      out.push({
        shape: 'sphere', color: i % 2 === 0 ? color : color2, pos: [0, 0.3, 0],
        vel: [dx * sp, Math.abs(dy) * sp * 0.7 + 1.5, dz * sp],
        gravity: 11, drag: 0.96, startScale: 0.12 * (size / 0.45), endScale: 0.02,
        lifetime: 0.5 + this._rng() * 0.3, spinRate: 0, axis: [0, 1, 0],
      });
    }
    return out;
  }

  /**
   * shockwave — ground stomp (source `spawnStompEffect`): a flat expanding ring
   * + scattered rock chunks + a rising dust ring, sized to the splash radius.
   * Fired for heavy/large-splash impacts (ultralisk stomp, thor, arclite).
   */
  private _shockwave(opts: VfxOpts): ParticleSpec[] {
    const R = Math.max(1.5, opts.count ?? 2.5);
    const rock: [number, number, number] = [0.4, 0.33, 0.25];
    const dust: [number, number, number] = [0.8, 0.73, 0.53];
    const ring = opts.color ?? [0.67, 0.53, 0.27];
    const out: ParticleSpec[] = [];
    // expanding flat ground ring (thin disc grows outward then fades)
    out.push({
      shape: 'cylinder', color: ring, pos: [0, 0.05, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: 0.3, endScale: R * 1.3, lifetime: 0.45,
      spinRate: 0, axis: [0, 1, 0],
    });
    // dark impact disc (charred ground mark)
    out.push({
      shape: 'cylinder', color: [0.12, 0.08, 0.04], pos: [0, 0.03, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: R * 0.9, endScale: R * 0.5, lifetime: 1.0,
      spinRate: 0, axis: [0, 1, 0],
    });
    // rock chunks flung outward
    const rocks = 10;
    for (let i = 0; i < rocks; i++) {
      const ang = (i / rocks) * Math.PI * 2 + this._rng() * 0.4;
      const sp = 3 + this._rng() * 4;
      out.push({
        shape: 'box', color: rock,
        pos: [Math.cos(ang) * R * 0.3, 0.2, Math.sin(ang) * R * 0.3],
        vel: [Math.cos(ang) * sp, 3 + this._rng() * 4, Math.sin(ang) * sp],
        gravity: 11, drag: 1, startScale: 0.15 + this._rng() * 0.2, endScale: 0.04,
        lifetime: 0.7 + this._rng() * 0.4, spinRate: 6 + this._rng() * 6, axis: this._rng3(),
      });
    }
    // rising dust motes around the rim
    const motes = 6;
    for (let i = 0; i < motes; i++) {
      const ang = (i / motes) * Math.PI * 2;
      out.push({
        shape: 'sphere', color: dust,
        pos: [Math.cos(ang) * R * 0.5, 0.15, Math.sin(ang) * R * 0.5],
        vel: [Math.cos(ang) * 0.6, 1.2 + this._rng(), Math.sin(ang) * 0.6],
        gravity: -0.5, drag: 0.9, startScale: 0.4, endScale: 0.05,
        lifetime: 0.8 + this._rng() * 0.3, spinRate: 0, axis: [0, 1, 0],
      });
    }
    return out;
  }

  /**
   * trail — one small fading mote left behind a projectile in flight (source
   * CombatVFX ribbon trail). The projectile-system emits one per frame at the
   * projectile's position; a short lifetime keeps ~`trailLength` motes alive at
   * once, reading as a colored streak in the weapon's trailColor. No velocity —
   * the mote stays put and shrinks (fade-by-shrink) so the streak marks the path.
   */
  private _trail(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? [1, 1, 0.4];
    const size = opts.size ?? 0.12;
    const life = opts.count ?? 0.18; // reuse `count` as lifetime (frames→seconds)
    return [{
      shape: 'sphere', color, pos: [0, 0, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: size, endScale: 0.01, lifetime: life,
      spinRate: 0, axis: [0, 1, 0],
    }];
  }

  /**
   * emp — EMP burst (source AbilityVFX `_createEMPExplosion`): 3 staggered
   * expanding pulse rings (white-blue → blue) + a bright central flash + a fan of
   * jagged electric arc-bits radiating to the blast radius. The source drew ring
   * meshes + BufferGeometry lightning; the particle port uses flat expanding
   * discs + outward electric spark bits in the same white/cyan palette. `size` =
   * blast radius (world units).
   */
  private _emp(opts: VfxOpts): ParticleSpec[] {
    const R = Math.max(1.5, opts.size ?? 4.6);
    const ringColors: [number, number, number][] = [[0.93, 1, 1], [0.4, 0.8, 1], [0.2, 0.53, 0.87]];
    const out: ParticleSpec[] = [];
    // 3 expanding flat rings (staggered lifetimes → sequential pulse look)
    for (let r = 0; r < 3; r++) {
      out.push({
        shape: 'cylinder', color: ringColors[r], pos: [0, 0.12 + r * 0.04, 0], vel: [0, 0, 0],
        gravity: 0, drag: 1, startScale: 0.3, endScale: R * 2 * (1 - r * 0.12),
        lifetime: 0.35 + r * 0.12, spinRate: 0, axis: [0, 1, 0],
      });
    }
    // bright central flash
    out.push({
      shape: 'sphere', color: [0.93, 1, 1], pos: [0, 0.25, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: R * 0.4, endScale: 0.05, lifetime: 0.25,
      spinRate: 0, axis: [0, 1, 0],
    });
    // radiating electric arc-bits (jagged spark shards flying to the rim)
    const arcs = 10;
    for (let a = 0; a < arcs; a++) {
      const ang = (a / arcs) * Math.PI * 2 + (this._rng() - 0.5) * 0.4;
      const sp = R * (1.3 + this._rng() * 0.7);
      const white = this._rng() > 0.3;
      out.push({
        shape: 'box', color: white ? [1, 1, 1] : [0.67, 0.87, 1],
        pos: [0, 0.2, 0],
        vel: [Math.cos(ang) * sp, 0.3 + this._rng() * 0.4, Math.sin(ang) * sp],
        gravity: 0, drag: 0.75, startScale: 0.14, endScale: 0.01,
        lifetime: 0.25 + this._rng() * 0.15, spinRate: 10, axis: this._rng3(),
      });
    }
    return out;
  }

  /**
   * blink — teleport departure/arrival (source AbilityVFX `_createBlinkVFX`).
   * `arrival=false` (blink_out): an imploding ring + a brief afterimage column +
   * motes CONVERGING inward (spawned on a ring, velocity toward center). `arrival=
   * true` (blink_in): an expanding ring + motes BURSTING outward. Both in the
   * protoss warp-blue palette.
   */
  private _blink(opts: VfxOpts, arrival: boolean): ParticleSpec[] {
    const color = opts.color ?? (arrival ? [0.53, 0.8, 1] : [0.27, 0.53, 1]);
    const out: ParticleSpec[] = [];
    // the ring: arrival expands outward, departure implodes inward.
    out.push({
      shape: 'cylinder', color, pos: [0, 0.06, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1,
      startScale: arrival ? 0.2 : 2.4, endScale: arrival ? 2.6 : 0.1,
      lifetime: arrival ? 0.35 : 0.3, spinRate: 0, axis: [0, 1, 0],
    });
    if (!arrival) {
      // departure afterimage column (thin tall cylinder that fades in place)
      out.push({
        shape: 'cylinder', color: [0.2, 0.4, 0.8], pos: [0, 0.6, 0], vel: [0, 0, 0],
        gravity: 0, drag: 1, startScale: 0.5, endScale: 0.05, lifetime: 0.3,
        spinRate: 0, axis: [0, 1, 0],
      });
    }
    // motes: converge (departure) or burst (arrival)
    const n = arrival ? 14 : 12;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this._rng() * 0.4;
      const rad = 0.8 + this._rng() * 0.5;
      const sp = 1.5 + this._rng();
      if (arrival) {
        out.push({
          shape: 'sphere', color: [0.53, 0.8, 1], pos: [0, 0.3 + this._rng() * 0.5, 0],
          vel: [Math.cos(ang) * sp * 1.5, 0.4 + this._rng() * 0.6, Math.sin(ang) * sp * 1.5],
          gravity: 0, drag: 0.85, startScale: 0.1, endScale: 0.01, lifetime: 0.4,
          spinRate: 0, axis: [0, 1, 0],
        });
      } else {
        // spawn on the rim, velocity pointing inward (toward the center)
        out.push({
          shape: 'sphere', color: [0.4, 0.67, 1],
          pos: [Math.cos(ang) * rad, 0.2 + this._rng() * 0.6, Math.sin(ang) * rad],
          vel: [-Math.cos(ang) * sp, 0.3, -Math.sin(ang) * sp],
          gravity: 0, drag: 0.9, startScale: 0.1, endScale: 0.01, lifetime: 0.4,
          spinRate: 0, axis: [0, 1, 0],
        });
      }
    }
    return out;
  }

  /**
   * radialBurst — shared shape for the shield-restore + energy-gain one-shots
   * (source `_createShieldBurstVFX` / `_createEnergyFlashVFX`): an expanding flat
   * ring + a bright central flash + `n` motes spraying outward+up. `ringColor` is
   * the disc/flash tone, `moteColor` the particles.
   */
  private _radialBurst(
    opts: VfxOpts, ringColor: [number, number, number], moteColor: [number, number, number], n: number,
  ): ParticleSpec[] {
    const size = opts.size ?? 1;
    const out: ParticleSpec[] = [];
    // expanding ring
    out.push({
      shape: 'cylinder', color: ringColor, pos: [0, 0.06, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: 0.2 * size, endScale: 1.6 * size, lifetime: 0.4,
      spinRate: 0, axis: [0, 1, 0],
    });
    // central flash
    out.push({
      shape: 'sphere', color: [Math.min(1, ringColor[0] + 0.3), Math.min(1, ringColor[1] + 0.2), 1],
      pos: [0, 0.3, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: 0.4 * size, endScale: 0.03, lifetime: 0.22,
      spinRate: 0, axis: [0, 1, 0],
    });
    // outward-spraying motes
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this._rng() * 0.4;
      const elev = (this._rng() - 0.3) * Math.PI * 0.5;
      const sp = (2 + this._rng() * 2) * size;
      out.push({
        shape: 'sphere', color: moteColor, pos: [0, 0.3, 0],
        vel: [Math.cos(ang) * Math.cos(elev) * sp, Math.sin(elev) * sp + 0.5, Math.sin(ang) * Math.cos(elev) * sp],
        gravity: 0, drag: 0.9, startScale: 0.09, endScale: 0.01, lifetime: 0.45,
        spinRate: 0, axis: [0, 1, 0],
      });
    }
    return out;
  }

  /**
   * buff_burst — a buff/debuff activation flash (source `_createBuffVFX` config.burst):
   * a bright central pop + `count` motes spraying outward-and-up at `speed`. Color +
   * count + size + speed all come from the buff's declarative `BuffBurstVFX`.
   */
  private _buffBurst(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? [1, 1, 1];
    const size = opts.size ?? 0.08;
    const speed = opts.speed ?? 2;
    const n = Math.max(1, Math.round(opts.count ?? 6));
    const out: ParticleSpec[] = [];
    // central flash
    out.push({
      shape: 'sphere', color: [Math.min(1, color[0] + 0.3), Math.min(1, color[1] + 0.3), Math.min(1, color[2] + 0.3)],
      pos: [0, 0.3, 0], vel: [0, 0, 0],
      gravity: 0, drag: 1, startScale: size * 3, endScale: 0.02, lifetime: 0.22,
      spinRate: 0, axis: [0, 1, 0],
    });
    // outward motes (source: cos/sin around, vy 0.5..1.0)
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this._rng() * 0.5;
      out.push({
        shape: 'sphere', color, pos: [0, 0.3, 0],
        vel: [Math.cos(ang) * speed, 0.5 + this._rng() * 0.5, Math.sin(ang) * speed],
        gravity: 0, drag: 0.9, startScale: size, endScale: 0.01, lifetime: 0.3,
        spinRate: 0, axis: [0, 1, 0],
      });
    }
    return out;
  }

  /**
   * buff_mote — ONE continuous aura particle (source `_createBuffVFX` config.particles,
   * emitted at `interval` by BuffAuraSystem). The caller supplies the spawn offset (in
   * x/y/z) + an explicit `vel`, `color`, `size`, `lifetime`; drift + fade are the
   * standard particle tick. A tiny XZ jitter is folded into the spawn point by the
   * aura system, so here pos is just the origin.
   */
  private _buffMote(opts: VfxOpts): ParticleSpec[] {
    const color = opts.color ?? [1, 1, 1];
    const size = opts.size ?? 0.08;
    const vel = opts.vel ?? [0, 0.5, 0];
    const lifetime = opts.lifetime ?? 0.5;
    // gravity>0 + box shape lets one generic mote double as rock/dirt/chitin debris
    // (earth_shatter / spine_rush / lurker_burrow), not just a floating aura mote.
    return [{
      shape: opts.shape ?? 'sphere', color, pos: [0, 0, 0], vel,
      gravity: opts.gravity ?? 0, drag: 0.94, startScale: size, endScale: 0.01, lifetime,
      spinRate: opts.gravity ? 4 : 0, axis: [0.3, 1, 0.5],
    }];
  }

  /**
   * spawnBeam — a straight beam of fading motes from (x1,y1,z1) to (x2,y2,z2)
   * (source `_createNexusBoltVFX` — a caster→target energy bolt). Buffered like
   * every other spawn (safe mid-frame). Not a VfxKind because it needs two
   * endpoints; the ability handler calls it for stellar_insight / energy_overcharge.
   */
  spawnBeam(
    x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
    color: [number, number, number],
  ): void {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const dist = Math.hypot(dx, dy, dz);
    const segs = Math.max(3, Math.min(24, Math.round(dist * 2)));
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      this._queue.push({
        kind: 'trail',
        x: x1 + dx * t, y: y1 + dy * t, z: z1 + dz * t,
        opts: { color, size: 0.16, count: 0.28 }, // count = lifetime (s)
      });
    }
  }

  // ── event wiring (M11 ch1 req 2): combat/ability events -> core VFX ──────────

  /**
   * Subscribe to the M9 EventBus and translate combat/ability events into core
   * VFX. The events fire MID-FRAME (inside other systems' query loops), so every
   * handler only BUFFERS via `spawnVfx` — the buffer is flushed safely at the top
   * of this system's tick. Positions are resolved from the involved entities'
   * Transforms (the bus carries entity ids only).
   */
  private _wireEvents(): void {
    const world = this._world;
    const posOf = (id: number): { x: number; y: number; z: number } | null => {
      const eh = id as unknown as EntityHandle;
      const t = world.get(eh, Transform);
      return t.ok ? { x: t.value.pos[0], y: t.value.pos[1], z: t.value.pos[2] } : null;
    };

    // attack_hit (attacker view): the per-weapon bespoke hit (M11 ch2). Resolve
    // the attacker's weaponId → getWeaponVFX and branch the hit visual by the
    // weapon's flavor (melee slash / slime splatter / flame stream / heavy-splash
    // ground shockwave), else the generic muzzle + colored impact flash. Colors,
    // slash counts, flame + splash flags all come from the ported WEAPON_VFX table
    // so weapon identity reads on screen (green claws, blue psi X, orange flame…).
    eventBus.on('combat:attack_hit', (d) => {
      const ap = posOf(d.attacker);
      const tp = posOf(d.target);
      const wid = attackWeaponId.get(d.attacker as unknown as EntityHandle);
      const cfg = getWeaponVFX(wid);
      const dirX = ap && tp ? tp.x - ap.x : 0;
      const dirZ = ap && tp ? tp.z - ap.z : 0;

      // muzzle at the attacker (trail color = the weapon's projectile color)
      if (ap && tp && !cfg.meleeSlash) {
        this.spawnVfx('muzzle', ap.x, ap.y + 0.6, ap.z, { dirX, dirZ, color: hexRgb(cfg.trailColor) });
      }
      // flamethrower: throw a flame cone from the attacker toward the target
      if (ap && tp && cfg.flameStream) {
        this.spawnVfx('flame', ap.x, ap.y + 0.4, ap.z, {
          dirX, dirZ, color: hexRgb(cfg.splashColor), color2: hexRgb(cfg.flameStreamColor2),
          size: Math.hypot(dirX, dirZ),
        });
      }
      if (!tp) return;
      // the hit visual at the target
      if (cfg.slimeSplatter) {
        this.spawnVfx('slime', tp.x, tp.y + 0.5, tp.z, {
          color: hexRgb(cfg.splashColor), color2: hexRgb(cfg.slimeDripColor2), size: cfg.impactSize,
        });
      } else if (cfg.meleeSlash) {
        this.spawnVfx('slash', tp.x, tp.y + 0.5, tp.z, {
          dirX, dirZ, color: hexRgb(cfg.slashColor), size: cfg.impactSize, count: cfg.slashCount,
        });
      } else {
        this.spawnVfx('impact', tp.x, tp.y + 0.6, tp.z, {
          color: hexRgb(cfg.impactColor), size: cfg.impactSize / 0.4,
        });
      }
      // heavy / large-splash weapons stamp a ground shockwave at the impact
      const def = wid ? getWeaponDef(wid) : undefined;
      if (def && def.splashRadius >= 1.5) {
        this.spawnVfx('shockwave', tp.x, tp.y, tp.z, {
          color: hexRgb(cfg.splashColor), count: def.splashRadius,
        });
      }
    });

    // damage (attacker view): spark/blood at the target keyed by the target's
    // body type (mechanical -> spark, biological -> blood), tinted by the
    // attacker weapon's impact color. Skipped for melee/slime/flame weapons —
    // their attack_hit already renders a bespoke hit (avoid double bursts).
    eventBus.on('combat:damage', (d) => {
      const tp = posOf(d.target);
      if (!tp) return;
      const cfg = getWeaponVFX(attackWeaponId.get(d.attacker as unknown as EntityHandle));
      if (cfg.meleeSlash || cfg.slimeSplatter || cfg.flameStream) return;
      const ap = posOf(d.attacker);
      const dirX = ap ? tp.x - ap.x : 0;
      const dirZ = ap ? tp.z - ap.z : 0;
      const bio = this._isBiological(d.target);
      const kind = bio ? 'blood' : 'spark';
      // sparks pick up the weapon's impact tint; blood stays organic-red.
      const color = bio ? undefined : hexRgb(cfg.impactColor);
      this.spawnVfx(kind, tp.x, tp.y + 0.5, tp.z, { dirX, dirZ, color });
    });

    // kill (killer + victim): death_debris + a small explosion at the victim. The
    // bus carries entity ids; the victim is still alive here (death-system emits
    // combat:kill BEFORE despawn), so its Faction.color + Renderable.size read
    // live. A single-entity world.get is safe mid-frame (not a query iteration).
    eventBus.on('combat:kill', (d) => {
      const vp = posOf(d.victim);
      if (!vp) return;
      const col = this._factionRgb(d.victim);
      const sz = this._modelSizeOf(d.victim);
      this.spawnVfx('death_debris', vp.x, vp.y, vp.z, { color: col, size: sz });
      this.spawnVfx('explosion', vp.x, vp.y + 0.3, vp.z, { size: Math.min(1.2, sz) });
    });

    // ability:used: bespoke per-ability VFX (M17 — AbilityVFX long-tail). An
    // ability listed in the ABILITY_VFX table spawns its distinctive kind (e.g.
    // EMP's electromagnetic burst) at the cast TARGET or the caster; abilities
    // not listed fall back to the generic cast_flash tinted by the ability's
    // visualColor. (The stateful per-entity source effects — flame-dash trail,
    // cloak fade, burrow, blink, charges — remain a tracked seam.)
    eventBus.on('ability:used', (d) => {
      const cp = posOf(d.entity);
      if (!cp) return;
      const spec = getAbilityVfx(d.abilityId);
      const hex = getAbilityDef(d.abilityId)?.visualColor;
      const tint = hex !== undefined ? hexRgb(hex) : undefined;
      if (spec) {
        // fire the bespoke effect at the target point (else the caster).
        const at = spec.atTarget && d.targetX !== undefined && d.targetZ !== undefined
          ? { x: d.targetX, y: cp.y, z: d.targetZ } : cp;
        this.spawnVfx(spec.kind, at.x, at.y + 0.2, at.z, { size: spec.size, color: spec.color ?? tint });
        if (spec.keepCastFlash === false) return; // bespoke effect replaces the glow
      }
      this.spawnVfx('cast_flash', cp.x, cp.y + 0.4, cp.z, { color: tint });

      // nexus bolt (stellar_insight / energy_overcharge): an energy beam from the
      // caster to the targeted ally (source `_createNexusBoltVFX`). blue vs gold.
      if ((d.abilityId === 'stellar_insight' || d.abilityId === 'energy_overcharge') && d.targetEntity !== undefined) {
        const tp = posOf(d.targetEntity);
        if (tp) {
          const boltColor: [number, number, number] = d.abilityId === 'stellar_insight' ? [0.27, 0.67, 1] : [1, 0.8, 0.13];
          this.spawnBeam(cp.x, cp.y + 1.5, cp.z, tp.x, tp.y + 0.5, tp.z, boltColor);
        }
      }
    });

    // fx:teleport (blink): departure implosion @ from + arrival burst @ to. Sited
    // at terrain height via spawnVfxOnGround (the event carries x/z only).
    eventBus.on('fx:teleport', (d) => {
      this.spawnVfxOnGround('blink_out', d.fromX, d.fromZ);
      this.spawnVfxOnGround('blink_in', d.toX, d.toZ);
    });

    // fx:shieldRestore / fx:energyGain: a burst at the target when its shield /
    // energy actually rose (Immortal restore, energy_overcharge). Position from
    // the target entity's Transform.
    eventBus.on('fx:shieldRestore', (d) => {
      const p = posOf(d.target);
      if (p) this.spawnVfx('shield_burst', p.x, p.y + 0.5, p.z);
    });
    eventBus.on('fx:energyGain', (d) => {
      const p = posOf(d.target);
      if (p) this.spawnVfx('energy_flash', p.x, p.y + 0.5, p.z);
    });
  }

  /**
   * True if the entity is a biological unit (Zerg race or BIO/PSIONIC combat type)
   * -> blood; else mechanical/structure -> spark. Derived live from UnitType (no
   * duplicated companion table — SSOT is the component).
   */
  private _isBiological(id: number): boolean {
    const ut = this._world.get(id as unknown as EntityHandle, UnitType);
    if (!ut.ok) return false;
    return ut.value.race === RACE.ZERG
      || ut.value.combatType === COMBAT_TYPE.BIO
      || ut.value.combatType === COMBAT_TYPE.PSIONIC;
  }

  /** Victim faction color (0xRRGGBB) -> rgb, for tinting death debris chunks. */
  private _factionRgb(id: number): [number, number, number] {
    const f = this._world.get(id as unknown as EntityHandle, Faction);
    if (!f.ok) return [0.4, 0.4, 0.4];
    const c = f.value.color;
    return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
  }

  /** Victim render size -> debris burst scale (bigger units throw bigger chunks). */
  private _modelSizeOf(id: number): number {
    const r = this._world.get(id as unknown as EntityHandle, Renderable);
    return r.ok ? Math.max(0.5, r.value.size) : 1;
  }
}
