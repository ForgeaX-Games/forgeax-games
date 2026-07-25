/**
 * MarsCraft -> forgeax-engine — DetectionSystem (Milestone M9 chunk 3)
 * =============================================================================
 * Port of the Three.js source `web/systems/DetectionSystem.ts`. Each frame:
 *   1. collect detectors (units whose Abilities carry an `isDetector` modifier)
 *   2. for every cloaked enemy unit (a `cloak` toggle that is active), if it is
 *      inside any ENEMY detector's vision range, refresh a short `detection_revealed`
 *      debuff (0.5s, re-applied every frame while in range)
 *   3. a cloaked unit with no active `detection_revealed` debuff is hidden from
 *      the enemy — `isVisibleToEnemy(entity)` returns false for it
 *
 * ADDITIVE (does not break M6): combat/health-bar can optionally consult
 * `isVisibleToEnemy`; nothing here changes existing systems. Garrisoned units are
 * skipped (already off-field).
 *
 * ⚠️ ECS rules: qr[N] is Batch[]; no spawn/despawn; buffs via the runtime helpers.
 */

import { Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform,
} from '@forgeax/engine-scene';
import {
  Abilities, Faction, UnitType, Health, Garrisoned, UnitStats, abilityBuffs,
} from '../components';
import {
  hasDetector, getToggleState, hasBuff, addBuff, makeBuff, getStatModifier,
} from './abilities-runtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const REVEAL_DURATION = 0.5;
const REVEALED_DEBUFF_ID = 'detection_revealed';

export interface DetectionHandle {
  /**
   * True if `entity` is visible to the enemy. Non-cloaked units are always
   * visible (true). A cloaked unit is visible only while revealed (a detector saw
   * it this/last frame, so the `detection_revealed` debuff is live).
   */
  isVisibleToEnemy(entity: EntityHandle): boolean;
  /** True if the unit is currently cloaked (cloak toggle active). */
  isCloaked(entity: EntityHandle): boolean;
}

export class DetectionSystem implements DetectionHandle {
  readonly name = 'DetectionSystem';

  install(world: World): DetectionHandle {
    world.addSystem(Update, {
      name: this.name,
      queries: [
        { with: [Entity, Transform, Faction, Abilities] },          // detectors (query 0)
        { with: [Entity, Transform, Faction, Health, Abilities] },   // candidates (query 1)
      ],
      resources: [],
      fn: (_w, qr) => {
        // 1. collect detectors.
        type Det = { x: number; z: number; vision: number; playerId: number };
        const detectors: Det[] = [];
        for (const b of qr[0] as unknown as Batch[]) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            if (world.get(e, Garrisoned).ok) continue;
            if (!hasDetector(e)) continue;
            // vision: prefer UnitStats.finalVisionRange, else UnitType + buff bonus.
            let vision: number;
            const ss = world.get(e, UnitStats);
            if (ss.ok && ss.value.finalVisionRange > 0) {
              vision = ss.value.finalVisionRange;
            } else {
              const ut = world.get(e, UnitType);
              const bonus = getStatModifier(e, 'visionRange').additive;
              vision = (ut.ok ? ut.value.visionRange : 10) + bonus;
            }
            detectors.push({
              x: b.Transform.pos[i * 3] as number,
              z: b.Transform.pos[i * 3 + 2] as number,
              vision,
              playerId: b.Faction.playerId[i] as number,
            });
          }
        }
        if (detectors.length === 0) return;

        // 2. reveal cloaked enemy units inside any enemy detector's range.
        for (const b of qr[1] as unknown as Batch[]) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            if (b.Health.isDead[i]) continue;
            if (world.get(e, Garrisoned).ok) continue;
            const cloak = getToggleState(e, 'cloak');
            if (!cloak || !cloak.active) continue;

            const px = b.Transform.pos[i * 3] as number;
            const pz = b.Transform.pos[i * 3 + 2] as number;
            const playerId = b.Faction.playerId[i] as number;

            let revealed = false;
            for (const d of detectors) {
              if (d.playerId === playerId) continue; // only enemy detectors reveal
              const dx = px - d.x, dz = pz - d.z;
              if (dx * dx + dz * dz <= d.vision * d.vision) { revealed = true; break; }
            }
            if (!revealed) continue;

            // refresh / apply the revealed debuff.
            if (hasBuff(e, REVEALED_DEBUFF_ID)) {
              // refresh remaining (BuffSystem ticks it down; re-arm to full).
              for (const buff of (abilityBuffs.get(e) ?? [])) {
                if (buff.id === REVEALED_DEBUFF_ID) buff.remaining = REVEAL_DURATION;
              }
            } else {
              addBuff(e, makeBuff({
                id: REVEALED_DEBUFF_ID,
                duration: REVEAL_DURATION,
                modifiers: [{ stat: 'isRevealed', mode: 'add', value: 1 }],
                sourceEntity: -1, isDebuff: true, stackMode: 'refresh', maxStacks: 1,
              }));
            }
          }
        }
      },
    });
    return this;
  }

  isCloaked(entity: EntityHandle): boolean {
    const s = getToggleState(entity, 'cloak');
    return !!s && s.active;
  }

  isVisibleToEnemy(entity: EntityHandle): boolean {
    if (!this.isCloaked(entity)) return true;
    return hasBuff(entity, REVEALED_DEBUFF_ID);
  }
}
