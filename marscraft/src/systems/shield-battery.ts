/**
 * MarsCraft -> forgeax-engine — ShieldBatterySystem (Milestone M9 chunk 2)
 * =============================================================================
 * Port of `web/systems/ShieldBatterySystem.ts`. A completed Protoss Shield
 * Battery restores 20 shield/s (1 energy per shield) to friendly units with
 * maxShield > 0 within range 7, draining its own Energy.
 *
 * forgeax adaptation: builds ONE per-frame snapshot of Transform+Health+Faction
 * rows (qr[0] iterated as Batch[]) + identifies completed shield_battery
 * buildings (Building component + typeId companion + Energy). For each shield-
 * needing unit, picks the nearest friendly battery with energy and transfers
 * shield, decrementing the battery's Energy. In-place column writes only.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Health, Faction, Building, Energy, buildingTypeId, BUILDING_STATE,
} from '../components';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const BATTERY_HEAL_RATE = 20;
const BATTERY_RANGE = 7;
const ENERGY_PER_SHIELD = 1;

interface BatteryRef { e: EntityHandle; x: number; z: number; playerId: number; energy: number; }
interface NeedRef { e: EntityHandle; x: number; z: number; playerId: number; shield: number; maxShield: number; }

export class ShieldBatterySystem {
  install(world: World): void {
    world.addSystem({
      name: 'mc-shield-battery',
      queries: [{ with: [Entity, Transform, Health, Faction] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        const batches = qr[0] as unknown as Batch[];

        // batteries (read Building + Energy off their archetype via world.get)
        const batteries: BatteryRef[] = [];
        const needs: NeedRef[] = [];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            const isDead = !!b.Health.isDead[i];
            const x = b.Transform.pos[i * 3] as number, z = b.Transform.pos[i * 3 + 2] as number;
            const playerId = b.Faction.playerId[i] as number;

            // battery candidate
            const bd = world.get(e, Building);
            if (!isDead && bd.ok && bd.value.state === BUILDING_STATE.COMPLETE && buildingTypeId.get(e) === 'shield_battery') {
              const en = world.get(e, Energy);
              if (en.ok && en.value.energy > 0) batteries.push({ e, x, z, playerId, energy: en.value.energy });
            }

            // shield-needing candidate
            const maxShield = b.Health.maxShield[i] as number;
            const shield = b.Health.shield[i] as number;
            if (!isDead && maxShield > 0 && shield < maxShield) {
              needs.push({ e, x, z, playerId, shield, maxShield });
            }
          }
        }
        if (batteries.length === 0 || needs.length === 0) return;

        const rangeSq = BATTERY_RANGE * BATTERY_RANGE;
        for (const need of needs) {
          let best: BatteryRef | null = null;
          let bestSq = rangeSq;
          for (const bat of batteries) {
            if (bat.playerId !== need.playerId || bat.e === need.e || bat.energy <= 0) continue;
            const dx = need.x - bat.x, dz = need.z - bat.z;
            const d = dx * dx + dz * dz;
            if (d < bestSq) { bestSq = d; best = bat; }
          }
          if (!best) continue;

          const maxHeal = BATTERY_HEAL_RATE * dt;
          const needed = need.maxShield - need.shield;
          const wanted = Math.min(maxHeal, needed);
          const energyCost = wanted * ENERGY_PER_SHIELD;
          const actual = best.energy >= energyCost ? wanted : best.energy / ENERGY_PER_SHIELD;
          if (actual <= 0) continue;

          world.set(need.e, Health, { shield: Math.min(need.maxShield, need.shield + actual) });
          const spent = actual * ENERGY_PER_SHIELD;
          best.energy -= spent;
          const en = world.get(best.e, Energy);
          if (en.ok) world.set(best.e, Energy, { energy: Math.max(0, en.value.energy - spent) });
        }
      },
    });
  }
}
