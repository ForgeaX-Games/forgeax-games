/**
 * MarsCraft -> forgeax-engine — ShieldRegenSystem (Milestone M9 chunk 2)
 * =============================================================================
 * Port of `web/systems/ShieldRegenSystem.ts`. Protoss shield natural regen:
 * for every entity with maxShield > 0, after SHIELD_REGEN_DELAY seconds without
 * damage, regen shield at finalShieldRegen/s up to maxShield.
 *
 * forgeax adaptation: the source read a private _gameTime accumulator and
 * Health.lastDamageTime (stamped by the damage resolver). We keep the same — a
 * per-frame accumulator + Health.lastDamageTime — and read the rate/delay from
 * UnitStats finals (buff-corrected) when present. Regen rate/delay defaults match
 * the source constants. qr[0] iterated as Batch[]; in-place column writes only.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Health, UnitStats } from '../components';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

export const SHIELD_REGEN_DELAY = 7.0;
export const SHIELD_REGEN_RATE = 2;

export class ShieldRegenSystem {
  private _gameTime = 0;

  install(world: World): void {
    world.addSystem({
      name: 'mc-shield-regen',
      queries: [{ with: [Entity, Health] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        this._gameTime += dt;
        if (dt <= 0) return;
        const batches = qr[0] as unknown as Batch[];
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const maxShield = b.Health.maxShield[i] as number;
            if (maxShield <= 0) continue;
            if (b.Health.isDead[i]) continue;
            const shield = b.Health.shield[i] as number;
            if (shield >= maxShield) continue;

            const e = b.Entity.self[i] as EntityHandle;
            const ss = world.get(e, UnitStats);
            const delay = ss.ok ? ss.value.finalShieldRegenDelay : SHIELD_REGEN_DELAY;
            const rate = ss.ok ? ss.value.finalShieldRegen : SHIELD_REGEN_RATE;

            if ((this._gameTime - (b.Health.lastDamageTime[i] as number)) < delay) continue;
            b.Health.shield[i] = Math.min(maxShield, shield + rate * dt);
          }
        }
      },
    });
  }
}
