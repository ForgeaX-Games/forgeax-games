/**
 * MarsCraft -> forgeax-engine — MedivacHealSystem (Milestone M9 chunk 2)
 * =============================================================================
 * Port of `web/systems/MedivacHealSystem.ts`. Each Medivac heals the lowest-HP
 * friendly bio/infantry unit within range 5 for 8 HP/s (no energy cost). Heals go
 * through the unified `resolveHeal` (respects healPower/healRate buffs).
 *
 * forgeax adaptation: the source did `world.query(CUnitType)` twice. forgeax has
 * no ad-hoc query, so the system builds ONE per-frame snapshot of all
 * Transform+Health+Faction+UnitType rows (qr[0] iterated as Batch[]), identifies
 * the medivacs (typeId companion), and for each finds the best heal target in the
 * snapshot. Garrisoned units are excluded (Garrisoned component present).
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Health, Faction, UnitType, Garrisoned, unitTypeId, UNIT_CATEGORY,
} from '../components';
import { resolveHeal } from './effect-executor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const MEDIVAC_HEAL_RATE = 8;
const MEDIVAC_HEAL_RANGE = 5;

interface Row {
  e: EntityHandle; x: number; z: number; playerId: number;
  category: number; hp: number; maxHp: number; isDead: boolean; garrisoned: boolean;
  isMedivac: boolean;
}

export class MedivacHealSystem {
  install(world: World): void {
    world.addSystem({
      name: 'mc-medivac-heal',
      queries: [{ with: [Entity, Transform, Health, Faction, UnitType] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        const batches = qr[0] as unknown as Batch[];

        const rows: Row[] = [];
        let anyMedivac = false;
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            const isMedivac = unitTypeId.get(e) === 'medivac';
            if (isMedivac) anyMedivac = true;
            rows.push({
              e, x: b.Transform.pos[i * 3] as number, z: b.Transform.pos[i * 3 + 2] as number,
              playerId: b.Faction.playerId[i] as number, category: b.UnitType.category[i] as number,
              hp: b.Health.hp[i] as number, maxHp: b.Health.maxHp[i] as number,
              isDead: !!b.Health.isDead[i], garrisoned: world.get(e, Garrisoned).ok,
              isMedivac,
            });
          }
        }
        if (!anyMedivac) return;

        const rangeSq = MEDIVAC_HEAL_RANGE * MEDIVAC_HEAL_RANGE;
        const baseHeal = MEDIVAC_HEAL_RATE * dt;
        for (const med of rows) {
          if (!med.isMedivac || med.isDead) continue;
          let best: Row | null = null;
          let bestRatio = 1;
          for (const t of rows) {
            if (t.e === med.e || t.garrisoned || t.isDead) continue;
            if (t.category !== UNIT_CATEGORY.INFANTRY && t.category !== UNIT_CATEGORY.WORKER) continue;
            if (t.hp >= t.maxHp) continue;
            if (t.playerId !== med.playerId) continue;
            const dx = t.x - med.x, dz = t.z - med.z;
            if (dx * dx + dz * dz > rangeSq) continue;
            const ratio = t.hp / t.maxHp;
            if (ratio < bestRatio) { bestRatio = ratio; best = t; }
          }
          if (best) resolveHeal(world, best.e, baseHeal, med.e);
        }
      },
    });
  }
}
