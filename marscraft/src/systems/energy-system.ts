/**
 * MarsCraft -> forgeax-engine — energy system (Milestone M9)
 * =============================================================================
 * Port of the Three.js source `web/systems/EnergySystem.ts`.
 *
 * Per-frame: every unit with an Energy component regenerates energy at its
 * effective regen rate, clamped to maxEnergy. The source read the regen rate
 * from `UnitStats.finalEnergyRegen` (which already folds in buff modifiers) when
 * a UnitStats component was present, falling back to `Energy.regenRate`
 * otherwise. We keep that: per row, prefer `UnitStats.finalEnergyRegen` when it
 * is > 0, else `Energy.regenRate`.
 *
 * Init-from-startPercent: the source seeded `energy = maxEnergy * startPercent`
 * at spawn (the unit-factory already does this: it sets `energy:
 * def.energyMax * startPercent` at spawn time). To stay 1:1 AND be robust to any
 * unit that was given an Energy component without a seeded current value, this
 * system performs a one-time "first-touch" init: the first frame it sees an
 * entity whose energy looks unseeded (energy === 0 AND startPercent > 0) it sets
 * `energy = maxEnergy * startPercent`. Tracked by an Entity Set so it only fires
 * once per entity (idempotent — re-running the system never re-seeds).
 *
 * Order (matches source priority 92 — after AbilitySystem(91), before
 * BuffSystem(93)/StatModifier(94)): in main.ts the install order is energy ->
 * buff -> stat-mod -> ability-cooldown.
 *
 * ⚠️ ECS rules (cheatsheet): `qr[0]` is an ARRAY OF BATCHES — iterate it; batch
 * keys are the registered component name (unprefixed). No spawn/despawn here.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Energy, UnitStats } from '../components';

/** Loose batch type (forgeax query batches are typed-array columns). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

export class EnergySystem {
  readonly name = 'EnergySystem';

  /** Entities already first-touch-seeded (one-time startPercent init). */
  private _seeded = new Set<number>();

  install(world: World): this {
    world.addSystem({
      name: this.name,
      queries: [{ with: [Entity, Energy] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time').dt;
        const batches = qr[0] as unknown as Batch[];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            const rawId = e as unknown as number;

            let energy = b.Energy.energy[i] as number;
            const maxEnergy = b.Energy.maxEnergy[i] as number;

            // ── one-time first-touch init from startPercent ──
            if (!this._seeded.has(rawId)) {
              this._seeded.add(rawId);
              const startPercent = b.Energy.startPercent[i] as number;
              if (energy === 0 && startPercent > 0 && maxEnergy > 0) {
                energy = maxEnergy * startPercent;
              }
            }

            // ── effective regen: prefer UnitStats.finalEnergyRegen ──
            let effectiveRegen = b.Energy.regenRate[i] as number;
            const stats = world.get(e, UnitStats);
            if (stats.ok && stats.value.finalEnergyRegen > 0) {
              effectiveRegen = stats.value.finalEnergyRegen;
            }

            // ── natural regen (clamped to maxEnergy) ──
            energy = Math.min(maxEnergy, energy + effectiveRegen * dt);
            b.Energy.energy[i] = energy;
          }
        }
      },
    });
    return this;
  }
}
