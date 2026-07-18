/**
 * MarsCraft -> forgeax-engine — abilities runtime helpers (Milestone M9)
 * =============================================================================
 * The Three.js source kept all per-unit ability runtime state (buffs, cooldowns,
 * toggle states, autocast flags) as METHODS on the `CAbilities` CLASS component
 * (web/components/Abilities.ts). forgeax components are SoA numeric-only, so M2
 * moved that state into typed `Map<Entity, …>` companions (see components.ts:
 * `abilityIds` / `abilityCooldowns` / `abilityBuffs` / `abilityToggleStates` /
 * `abilityAutocast`). This module reimplements the `CAbilities` METHODS as free
 * functions over those companions, so the buff / cooldown / stat-modifier logic
 * stays 1:1 with the source while remaining ECS-shaped.
 *
 * SSOT: the companion Maps in components.ts are the single source of truth; these
 * helpers only read/mutate them (never duplicate state).
 */

import { type EntityHandle as Entity } from '@forgeax/engine-ecs';
import {
  abilityCooldowns, abilityBuffs, abilityToggleStates,
  type ActiveBuff, type AbilityCooldown, type ToggleState,
} from '../components';
import type { BuffModifier } from '../data/abilities';

// ── cooldown ────────────────────────────────────────────────────────────────

/** Source CAbilities.setCooldown. */
export function setCooldown(e: Entity, abilityId: string, duration: number): void {
  let m = abilityCooldowns.get(e);
  if (!m) { m = new Map<string, AbilityCooldown>(); abilityCooldowns.set(e, m); }
  m.set(abilityId, { abilityId, remaining: duration, total: duration });
}

/** Source CAbilities.getCooldown. */
export function getCooldown(e: Entity, abilityId: string): number {
  return abilityCooldowns.get(e)?.get(abilityId)?.remaining ?? 0;
}

/** Source CAbilities.isOnCooldown. */
export function isOnCooldown(e: Entity, abilityId: string): boolean {
  return getCooldown(e, abilityId) > 0;
}

// ── buffs ─────────────────────────────────────────────────────────────────────

function buffsOf(e: Entity): ActiveBuff[] {
  let arr = abilityBuffs.get(e);
  if (!arr) { arr = []; abilityBuffs.set(e, arr); }
  return arr;
}

/**
 * Source CAbilities.addBuff — stackMode-aware add (refresh / stack / independent).
 */
export function addBuff(e: Entity, buff: ActiveBuff): void {
  const buffs = buffsOf(e);
  const mode = buff.stackMode;

  if (mode === 'independent') {
    buffs.push(buff);
    return;
  }

  const existingIdx = buffs.findIndex((b) => b.id === buff.id);
  if (existingIdx < 0) { buffs.push(buff); return; }

  const existing = buffs[existingIdx];
  if (mode === 'stack') {
    if (existing.stacks < existing.maxStacks) existing.stacks++;
  }
  existing.remaining = buff.totalDuration;
  existing.totalDuration = buff.totalDuration;
  existing.modifiers = [...buff.modifiers];
  existing.sourceEntity = buff.sourceEntity;
  if (buff.vfx) existing.vfx = buff.vfx;
}

/** Source CAbilities.removeBuff. */
export function removeBuff(e: Entity, buffId: string): boolean {
  const buffs = abilityBuffs.get(e);
  if (!buffs) return false;
  const idx = buffs.findIndex((b) => b.id === buffId);
  if (idx >= 0) { buffs.splice(idx, 1); return true; }
  return false;
}

/** Source CAbilities.removeAllDebuffs. */
export function removeAllDebuffs(e: Entity): string[] {
  const buffs = abilityBuffs.get(e);
  if (!buffs) return [];
  const removed = buffs.filter((b) => b.isDebuff).map((b) => b.id);
  abilityBuffs.set(e, buffs.filter((b) => !b.isDebuff));
  return removed;
}

/** Source CAbilities.hasBuff. */
export function hasBuff(e: Entity, buffId: string): boolean {
  return (abilityBuffs.get(e) ?? []).some((b) => b.id === buffId);
}

/**
 * Source CAbilities.getStatModifier — sum of all buff modifiers for one stat.
 *
 * SC2 rules (verbatim):
 * - 'add'      -> additive accumulates (x stacks), independent also accumulates
 * - 'multiply' -> percentBonus accumulates (x stacks); independent same-id buffs
 *                 take the most extreme value (slow=min, speed-up=max)
 * returns { additive, multiplicative=(1+percentBonus), percentBonus }.
 */
export function getStatModifier(
  e: Entity, stat: string,
): { additive: number; multiplicative: number; percentBonus: number } {
  let additive = 0;
  let percentBonus = 0;
  const independentMultiply = new Map<string, number>();

  for (const buff of abilityBuffs.get(e) ?? []) {
    const stacks = buff.stacks || 1;
    for (const mod of buff.modifiers) {
      if (mod.stat !== stat) continue;
      if (mod.mode === 'add') {
        additive += mod.value * stacks;
      } else if (mod.mode === 'multiply') {
        if (buff.stackMode === 'independent') {
          const existing = independentMultiply.get(buff.id);
          const effectiveValue = mod.value * stacks;
          if (existing === undefined) {
            independentMultiply.set(buff.id, effectiveValue);
          } else if (effectiveValue < 0) {
            independentMultiply.set(buff.id, Math.min(existing, effectiveValue));
          } else {
            independentMultiply.set(buff.id, Math.max(existing, effectiveValue));
          }
        } else {
          percentBonus += mod.value * stacks;
        }
      }
    }
  }
  for (const val of independentMultiply.values()) percentBonus += val;
  return { additive, multiplicative: 1 + percentBonus, percentBonus };
}

/** True if any buff modifier marks this entity as a detector (isDetector). */
export function hasDetector(e: Entity): boolean {
  for (const buff of abilityBuffs.get(e) ?? []) {
    for (const mod of buff.modifiers) if (mod.stat === 'isDetector') return true;
  }
  return false;
}

// ── toggles ─────────────────────────────────────────────────────────────────

function togglesOf(e: Entity): Map<string, ToggleState> {
  let m = abilityToggleStates.get(e);
  if (!m) { m = new Map<string, ToggleState>(); abilityToggleStates.set(e, m); }
  return m;
}

/** Source CAbilities.getToggleState. */
export function getToggleState(e: Entity, stateId: string): ToggleState | undefined {
  return abilityToggleStates.get(e)?.get(stateId);
}

/** Source CAbilities.isToggleActive. */
export function isToggleActive(e: Entity, stateId: string): boolean {
  return abilityToggleStates.get(e)?.get(stateId)?.active ?? false;
}

/** Ensure a toggle state exists, returning it. */
export function ensureToggleState(
  e: Entity, stateId: string, transitionTotal = 0,
): ToggleState {
  const m = togglesOf(e);
  let s = m.get(stateId);
  if (!s) {
    s = { stateId, active: false, transitionRemaining: 0, transitionTotal };
    m.set(stateId, s);
  }
  return s;
}

/** Source CAbilities.isAnyTransitioning. */
export function isAnyTransitioning(e: Entity): boolean {
  const m = abilityToggleStates.get(e);
  if (!m) return false;
  for (const s of m.values()) if (s.transitionRemaining > 0) return true;
  return false;
}

/** Build an ActiveBuff from an apply_buff/apply_debuff-shaped descriptor. */
export function makeBuff(args: {
  id: string;
  duration: number;
  modifiers: BuffModifier[];
  sourceEntity: number;
  isDebuff: boolean;
  stackMode?: 'refresh' | 'stack' | 'independent';
  maxStacks?: number;
  triggers?: unknown[];
  vfx?: unknown;
}): ActiveBuff {
  const stackMode = args.stackMode ?? 'refresh';
  return {
    id: args.id,
    remaining: args.duration,
    totalDuration: args.duration,
    modifiers: [...args.modifiers],
    sourceEntity: args.sourceEntity,
    isDebuff: args.isDebuff,
    triggers: args.triggers ? [...args.triggers] : undefined,
    triggerCooldowns: args.triggers ? new Map<string, number>() : undefined,
    stackMode,
    maxStacks: stackMode === 'stack' ? (args.maxStacks ?? 1) : 1,
    stacks: 1,
    vfx: args.vfx,
  };
}
