/**
 * MarsCraft -> forgeax-engine — CreepHealingSystem (Milestone M9 chunk 2)
 * =============================================================================
 * Port of `web/systems/CreepHealingSystem.ts`. Zerg global passive: any Zerg
 * bio/armored unit standing ON CREEP and out of combat (5s no damage) regens
 * CREEP_HEAL_PER_SEC HP/s. Heals via the unified `resolveHeal`.
 *
 * Dependencies:
 *   - OutOfCombatSystem (ported this chunk) — out-of-combat gate.
 *   - CreepSystem (M9 ch3 SEAM) — the creep coverage map. Until it lands, the
 *     `isOnCreep` predicate is injected and defaults to `() => false`, so the
 *     heal LOGIC is fully ported + wired but inactive (no creep yet = nothing on
 *     creep). When CreepSystem is ported, pass its `isOnCreep` and the system
 *     heals with zero further changes. This is a real seam, not a fake.
 *
 * qr[0] iterated as Batch[]; heals via world.set inside resolveHeal (no spawn).
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Health, UnitType, Garrisoned, RACE, COMBAT_TYPE,
} from '../components';
import { resolveHeal } from './effect-executor';
import type { OutOfCombatHandle } from './out-of-combat';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const CREEP_HEAL_PER_SEC = 4;
const OUT_OF_COMBAT_THRESHOLD = 5;
const ELIGIBLE_COMBAT = new Set<number>([COMBAT_TYPE.BIO, COMBAT_TYPE.ARMORED]);

export interface CreepHealingDeps {
  outOfCombat: OutOfCombatHandle;
  /** Creep coverage test (M9 ch3 CreepSystem seam; defaults to no creep). */
  isOnCreep?: (x: number, z: number) => boolean;
}

export class CreepHealingSystem {
  private readonly _ooc: OutOfCombatHandle;
  private readonly _isOnCreep: (x: number, z: number) => boolean;

  constructor(deps: CreepHealingDeps) {
    this._ooc = deps.outOfCombat;
    this._isOnCreep = deps.isOnCreep ?? (() => false);
  }

  install(world: World): void {
    world.addSystem({
      name: 'mc-creep-healing',
      queries: [{ with: [Entity, Transform, Health, UnitType] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        const heal = CREEP_HEAL_PER_SEC * dt;
        const batches = qr[0] as unknown as Batch[];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            if ((b.UnitType.race[i] as number) !== RACE.ZERG) continue;
            if (!ELIGIBLE_COMBAT.has(b.UnitType.combatType[i] as number)) continue;
            if (b.Health.isDead[i]) continue;
            if ((b.Health.hp[i] as number) >= (b.Health.maxHp[i] as number)) continue;

            const e = b.Entity.self[i] as EntityHandle;
            if (world.get(e, Garrisoned).ok) continue;
            if (!this._ooc.isOutOfCombat(e, OUT_OF_COMBAT_THRESHOLD)) continue;
            if (!this._isOnCreep(b.Transform.pos[i * 3] as number, b.Transform.pos[i * 3 + 2] as number)) continue;

            resolveHeal(world, e, heal);
          }
        }
      },
    });
  }
}
