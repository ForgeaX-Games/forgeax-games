/**
 * MarsCraft -> forgeax-engine — StatefulAbilityVfxSystem (M17 chunk C)
 * =============================================================================
 * Ability-SPECIFIC persistent VFX that aren't expressible as a declarative
 * BuffVFXConfig (those go through BuffAuraSystem). Each lives on its host entity
 * for as long as its driver is active, then tears down. Three drivers:
 *   • buff      — lives while the entity holds a buff (ability:buff_applied/removed)
 *   • channel   — lives during a castTime windup (ability:cast_start → !isChanneling)
 *   • sustained — lives during a sustained phase (ability:sustained_start →
 *                 ability:sustained_end / sustained_complete)
 *
 * Ported effects (faithful to source AbilityVFX):
 *   • stellar_insight  (buff)      → floating layered "eye" (_createStellarInsightEyeVFX)
 *   • phase_snipe      (channel)   → charging energy ball + glow at the muzzle,
 *                                    growing over the windup, with converging motes
 *                                    (_createPhaseSnipeVFX)
 *   • flame_dash       (sustained) → pulsing orange shell + backward flame trail
 *                                    (_createFlameDashVFX)
 *   • cloak            (toggle)    → one-shot cloak-in/out shimmer burst
 *                                    (_createCloakTransitionVFX)
 *
 * NOT yet ported (large bespoke geometry; same event plumbing now exists, so they're
 * unblocked for a follow-up tick): spine_rush (bone spines), earth_shatter (fissures),
 * lurker_burrow (submerge), prismatic_charge/blast. Tracked in PORT-PROGRESS.
 *
 * RENDER translation: source used THREE meshes + material.opacity; forgeax is ECS +
 * shared materials, so persistent parts are FREE entities (prims / FlatMeshCache),
 * repositioned onto the host each frame + despawned on teardown (not ChildOf → no
 * orphan class); opacity fade → scale pulse; continuous particles delegate to
 * VfxSystem (buff_mote / buff_burst). The eye's per-frame lookAt(camera) billboard →
 * fixed flat-XZ parts (RTS camera is rotation-locked by default; noted seam).
 *
 * ⚠️ ECS rules: event handlers only BUFFER create/remove; all spawn/despawn happens
 * at the top of this system's own tick.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform, MeshFilter, MeshRenderer, type Handle } from '@forgeax/engine-runtime';
import { Motion } from '../components';
import { hasBuff } from './abilities-runtime';
import { eventBus, type GameEvents } from '../core/event-bus';
import { FlatMeshCache } from '../world/flat-meshes';
import type { VfxHandle } from './vfx-system';
import type { AbilitySystemHandle } from './ability-system';
import type { UnitPrimitives } from '../world/unit-models';

const toHandle = (id: number): EntityHandle => id as unknown as EntityHandle;
type TintFn = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

type RenderKind = 'eye' | 'phase' | 'flame' | 'earth' | 'spine' | 'burrow' | 'prismatic';
type Driver = 'buff' | 'channel' | 'sustained' | 'timed';

/** buffId → bespoke buff-driven effect. */
const EFFECT_FOR_BUFF: Record<string, RenderKind> = { stellar_insight: 'eye' };
/** abilityId → channel-driven (cast-windup) effect. */
const EFFECT_FOR_CHANNEL: Record<string, RenderKind> = { phase_snipe: 'phase' };
/** abilityId → sustained-driven (dash/channel) effect. */
const EFFECT_FOR_SUSTAINED: Record<string, RenderKind> = { flame_dash: 'flame', earth_shatter: 'earth', spine_rush: 'spine', prismatic_charge: 'prismatic' };
/** abilityId → fires a one-shot blast at the TARGET on ability:sustained_complete. */
const BLAST_ON_COMPLETE = new Set<string>(['prismatic_charge']);
const PRISM_OMEN_R = 2.2 * 1.84;
/** abilityId → cast_start-triggered TIMED emitter (self-expires; not tied to isChanneling). */
const EFFECT_FOR_CAST_TIMED: Record<string, { kind: RenderKind; seconds: number }> = {
  lurker_burrow: { kind: 'burrow', seconds: 1.0 },
  lurker_burrow_cancel: { kind: 'burrow', seconds: 1.0 },
};

interface EffectInstance {
  entity: EntityHandle;
  entityId: number;
  tag: string;          // buffId or abilityId
  driver: Driver;
  kind: RenderKind;
  parts: EntityHandle[];
  elapsed: number;
  particleTimer: number;
  lastX: number;        // path-tracking for along-dash emitters (earth/spine)
  lastZ: number;
  timed: number;        // remaining seconds for the 'timed' driver (burrow); else 0
  tx: number;           // target point (prismatic omen/blast); else 0
  tz: number;
}
interface CreateReq { entityId: number; tag: string; driver: Driver; kind: RenderKind; seconds?: number; tx?: number; tz?: number }
/** A short-lived ground/air decal that animates then despawns (no per-entity opacity). */
interface Decal { entity: EntityHandle; life: number; maxLife: number; anim: 'expand' | 'rise' | 'hold'; a: number; b: number; }

export interface StatefulAbilityVfxDeps {
  tint: TintFn;
  prims: UnitPrimitives;
  vfx: VfxHandle;
  ability: AbilitySystemHandle;
  heightAt: (x: number, z: number) => number;
}

export interface StatefulAbilityVfxHandle {
  count(): number;
  probe(): Array<{ entity: number; tag: string; driver: string; kind: string; parts: number }>;
}

const EYE_Y = 1.6;

export class StatefulAbilityVfxSystem implements StatefulAbilityVfxHandle {
  readonly name = 'StatefulAbilityVfxSystem';
  private _world!: World;
  private _flat!: FlatMeshCache;
  private readonly _deps: StatefulAbilityVfxDeps;
  private readonly _fx = new Map<string, EffectInstance>();
  private readonly _decals: Decal[] = [];
  private readonly _pendingCreate: CreateReq[] = [];
  private readonly _pendingRemove: string[] = [];
  private readonly _pendingBlast: Array<{ x: number; y: number; z: number; radius: number }> = [];
  private _rngS = 0x51a7ef;

  constructor(deps: StatefulAbilityVfxDeps) { this._deps = deps; }

  install(world: World): StatefulAbilityVfxHandle {
    this._world = world;
    this._flat = new FlatMeshCache(world);
    eventBus.on('ability:buff_applied', this._onBuffApplied);
    eventBus.on('ability:buff_removed', this._onBuffRemoved);
    eventBus.on('ability:cast_start', this._onCastStart);
    eventBus.on('ability:sustained_start', this._onSustainedStart);
    eventBus.on('ability:sustained_end', this._onSustainedEnd);
    eventBus.on('ability:sustained_complete', this._onSustainedComplete);
    eventBus.on('ability:toggle_complete', this._onToggleComplete);
    world.addSystem({
      name: this.name,
      queries: [{ with: [Entity, Transform] }], // unused — we iterate our own set
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

  count(): number { return this._fx.size; }
  probe(): Array<{ entity: number; tag: string; driver: string; kind: string; parts: number }> {
    return [...this._fx.values()].map((f) => ({ entity: f.entityId, tag: f.tag, driver: f.driver, kind: f.kind, parts: f.parts.length }));
  }

  private _key(entityId: number, tag: string): string { return `${entityId}:${tag}`; }
  private _rng(): number {
    let s = this._rngS | 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this._rngS = s;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private _facing(e: EntityHandle): number {
    const mo = this._world.get(e, Motion);
    return mo.ok ? (mo.value.facingY as number) : 0;
  }

  // ── event handlers (BUFFER only) ───────────────────────────────────────────
  private readonly _onBuffApplied = (d: GameEvents['ability:buff_applied']): void => {
    const kind = EFFECT_FOR_BUFF[d.buffId];
    if (kind) this._pendingCreate.push({ entityId: d.entity, tag: d.buffId, driver: 'buff', kind });
  };
  private readonly _onBuffRemoved = (d: GameEvents['ability:buff_removed']): void => {
    if (EFFECT_FOR_BUFF[d.buffId]) this._pendingRemove.push(this._key(d.entity, d.buffId));
  };
  private readonly _onCastStart = (d: GameEvents['ability:cast_start']): void => {
    const kind = EFFECT_FOR_CHANNEL[d.abilityId];
    if (kind) { this._pendingCreate.push({ entityId: d.entity, tag: d.abilityId, driver: 'channel', kind }); return; }
    const timed = EFFECT_FOR_CAST_TIMED[d.abilityId];
    if (timed) this._pendingCreate.push({ entityId: d.entity, tag: d.abilityId, driver: 'timed', kind: timed.kind, seconds: Math.max(timed.seconds, d.castTime + 0.4) });
  };
  private readonly _onSustainedStart = (d: GameEvents['ability:sustained_start']): void => {
    const kind = EFFECT_FOR_SUSTAINED[d.abilityId];
    if (kind) this._pendingCreate.push({ entityId: d.entity, tag: d.abilityId, driver: 'sustained', kind, tx: d.targetX, tz: d.targetZ });
  };
  private readonly _onSustainedEnd = (d: GameEvents['ability:sustained_end']): void => {
    if (EFFECT_FOR_SUSTAINED[d.abilityId]) this._pendingRemove.push(this._key(d.entity, d.abilityId));
  };
  private readonly _onSustainedComplete = (d: GameEvents['ability:sustained_complete']): void => {
    if (!EFFECT_FOR_SUSTAINED[d.abilityId]) return;
    // natural finish: fire the area blast at the target (source _createPrismaticBlastVFX)
    if (BLAST_ON_COMPLETE.has(d.abilityId) && d.targetX !== undefined && d.targetZ !== undefined) {
      this._pendingBlast.push({ x: d.targetX, y: this._deps.heightAt(d.targetX, d.targetZ), z: d.targetZ, radius: PRISM_OMEN_R });
    }
    this._pendingRemove.push(this._key(d.entity, d.abilityId));
  };
  private readonly _onToggleComplete = (d: GameEvents['ability:toggle_complete']): void => {
    if (d.stateId === 'cloak') this._cloakBurst(d.entity); // one-shot, no instance
  };

  private _flush(): void {
    // create BEFORE remove so a create+remove landing in the SAME batch (e.g. a very
    // short sustained under a slow frame) nets to removed, not a stuck effect.
    if (this._pendingCreate.length) for (const r of this._pendingCreate.splice(0)) this._create(r);
    if (this._pendingRemove.length) for (const k of this._pendingRemove.splice(0)) this._destroy(k);
    if (this._pendingBlast.length) for (const b of this._pendingBlast.splice(0)) this._prismaticBlast(b.x, b.y, b.z, b.radius);
  }

  private _create(req: CreateReq): void {
    const key = this._key(req.entityId, req.tag);
    if (this._fx.has(key)) return;
    const e = toHandle(req.entityId);
    const tr = this._world.get(e, Transform);
    if (!tr.ok) return;
    const [x, y, z] = tr.value.pos;
    const base: EffectInstance = { entity: e, entityId: req.entityId, tag: req.tag, driver: req.driver, kind: req.kind, parts: [], elapsed: 0, particleTimer: 0, lastX: x, lastZ: z, timed: req.seconds ?? 0, tx: req.tx ?? x, tz: req.tz ?? z };
    if (req.kind === 'eye') base.parts = this._buildEye(x, y, z);
    else if (req.kind === 'phase') base.parts = this._buildPhase(e, x, y, z);
    else if (req.kind === 'flame') base.parts = this._buildFlame(x, y, z);
    else if (req.kind === 'spine') { const p = this._spawnMesh(this._flat.disc(0.8 * 1.84, 24), [0.67, 0.53, 0.33], x, y + 0.04, z, 1); if (p) base.parts = [p]; } // ground bulge
    else if (req.kind === 'burrow') this._decal(this._flat.ring(0.82, 1.0, 32), [0.73, 0.6, 0.33], x, y + 0.05, z, 'expand', 0.4, 1.5 * 1.84); // shockwave
    else if (req.kind === 'prismatic') base.parts = this._buildPrismatic(x, y, z, base.tx, base.tz);
    this._fx.set(key, base);
  }

  /** Spawn a short-lived animated decal (expanding ring / rising spine / static hold). */
  private _decal(mesh: Handle<'MeshAsset', 'shared'>, color: [number, number, number], x: number, y: number, z: number, anim: Decal['anim'], life: number, a: number, b = 0, rotY = 0): void {
    const mat = this._deps.tint(color, { metallic: 0, roughness: 1 });
    const s0 = anim === 'expand' ? 0.01 : 1;
    const data: Record<string, number[]> = { pos: [x, y, z], scale: [s0, anim === 'rise' ? 0.01 : s0, s0] };
    if (rotY) { data.quat = [0, Math.sin(rotY / 2), 0, Math.cos(rotY / 2)]; }
    const res = this._world.spawn(
      { component: Transform, data },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [mat] } },
    );
    if (res.ok) this._decals.push({ entity: res.value as EntityHandle, life, maxLife: life, anim, a, b });
  }

  private _spawnMesh(mesh: Handle<'MeshAsset', 'shared'>, color: [number, number, number], x: number, y: number, z: number, scale: number): EntityHandle | null {
    const mat = this._deps.tint(color, { metallic: 0, roughness: 1 });
    const res = this._world.spawn(
      { component: Transform, data: { pos: [x, y, z], scale: [scale, scale, scale] } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [mat] } },
    );
    return res.ok ? (res.value as EntityHandle) : null;
  }

  /** stellar_insight floating layered eye (flat XZ parts). */
  private _buildEye(x: number, y: number, z: number): EntityHandle[] {
    const S = 0.6, H = 0.28, baseY = y + EYE_Y;
    const layers: Array<{ mesh: Handle<'MeshAsset', 'shared'>; color: [number, number, number]; ly: number }> = [
      { mesh: this._flat.ring(S * 0.9, S * 1.2, 32), color: [0.27, 0.67, 1.0], ly: 0.00 },
      { mesh: this._flat.ellipse(S, H, 24),          color: [0.20, 0.60, 1.0], ly: 0.02 },
      { mesh: this._flat.disc(0.18, 24),             color: [0.40, 0.80, 1.0], ly: 0.04 },
      { mesh: this._flat.ring(0.15, 0.19, 24),       color: [0.13, 0.40, 0.80], ly: 0.05 },
      { mesh: this._flat.disc(0.07, 16),             color: [1.0, 1.0, 1.0], ly: 0.06 },
    ];
    const parts: EntityHandle[] = [];
    for (const L of layers) { const p = this._spawnMesh(L.mesh, L.color, x, baseY + L.ly, z, 1); if (p) parts.push(p); }
    return parts;
  }

  /** phase_snipe muzzle charge — [ball, glow] spheres. */
  private _buildPhase(e: EntityHandle, x: number, y: number, z: number): EntityHandle[] {
    const f = this._facing(e);
    const mx = x + Math.sin(f) * 0.5, my = y + 0.5, mz = z + Math.cos(f) * 0.5;
    const parts: EntityHandle[] = [];
    const ball = this._spawnMesh(this._deps.prims.sphere, [0.0, 0.8, 1.0], mx, my, mz, 0.1);   // ball
    const glow = this._spawnMesh(this._deps.prims.sphere, [0.53, 0.73, 1.0], mx, my, mz, 0.18); // glow
    if (ball) parts.push(ball);
    if (glow) parts.push(glow);
    return parts;
  }

  /** flame_dash pulsing shell sphere. */
  private _buildFlame(x: number, y: number, z: number): EntityHandle[] {
    const shell = this._spawnMesh(this._deps.prims.sphere, [1.0, 0.67, 0.0], x, y + 0.3, z, 0.8);
    return shell ? [shell] : [];
  }

  /** cloak in/out one-shot shimmer (source _createCloakTransitionVFX). */
  private _cloakBurst(entityId: number): void {
    const tr = this._world.get(toHandle(entityId), Transform);
    if (!tr.ok) return;
    this._deps.vfx.spawnVfx('buff_burst', tr.value.pos[0], tr.value.pos[1] + 0.3, tr.value.pos[2], {
      color: [0.53, 0.67, 0.8], count: 7, size: 0.06, speed: 1.2,
    });
  }

  private _destroy(key: string): void {
    const inst = this._fx.get(key);
    if (!inst) return;
    // dash effects (earth/spine) fire a bigger burst where the dash ended.
    if (inst.kind === 'earth' || inst.kind === 'spine') {
      const tr = this._world.get(inst.entity, Transform);
      if (tr.ok) {
        const [x, y, z] = tr.value.pos;
        if (inst.kind === 'earth') this._emitDebris(x, y, z, 14, 0.24, [0.4, 0.32, 0.22]);
        else { this._decal(this._flat.disc(0.4, 6), [0.87, 0.8, 0.67], x, y, z, 'rise', 1.1, 1.6); this._emitDebris(x, y, z, 20, 0.22, [0.53, 0.47, 0.33]); }
      }
    }
    for (const p of inst.parts) if (this._world.get(p, Transform).ok) this._world.despawn(p);
    this._fx.delete(key);
  }

  /** Emit N chunky debris bits (rock/dirt) that arc up + fall (gravity), themed color. */
  private _emitDebris(x: number, y: number, z: number, n: number, size: number, color: [number, number, number]): void {
    for (let i = 0; i < n; i++) {
      const ang = this._rng() * Math.PI * 2, sp = 1.5 + this._rng() * 3;
      this._deps.vfx.spawnVfx('buff_mote', x + (this._rng() - 0.5) * 0.4, y + 0.15, z + (this._rng() - 0.5) * 0.4, {
        color, size: size * (0.6 + this._rng() * 0.6), shape: 'box', gravity: 11,
        vel: [Math.cos(ang) * sp, 2.5 + this._rng() * 2.5, Math.sin(ang) * sp], lifetime: 0.7,
      });
    }
  }

  // ── per-frame update ────────────────────────────────────────────────────────
  private _tick(dt: number): void {
    const world = this._world;
    const dead: string[] = [];
    for (const [key, inst] of this._fx) {
      if (inst.driver === 'timed') inst.timed -= dt;
      const tr = world.get(inst.entity, Transform);
      if (!tr.ok || !this._alive(inst)) { dead.push(key); continue; }
      inst.elapsed += dt;
      if (inst.kind === 'eye') this._updateEye(inst, tr.value);
      else if (inst.kind === 'phase') this._updatePhase(inst, tr.value, dt);
      else if (inst.kind === 'flame') this._updateFlame(inst, tr.value, dt);
      else if (inst.kind === 'earth') this._updateEarth(inst, tr.value, dt);
      else if (inst.kind === 'spine') this._updateSpine(inst, tr.value);
      else if (inst.kind === 'burrow') this._updateBurrow(inst, tr.value, dt);
      else if (inst.kind === 'prismatic') this._updatePrismatic(inst, tr.value, dt);
    }
    for (const k of dead) this._destroy(k);
    this._tickDecals(dt);
  }

  /** driver-specific liveness (host-despawn already handled by the caller). */
  private _alive(inst: EffectInstance): boolean {
    // buff: while held; channel: during the castTime windup (no cast-end event, so poll).
    // sustained: torn down by the sustained_end/complete EVENT (source does the same —
    // it destroys on sustained_end, not by polling); timed: self-expiring emitter.
    if (inst.driver === 'buff') return hasBuff(inst.entity as unknown as never, inst.tag);
    if (inst.driver === 'channel') return this._deps.ability.isChanneling(inst.entity);
    if (inst.driver === 'timed') return inst.timed > 0;
    return true;
  }

  /** earth_shatter: rocks + dust + crack lines laid along the dash path. */
  private _updateEarth(inst: EffectInstance, tf: { pos: ArrayLike<number> }, dt: number): void {
    const dx = tf.pos[0] - inst.lastX, dz = tf.pos[2] - inst.lastZ;
    const dist = Math.hypot(dx, dz);
    if (dist >= 0.4) {
      const ang = Math.atan2(dx, dz) + (this._rng() - 0.5) * 1.2, len = 0.3 + this._rng() * 0.4;
      // a short ground crack (thin flat box) + a rock spray at the current step
      this._decal(this._flat.ellipse(len, 0.05, 4), [0.2, 0.13, 0.07], tf.pos[0], tf.pos[1] + 0.03, tf.pos[2], 'hold', 1.5, 0, 0, ang);
      this._emitDebris(tf.pos[0], tf.pos[1], tf.pos[2], 5, 0.2, [0.33, 0.27, 0.2]);
      inst.lastX = tf.pos[0]; inst.lastZ = tf.pos[2];
    }
    inst.particleTimer += dt;
    if (inst.particleTimer >= 0.04) {
      inst.particleTimer = 0;
      this._deps.vfx.spawnVfx('buff_mote', tf.pos[0] + (this._rng() - 0.5) * 2, tf.pos[1] + 0.1, tf.pos[2] + (this._rng() - 0.5) * 2, { color: [0.8, 0.73, 0.53], size: 0.35, vel: [0, 0.3, 0], lifetime: 0.8 });
    }
  }

  /** spine_rush: bone spines (cones) erupt from the ground along the dash path. */
  private _updateSpine(inst: EffectInstance, tf: { pos: ArrayLike<number> }): void {
    // keep the ground-bulge disc under the runner
    if (inst.parts[0]) this._world.set(inst.parts[0], Transform, { pos: [tf.pos[0], tf.pos[1] + 0.04, tf.pos[2]] });
    const dx = tf.pos[0] - inst.lastX, dz = tf.pos[2] - inst.lastZ;
    if (Math.hypot(dx, dz) >= 0.5) {
      const h = 1.2 + this._rng() * 1.0;
      // rising bone spine (cone), tilted slightly, grows up from the ground
      this._decal(this._deps.prims.cone, [0.87, 0.8, 0.67], tf.pos[0], tf.pos[1] + h / 2, tf.pos[2], 'rise', 0.9, h);
      this._emitDebris(tf.pos[0], tf.pos[1], tf.pos[2], 5, 0.18, [0.53, 0.47, 0.33]);
      inst.lastX = tf.pos[0]; inst.lastZ = tf.pos[2];
    }
  }

  /** lurker_burrow: dirt spray + a settling mound while the unit submerges. */
  private _updateBurrow(inst: EffectInstance, tf: { pos: ArrayLike<number> }, _dt: number): void {
    inst.particleTimer += _dt;
    if (inst.particleTimer >= 0.05) {
      inst.particleTimer = 0;
      const ang = this._rng() * Math.PI * 2, sp = 1.5 + this._rng() * 2;
      this._deps.vfx.spawnVfx('buff_mote', tf.pos[0] + (this._rng() - 0.5) * 0.3, tf.pos[1] + 0.1, tf.pos[2] + (this._rng() - 0.5) * 0.3, {
        color: this._rng() < 0.3 ? [0.53, 0.47, 0.33] : [0.73, 0.67, 0.47], size: 0.06, shape: 'box', gravity: 9,
        vel: [Math.cos(ang) * sp, 1.5 + this._rng() * 2, Math.sin(ang) * sp], lifetime: 0.6,
      });
    }
    // near the end, settle a mound mark once
    if (inst.timed <= 0.2 && inst.parts.length === 0) {
      const p = this._spawnMesh(this._flat.disc(0.7, 20), [0.47, 0.4, 0.27], tf.pos[0], tf.pos[1] + 0.02, tf.pos[2], 1);
      if (p) inst.parts.push(p);
    }
  }

  /** prismatic_charge parts: [headBall, headGlow, omenRing@target, omenDisc@target]. */
  private _buildPrismatic(x: number, y: number, z: number, tx: number, tz: number): EntityHandle[] {
    const parts: EntityHandle[] = [];
    const headY = y + 0.8;
    const ball = this._spawnMesh(this._deps.prims.sphere, [0.27, 0.53, 1.0], x, headY, z, 0.3);   // energy ball
    const glow = this._spawnMesh(this._deps.prims.sphere, [0.53, 0.73, 1.0], x, headY, z, 0.5);   // glow
    const tgy = this._deps.heightAt(tx, tz);
    const ring = this._spawnMesh(this._flat.ring(PRISM_OMEN_R * 0.92, PRISM_OMEN_R, 48), [0.27, 0.53, 1.0], tx, tgy + 0.04, tz, 1); // omen ring @ target
    const disc = this._spawnMesh(this._flat.disc(PRISM_OMEN_R * 0.9, 32), [0.13, 0.2, 0.4], tx, tgy + 0.03, tz, 1); // omen disc @ target
    for (const p of [ball, glow, ring, disc]) if (p) parts.push(p);
    return parts;
  }

  /** prismatic_charge: grow head orb, spin the omen ring, converge + rising motes. */
  private _updatePrismatic(inst: EffectInstance, tf: { pos: ArrayLike<number> }, dt: number): void {
    const world = this._world;
    const headY = tf.pos[1] + 0.8;
    const prog = Math.min(inst.elapsed / 3.0, 1); // ~duration; cosmetic growth
    const ball = (0.15 + prog * 0.35) * 2; // prim sphere r0.5 → *2
    if (inst.parts[0]) world.set(inst.parts[0], Transform, { pos: [tf.pos[0], headY, tf.pos[2]], scale: [ball, ball, ball] });
    if (inst.parts[1]) { const g = ball * 1.6; world.set(inst.parts[1], Transform, { pos: [tf.pos[0], headY, tf.pos[2]], scale: [g, g, g] }); }
    if (inst.parts[2]) { const a = inst.elapsed * 0.5; world.set(inst.parts[2], Transform, { quat: [0, Math.sin(a / 2), 0, Math.cos(a / 2)] }); } // spin omen ring
    // charge motes converging to the head orb (blue → gold as it charges)
    inst.particleTimer += dt;
    if (inst.particleTimer >= 0.06) {
      inst.particleTimer = 0;
      const ang = this._rng() * Math.PI * 2, dist = 0.4 + this._rng() * 0.3, sp = dist / 0.2;
      const px = tf.pos[0] + Math.cos(ang) * dist, pz = tf.pos[2] + Math.sin(ang) * dist, py = headY + (this._rng() - 0.5) * 0.3;
      this._deps.vfx.spawnVfx('buff_mote', px, py, pz, {
        color: prog < 0.5 ? [0.4, 0.87, 1.0] : [1.0, 0.87, 0.53], size: 0.05,
        vel: [(tf.pos[0] - px) * sp, (headY - py) * 2, (tf.pos[2] - pz) * sp], lifetime: 0.2,
      });
      // an omen ground mote rising in the target area
      const oa = this._rng() * Math.PI * 2, od = this._rng() * PRISM_OMEN_R * 0.8;
      this._deps.vfx.spawnVfx('buff_mote', inst.tx + Math.cos(oa) * od, this._deps.heightAt(inst.tx, inst.tz) + 0.05, inst.tz + Math.sin(oa) * od, { color: [0.4, 0.6, 1.0], size: 0.06, vel: [0, 0.9, 0], lifetime: 0.8 });
    }
  }

  /** prismatic_blast: the sky-strike at completion — light pillar + shockwave rings +
   *  flash + impact disc + scorch + energy shards (source _createPrismaticBlastVFX). */
  private _prismaticBlast(x: number, y: number, z: number, radius: number): void {
    // tall light pillar (outer gold + white core) — brief
    this._decal(this._deps.prims.cylinder, [1.0, 0.87, 0.4], x, y + 9, z, 'hold', 0.5, 0, 0);
    this._scaleDecalLast(2.2 * 2, 18, 2.2 * 2);
    this._decal(this._deps.prims.cylinder, [1.0, 1.0, 1.0], x, y + 9, z, 'hold', 0.45, 0, 0);
    this._scaleDecalLast(0.8 * 2, 18, 0.8 * 2);
    // two expanding shockwave rings + a white ground impact disc + a scorch mark
    this._decal(this._flat.ring(0.33, 1.0, 48), [1.0, 0.87, 0.53], x, y + 0.06, z, 'expand', 0.5, radius);
    this._decal(this._flat.ring(0.28, 1.0, 48), [1.0, 0.67, 0.27], x, y + 0.05, z, 'expand', 0.7, radius * 1.2);
    this._decal(this._flat.disc(radius * 0.6, 32), [1.0, 0.93, 0.87], x, y + 0.04, z, 'hold', 0.35, 0);
    this._decal(this._flat.disc(radius * 0.85, 32), [0.2, 0.13, 0.07], x, y + 0.02, z, 'hold', 1.6, 0);
    // central flash sphere (brief)
    const flash = this._spawnMesh(this._deps.prims.sphere, [1.0, 1.0, 1.0], x, y + 0.5, z, 2.0);
    if (flash) this._decals.push({ entity: flash, life: 0.25, maxLife: 0.25, anim: 'hold', a: 0, b: 0 });
    // 35 energy shards (gold / pale-gold / blue) arcing up and out
    for (let i = 0; i < 35; i++) {
      const ang = this._rng() * Math.PI * 2, elev = (this._rng() - 0.15) * Math.PI * 0.6, sp = 4 + this._rng() * 5;
      const r = this._rng();
      const col: [number, number, number] = r < 0.35 ? [1.0, 0.8, 0.27] : r < 0.65 ? [1.0, 0.93, 0.67] : [0.27, 0.53, 1.0];
      this._deps.vfx.spawnVfx('buff_mote', x, y + 0.5, z, {
        color: col, size: 0.1, gravity: 6,
        vel: [Math.cos(ang) * Math.cos(elev) * sp, Math.sin(elev) * sp + 2.5, Math.sin(ang) * Math.cos(elev) * sp], lifetime: 0.7,
      });
    }
  }

  /** Set an explicit non-uniform scale on the most-recently-spawned decal (pillars). */
  private _scaleDecalLast(sx: number, sy: number, sz: number): void {
    const d = this._decals[this._decals.length - 1];
    if (d && this._world.get(d.entity, Transform).ok) this._world.set(d.entity, Transform, { scale: [sx, sy, sz] });
  }

  /** Animate + expire the transient decals. */
  private _tickDecals(dt: number): void {
    if (!this._decals.length) return;
    const keep: Decal[] = [];
    for (const d of this._decals) {
      d.life -= dt;
      if (d.life <= 0) { if (this._world.get(d.entity, Transform).ok) this._world.despawn(d.entity); continue; }
      const prog = 1 - d.life / d.maxLife;
      // expand decals spawn flat ([_,0.01,_]) and only X/Z animate; rise decals spawn [1,0.01,1] and only Y animates.
      if (d.anim === 'expand') { const s = Math.max(0.01, d.a * prog); this._world.set(d.entity, Transform, { scale: [s, 0.01, s] }); }
      else if (d.anim === 'rise') { const s = Math.min(d.a, (prog / 0.15) * d.a); this._world.set(d.entity, Transform, { scale: [1, Math.max(0.01, s), 1] }); }
      keep.push(d);
    }
    this._decals.length = 0;
    this._decals.push(...keep);
  }

  private _updateEye(inst: EffectInstance, tf: { pos: ArrayLike<number> }): void {
    const world = this._world;
    const baseY = tf.pos[1] + EYE_Y;
    const glowPulse = 1 + Math.sin(inst.elapsed * 3.5) * 0.12;
    const pupilPulse = 0.85 + Math.sin(inst.elapsed * 5) * 0.25;
    const layerY = [0.0, 0.02, 0.04, 0.05, 0.06];
    for (let i = 0; i < inst.parts.length; i++) {
      // parts spawn at scale [1,1,1]; only the glow ring (i=0) and pupil (i=4) pulse in X/Z, Y stays 1.
      const patch: Record<string, number[]> = { pos: [tf.pos[0], baseY + (layerY[i] ?? 0), tf.pos[2]] };
      if (i === 0) { patch.scale = [glowPulse, 1, glowPulse]; }
      else if (i === 4) { patch.scale = [pupilPulse, 1, pupilPulse]; }
      world.set(inst.parts[i], Transform, patch);
    }
  }

  private _updatePhase(inst: EffectInstance, tf: { pos: ArrayLike<number> }, _dt: number): void {
    const world = this._world;
    const f = this._facing(inst.entity);
    const mx = tf.pos[0] + Math.sin(f) * 0.5, my = tf.pos[1] + 0.5, mz = tf.pos[2] + Math.cos(f) * 0.5;
    const chargeProgress = Math.min(inst.elapsed / 1.0, 1.0);
    const ballScale = (0.05 + chargeProgress * 0.15) * 2; // prim sphere is r0.5 → *2 = visual radius
    if (inst.parts[0]) world.set(inst.parts[0], Transform, { pos: [mx, my, mz], scale: [ballScale, ballScale, ballScale] });
    if (inst.parts[1]) { const g = ballScale * 1.8; world.set(inst.parts[1], Transform, { pos: [mx, my, mz], scale: [g, g, g] }); }
    // converging motes toward the muzzle
    inst.particleTimer += _dt;
    if (inst.particleTimer >= 0.08) {
      inst.particleTimer = 0;
      const ang = this._rng() * Math.PI * 2, dist = 0.3;
      const px = mx + Math.cos(ang) * dist, pz = mz + Math.sin(ang) * dist;
      const sp = dist / 0.15;
      this._deps.vfx.spawnVfx('buff_mote', px, my + (this._rng() - 0.5) * 0.2, pz, {
        color: [0.4, 0.87, 1.0], size: 0.04, vel: [-Math.cos(ang) * sp, 0, -Math.sin(ang) * sp], lifetime: 0.15,
      });
    }
  }

  private _updateFlame(inst: EffectInstance, tf: { pos: ArrayLike<number> }, _dt: number): void {
    const world = this._world;
    const pulse = (1.0 + Math.sin(inst.elapsed * 15) * 0.1) * 0.8;
    if (inst.parts[0]) world.set(inst.parts[0], Transform, { pos: [tf.pos[0], tf.pos[1] + 0.3, tf.pos[2]], scale: [pulse, pulse, pulse] });
    // backward flame trail
    inst.particleTimer += _dt;
    if (inst.particleTimer >= 0.05) {
      inst.particleTimer = 0;
      const back = this._facing(inst.entity) + Math.PI + (this._rng() - 0.5) * 0.6;
      const speed = 1.0 + this._rng() * 1.5;
      this._deps.vfx.spawnVfx('buff_mote', tf.pos[0] + (this._rng() - 0.5) * 0.15, tf.pos[1] + 0.25, tf.pos[2] + (this._rng() - 0.5) * 0.15, {
        color: [1.0, 0.55 + this._rng() * 0.2, 0.1], size: 0.12, vel: [Math.sin(back) * speed, 0.3 + this._rng() * 0.3, Math.cos(back) * speed], lifetime: 0.25,
      });
    }
  }
}
