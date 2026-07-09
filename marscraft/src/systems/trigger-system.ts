/**
 * MarsCraft -> forgeax-engine — TriggerSystem (Milestone M9 chunk 4)
 * =============================================================================
 * Port of the Three.js source `web/systems/TriggerSystem.ts` — reactive effect
 * evaluation + execution + passive auto-activation.
 *
 * Responsibilities (1:1 with source):
 *   1. Subscribe to the EventBus reactive events (ability:used, combat:attack_hit,
 *      combat:damage, combat:damage_taken, combat:kill, ability:buff_applied,
 *      ability:buff_removed).
 *   2. For each event, collect every trigger on the involved entity whose `event`
 *      matches — from BUFF-level triggers (ActiveBuff.triggers) AND ABILITY-level
 *      triggers (AbilityDef.triggers on the unit's abilityIds; passives must be
 *      activated). Evaluate each trigger's conditions (AND); on pass, build a
 *      CastContext and run its effects via the effect-executor. Honor a per-trigger
 *      cooldown (buff-level via ActiveBuff.triggerCooldowns, ability-level via
 *      abilityTriggerCooldowns).
 *   3. Tick down all trigger cooldowns each frame.
 *   4. Tick `on_interval` triggers (timed, not event-driven).
 *   5. Passive auto-activation: a passive ability (isPassive) activates when its
 *      requiredUpgrade is met (or empty); on activation its effects run once
 *      (usually an apply_buff with the actual triggers).
 *
 * ── forgeax adaptation ───────────────────────────────────────────────────────
 *   - The source kept per-unit ability runtime on the CAbilities class; here it
 *     lives in the M2 Map companions (abilityBuffs / abilityIds /
 *     abilityActivatedPassives / abilityTriggerCooldowns). Methods become reads of
 *     those companions.
 *   - EventBus ids are RAW numbers; converted to EntityHandle at the boundary via
 *     `world.get(...).ok` liveness checks (no `world.isAlive`).
 *   - `world.query(...)` (for nearby_unit_count + per-frame cooldown ticks) has no
 *     ad-hoc equivalent: the per-frame system iterates the Abilities query batches,
 *     and nearby_unit_count scans the AbilitySystem's per-frame combat snapshot.
 *   - Effects never spawn/despawn here directly (they funnel to the effect-executor
 *     whose summon path collects-then-spawns); event handlers run synchronously off
 *     the bus emit, which fires from inside systems — safe because emit happens at
 *     the END of a per-entity step (after the damage write), not mid batch-mutation.
 */

import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Entity } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Abilities, Health, Energy, UnitType, Faction, UnitStats,
  abilityBuffs, abilityIds, abilityActivatedPassives, abilityTriggerCooldowns,
  unitTypeId,
  type ActiveBuff,
} from '../components';
import {
  getAbilityDef,
  type TriggerDef, type TriggerCondition, type TriggerEvent, type TriggerEffectTarget,
  type AbilityEffect,
} from '../data/abilities';
import { executeEffects, type CastContext } from './effect-executor';
import { hasBuff } from './abilities-runtime';
import { eventBus, type GameEvents } from '../core/event-bus';
import type { UpgradeManagerHandle } from './upgrade-manager';
import type { OutOfCombatHandle } from './out-of-combat';
import type { CreepHandle } from './creep-system';
import type { CombatTarget } from './combat-registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const rawId = (e: EntityHandle): number => e as unknown as number;
const toHandle = (raw: number): EntityHandle => raw as unknown as EntityHandle;

/** Deterministic RNG for `probability` conditions (mulberry32). */
let _rng = 0x1234abcd >>> 0;
function triggerRandom(): number {
  _rng = (_rng + 0x6d2b79f5) >>> 0;
  let t = _rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

interface TriggerCandidate {
  trigger: TriggerDef;
  ownerEntity: EntityHandle;
  ownerBuff?: ActiveBuff;
  eventOtherEntity?: EntityHandle;
}

export interface TriggerSystemDeps {
  upgradeManager?: UpgradeManagerHandle | null;
  outOfCombat?: OutOfCombatHandle | null;
  creep?: CreepHandle | null;
  /** Live per-frame combat snapshot (for nearby_unit_count). */
  combatSnapshot?: () => readonly CombatTarget[];
}

export interface TriggerSystemHandle {
  /** Inspect an entity's passives + triggers (verify hook). */
  probe(entity: EntityHandle): {
    abilityIds: string[];
    activatedPassives: string[];
    triggers: Array<{ source: string; id: string; event: string; onCooldown: boolean }>;
  };
}

export class TriggerSystem implements TriggerSystemHandle {
  private _world!: World;
  private _gameTime = 0;
  private readonly _deps: TriggerSystemDeps;
  /** on_interval timers, keyed `${rawId}:${triggerId}`. */
  private readonly _intervalTimers = new Map<string, number>();

  // bound handlers (stable refs for off())
  private readonly _onAbilityCast = (d: GameEvents['ability:used']) =>
    this._evaluate(toHandle(d.entity), 'on_ability_cast', d.targetEntity !== undefined ? toHandle(d.targetEntity) : undefined, d);
  private readonly _onAttackHit = (d: GameEvents['combat:attack_hit']) =>
    this._evaluate(toHandle(d.attacker), 'on_attack_hit', toHandle(d.target), d);
  private readonly _onDamageDealt = (d: GameEvents['combat:damage']) =>
    this._evaluate(toHandle(d.attacker), 'on_damage_dealt', toHandle(d.target), d);
  private readonly _onDamageTaken = (d: GameEvents['combat:damage_taken']) =>
    this._evaluate(toHandle(d.target), 'on_damage_taken', toHandle(d.attacker), d);
  private readonly _onKill = (d: GameEvents['combat:kill']) => {
    // on_death (victim's triggers) — victim may already be flagged dead but its
    // components are still live (DeathSystem emits before despawn).
    this._evaluate(toHandle(d.victim), 'on_death', d.killer ? toHandle(d.killer) : undefined, d, true);
    // on_kill (killer's triggers)
    if (d.killer !== 0) this._evaluate(toHandle(d.killer), 'on_kill', toHandle(d.victim), d);
  };
  private readonly _onBuffApplied = (d: GameEvents['ability:buff_applied']) =>
    this._evaluate(toHandle(d.entity), 'on_buff_applied', undefined, d);
  private readonly _onBuffExpired = (d: GameEvents['ability:buff_removed']) =>
    this._evaluate(toHandle(d.entity), 'on_buff_expired', undefined, d);

  constructor(deps: TriggerSystemDeps = {}) { this._deps = deps; }

  install(world: World): TriggerSystemHandle {
    this._world = world;

    eventBus.on('ability:used', this._onAbilityCast);
    eventBus.on('combat:attack_hit', this._onAttackHit);
    eventBus.on('combat:damage', this._onDamageDealt);
    eventBus.on('combat:damage_taken', this._onDamageTaken);
    eventBus.on('combat:kill', this._onKill);
    eventBus.on('ability:buff_applied', this._onBuffApplied);
    eventBus.on('ability:buff_removed', this._onBuffExpired);

    world.addSystem({
      name: 'mc-trigger-system',
      queries: [{ with: [Entity, Abilities] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        this._gameTime += world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        const batches = qr[0] as unknown as Batch[];

        // 1. passive auto-activation
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) this._activatePassives(b.Entity.self[i] as EntityHandle);
        }
        // 2. tick trigger cooldowns
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) this._tickCooldowns(b.Entity.self[i] as EntityHandle, dt);
        }
        // 3. on_interval triggers
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) this._tickIntervalTriggers(b.Entity.self[i] as EntityHandle, dt);
        }
      },
    });

    return this;
  }

  destroy(): void {
    eventBus.off('ability:used', this._onAbilityCast);
    eventBus.off('combat:attack_hit', this._onAttackHit);
    eventBus.off('combat:damage', this._onDamageDealt);
    eventBus.off('combat:damage_taken', this._onDamageTaken);
    eventBus.off('combat:kill', this._onKill);
    eventBus.off('ability:buff_applied', this._onBuffApplied);
    eventBus.off('ability:buff_removed', this._onBuffExpired);
  }

  // ── passive auto-activation ──────────────────────────────────────────────────
  private _activatePassives(entity: EntityHandle): void {
    const ids = abilityIds.get(entity);
    if (!ids || ids.length === 0) return;
    let activated = abilityActivatedPassives.get(entity);
    for (const abilityId of ids) {
      const def = getAbilityDef(abilityId);
      if (!def || !def.isPassive) continue;
      if (activated?.has(abilityId)) continue;
      // requiredUpgrade gate: empty => active on creation; else needs the upgrade.
      if (def.requiredUpgrade) {
        const mgr = this._deps.upgradeManager;
        if (!mgr) continue;
        const cf = this._world.get(entity, Faction);
        if (!cf.ok || mgr.getLevel(cf.value.playerId, def.requiredUpgrade) < 1) continue;
      }
      if (!activated) { activated = new Set<string>(); abilityActivatedPassives.set(entity, activated); }
      activated.add(abilityId);
      // run the passive's one-shot effects (usually apply_buff + triggers).
      if (def.effects.length > 0) {
        const ctx: CastContext = {
          caster: entity, targetEntity: entity,
          gameTime: this._gameTime,
          targets: this._deps.combatSnapshot?.(),
        };
        executeEffects(this._world, ctx, def.effects);
      }
    }
  }

  // ── core evaluate ────────────────────────────────────────────────────────────
  private _evaluate(
    entity: EntityHandle, eventType: TriggerEvent,
    eventOther: EntityHandle | undefined, eventData: unknown, skipAlive = false,
  ): void {
    const world = this._world;
    if (!skipAlive && !world.get(entity, Health).ok) return;
    if (!world.get(entity, Abilities).ok) return;

    const candidates = this._collect(entity, eventType, eventOther);
    for (const c of candidates) this._evaluateAndExecute(c, eventData);
  }

  private _collect(
    entity: EntityHandle, eventType: TriggerEvent, eventOther?: EntityHandle,
  ): TriggerCandidate[] {
    const out: TriggerCandidate[] = [];

    // source 1: buff-level triggers
    for (const buff of abilityBuffs.get(entity) ?? []) {
      const triggers = buff.triggers as TriggerDef[] | undefined;
      if (!triggers) continue;
      for (const trigger of triggers) {
        if (trigger.event === eventType) out.push({ trigger, ownerEntity: entity, ownerBuff: buff, eventOtherEntity: eventOther });
      }
    }
    // source 2: ability-level triggers (passives must be activated)
    const activated = abilityActivatedPassives.get(entity);
    for (const abilityId of abilityIds.get(entity) ?? []) {
      const def = getAbilityDef(abilityId);
      if (!def?.triggers) continue;
      if (def.isPassive && !activated?.has(abilityId)) continue;
      for (const trigger of def.triggers) {
        if (trigger.event === eventType) out.push({ trigger, ownerEntity: entity, eventOtherEntity: eventOther });
      }
    }
    return out;
  }

  private _evaluateAndExecute(c: TriggerCandidate, eventData: unknown): void {
    const world = this._world;
    const { trigger, ownerEntity, ownerBuff, eventOtherEntity } = c;

    // 1. cooldown gate
    if (trigger.cooldown && trigger.cooldown > 0) {
      if (ownerBuff?.triggerCooldowns) {
        if ((ownerBuff.triggerCooldowns.get(trigger.id) ?? 0) > 0) return;
      } else {
        const m = abilityTriggerCooldowns.get(ownerEntity);
        if (m && (m.get(trigger.id) ?? 0) > 0) return;
      }
    }

    // 2. conditions (AND)
    if (trigger.conditions) {
      for (const cond of trigger.conditions) {
        if (!this._evalCondition(ownerEntity, eventOtherEntity, cond, eventData)) return;
      }
    }

    // 3. effect target
    const effectTargetEntity = this._resolveTarget(trigger.effectTarget, ownerEntity, eventOtherEntity);

    // 4. context (fill target pos so area effects center correctly)
    let tx: number | undefined, tz: number | undefined;
    if (effectTargetEntity !== undefined) {
      const tt = world.get(effectTargetEntity, Transform);
      if (tt.ok) { tx = tt.value.pos[0]; tz = tt.value.pos[2]; }
    }
    const ctx: CastContext = {
      caster: ownerEntity, targetEntity: effectTargetEntity, targetX: tx, targetZ: tz,
      gameTime: this._gameTime, targets: this._deps.combatSnapshot?.(),
    };

    // 5. execute
    executeEffects(world, ctx, trigger.effects as AbilityEffect[]);

    // 6. set cooldown
    if (trigger.cooldown && trigger.cooldown > 0) {
      if (ownerBuff?.triggerCooldowns) {
        ownerBuff.triggerCooldowns.set(trigger.id, trigger.cooldown);
      } else {
        let m = abilityTriggerCooldowns.get(ownerEntity);
        if (!m) { m = new Map<string, number>(); abilityTriggerCooldowns.set(ownerEntity, m); }
        m.set(trigger.id, trigger.cooldown);
      }
    }
  }

  // ── conditions ───────────────────────────────────────────────────────────────
  private _evalCondition(
    owner: EntityHandle, other: EntityHandle | undefined,
    cond: TriggerCondition, eventData: unknown,
  ): boolean {
    const world = this._world;
    const ed = eventData as Record<string, unknown> | undefined;
    switch (cond.type) {
      case 'ability_id': return ed?.abilityId === cond.abilityId;
      case 'buff_id': return ed?.buffId === cond.buffId;
      case 'unit_type': {
        const ut = unitTypeStr(world, owner);
        return ut !== undefined && cond.typeIds.includes(ut);
      }
      case 'target_type': {
        if (other === undefined) return false;
        const ut = unitTypeStr(world, other);
        return ut !== undefined && cond.typeIds.includes(ut);
      }
      case 'has_buff': return hasBuff(owner, cond.buffId);
      case 'no_buff': return !hasBuff(owner, cond.buffId);
      case 'hp_below': { const h = world.get(owner, Health); return h.ok && h.value.maxHp > 0 && (h.value.hp / h.value.maxHp) < cond.percent; }
      case 'hp_above': { const h = world.get(owner, Health); return h.ok && h.value.maxHp > 0 && (h.value.hp / h.value.maxHp) > cond.percent; }
      case 'shield_below': { const h = world.get(owner, Health); return h.ok && h.value.maxShield > 0 && (h.value.shield / h.value.maxShield) < cond.percent; }
      case 'shield_above': { const h = world.get(owner, Health); return h.ok && h.value.maxShield > 0 && (h.value.shield / h.value.maxShield) > cond.percent; }
      case 'probability': return triggerRandom() < cond.chance;
      case 'upgrade_level': {
        const mgr = this._deps.upgradeManager;
        if (!mgr) return false;
        const cf = world.get(owner, Faction);
        return cf.ok && mgr.getLevel(cf.value.playerId, cond.upgradeId) >= cond.min;
      }
      case 'is_on_creep': {
        const creep = this._deps.creep;
        if (!creep) return false;
        const t = world.get(owner, Transform);
        return t.ok && creep.isOnCreep(t.value.pos[0], t.value.pos[2]);
      }
      case 'is_out_of_combat': {
        const ooc = this._deps.outOfCombat;
        return ooc ? ooc.isOutOfCombat(owner, cond.thresholdSec ?? 5) : false;
      }
      case 'target_combat_type': {
        if (other === undefined) return false;
        const ut = world.get(other, UnitType);
        return ut.ok && cond.combatTypes.includes(COMBAT_NAMES[ut.value.combatType] ?? '');
      }
      case 'nearby_unit_count': {
        const t = world.get(owner, Transform);
        if (!t.ok) return false;
        const ownerFac = world.get(owner, Faction);
        const snap = this._deps.combatSnapshot?.() ?? [];
        const r2 = cond.radius * cond.radius;
        let count = 0;
        for (const cand of snap) {
          if (cand.entity === owner) continue;
          if (cand.isDead) continue;
          const dx = cand.x - t.value.pos[0], dz = cand.z - t.value.pos[2];
          if (dx * dx + dz * dz > r2) continue;
          if (cond.filter !== 'any' && ownerFac.ok) {
            if (cond.filter === 'ally' && cand.playerId !== ownerFac.value.playerId) continue;
            if (cond.filter === 'enemy' && cand.playerId === ownerFac.value.playerId) continue;
          }
          count++;
        }
        if (cond.min !== undefined && count < cond.min) return false;
        if (cond.max !== undefined && count > cond.max) return false;
        return true;
      }
      case 'stat_check': {
        const checkEntity = cond.target === 'target' ? other : owner;
        if (checkEntity === undefined) return false;
        const val = this._statValue(checkEntity, cond.stat, cond.percent !== undefined);
        if (val === null) return false;
        const cmp = cond.percent !== undefined ? cond.percent / 100 : (cond.value ?? 0);
        switch (cond.op) {
          case '>=': return val >= cmp;
          case '<=': return val <= cmp;
          case '>': return val > cmp;
          case '<': return val < cmp;
          case '==': return Math.abs(val - cmp) < 0.001;
          default: return false;
        }
      }
      default: return false;
    }
  }

  private _statValue(entity: EntityHandle, stat: string, asPercent: boolean): number | null {
    const world = this._world;
    switch (stat) {
      case 'hp': { const h = world.get(entity, Health); if (!h.ok) return null; return asPercent ? (h.value.maxHp > 0 ? h.value.hp / h.value.maxHp : 0) : h.value.hp; }
      case 'shield': { const h = world.get(entity, Health); if (!h.ok) return null; return asPercent ? (h.value.maxShield > 0 ? h.value.shield / h.value.maxShield : 0) : h.value.shield; }
      case 'energy': { const e = world.get(entity, Energy); if (!e.ok) return null; return asPercent ? (e.value.maxEnergy > 0 ? e.value.energy / e.value.maxEnergy : 0) : e.value.energy; }
    }
    const s = world.get(entity, UnitStats);
    if (!s.ok) return null;
    const sv = s.value;
    switch (stat) {
      case 'armor': return sv.finalArmor;
      case 'damage': return sv.finalDamage;
      case 'range': return sv.finalRange;
      case 'moveSpeed': return sv.finalMoveSpeed;
      case 'attackCooldown': return sv.finalAttackCooldown;
      case 'visionRange': return sv.finalVisionRange;
      case 'splashRadius': return sv.finalSplashRadius;
      case 'maxHp': return sv.finalMaxHp;
      case 'maxShield': return sv.finalMaxShield;
      case 'maxEnergy': return sv.finalMaxEnergy;
      case 'energyRegen': return sv.finalEnergyRegen;
      case 'shieldRegen': return sv.finalShieldRegen;
      case 'shieldArmor': return sv.finalShieldArmor;
      case 'damageTakenMult': return sv.finalDamageTakenMult;
      case 'healPowerMult': return sv.finalHealPowerMult;
      case 'healRateMult': return sv.finalHealRateMult;
      default: return null;
    }
  }

  private _resolveTarget(
    effectTarget: TriggerEffectTarget, owner: EntityHandle, other?: EntityHandle,
  ): EntityHandle | undefined {
    switch (effectTarget) {
      case 'self': return owner;
      case 'event_target': return other;
      case 'event_source': return other;
      default: return owner;
    }
  }

  // ── per-frame cooldown + interval ticks ──────────────────────────────────────
  private _tickCooldowns(entity: EntityHandle, dt: number): void {
    for (const buff of abilityBuffs.get(entity) ?? []) {
      if (!buff.triggerCooldowns) continue;
      for (const [id, rem] of buff.triggerCooldowns) {
        const v = rem - dt;
        if (v <= 0) buff.triggerCooldowns.delete(id); else buff.triggerCooldowns.set(id, v);
      }
    }
    const m = abilityTriggerCooldowns.get(entity);
    if (m) {
      for (const [id, rem] of m) {
        const v = rem - dt;
        if (v <= 0) m.delete(id); else m.set(id, v);
      }
    }
  }

  private _tickIntervalTriggers(entity: EntityHandle, dt: number): void {
    // buff-level interval triggers
    for (const buff of abilityBuffs.get(entity) ?? []) {
      const triggers = buff.triggers as TriggerDef[] | undefined;
      if (!triggers) continue;
      for (const trigger of triggers) {
        if (trigger.event !== 'on_interval') continue;
        this._tickOneInterval(entity, trigger, buff, dt);
      }
    }
    // ability-level interval triggers (passives must be activated)
    const activated = abilityActivatedPassives.get(entity);
    for (const abilityId of abilityIds.get(entity) ?? []) {
      const def = getAbilityDef(abilityId);
      if (!def?.triggers) continue;
      if (def.isPassive && !activated?.has(abilityId)) continue;
      for (const trigger of def.triggers) {
        if (trigger.event !== 'on_interval') continue;
        this._tickOneInterval(entity, trigger, undefined, dt);
      }
    }
  }

  private _tickOneInterval(entity: EntityHandle, trigger: TriggerDef, ownerBuff: ActiveBuff | undefined, dt: number): void {
    const interval = trigger.interval ?? 1;
    const key = `${rawId(entity)}:${trigger.id}`;
    const elapsed = (this._intervalTimers.get(key) ?? 0) + dt;
    if (elapsed >= interval) {
      this._intervalTimers.set(key, elapsed - interval);
      this._evaluateAndExecute({ trigger, ownerEntity: entity, ownerBuff, eventOtherEntity: undefined }, undefined);
    } else {
      this._intervalTimers.set(key, elapsed);
    }
  }

  // ── verify hook ──────────────────────────────────────────────────────────────
  probe(entity: EntityHandle): {
    abilityIds: string[];
    activatedPassives: string[];
    triggers: Array<{ source: string; id: string; event: string; onCooldown: boolean }>;
  } {
    const ids = abilityIds.get(entity) ?? [];
    const activated = abilityActivatedPassives.get(entity);
    const acdMap = abilityTriggerCooldowns.get(entity);
    const triggers: Array<{ source: string; id: string; event: string; onCooldown: boolean }> = [];
    for (const buff of abilityBuffs.get(entity) ?? []) {
      const ts = buff.triggers as TriggerDef[] | undefined;
      if (!ts) continue;
      for (const t of ts) triggers.push({ source: `buff:${buff.id}`, id: t.id, event: t.event, onCooldown: (buff.triggerCooldowns?.get(t.id) ?? 0) > 0 });
    }
    for (const abilityId of ids) {
      const def = getAbilityDef(abilityId);
      if (!def?.triggers) continue;
      const active = !def.isPassive || (activated?.has(abilityId) ?? false);
      for (const t of def.triggers) triggers.push({ source: `ability:${abilityId}${active ? '' : '(inactive)'}`, id: t.id, event: t.event, onCooldown: (acdMap?.get(t.id) ?? 0) > 0 });
    }
    return { abilityIds: ids, activatedPassives: activated ? [...activated] : [], triggers };
  }
}

/** combat-type code -> source string (matches damage triangle keys). */
const COMBAT_NAMES: Record<number, string> = { 0: 'bio', 1: 'armored', 2: 'psionic', 3: 'void', 4: 'structure' };

/** Resolve a unit's typeId string companion (for unit_type / target_type). */
function unitTypeStr(_world: World, e: EntityHandle): string | undefined {
  return unitTypeId.get(e);
}
