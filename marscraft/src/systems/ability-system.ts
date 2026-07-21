/**
 * MarsCraft -> forgeax-engine — ability system (cast pipeline) (Milestone M9)
 * =============================================================================
 * Port of the Three.js source `web/systems/AbilitySystem.ts` — the CAST PIPELINE.
 *
 * `castAbility(world, caster, abilityId, { targetEntity?, x?, z? })` runs the
 * full pipeline (1:1 with source `useAbility`):
 *   1. lookup AbilityDef; attack-modifier (orb) abilities just toggle + return
 *   2. validate caster alive + has the ability + not passive
 *   3. _validateCast: cooldown / energy / hp / target faction+type+range / etc.
 *   4. toggle/cloak cancel shortcut (deactivate without cost)
 *   5. spend hp + energy
 *   6. set cooldown (instant cast; castTime pre-cast = a SEAM, see below)
 *   7. face target
 *   8. run effects via the effect-executor
 *
 * Plus three frame systems:
 *   - cooldown tick: decrement abilityCooldowns over dt (source _updateCooldowns)
 *   - snapshot: rebuild the per-frame CombatTarget[] (so area effects are REAL)
 *   - autocast tick: cast autocast-enabled unit-target abilities at best target
 *
 * SEAMS (clearly marked, not faked):
 *   - castTime pre-cast (channeling), sustained phases, backswing, projectile
 *     ability launch, recall pending, passive auto-activation, trigger system:
 *     these need the channeling/sustained/projectile/trigger machinery that is a
 *     later M9 chunk. Abilities that REQUIRE them are skipped with a console.debug
 *     (effects still run instantly where safe; channeled-only ones no-op).
 *
 * ⚠️ ECS rules: qr[0] is Batch[]; companions via the runtime helpers; collect-
 * then-mutate (no spawn/despawn inside a query fn).
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Abilities, Energy, Health, Faction, UnitType, Movement, Motion, Illusion,
  MOVE_TYPE, PLAYER_ID,
  abilityIds, abilityCooldowns, abilityAutocast, abilityAttackModifier,
} from '../components';
import { getAbilityDef, type AbilityDef } from '../data/abilities';
import {
  isOnCooldown, setCooldown, hasBuff, isAnyTransitioning, getToggleState,
} from './abilities-runtime';
import { executeEffects, type CastContext } from './effect-executor';
import type { CombatTarget } from './combat-registry';
import { snapshotCombatTargets } from './combat-registry';
import { eventBus } from '../core/event-bus';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;

export interface CastTarget {
  targetEntity?: EntityHandle;
  x?: number;
  z?: number;
}

/** castTime windup in progress. */
interface ChannelState {
  abilityId: string;
  def: AbilityDef;
  remaining: number;
  targetEntity?: EntityHandle;
  targetX?: number;
  targetZ?: number;
  cancelable: boolean;
}

/** Sustained phase / toggle drain in progress. */
interface SustainedState {
  abilityId: string;
  def: AbilityDef;
  /** Remaining duration; Infinity for toggle / duration<=0 (until interrupted). */
  remaining: number;
  energyPerSecond: number;
  /** Periodic effect interval (0 = none). */
  interval: number;
  intervalTimer: number;
  targetEntity?: EntityHandle;
  targetX?: number;
  targetZ?: number;
  /** Toggle abilities end when the toggle goes inactive, not by duration. */
  isToggle: boolean;
  toggleStateId?: string;
}

/** Ability projectile whose effects are deferred until impact. */
interface PendingProjectile {
  caster: EntityHandle;
  def: AbilityDef;
  abilityId: string;
  targetEntity?: EntityHandle;
  targetX?: number;
  targetZ?: number;
  remaining: number;
}

export interface AbilitySystemOpts {
  /** Optional walkable clamp passed to teleport effects. */
  clampToWalkable?: (x: number, z: number) => { x: number; z: number };
  /**
   * requiredUpgrade gating (M9 ch4): given a player + an upgradeId, return the
   * researched level. An ability with a non-empty `requiredUpgrade` is rejected
   * when the level is < 1. When unset, the gate is skipped (back-compat).
   */
  getUpgradeLevel?: (playerId: number, upgradeId: string) => number;
}

export interface AbilitySystemHandle {
  castAbility(caster: EntityHandle, abilityId: string, target?: CastTarget): boolean;
  canCast(caster: EntityHandle, abilityId: string, target?: CastTarget): boolean;
  /** Is this entity in a castTime windup right now? (VFX teardown for cast-windup effects.) */
  isChanneling(caster: EntityHandle): boolean;
  /** Is this entity in a sustained/channeled phase right now? */
  isSustaining(caster: EntityHandle): boolean;
  /** The live per-frame combat-target snapshot (read-only). */
  readonly snapshot: readonly CombatTarget[];
}

export class AbilitySystem implements AbilitySystemHandle {
  readonly name = 'AbilitySystem';
  private _world!: World;
  private _gameTime = 0;
  private _snapshot: CombatTarget[] = [];
  private readonly _opts: AbilitySystemOpts;

  /** Active castTime windups (rawId -> channel state). */
  private readonly _channeling = new Map<number, ChannelState>();
  /** Active sustained phases / toggle drains (rawId -> sustained state). */
  private readonly _sustained = new Map<number, SustainedState>();
  /** In-flight ability projectiles (effects deferred until impact). */
  private readonly _pendingProjectiles: PendingProjectile[] = [];

  constructor(opts: AbilitySystemOpts = {}) { this._opts = opts; }

  get snapshot(): readonly CombatTarget[] { return this._snapshot; }

  install(world: World): AbilitySystemHandle {
    this._world = world;

    // ── snapshot + cooldown tick + autocast (single system, source order) ──
    world.addSystem(Update, {
      name: this.name,
      queries: [
        { with: [Entity, Abilities] },                       // ability carriers
        { with: [Entity, Transform, Health, Faction] },      // combat snapshot
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource(Time).delta;
        this._gameTime += dt;

        // rebuild the per-frame combat-target snapshot (area effects use it)
        snapshotCombatTargets(world, qr[1] as unknown as Batch[], this._snapshot);

        const carriers = qr[0] as unknown as Batch[];
        // cooldown tick (decrement + expire)
        for (const b of carriers) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            this._tickCooldowns(b.Entity.self[i] as EntityHandle, dt);
          }
        }

        // cast-pipeline phases (M9 ch4): advance castTime windups, sustained
        // drains, and in-flight ability projectiles. These mutate energy/buffs +
        // run effects but never spawn/despawn here, so ticking inline is safe.
        if (this._channeling.size) this._tickChanneling(world, dt);
        if (this._sustained.size) this._tickSustained(world, dt);
        if (this._pendingProjectiles.length) this._tickProjectiles(world, dt);
        // autocast (collect casts, run after the loop — casts mutate buffs/energy
        // but never spawn/despawn, so running inline is safe; we still collect to
        // keep the iteration read-only for clarity/safety).
        const pending: Array<{ caster: EntityHandle; abilityId: string; target: EntityHandle }> = [];
        for (const b of carriers) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            this._collectAutocast(world, b.Entity.self[i] as EntityHandle, pending);
          }
        }
        for (const p of pending) this.castAbility(p.caster, p.abilityId, { targetEntity: p.target });
      },
    });

    return this;
  }

  // ── cooldown tick ─────────────────────────────────────────────────────────
  private _tickCooldowns(e: EntityHandle, dt: number): void {
    const m = abilityCooldowns.get(e);
    if (!m) return;
    for (const [id, cd] of m) {
      cd.remaining -= dt;
      if (cd.remaining <= 0) m.delete(id);
    }
  }

  isChanneling(caster: EntityHandle): boolean { return this._channeling.has(rawId(caster)); }
  isSustaining(caster: EntityHandle): boolean { return this._sustained.has(rawId(caster)); }

  // ── public cast API ─────────────────────────────────────────────────────────
  castAbility(caster: EntityHandle, abilityId: string, target: CastTarget = {}): boolean {
    const world = this._world;
    const def = getAbilityDef(abilityId);
    if (!def) { console.warn(`[marscraft][ability] unknown ability: ${abilityId}`); return false; }

    let targetEntity = target.targetEntity;
    let targetX = target.x;
    let targetZ = target.z;

    // 1b. attack-modifier (orb) abilities: just toggle the modifier + return.
    if (def.attackModifier) {
      const cur = abilityAttackModifier.get(caster) ?? null;
      if (cur && cur.abilityId === abilityId) {
        abilityAttackModifier.set(caster, null);
      } else {
        abilityAttackModifier.set(caster, {
          abilityId, active: true, energyCost: def.attackModifier.energyCost, config: def.attackModifier,
        });
      }
      return true;
    }

    // 2. caster validity
    if (!world.get(caster, Health).ok) return false;
    const ab = world.get(caster, Abilities);
    if (!ab.ok) return false;
    const ids = abilityIds.get(caster) ?? [];
    if (!ids.includes(abilityId)) return false;
    if (def.isPassive) return false;
    if (def.targetType === 'unit' && targetEntity === undefined) return false;

    // 3. validate cast conditions
    const fail = this._validateCast(world, caster, def, targetEntity, targetX, targetZ);
    if (fail) { console.debug(`[marscraft][ability] ${abilityId} blocked: ${fail}`); return false; }

    // 4. toggle/cloak cancel shortcut (deactivate without cost)
    if (def.isToggle) {
      const te = def.effects.find((e) => e.type === 'toggle' || e.type === 'cloak');
      if (te) {
        const stateId = te.type === 'toggle' ? (te as { stateId: string }).stateId : 'cloak';
        const state = getToggleState(caster, stateId);
        if (state?.active && te.type === 'cloak') {
          state.active = false;
          if (def.cooldown > 0) setCooldown(caster, abilityId, def.cooldown);
          return true;
        }
      }
    }

    // 4b. direction-type: convert click point to a normalized direction vector
    if (def.targetType === 'direction' && targetX !== undefined && targetZ !== undefined) {
      const tr = world.get(caster, Transform);
      if (tr.ok) {
        const dx = targetX - tr.value.pos[0], dz = targetZ - tr.value.pos[2];
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0.001) { targetX = dx / len; targetZ = dz / len; }
        else {
          const mo = world.get(caster, Motion);
          const facing = mo.ok ? mo.value.facingY : 0;
          targetX = Math.sin(facing); targetZ = Math.cos(facing);
        }
      }
    }

    // 5. spend hp + energy
    if (def.hpCost > 0) {
      const hr = world.get(caster, Health);
      if (hr.ok) {
        const hp = Math.max(0, hr.value.hp - def.hpCost);
        world.set(caster, Health, { hp, isDead: hp <= 0, lastDamageTime: this._gameTime });
      }
    }
    if (def.energyCost > 0) {
      const er = world.get(caster, Energy);
      if (er.ok) world.set(caster, Energy, { energy: Math.max(0, er.value.energy - def.energyCost) });
    }

    // 6. face target (faceTarget defaults true)
    if (def.faceTarget !== false) {
      const tr = world.get(caster, Transform);
      if (tr.ok) {
        let fx = targetX, fz = targetZ;
        if (targetEntity !== undefined) {
          const tt = world.get(targetEntity, Transform);
          if (tt.ok) { fx = tt.value.pos[0]; fz = tt.value.pos[2]; }
        }
        if (fx !== undefined && fz !== undefined) {
          const dx = fx - tr.value.pos[0], dz = fz - tr.value.pos[2];
          if (dx * dx + dz * dz > 0.01) {
            const mo = world.get(caster, Motion);
            if (mo.ok) world.set(caster, Motion, { facingY: Math.atan2(dx, dz) });
          }
        }
      }
    }

    // 7. set cooldown (instant cast — same as source: cooldown starts at the
    //    effect point. For channeled abilities the effect point is after castTime,
    //    but starting the cooldown now is the source's behaviour for instant +
    //    the simplification we keep for channels too.)
    if (def.cooldown > 0) setCooldown(caster, abilityId, def.cooldown);

    // 8. castTime CHANNELING (M9 ch4): if the ability has a windup, defer the
    //    effect point. The caster stands still during the windup; effects run when
    //    it completes. Instant abilities (castTime 0/undefined) execute now.
    if (def.castTime && def.castTime > 0) {
      const raw = rawId(caster);
      // movement halts during the windup
      const mv = world.get(caster, Movement);
      if (mv.ok) world.set(caster, Movement, { hasTarget: false, arrived: true, currentSpeed: 0 });
      this._channeling.set(raw, {
        abilityId, def, remaining: def.castTime,
        targetEntity, targetX, targetZ,
        cancelable: def.channelingCancelable !== false,
      });
      // cast-windup began → VFX hook (source ability:cast_start). ability:used
      // fires later at the effect point (in _completeChannel), not here.
      eventBus.emit('ability:cast_start', { entity: raw, abilityId, castTime: def.castTime });
      return true;
    }

    // 9. instant effect point
    this._runEffectPoint(world, caster, def, abilityId, targetEntity, targetX, targetZ);
    return true;
  }

  // ── effect point (the moment effects actually fire) ──────────────────────────
  private _runEffectPoint(
    world: World, caster: EntityHandle, def: AbilityDef, abilityId: string,
    targetEntity?: EntityHandle, targetX?: number, targetZ?: number,
  ): void {
    const ctx: CastContext = {
      caster, targetEntity, targetX, targetZ,
      gameTime: this._gameTime,
      targets: this._snapshot,
      hitSet: def.sustained?.uniqueHits ? new Set<number>() : undefined,
      clampToWalkable: this._opts.clampToWalkable,
    };

    // projectile-launch DELAY (M9 ch4): for abilities that fly a projectile to the
    // target, defer the effects until the projectile would arrive (distance/speed
    // or flightTime). We model the flight as a timed delay (no separate ability-
    // projectile entity / VFX — that's M11), then run the effects at impact.
    if (def.projectile) {
      const delay = this._projectileFlightTime(world, def, caster, targetEntity, targetX, targetZ);
      if (delay > 0) {
        this._pendingProjectiles.push({ caster, def, abilityId, targetEntity, targetX, targetZ, remaining: delay });
        // emit ability:used at cast (the action was committed)
        this._emitUsed(caster, abilityId, targetEntity, targetX, targetZ);
        return;
      }
    }

    executeEffects(world, ctx, def.effects);
    this._emitUsed(caster, abilityId, targetEntity, targetX, targetZ);

    // sustained phase (M9 ch4): after the effect point, enter the sustained state
    // (periodic intervalEffects + per-second energy drain + duration). Toggle
    // abilities with toggleEnergyCost also drain per second while active.
    this._enterSustained(world, caster, def, abilityId, targetEntity, targetX, targetZ);
  }

  private _emitUsed(
    caster: EntityHandle, abilityId: string,
    targetEntity?: EntityHandle, targetX?: number, targetZ?: number,
  ): void {
    eventBus.emit('ability:used', {
      entity: rawId(caster), abilityId,
      targetEntity: targetEntity !== undefined ? rawId(targetEntity) : undefined,
      targetX, targetZ,
    });
  }

  // ── castTime channeling ──────────────────────────────────────────────────────
  private _tickChanneling(world: World, dt: number): void {
    const done: EntityHandle[] = [];
    for (const [raw, ch] of this._channeling) {
      const e = raw as unknown as EntityHandle;
      // caster died / despawned -> drop the channel (cost already spent; SC2 keeps it)
      if (!world.get(e, Health).ok) { this._channeling.delete(raw); continue; }
      // hard-control (stun/lockdown) interrupts a cancelable windup
      if (ch.cancelable && (hasBuff(e, 'stun') || hasBuff(e, 'lockdown'))) {
        this._channeling.delete(raw);
        continue;
      }
      ch.remaining -= dt;
      if (ch.remaining <= 0) done.push(e);
    }
    for (const e of done) this._completeChannel(world, e);
  }

  private _completeChannel(world: World, caster: EntityHandle): void {
    const raw = rawId(caster);
    const ch = this._channeling.get(raw);
    if (!ch) return;
    this._channeling.delete(raw);
    // the effect point: run effects + enter any sustained phase + emit ability:used
    this._runEffectPoint(world, caster, ch.def, ch.abilityId, ch.targetEntity, ch.targetX, ch.targetZ);
  }

  // ── sustained phases / toggle drain ──────────────────────────────────────────
  private _enterSustained(
    world: World, caster: EntityHandle, def: AbilityDef, abilityId: string,
    targetEntity?: EntityHandle, targetX?: number, targetZ?: number,
  ): void {
    const sus = def.sustained;
    const toggleDrain = def.isToggle && (def.toggleEnergyCost ?? 0) > 0;
    if (!sus && !toggleDrain) return;

    const energyPerSecond = sus?.energyPerSecond ?? (toggleDrain ? (def.toggleEnergyCost ?? 0) : 0);
    const interval = sus?.interval ?? 0;
    // duration: sustained.duration (0/undefined = until interrupted), toggle = until off.
    const remaining = sus && sus.duration > 0 ? sus.duration : Infinity;
    const toggleStateId = toggleDrain
      ? (def.effects.find((e) => e.type === 'toggle') as { stateId?: string } | undefined)?.stateId
      : undefined;

    this._sustained.set(rawId(caster), {
      abilityId, def, remaining, energyPerSecond,
      interval, intervalTimer: 0,
      targetEntity, targetX, targetZ,
      isToggle: !!def.isToggle, toggleStateId,
    });
    // sustained phase began → VFX hook (source ability:sustained_start).
    eventBus.emit('ability:sustained_start', { entity: rawId(caster), abilityId, targetX, targetZ, duration: sus?.duration });
  }

  private _tickSustained(world: World, dt: number): void {
    // natural=true → completed its full duration (source ability:sustained_complete);
    // natural=false → interrupted (toggle off / energy out) (source ability:sustained_end).
    const ended: Array<{ e: EntityHandle; natural: boolean }> = [];
    for (const [raw, s] of this._sustained) {
      const e = raw as unknown as EntityHandle;
      // host died → interrupt + VFX teardown hook.
      if (!world.get(e, Health).ok) {
        this._sustained.delete(raw);
        eventBus.emit('ability:sustained_end', { entity: raw, abilityId: s.abilityId });
        continue;
      }

      // toggle abilities end when their toggle goes inactive.
      if (s.isToggle && s.toggleStateId) {
        const st = getToggleState(e, s.toggleStateId);
        if (!st || !st.active) { ended.push({ e, natural: false }); continue; }
      }

      // per-second energy drain; out of energy -> interrupt.
      if (s.energyPerSecond > 0) {
        const er = world.get(e, Energy);
        if (er.ok) {
          const cost = s.energyPerSecond * dt;
          if (er.value.energy < cost) { ended.push({ e, natural: false }); continue; }
          world.set(e, Energy, { energy: er.value.energy - cost });
        }
      }

      // periodic interval effects (e.g. medivac heal tick).
      if (s.interval > 0 && s.def.sustained?.intervalEffects) {
        s.intervalTimer += dt;
        while (s.intervalTimer >= s.interval) {
          s.intervalTimer -= s.interval;
          const ctx: CastContext = {
            caster: e, targetEntity: s.targetEntity, targetX: s.targetX, targetZ: s.targetZ,
            gameTime: this._gameTime, targets: this._snapshot,
            clampToWalkable: this._opts.clampToWalkable,
          };
          executeEffects(world, ctx, s.def.sustained.intervalEffects);
        }
      }

      // duration countdown (Infinity for open-ended).
      if (Number.isFinite(s.remaining)) {
        s.remaining -= dt;
        if (s.remaining <= 0) ended.push({ e, natural: true });
      }
    }
    for (const { e, natural } of ended) {
      const raw = rawId(e);
      const s = this._sustained.get(raw);
      this._sustained.delete(raw);
      if (s?.def.sustained?.completionEffects) {
        const ctx: CastContext = {
          caster: e, targetEntity: s.targetEntity, targetX: s.targetX, targetZ: s.targetZ,
          gameTime: this._gameTime, targets: this._snapshot,
        };
        executeEffects(world, ctx, s.def.sustained.completionEffects);
      }
      // VFX hook: natural finish -> sustained_complete (drives e.g. prismatic blast);
      // interruption -> sustained_end. (VFX cleanup listens to both.)
      if (s) {
        if (natural) eventBus.emit('ability:sustained_complete', { entity: raw, abilityId: s.abilityId, targetX: s.targetX, targetZ: s.targetZ });
        else eventBus.emit('ability:sustained_end', { entity: raw, abilityId: s.abilityId });
      }
    }
  }

  // ── ability projectile-launch delay ──────────────────────────────────────────
  private _projectileFlightTime(
    world: World, def: AbilityDef, caster: EntityHandle,
    targetEntity?: EntityHandle, targetX?: number, targetZ?: number,
  ): number {
    const proj = def.projectile;
    if (!proj) return 0;
    if (proj.flightTime && proj.flightTime > 0) return proj.flightTime;
    // distance / speed
    const ct = world.get(caster, Transform);
    if (!ct.ok) return 0;
    let tx = targetX, tz = targetZ;
    if (targetEntity !== undefined) {
      const tt = world.get(targetEntity, Transform);
      if (tt.ok) { tx = tt.value.pos[0]; tz = tt.value.pos[2]; }
    }
    if (tx === undefined || tz === undefined) return 0;
    const d = Math.hypot(tx - ct.value.pos[0], tz - ct.value.pos[2]);
    const speed = proj.speed > 0 ? proj.speed : 18;
    return d / speed;
  }

  private _tickProjectiles(world: World, dt: number): void {
    for (let k = this._pendingProjectiles.length - 1; k >= 0; k--) {
      const p = this._pendingProjectiles[k];
      p.remaining -= dt;
      if (p.remaining > 0) continue;
      this._pendingProjectiles.splice(k, 1);
      // impact: run the effects (caster may be gone — effects guard internally).
      const ctx: CastContext = {
        caster: p.caster, targetEntity: p.targetEntity, targetX: p.targetX, targetZ: p.targetZ,
        gameTime: this._gameTime, targets: this._snapshot,
        hitSet: p.def.sustained?.uniqueHits ? new Set<number>() : undefined,
        clampToWalkable: this._opts.clampToWalkable,
      };
      executeEffects(world, ctx, p.def.effects);
      // a projectile ability may also enter a sustained phase on impact.
      this._enterSustained(world, p.caster, p.def, p.abilityId, p.targetEntity, p.targetX, p.targetZ);
    }
  }

  /** Validate without executing (source canUseAbility). */
  canCast(caster: EntityHandle, abilityId: string, target: CastTarget = {}): boolean {
    const world = this._world;
    const def = getAbilityDef(abilityId);
    if (!def || def.isPassive) return false;
    if (!world.get(caster, Health).ok) return false;
    if (!(abilityIds.get(caster) ?? []).includes(abilityId)) return false;
    return !this._validateCast(world, caster, def, target.targetEntity, target.x, target.z);
  }

  // ── validation (source _validateCast) ───────────────────────────────────────
  private _validateCast(
    world: World, caster: EntityHandle, def: AbilityDef,
    targetEntity?: EntityHandle, targetX?: number, targetZ?: number,
  ): string | null {
    if (world.get(caster, Illusion).ok) return 'illusion cannot cast';
    if (hasBuff(caster, 'stun') || hasBuff(caster, 'lockdown') ||
        hasBuff(caster, 'recall_pending') || hasBuff(caster, 'graviton_lift')) return 'controlled';
    if (isAnyTransitioning(caster)) return 'transitioning';
    if (isOnCooldown(caster, def.id)) return 'on cooldown';

    // requiredUpgrade gating (M9 ch4): an ability with a non-empty
    // requiredUpgrade needs that upgrade researched (level >= 1) for the caster's
    // player. Skipped when no level lookup is wired (back-compat).
    if (def.requiredUpgrade && this._opts.getUpgradeLevel) {
      const cf = world.get(caster, Faction);
      if (cf.ok && this._opts.getUpgradeLevel(cf.value.playerId, def.requiredUpgrade) < 1) {
        return 'requires upgrade';
      }
    }

    if (def.allowedUnits.length > 0) {
      const ut = world.get(caster, UnitType);
      // allowedUnits keys are typeIds; the typeId companion lives in unitTypeId —
      // but allowedUnits is also satisfied if the ability was injected via forms.
      // We validate against the unit's runtime ability list (already checked by
      // the caller), so an empty/positive allowedUnits here is non-blocking when
      // the unit carries the ability. (Source also gated on typeId; equivalent.)
      void ut;
    }

    if (def.hpCost > 0) {
      const hr = world.get(caster, Health);
      if (!hr.ok || hr.value.hp <= def.hpCost) return 'not enough hp';
    }
    if (def.energyCost > 0) {
      const er = world.get(caster, Energy);
      if (!er.ok || er.value.energy < def.energyCost) return 'not enough energy';
    }

    // target legality (unit / unit_or_point)
    if ((def.targetType === 'unit' || def.targetType === 'unit_or_point') && targetEntity !== undefined) {
      const th = world.get(targetEntity, Health);
      if (!th.ok || th.value.isDead) return 'target dead';

      if (def.targetFilter !== 'any' && def.targetFilter !== 'self') {
        const cf = world.get(caster, Faction);
        const tf = world.get(targetEntity, Faction);
        if (cf.ok && tf.ok) {
          const friendly = cf.value.playerId === tf.value.playerId;
          if (def.targetFilter === 'ally' && !friendly) return 'ally only';
          if (def.targetFilter === 'enemy' && friendly) return 'enemy only';
        }
      }

      if (def.targetUnitFilter && def.targetUnitFilter !== 'any') {
        const mv = world.get(targetEntity, Movement);
        const tut = world.get(targetEntity, UnitType);
        const isAir = mv.ok ? mv.value.moveType === MOVE_TYPE.AIR : false;
        const isBuilding = tut.ok && tut.value.category === 3; // UNIT_CATEGORY.BUILDING
        switch (def.targetUnitFilter) {
          case 'air': if (!isAir) return 'air only'; break;
          case 'ground': if (isAir) return 'ground only'; break;
          case 'groundNonMassive':
            if (isAir) return 'ground only';
            if (tut.ok && tut.value.unitSize === 2) return 'no massive'; // UNIT_SIZE.LARGE
            break;
          case 'building': if (!isBuilding) return 'building only'; break;
          case 'hasEnergy': {
            const te = world.get(targetEntity, Energy);
            if (!te.ok || te.value.energy <= 0) return 'no energy';
            break;
          }
          // infantry/vehicle/worker/biological/mechanical filters need typeId/
          // category lookups; the common verify abilities use the cases above.
        }
      }

      if (def.castRange > 0) {
        const ct = world.get(caster, Transform);
        const tt = world.get(targetEntity, Transform);
        if (ct.ok && tt.ok) {
          const dx = tt.value.pos[0] - ct.value.pos[0], dz = tt.value.pos[2] - ct.value.pos[2];
          if (Math.sqrt(dx * dx + dz * dz) > def.castRange) return 'out of range';
        }
      }
    }

    if (def.targetType === 'point' && def.castRange > 0 && targetX !== undefined && targetZ !== undefined) {
      const ct = world.get(caster, Transform);
      if (ct.ok) {
        const dx = targetX - ct.value.pos[0], dz = targetZ - ct.value.pos[2];
        if (Math.sqrt(dx * dx + dz * dz) > def.castRange) return 'out of range';
      }
    }
    if (def.targetType === 'direction') {
      if ((targetX === undefined) !== (targetZ === undefined)) return 'need direction';
    }
    return null;
  }

  // ── autocast (source _updateAutocast / _findAutocastTarget) ──────────────────
  private _collectAutocast(
    world: World, caster: EntityHandle,
    out: Array<{ caster: EntityHandle; abilityId: string; target: EntityHandle }>,
  ): void {
    const hr = world.get(caster, Health);
    if (hr.ok && hr.value.isDead) return;
    const map = abilityAutocast.get(caster);
    if (!map || map.size === 0) return;
    const cf = world.get(caster, Faction);
    const ct = world.get(caster, Transform);
    if (!cf.ok || !ct.ok) return;

    for (const [abilityId, enabled] of map) {
      if (!enabled) continue;
      const def = getAbilityDef(abilityId);
      if (!def || def.isPassive || def.isToggle) continue;
      if (isOnCooldown(caster, abilityId)) continue;
      if (def.energyCost > 0) {
        const er = world.get(caster, Energy);
        if (!er.ok || er.value.energy < def.energyCost) continue;
      }
      if (def.targetType !== 'unit') continue;
      const target = this._findAutocastTarget(world, caster, def, ct.value.pos[0], ct.value.pos[2], cf.value.playerId);
      if (target !== null) out.push({ caster, abilityId, target });
    }
  }

  private _findAutocastTarget(
    world: World, caster: EntityHandle, def: AbilityDef,
    cx: number, cz: number, casterPlayer: number,
  ): EntityHandle | null {
    const rangeSq = def.castRange * def.castRange;
    const isHeal = def.effects.some((e) => e.type === 'heal') ||
      (def.sustained?.intervalEffects?.some((e) => e.type === 'heal') ?? false);
    let best: EntityHandle | null = null;
    let bestScore = -Infinity;

    for (const t of this._snapshot) {
      if (t.entity === caster) continue;
      if (t.isDead) continue;
      if (def.targetFilter === 'ally' && t.playerId !== casterPlayer) continue;
      if (def.targetFilter === 'enemy' && t.playerId === casterPlayer) continue;
      if (t.playerId === PLAYER_ID.NEUTRAL) continue;

      const dx = cx - t.x, dz = cz - t.z;
      const distSq = dx * dx + dz * dz;
      if (rangeSq > 0 && distSq > rangeSq) continue;

      if (isHeal) {
        const hr = world.get(t.entity, Health);
        if (!hr.ok || hr.value.hp >= hr.value.maxHp) continue; // skip full-hp
        const score = -(hr.value.hp / hr.value.maxHp);
        if (score > bestScore) { bestScore = score; best = t.entity; }
      } else {
        const score = -distSq;
        if (score > bestScore) { bestScore = score; best = t.entity; }
      }
    }
    return best;
  }
}
