/**
 * MarsCraft -> forgeax-engine — OutOfCombatSystem (Milestone M9 chunk 2)
 * =============================================================================
 * Port of `web/systems/OutOfCombatSystem.ts`. Tracks game time + exposes
 * `isOutOfCombat(entity, threshold)`.
 *
 * forgeax adaptation: the source listened to `combat:damage` EventBus events to
 * stamp `UnitStats.lastCombatTime`. forgeax has no EventBus, but the M6 damage
 * resolver already stamps `Health.lastDamageTime = gameTime` on every hit (both
 * the attacker via attack-system and the target). So out-of-combat is derived
 * directly from `Health.lastDamageTime` (the same fact, one carrier) — no event
 * plumbing, no duplicated `lastCombatTime`. The system itself only advances the
 * shared game clock each frame; `isOutOfCombat` is a query. (UnitStats.lastCombat
 * Time stays unused by this path — its damage-event writer is the M9 ch3 trigger
 * system seam.)
 */

import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Health } from '../components';

export const DEFAULT_OUT_OF_COMBAT_THRESHOLD = 5;

export interface OutOfCombatHandle {
  isOutOfCombat(entity: EntityHandle, thresholdSec?: number): boolean;
  readonly gameTime: number;
}

export class OutOfCombatSystem implements OutOfCombatHandle {
  private _world!: World;
  private _gameTime = 0;

  get gameTime(): number { return this._gameTime; }

  install(world: World): OutOfCombatHandle {
    this._world = world;
    world.addSystem({
      name: 'mc-out-of-combat',
      queries: [],
      resources: ['Time'],
      fn: () => { this._gameTime += world.getResource<{ dt: number }>('Time')?.dt ?? 0; },
    });
    return this;
  }

  isOutOfCombat(entity: EntityHandle, thresholdSec: number = DEFAULT_OUT_OF_COMBAT_THRESHOLD): boolean {
    const hr = this._world.get(entity, Health);
    if (!hr.ok) return true; // no health -> treat as out of combat
    return (this._gameTime - hr.value.lastDamageTime) >= thresholdSec;
  }
}
