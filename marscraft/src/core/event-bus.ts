/**
 * MarsCraft -> forgeax-engine — typed EventBus (Milestone M9 chunk 4)
 * =============================================================================
 * A tiny typed event bus (singleton), ported from the Three.js source
 * `web/core/EventBus.ts` but trimmed to the events the forgeax port actually
 * consumes. Earlier milestones DROPPED the source EventBus (resource/supply HUD
 * events poll instead, M12; the M9 ch1-3 effect handlers were wired via direct
 * setter functions). M9 ch4's TriggerSystem is fundamentally event-driven — it
 * reacts to combat / ability events — so a small bus is reintroduced here.
 *
 * SSOT note: this bus carries ONLY the reactive-trigger events (combat + ability
 * lifecycle). It is NOT a general message bus; the rest of the port keeps its
 * direct handles/setters. Entity ids on the bus are RAW numbers (the source used
 * raw entity ids too); callers convert to/from EntityHandle at the boundary.
 *
 * Keep emissions CHEAP: `emit` is a no-op when nothing subscribed (the common
 * case before the TriggerSystem installs), so the combat hot path pays ~one map
 * lookup + length check per event.
 */

import type { BuffVFXConfig } from '../data/abilities';

/**
 * Reactive game events the TriggerSystem listens to (raw entity ids).
 * Mirrors the source GameEvents subset used by triggers.
 */
export interface GameEvents {
  /** Ability cast completed (caster view). */
  'ability:used': { entity: number; abilityId: string; targetEntity?: number; targetX?: number; targetZ?: number };
  /** A castTime windup began (caster view) — drives cast-windup VFX (e.g. phase_snipe). */
  'ability:cast_start': { entity: number; abilityId: string; castTime: number };
  /** A sustained/channeled phase began — drives sustained VFX (flame_dash, spine_rush, prismatic_charge…). */
  'ability:sustained_start': { entity: number; abilityId: string; targetX?: number; targetZ?: number; duration?: number };
  /** A sustained phase ended by interruption (energy out / toggle off / control / death). */
  'ability:sustained_end': { entity: number; abilityId: string };
  /** A sustained phase finished naturally (full duration) — drives completion VFX (prismatic blast). */
  'ability:sustained_complete': { entity: number; abilityId: string; targetX?: number; targetZ?: number };
  /** A toggle finished (de)activating — drives toggle VFX (cloak in/out). */
  'ability:toggle_complete': { entity: number; stateId: string; active: boolean };
  /** A normal-attack hit landed (attacker view). */
  'combat:attack_hit': { attacker: number; target: number; damage: number };
  /** Damage was dealt (attacker view). */
  'combat:damage': { attacker: number; target: number; damage: number };
  /** Damage was taken (target view). */
  'combat:damage_taken': { target: number; attacker: number; damage: number };
  /** A unit was killed (killer + victim). killer = 0 means no attributable killer. */
  'combat:kill': { killer: number; victim: number };
  /** A buff was applied to an entity. */
  'ability:buff_applied': { entity: number; buffId: string; duration: number; vfx?: BuffVFXConfig };
  /** A buff was removed/expired from an entity. */
  'ability:buff_removed': { entity: number; buffId: string };
  /** A teleport (blink) effect resolved — carries the from/to ground points for VFX. */
  'fx:teleport': { entity: number; fromX: number; fromZ: number; toX: number; toZ: number };
  /** A shield-restore effect actually raised a unit's shield (Immortal etc.) — VFX at the target. */
  'fx:shieldRestore': { target: number };
  /** A modify-energy effect ADDED energy to a unit (energy_overcharge etc.) — VFX at the target. */
  'fx:energyGain': { target: number };
  /** ── AlertSystem toasts (M19 UI). Local-player events → transient corner alerts. */
  /** A completed building finished (local player). */
  'alert:build_complete': { buildingTypeId: string; x: number; z: number };
  /** A trained unit finished (local player). */
  'alert:train_complete': { unitTypeId: string; x: number; z: number };
  /** An upgrade research finished (local player). */
  'alert:upgrade_complete': { upgradeId: string };
  /** A local-player action failed for lack of resources / supply. */
  'alert:not_enough_minerals': Record<string, never>;
  'alert:not_enough_gas': Record<string, never>;
  'alert:supply_blocked': Record<string, never>;
}

type EventName = keyof GameEvents;

/**
 * Event callback. Returning `true` intercepts (stopPropagation) — kept for 1:1
 * parity with the source, though the trigger port does not use interception.
 */
type EventCallback<T extends EventName> = (data: GameEvents[T]) => void | boolean;

interface Listener<T extends EventName = EventName> {
  callback: EventCallback<T>;
  priority: number;
  once: boolean;
}

export class EventBus {
  private static _instance: EventBus | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _listeners = new Map<EventName, Listener<any>[]>();

  static get instance(): EventBus {
    if (!EventBus._instance) EventBus._instance = new EventBus();
    return EventBus._instance;
  }

  /** Reset the singleton (used on a fresh bootstrap so stale listeners don't leak). */
  static reset(): void {
    if (EventBus._instance) EventBus._instance.clearAll();
  }

  /** Subscribe to an event (higher priority runs first). */
  on<T extends EventName>(event: T, callback: EventCallback<T>, priority = 0): void {
    let list = this._listeners.get(event);
    if (!list) { list = []; this._listeners.set(event, list); }
    list.push({ callback, priority, once: false });
    list.sort((a, b) => b.priority - a.priority);
  }

  /** Subscribe once (auto-removed after the first fire). */
  once<T extends EventName>(event: T, callback: EventCallback<T>, priority = 0): void {
    let list = this._listeners.get(event);
    if (!list) { list = []; this._listeners.set(event, list); }
    list.push({ callback, priority, once: true });
    list.sort((a, b) => b.priority - a.priority);
  }

  /** Unsubscribe a specific callback. */
  off<T extends EventName>(event: T, callback: EventCallback<T>): void {
    const list = this._listeners.get(event);
    if (!list) return;
    const idx = list.findIndex((l) => l.callback === callback);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** Fire an event. Returns true if a handler intercepted it. */
  emit<T extends EventName>(event: T, data: GameEvents[T]): boolean {
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return false;
    const snapshot = list.slice(); // copy: handlers may mutate the list
    let intercepted = false;
    for (const listener of snapshot) {
      const result = listener.callback(data);
      if (listener.once) {
        const idx = list.indexOf(listener);
        if (idx >= 0) list.splice(idx, 1);
      }
      if (result === true) { intercepted = true; break; }
    }
    return intercepted;
  }

  clearEvent(event: EventName): void { this._listeners.delete(event); }
  clearAll(): void { this._listeners.clear(); }
}

/** Shorthand for the singleton instance. */
export const eventBus = EventBus.instance;
