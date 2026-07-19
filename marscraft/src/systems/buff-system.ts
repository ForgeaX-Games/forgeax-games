/**
 * MarsCraft -> forgeax-engine — buff system (Milestone M9)
 * =============================================================================
 * Port of the Three.js source `web/systems/BuffSystem.ts`.
 *
 * Responsibilities (verbatim from source):
 * 1. Tick down buff/debuff durations; remove on expiry (permanent buffs with
 *    totalDuration<=0 / Infinity don't decay).
 * 2. Tick toggle transition timers; on completion flip `active` and apply/remove
 *    the toggle's onActivate buff modifiers.
 * 3. Apply hard-control buff effects to gameplay components:
 *    - stun / lockdown / recall_pending / graviton_lift -> clear movement target
 *      + stop attacking.
 *    - graviton_lift -> while lifted set Movement.moveType = AIR; revert to GROUND
 *      when the lift ends.
 *
 * NOTE: ability cooldown decrement is NOT here — it lives in the ability system
 * (matches source: cooldowns tick in AbilitySystem). StatModifier (final stat
 * recompute) is its own system.
 *
 * ⚠️ ECS rules: qr[0] is Batch[] — iterate; companions read via the Map helpers;
 * cross-archetype gameplay components via world.get/set. No spawn/despawn.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Abilities, Movement, Attack, MOVE_TYPE, NO_ENTITY,
  abilityBuffs, abilityToggleStates, abilityIds,
} from '../components';
import { getAbilityDef, type ToggleEffect, type BuffModifier } from '../data/abilities';
import { addBuff, removeBuff, hasBuff, makeBuff } from './abilities-runtime';
import { eventBus } from '../core/event-bus';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const HARD_CONTROL = ['stun', 'lockdown', 'recall_pending', 'graviton_lift'];

export class BuffSystem {
  readonly name = 'BuffSystem';

  /** Entities currently lifted by graviton_lift (to revert moveType on release). */
  private _lifted = new Set<number>();

  install(world: World): this {
    world.addSystem({
      name: this.name,
      queries: [{ with: [Entity, Abilities] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time').dt;
        const batches = qr[0] as unknown as Batch[];

        // pass 1: tick buff/toggle lifecycles
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            this._tickLifecycles(b.Entity.self[i] as EntityHandle, dt);
          }
        }
        // pass 2: apply hard-control effects
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            this._applyHardControl(world, b.Entity.self[i] as EntityHandle);
          }
        }
      },
    });
    return this;
  }

  private _tickLifecycles(e: EntityHandle, dt: number): void {
    // ── buffs ──
    const buffs = abilityBuffs.get(e);
    if (buffs) {
      for (let i = buffs.length - 1; i >= 0; i--) {
        const buff = buffs[i];
        // permanent buffs (totalDuration<=0 or non-finite) don't decay
        if (buff.totalDuration > 0 && Number.isFinite(buff.totalDuration)) {
          buff.remaining -= dt;
          if (buff.remaining <= 0) {
            const id = buff.id;
            buffs.splice(i, 1);
            // ability:buff_removed trigger event (on_buff_expired). Skip internal
            // toggle buffs (`__toggle_*`) — those aren't ability buffs.
            if (!id.startsWith('__toggle_')) {
              eventBus.emit('ability:buff_removed', { entity: e as unknown as number, buffId: id });
            }
          }
        }
      }
    }

    // ── toggle transitions ──
    const toggles = abilityToggleStates.get(e);
    if (toggles) {
      for (const state of toggles.values()) {
        if (state.transitionRemaining > 0) {
          state.transitionRemaining -= dt;
          if (state.transitionRemaining <= 0) {
            state.transitionRemaining = 0;
            state.active = !state.active;
            this._handleToggleBuff(e, state.stateId, state.active);
            // toggle finished (de)activating → VFX hook (source ability:toggle_complete).
            eventBus.emit('ability:toggle_complete', { entity: e as unknown as number, stateId: state.stateId, active: state.active });
          }
        }
      }
    }
  }

  private _applyHardControl(world: World, e: EntityHandle): void {
    const controlled = HARD_CONTROL.some((id) => hasBuff(e, id));
    if (controlled) {
      const mv = world.get(e, Movement);
      if (mv.ok) world.set(e, Movement, { hasTarget: false, arrived: true, currentSpeed: 0 });
      const at = world.get(e, Attack);
      if (at.ok) world.set(e, Attack, { isAttacking: false, targetEntity: NO_ENTITY });
    }

    // graviton_lift -> air while lifted, revert to ground on release
    const mv = world.get(e, Movement);
    if (mv.ok) {
      const rawId = e as unknown as number;
      if (hasBuff(e, 'graviton_lift')) {
        this._lifted.add(rawId);
        if (mv.value.moveType !== MOVE_TYPE.AIR) world.set(e, Movement, { moveType: MOVE_TYPE.AIR });
      } else if (this._lifted.has(rawId)) {
        this._lifted.delete(rawId);
        world.set(e, Movement, { moveType: MOVE_TYPE.GROUND });
      }
    }
  }

  /** On toggle activate/deactivate, apply/remove the toggle's onActivate buff. */
  private _handleToggleBuff(e: EntityHandle, stateId: string, active: boolean): void {
    const buffId = `__toggle_${stateId}`;
    if (active) {
      const modifiers = this._findToggleModifiers(e, stateId);
      if (modifiers && modifiers.length > 0) {
        addBuff(e, makeBuff({
          id: buffId,
          duration: Infinity,
          modifiers,
          sourceEntity: e as unknown as number,
          isDebuff: false,
          stackMode: 'refresh',
          maxStacks: 1,
        }));
      }
    } else {
      removeBuff(e, buffId);
    }
  }

  private _findToggleModifiers(e: EntityHandle, stateId: string): BuffModifier[] | undefined {
    // Scan the unit's ability list for a ToggleEffect whose stateId matches and
    // return its onActivateModifiers (source BuffSystem._findToggleModifiers).
    const ids = abilityIds.get(e) ?? [];
    for (const abilityId of ids) {
      const def = getAbilityDef(abilityId);
      if (!def) continue;
      for (const effect of def.effects) {
        if (effect.type === 'toggle') {
          const te = effect as ToggleEffect;
          if (te.stateId === stateId && te.onActivateModifiers) return te.onActivateModifiers;
        }
      }
    }
    return undefined;
  }
}
