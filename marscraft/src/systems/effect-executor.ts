/**
 * MarsCraft -> forgeax-engine — ability effect executor (Milestone M9)
 * =============================================================================
 * Port of the Three.js source `web/systems/EffectExecutor.ts`.
 *
 * `executeEffect(world, ctx, effect)` applies one atomic ability effect. The
 * cast pipeline (ability-system.ts) calls `executeEffects(...)` with the
 * AbilityDef.effects after validation + energy spend + cooldown set.
 *
 * EFFECT SCOPE FOR THIS M9 CHUNK
 * ------------------------------
 * REAL (fully ported, no later systems needed):
 *   damage, heal, energy drain (energy+hp), modify_energy, restore_shield,
 *   apply_buff, apply_debuff, remove_buff, stun, toggle, cloak, decloak,
 *   teleport, knockback, area_damage, area_effect, kill_self.
 * SEAMS (clearly marked: no-op + console.debug; need not-yet-ported systems):
 *   spawn_unit, morph, recall, spawn_hazard, spawn_ground_effect,
 *   spawn_direction_wave, transport_load, transport_unload, form_switch.
 * These seams are reached only by abilities outside this chunk's verified set;
 * they degrade gracefully (no crash) rather than fake an effect.
 *
 * Damage funnels through M6's `resolveDamage` (unified pipeline). Area effects
 * use M6's `resolveArea` over a per-frame CombatTarget[] snapshot carried on the
 * CastContext (forgeax has no ad-hoc World query; the ability system supplies the
 * snapshot it already builds each frame).
 */

import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform,
} from '@forgeax/engine-scene';
import {
  Health, Energy, Movement, Faction, UnitType, UnitStats,
  type CombatTypeCode,
} from '../components';
import type {
  AbilityEffect, DamageEffect, HealEffect, ApplyBuffEffect, ApplyDebuffEffect,
  RemoveBuffEffect, StunEffect, DrainEffect, ToggleEffect, KnockbackEffect,
  ModifyEnergyEffect, RestoreShieldEffect, AreaDamageEffect, AreaEffectDef,
  CloakEffect, DecloakEffect, TeleportEffect, FormSwitchEffect, MorphEffect,
  SpawnGroundEffectEffect, SpawnHazardEffect, SpawnUnitEffect, RecallEffect,
  SpawnDirectionWaveEffect,
} from '../data/abilities';
import { resolveDamage, applyDamageToHealth } from './damage-resolver';
import { resolveArea } from './splash-resolver';
import type { CombatTarget } from './combat-registry';
import {
  addBuff, removeBuff, removeAllDebuffs, makeBuff,
  ensureToggleState,
} from './abilities-runtime';
import { eventBus } from '../core/event-bus';

/** Cast context — passed through the whole effect tree for one cast. */
export interface CastContext {
  caster: EntityHandle;
  targetEntity?: EntityHandle;
  targetX?: number;
  targetZ?: number;
  gameTime: number;
  /** Per-frame combat-target snapshot (for area_effect/area_damage). */
  targets?: readonly CombatTarget[];
  /** Per-cast unique-hit dedupe set (raw entity ids). */
  hitSet?: Set<number>;
  /** Optional walkable clamp for teleport landing. */
  clampToWalkable?: (x: number, z: number) => { x: number; z: number };
}

const rawId = (e: EntityHandle): number => e as unknown as number;

// ── M9 ch2 effect handlers (wired in main.ts; null = seam fallback) ───────────
// The `form_switch` / `morph` effect types previously degraded to a console.debug
// no-op (M9 ch1 seam). M9 ch2 ports the FormSwitchSystem + UnitMorphSystem; these
// optional handlers let the executor drive them without importing the systems
// (avoids a cycle). When unset, the effect still degrades gracefully.
let _formSwitchHandler: ((world: World, entity: EntityHandle, formId: string) => void) | null = null;
let _morphHandler: ((world: World, entity: EntityHandle, targetTypeId: string) => void) | null = null;

/** Wire the form_switch effect to the FormSwitchSystem. */
export function setFormSwitchHandler(fn: (world: World, entity: EntityHandle, formId: string) => void): void {
  _formSwitchHandler = fn;
}
/** Wire the morph effect to the UnitMorphSystem. */
export function setMorphHandler(fn: (world: World, entity: EntityHandle, targetTypeId: string) => void): void {
  _morphHandler = fn;
}

// ── M9 ch3 effect handlers (wired in main.ts; null = seam fallback) ───────────
// spawn_ground_effect / spawn_hazard / spawn_unit (summon) / transport_load /
// transport_unload / recall: M9 ch1+ch2 left these as console.debug no-ops. M9
// ch3 ports their systems; these optional handlers let the executor drive them
// without importing the systems (avoids a cycle). Unset = graceful no-op.
export interface GroundEffectSpawnReq {
  typeId: string; x: number; z: number; playerId: number; radius: number; duration: number; casterEntity?: EntityHandle;
}
export interface HazardSpawnReq {
  hazardTypeId: string; x: number; z: number; playerId: number; casterEntity: EntityHandle;
  hp: number; duration: number; shape: 'circle' | 'arc' | 'line'; radius: number;
  angle?: number; width?: number; height?: number;
  blocksMovement?: boolean; blocksProjectiles?: boolean; blocksAllFactions?: boolean;
  dirX?: number; dirZ?: number; areaEffects?: AbilityEffect[]; areaInterval?: number;
}
export interface SummonReq {
  unitTypeId: string; count: number; x: number; z: number; playerId: number;
  casterEntity: EntityHandle; lifetime?: number; autoAttackTarget?: EntityHandle;
  damageTakenMultiplier?: number; damageDealtMultiplier?: number; inheritCasterStats?: boolean;
}
let _groundEffectHandler: ((req: GroundEffectSpawnReq) => void) | null = null;
let _hazardHandler: ((req: HazardSpawnReq) => void) | null = null;
let _summonHandler: ((req: SummonReq) => void) | null = null;
let _transportLoadHandler: ((world: World, carrier: EntityHandle, unit: EntityHandle) => void) | null = null;
let _transportUnloadHandler: ((world: World, carrier: EntityHandle) => void) | null = null;
let _recallHandler: ((world: World, caster: EntityHandle, x: number, z: number, radius: number) => void) | null = null;

/** spawn_direction_wave (sonar pulse): a traveling corridor wave. */
export interface DirectionWaveSpawnReq {
  casterEntity: EntityHandle; playerId: number; x: number; z: number;
  dirX: number; dirZ: number; speed: number; maxRange: number; width: number;
  hitEffects: AbilityEffect[]; revealRange?: number; revealDuration?: number;
}
let _directionWaveHandler: ((req: DirectionWaveSpawnReq) => void) | null = null;
export function setDirectionWaveHandler(fn: (req: DirectionWaveSpawnReq) => void): void { _directionWaveHandler = fn; }

export function setGroundEffectHandler(fn: (req: GroundEffectSpawnReq) => void): void { _groundEffectHandler = fn; }
export function setHazardHandler(fn: (req: HazardSpawnReq) => void): void { _hazardHandler = fn; }
export function setSummonHandler(fn: (req: SummonReq) => void): void { _summonHandler = fn; }
export function setTransportLoadHandler(fn: (world: World, carrier: EntityHandle, unit: EntityHandle) => void): void { _transportLoadHandler = fn; }
export function setTransportUnloadHandler(fn: (world: World, carrier: EntityHandle) => void): void { _transportUnloadHandler = fn; }
export function setRecallHandler(fn: (world: World, caster: EntityHandle, x: number, z: number, radius: number) => void): void { _recallHandler = fn; }

/** Run a list of effects in order. */
export function executeEffects(world: World, ctx: CastContext, effects: AbilityEffect[]): void {
  for (const effect of effects) executeEffect(world, ctx, effect);
}

/** Apply one atomic effect. */
export function executeEffect(world: World, ctx: CastContext, effect: AbilityEffect): void {
  switch (effect.type) {
    case 'damage': return executeDamage(world, ctx, effect);
    case 'heal': return executeHeal(world, ctx, effect);
    case 'apply_buff': return executeApplyBuff(world, ctx, effect);
    case 'apply_debuff': return executeApplyDebuff(world, ctx, effect);
    case 'remove_buff': return executeRemoveBuff(world, ctx, effect);
    case 'stun': return executeStun(world, ctx, effect);
    case 'drain': return executeDrain(world, ctx, effect);
    case 'toggle': return executeToggle(world, ctx, effect);
    case 'cloak': return executeCloak(world, ctx, effect);
    case 'decloak': return executeDecloak(world, ctx, effect);
    case 'modify_energy': return executeModifyEnergy(world, ctx, effect);
    case 'restore_shield': return executeRestoreShield(world, ctx, effect);
    case 'knockback': return executeKnockback(world, ctx, effect);
    case 'teleport': return executeTeleport(world, ctx, effect);
    case 'area_damage': return executeAreaDamage(world, ctx, effect);
    case 'area_effect': return executeAreaEffect(world, ctx, effect);
    case 'kill_self': {
      const hr = world.get(ctx.caster, Health);
      if (hr.ok && !hr.value.isDead) world.set(ctx.caster, Health, { hp: 0, isDead: true });
      return;
    }
    // ── M9 ch2: form_switch + morph (real when the handlers are wired) ──
    case 'form_switch': {
      if (_formSwitchHandler) { _formSwitchHandler(world, ctx.caster, (effect as FormSwitchEffect).formId); }
      else console.debug(`[marscraft][effect] 'form_switch' handler not wired — no-op`);
      return;
    }
    case 'morph': {
      if (_morphHandler) { _morphHandler(world, ctx.caster, (effect as MorphEffect).targetFormId); }
      else console.debug(`[marscraft][effect] 'morph' handler not wired — no-op`);
      return;
    }
    // ── M9 ch3: spawn_ground_effect / spawn_hazard / spawn_unit / recall /
    //    transport_load / transport_unload (real when handlers are wired) ──
    case 'spawn_ground_effect': return executeSpawnGroundEffect(world, ctx, effect);
    case 'spawn_hazard': return executeSpawnHazard(world, ctx, effect);
    case 'spawn_unit': return executeSpawnUnit(world, ctx, effect);
    case 'recall': return executeRecall(world, ctx, effect);
    case 'transport_load': {
      if (_transportLoadHandler && ctx.targetEntity !== undefined) _transportLoadHandler(world, ctx.caster, ctx.targetEntity);
      else console.debug(`[marscraft][effect] 'transport_load' handler not wired — no-op`);
      return;
    }
    case 'transport_unload': {
      if (_transportUnloadHandler) _transportUnloadHandler(world, ctx.caster);
      else console.debug(`[marscraft][effect] 'transport_unload' handler not wired — no-op`);
      return;
    }
    // ── M17: spawn_direction_wave (sonar-pulse traveling wave — real when wired) ──
    case 'spawn_direction_wave': return executeSpawnDirectionWave(world, ctx, effect);
    default:
      console.debug(`[marscraft][effect] unknown effect type — no-op`);
      return;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Combat-type code of an entity (for the damage triangle), or undefined. */
function combatTypeOf(world: World, e: EntityHandle): CombatTypeCode | undefined {
  const ut = world.get(e, UnitType);
  return ut.ok ? (ut.value.combatType as CombatTypeCode) : undefined;
}

// ── 1. damage ─────────────────────────────────────────────────────────────────
function executeDamage(world: World, ctx: CastContext, effect: DamageEffect): void {
  const target = effect.selfDamage ? ctx.caster : ctx.targetEntity;
  if (target === undefined) return;
  // attribute the caster as the attacker (unless self-damage) so ability damage
  // also fires combat:damage / combat:kill trigger events.
  const attacker = effect.selfDamage ? undefined : ctx.caster;
  resolveDamage(
    world, target, effect.amount, 1, effect.damageType, ctx.gameTime,
    undefined, 0, 0, combatTypeOf(world, ctx.caster), attacker,
  );
}

// ── 2. heal (respects healPower / healRate via UnitStats finals) ───────────────
function executeHeal(world: World, ctx: CastContext, effect: HealEffect): void {
  const target = ctx.targetEntity ?? ctx.caster;
  resolveHeal(world, target, effect.amount, ctx.caster);
}

/**
 * Unified heal (port of DamageResolver.resolveHeal): final = base *
 * sourceHealPowerMult * targetHealRateMult, capped to maxHp; healRate<=0 blocks.
 */
export function resolveHeal(
  world: World, target: EntityHandle, baseAmount: number, sourceEntity?: EntityHandle,
): number {
  const hr = world.get(target, Health);
  if (!hr.ok || hr.value.isDead) return 0;
  const h = hr.value;
  if (h.hp >= h.maxHp) return 0;

  let sourceMult = 1.0;
  if (sourceEntity !== undefined) {
    const ss = world.get(sourceEntity, UnitStats);
    if (ss.ok) sourceMult = ss.value.finalHealPowerMult;
  }
  let targetMult = 1.0;
  const ts = world.get(target, UnitStats);
  if (ts.ok) targetMult = ts.value.finalHealRateMult;
  if (targetMult <= 0) return 0; // heal-blocked

  const rawHeal = baseAmount * sourceMult * targetMult;
  const cap = h.maxHp - h.hp;
  const actual = Math.min(cap, rawHeal);
  if (actual > 0) world.set(target, Health, { hp: h.hp + actual });
  return actual;
}

// ── 3. apply_buff ───────────────────────────────────────────────────────────
function executeApplyBuff(world: World, ctx: CastContext, effect: ApplyBuffEffect): void {
  const target = ctx.targetEntity ?? ctx.caster;
  addBuff(target, makeBuff({
    id: effect.buffId,
    duration: effect.duration,
    modifiers: effect.modifiers,
    sourceEntity: rawId(ctx.caster),
    isDebuff: false,
    stackMode: effect.stackMode,
    maxStacks: effect.maxStacks,
    triggers: effect.triggers,
    vfx: effect.vfx,
  }));
  eventBus.emit('ability:buff_applied', { entity: rawId(target), buffId: effect.buffId, duration: effect.duration, vfx: effect.vfx });
}

// ── 4. apply_debuff ───────────────────────────────────────────────────────────
function executeApplyDebuff(world: World, ctx: CastContext, effect: ApplyDebuffEffect): void {
  const target = ctx.targetEntity;
  if (target === undefined) return;
  addBuff(target, makeBuff({
    id: effect.debuffId,
    duration: effect.duration,
    modifiers: effect.modifiers,
    sourceEntity: rawId(ctx.caster),
    isDebuff: true,
    stackMode: effect.stackMode,
    maxStacks: effect.maxStacks,
    triggers: effect.triggers,
    vfx: effect.vfx,
  }));
  eventBus.emit('ability:buff_applied', { entity: rawId(target), buffId: effect.debuffId, duration: effect.duration, vfx: effect.vfx });
}

// ── 5. remove_buff ────────────────────────────────────────────────────────────
function executeRemoveBuff(world: World, ctx: CastContext, effect: RemoveBuffEffect): void {
  const target = ctx.targetEntity ?? ctx.caster;
  if (effect.removeAll) removeAllDebuffs(target);
  else removeBuff(target, effect.buffId);
}

// ── 6. stun ───────────────────────────────────────────────────────────────────
function executeStun(world: World, ctx: CastContext, effect: StunEffect): void {
  const target = ctx.targetEntity;
  if (target === undefined) return;
  addBuff(target, makeBuff({
    id: 'stun',
    duration: effect.duration,
    modifiers: [
      { stat: 'moveSpeed', mode: 'multiply', value: 0 },   // can't move
      { stat: 'attackSpeed', mode: 'multiply', value: 0 },  // can't attack
    ],
    sourceEntity: rawId(ctx.caster),
    isDebuff: true,
    stackMode: 'refresh',
    maxStacks: 1,
  }));
  const mv = world.get(target, Movement);
  if (mv.ok) world.set(target, Movement, { hasTarget: false, arrived: true });
}

// ── 7. drain (energy or hp; per-tick or instant) ──────────────────────────────
function executeDrain(world: World, ctx: CastContext, effect: DrainEffect): void {
  const target = ctx.targetEntity;
  if (target === undefined) return;
  const amount = effect.amountPerSecond * (effect.duration > 0 ? effect.duration : 1);

  if (effect.drainType === 'energy') {
    const te = world.get(target, Energy);
    if (!te.ok) return;
    const drained = Math.min(te.value.energy, amount);
    world.set(target, Energy, { energy: te.value.energy - drained });
    const ce = world.get(ctx.caster, Energy);
    if (ce.ok) world.set(ctx.caster, Energy, { energy: Math.min(ce.value.maxEnergy, ce.value.energy + drained) });
  } else {
    const th = world.get(target, Health);
    if (!th.ok || th.value.isDead) return;
    const drained = Math.min(th.value.hp, amount);
    world.set(target, Health, { hp: th.value.hp - drained });
    const ch = world.get(ctx.caster, Health);
    if (ch.ok && !ch.value.isDead) world.set(ctx.caster, Health, { hp: Math.min(ch.value.maxHp, ch.value.hp + drained) });
  }
}

// ── 8. toggle ─────────────────────────────────────────────────────────────────
function executeToggle(world: World, ctx: CastContext, effect: ToggleEffect): void {
  const state = ensureToggleState(ctx.caster, effect.stateId, effect.toggleTime);
  if (state.transitionRemaining > 0) return; // mid-transition: ignore
  if (effect.toggleTime > 0) {
    state.transitionRemaining = effect.toggleTime;
    state.transitionTotal = effect.toggleTime;
    // active flip happens in BuffSystem when the transition completes
  } else {
    state.active = !state.active;
  }
  const mv = world.get(ctx.caster, Movement);
  if (mv.ok) world.set(ctx.caster, Movement, { hasTarget: false, arrived: true });
}

// ── 8b. cloak / decloak (simple toggle of the 'cloak' state) ──────────────────
function executeCloak(world: World, ctx: CastContext, _effect: CloakEffect): void {
  const state = ensureToggleState(ctx.caster, 'cloak', 0);
  state.active = !state.active;
}
function executeDecloak(world: World, ctx: CastContext, _effect: DecloakEffect): void {
  const state = ensureToggleState(ctx.caster, 'cloak', 0);
  state.active = false;
}

// ── 9. modify_energy ──────────────────────────────────────────────────────────
function executeModifyEnergy(world: World, ctx: CastContext, effect: ModifyEnergyEffect): void {
  const target = effect.applyTo === 'self' ? ctx.caster : (ctx.targetEntity ?? ctx.caster);
  const er = world.get(target, Energy);
  if (!er.ok) return;
  const e = er.value;
  let energy: number;
  if (effect.amount === 'clear') energy = 0;
  else if (effect.amount > 0) energy = Math.min(e.maxEnergy, e.energy + effect.amount);
  else energy = Math.max(0, e.energy + effect.amount);
  world.set(target, Energy, { energy });
  if (energy > e.energy) eventBus.emit('fx:energyGain', { target: rawId(target) });
}

// ── 10. restore_shield ────────────────────────────────────────────────────────
function executeRestoreShield(world: World, ctx: CastContext, effect: RestoreShieldEffect): void {
  const target = effect.applyTo === 'self' ? ctx.caster : (ctx.targetEntity ?? ctx.caster);
  const hr = world.get(target, Health);
  if (!hr.ok || hr.value.isDead) return;
  const h = hr.value;
  if (h.maxShield <= 0) return;
  const newShield = Math.min(h.maxShield, h.shield + effect.amount);
  world.set(target, Health, { shield: newShield });
  if (newShield > h.shield) eventBus.emit('fx:shieldRestore', { target: rawId(target) });
}

// ── 11. knockback (move target along a direction + brief stun) ────────────────
function executeKnockback(world: World, ctx: CastContext, effect: KnockbackEffect): void {
  const target = ctx.targetEntity;
  if (target === undefined) return;
  const tr = world.get(target, Transform);
  const mv = world.get(target, Movement);
  if (!tr.ok || !mv.ok) return;

  let originX: number, originZ: number;
  if (effect.direction === 'away_from_target') {
    originX = ctx.targetX ?? tr.value.pos[0];
    originZ = ctx.targetZ ?? tr.value.pos[2];
  } else {
    const ct = world.get(ctx.caster, Transform);
    if (!ct.ok) return;
    originX = ct.value.pos[0];
    originZ = ct.value.pos[2];
  }
  let dx = tr.value.pos[0] - originX;
  let dz = tr.value.pos[2] - originZ;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.01) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
  else { dx /= len; dz /= len; }

  const MAP_BOUND = 62;
  const landX = Math.max(-MAP_BOUND, Math.min(MAP_BOUND, tr.value.pos[0] + dx * effect.distance));
  const landZ = Math.max(-MAP_BOUND, Math.min(MAP_BOUND, tr.value.pos[2] + dz * effect.distance));

  // Push via the Movement push channel (the movement system steers pushTarget).
  world.set(target, Movement, { isPushed: true, pushTargetX: landX, pushTargetZ: landZ });

  const stunDur = effect.stunDuration ?? (effect.distance / (effect.speed ?? 12));
  if (stunDur > 0) {
    addBuff(target, makeBuff({
      id: 'stun', duration: stunDur,
      modifiers: [
        { stat: 'moveSpeed', mode: 'multiply', value: 0 },
        { stat: 'attackSpeed', mode: 'multiply', value: 0 },
      ],
      sourceEntity: rawId(ctx.caster), isDebuff: true, stackMode: 'refresh', maxStacks: 1,
    }));
  }
}

// ── 12. teleport ──────────────────────────────────────────────────────────────
function executeTeleport(world: World, ctx: CastContext, effect: TeleportEffect): void {
  if (ctx.targetX === undefined || ctx.targetZ === undefined) return;
  const tr = world.get(ctx.caster, Transform);
  if (!tr.ok) return;
  const prevX = tr.value.pos[0], prevZ = tr.value.pos[2];
  let tx = ctx.targetX, tz = ctx.targetZ;

  if (effect.maxRange > 0) {
    const dx = tx - prevX, dz = tz - prevZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > effect.maxRange) {
      const ratio = effect.maxRange / dist;
      tx = prevX + dx * ratio; tz = prevZ + dz * ratio;
    }
  }
  if (ctx.clampToWalkable) { const s = ctx.clampToWalkable(tx, tz); tx = s.x; tz = s.z; }

  world.set(ctx.caster, Transform, { pos: [tx, tr.value.pos[1], tz] });
  const mv = world.get(ctx.caster, Movement);
  if (mv.ok) world.set(ctx.caster, Movement, { hasTarget: false, arrived: true });
  // Blink VFX: departure implosion @ old pos + arrival burst @ new pos (the
  // VfxSystem renders both off this bus event — source AbilityVFX _createBlinkVFX).
  eventBus.emit('fx:teleport', { entity: rawId(ctx.caster), fromX: prevX, fromZ: prevZ, toX: tx, toZ: tz });
}

// ── 13. area_damage (one-shot circle damage; duration field is an M9 seam) ─────
function executeAreaDamage(world: World, ctx: CastContext, effect: AreaDamageEffect): void {
  const cx = ctx.targetX ?? 0, cz = ctx.targetZ ?? 0;
  const cf = world.get(ctx.caster, Faction);
  if (!cf.ok) return;
  const cands = ctx.targets ?? [];
  const hits = resolveArea(cands, cx, cz, cf.value.playerId, { shape: 'circle', radius: effect.radius }, rawId(ctx.caster));
  const ctype = combatTypeOf(world, ctx.caster);
  for (const hit of hits) {
    resolveDamage(world, hit.entity, effect.damagePerSecond, 1, effect.damageType, ctx.gameTime, undefined, 0, 0, ctype);
  }
  if (effect.duration > 0) {
    console.debug('[marscraft][effect] area_damage duration>0 (persistent field) is an M9 seam — applied one tick');
  }
}

// ── 14. area_effect (run sub-effects on each target in an AoE shape) ───────────
function executeAreaEffect(world: World, ctx: CastContext, effect: AreaEffectDef): void {
  const cf = world.get(ctx.caster, Faction);
  if (!cf.ok) return;
  const ct = world.get(ctx.caster, Transform);

  let cx: number, cz: number, queryCx: number, queryCz: number;
  let dirX: number | undefined, dirZ: number | undefined;

  if (effect.shape === 'cone' && ct.ok) {
    cx = ct.value.pos[0]; cz = ct.value.pos[2];
    dirX = ct.value.pos[0]; dirZ = ct.value.pos[2];
    // forward point from caster facing (Motion.facingY would be ideal; use the
    // cast direction toward the target point if present, else +Z).
    const fx = (ctx.targetX ?? (ct.value.pos[0])) - ct.value.pos[0];
    const fz = (ctx.targetZ ?? (ct.value.pos[2] + 1)) - ct.value.pos[2];
    const flen = Math.sqrt(fx * fx + fz * fz) || 1;
    queryCx = ct.value.pos[0] + fx / flen;
    queryCz = ct.value.pos[2] + fz / flen;
  } else {
    cx = ctx.targetX ?? 0; cz = ctx.targetZ ?? 0;
    queryCx = cx; queryCz = cz;
    dirX = ct.ok ? ct.value.pos[0] : undefined;
    dirZ = ct.ok ? ct.value.pos[2] : undefined;
  }

  const cands = ctx.targets ?? [];
  const hits = resolveArea(
    cands, queryCx, queryCz,
    effect.targetFilter === 'enemy' ? cf.value.playerId : -1,
    {
      shape: effect.shape, radius: effect.radius, angle: effect.angle,
      width: effect.width, falloff: effect.falloff ?? [1.0],
      directionX: dirX, directionZ: dirZ,
    },
  );

  const hitSet = ctx.hitSet;
  let hitCount = 0;
  for (const hit of hits) {
    if (effect.excludeTarget && ctx.targetEntity !== undefined && hit.entity === ctx.targetEntity) continue;
    if (hitSet) { const id = rawId(hit.entity); if (hitSet.has(id)) continue; hitSet.add(id); }
    if (effect.targetFilter === 'ally') {
      const hf = world.get(hit.entity, Faction);
      if (!hf.ok || hf.value.playerId !== cf.value.playerId) continue;
    }
    const subCtx: CastContext = {
      caster: ctx.caster, targetEntity: hit.entity, targetX: cx, targetZ: cz,
      gameTime: ctx.gameTime, targets: ctx.targets, hitSet,
    };
    if (effect.applyFalloffToDamage && hit.falloff < 1.0) {
      const scaled = effect.effects.map((e) => e.type === 'damage' ? { ...e, amount: e.amount * hit.falloff } : e);
      executeEffects(world, subCtx, scaled);
    } else {
      executeEffects(world, subCtx, effect.effects);
    }
    if (effect.maxHits !== undefined && ++hitCount >= effect.maxHits) break;
  }
}

// ── 15. spawn_ground_effect (persistent ground AoE zone) ──────────────────────
function executeSpawnGroundEffect(world: World, ctx: CastContext, effect: SpawnGroundEffectEffect): void {
  if (!_groundEffectHandler) { console.debug(`[marscraft][effect] 'spawn_ground_effect' handler not wired — no-op`); return; }
  const cf = world.get(ctx.caster, Faction);
  const playerId = cf.ok ? cf.value.playerId : 0;
  let x = ctx.targetX, z = ctx.targetZ;
  if (x === undefined || z === undefined) {
    const tr = world.get(ctx.caster, Transform);
    if (tr.ok) { x = tr.value.pos[0]; z = tr.value.pos[2]; }
  }
  if (x === undefined || z === undefined) return;
  _groundEffectHandler({
    typeId: effect.groundEffectId, x, z, playerId,
    radius: effect.radius, duration: effect.duration, casterEntity: ctx.caster,
  });
}

// ── 16. spawn_hazard (hazard zone — lurker spines / mines / force fields) ─────
function executeSpawnHazard(world: World, ctx: CastContext, effect: SpawnHazardEffect): void {
  if (!_hazardHandler) { console.debug(`[marscraft][effect] 'spawn_hazard' handler not wired — no-op`); return; }
  const cf = world.get(ctx.caster, Faction);
  const playerId = cf.ok ? cf.value.playerId : 0;
  let x = ctx.targetX, z = ctx.targetZ;
  if (x === undefined || z === undefined) {
    const tr = world.get(ctx.caster, Transform);
    if (tr.ok) { x = tr.value.pos[0]; z = tr.value.pos[2]; }
  }
  if (x === undefined || z === undefined) return;
  // Direction: from caster toward the cast point (for arc/line hazards).
  let dirX = 0, dirZ = 1;
  const ct = world.get(ctx.caster, Transform);
  if (ct.ok) {
    const dx = x - ct.value.pos[0], dz = z - ct.value.pos[2];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.001) { dirX = dx / len; dirZ = dz / len; }
  }
  _hazardHandler({
    hazardTypeId: effect.hazardTypeId, x, z, playerId, casterEntity: ctx.caster,
    hp: effect.hp, duration: effect.duration, shape: effect.shape, radius: effect.radius,
    angle: effect.angle, width: effect.width, height: effect.height,
    blocksMovement: effect.blocksMovement, blocksProjectiles: effect.blocksProjectiles,
    blocksAllFactions: effect.blocksAllFactions, dirX, dirZ,
    areaEffects: effect.areaEffects, areaInterval: effect.areaInterval,
  });
}

// ── 16b. spawn_direction_wave (sonar-pulse traveling corridor wave) ───────────
function executeSpawnDirectionWave(world: World, ctx: CastContext, effect: SpawnDirectionWaveEffect): void {
  if (!_directionWaveHandler) { console.debug(`[marscraft][effect] 'spawn_direction_wave' handler not wired — no-op`); return; }
  const tr = world.get(ctx.caster, Transform);
  if (!tr.ok) return;
  const cf = world.get(ctx.caster, Faction);
  const playerId = cf.ok ? cf.value.playerId : 0;
  // For direction casts the ability system stores a NORMALIZED direction vector
  // in targetX/targetZ; fall back to the caster's facing if absent.
  let dirX = ctx.targetX, dirZ = ctx.targetZ;
  if (dirX === undefined || dirZ === undefined) { dirX = 0; dirZ = 1; }
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-4) { dirX = 0; dirZ = 1; }
  _directionWaveHandler({
    casterEntity: ctx.caster, playerId, x: tr.value.pos[0], z: tr.value.pos[2],
    dirX, dirZ, speed: effect.speed, maxRange: effect.maxRange, width: effect.width,
    hitEffects: effect.hitEffects, revealRange: effect.revealRange, revealDuration: effect.revealDuration,
  });
}

// ── 17. spawn_unit (summon: illusions / broodlings / interceptors) ────────────
function executeSpawnUnit(world: World, ctx: CastContext, effect: SpawnUnitEffect): void {
  if (!_summonHandler) { console.debug(`[marscraft][effect] 'spawn_unit' handler not wired — no-op`); return; }
  const cf = world.get(ctx.caster, Faction);
  const playerId = cf.ok ? cf.value.playerId : 0;
  let baseX: number | undefined, baseZ: number | undefined;
  if (effect.spawnAtTarget) { baseX = ctx.targetX; baseZ = ctx.targetZ; }
  if (baseX === undefined || baseZ === undefined) {
    const tr = world.get(ctx.caster, Transform);
    if (tr.ok) { baseX = tr.value.pos[0] + (effect.offsetX ?? 0); baseZ = tr.value.pos[2] + (effect.offsetZ ?? 0); }
  }
  if (baseX === undefined || baseZ === undefined) return;
  _summonHandler({
    unitTypeId: effect.unitTypeId, count: effect.count, x: baseX, z: baseZ, playerId,
    casterEntity: ctx.caster, lifetime: effect.lifetime,
    autoAttackTarget: effect.autoAttackTarget ? ctx.targetEntity : undefined,
    damageTakenMultiplier: effect.damageTakenMultiplier,
    damageDealtMultiplier: effect.damageDealtMultiplier,
    inheritCasterStats: effect.inheritCasterStats,
  });
}

// ── 18. recall (teleport allied units near a point to the caster) ─────────────
function executeRecall(world: World, ctx: CastContext, effect: RecallEffect): void {
  if (!_recallHandler) { console.debug(`[marscraft][effect] 'recall' handler not wired — no-op`); return; }
  const x = ctx.targetX, z = ctx.targetZ;
  if (x === undefined || z === undefined) return;
  _recallHandler(world, ctx.caster, x, z, effect.radius);
}

/** Re-export so callers can apply already-resolved damage if needed. */
export { applyDamageToHealth };
