/**
 * MarsCraft -> forgeax-engine — combat candidate snapshot (Milestone M6)
 * =============================================================================
 * The Three.js source scanned candidates through `world.query(CTransform, CHealth,
 * CFaction)` (or a SpatialGrid) from inside target-acquisition / splash / bounce
 * search. forgeax exposes entity enumeration ONLY through a system's query
 * callback (there is no ad-hoc `world.query` on World), so M6 builds a per-frame
 * **snapshot** of every combat-relevant entity once (from the attack-system's own
 * query batches, and again from the projectile-system's prologue) and feeds that
 * array to the splash / bounce / acquisition helpers.
 *
 * This is the forgeax analogue of the source's `world.query(...)` candidate list +
 * the (deferred to M9) SpatialGrid optimisation: O(N) full scan, same as the
 * source's no-SpatialGrid fallback path.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Health, Faction, Movement, UnitType, Selectable, Renderable, Building,
  MOVE_TYPE, BUILDING_STATE, PLAYER_ID,
} from '../components';

/** One combat-relevant entity, snapshotted for a single frame. */
export interface CombatTarget {
  entity: EntityHandle;
  x: number;
  y: number;
  z: number;
  playerId: number;
  /** Physical radius (selectionRadius, else renderable size/2, else 0.5). */
  radius: number;
  isAir: boolean;
  isDead: boolean;
  isPlacing: boolean;
  /** UnitType.combatType code (for triangle counter). */
  combatType: number;
  hp: number;
}

/** Loose batch type (forgeax query batches are typed-array columns). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/**
 * Build a snapshot of every entity carrying Transform + Health + Faction across
 * a query's batches. The query MUST be declared with at least
 * `[Entity, Transform, Health, Faction]`; Movement / UnitType / Selectable /
 * Renderable / Building are read optionally via `world.get` per row (they live on
 * different archetypes).
 */
export function snapshotCombatTargets(world: World, batches: Batch[], out: CombatTarget[]): void {
  // POOLED: reuse the objects already in `out` (mutate in place) instead of
  // `out.push({...})` every frame. This runs on the combat hot path (attack /
  // projectile / hazard / … rebuild it per frame), so allocating N objects each
  // time was real GC churn. `out.length = idx` at the end trims extras while
  // keeping [0,idx) allocated for the next frame (stable count → zero allocs).
  let idx = 0;
  for (const b of batches) {
    const n = b.Entity.self.length as number;
    for (let i = 0; i < n; i++) {
      const entity = b.Entity.self[i] as EntityHandle;
      const playerId = b.Faction.playerId[i] as number;
      const isDead = !!b.Health.isDead[i];
      const hp = b.Health.hp[i] as number;

      // air? Movement may not be on this archetype.
      let isAir = false;
      const mv = world.get(entity, Movement);
      if (mv.ok) isAir = mv.value.moveType === MOVE_TYPE.AIR;

      let combatType = 0;
      const ut = world.get(entity, UnitType);
      if (ut.ok) combatType = ut.value.combatType;

      let radius = 0.5;
      const sel = world.get(entity, Selectable);
      if (sel.ok) {
        radius = sel.value.selectionRadius;
      } else {
        const rn = world.get(entity, Renderable);
        if (rn.ok) radius = rn.value.size * 0.5;
      }

      let isPlacing = false;
      const bd = world.get(entity, Building);
      if (bd.ok) isPlacing = bd.value.state === BUILDING_STATE.PLACING;

      let t = out[idx];
      if (t === undefined) { t = {} as CombatTarget; out[idx] = t; }
      t.entity = entity;
      t.x = b.Transform.posX[i];
      t.y = b.Transform.posY[i];
      t.z = b.Transform.posZ[i];
      t.playerId = playerId;
      t.radius = radius;
      t.isAir = isAir;
      t.isDead = isDead;
      t.isPlacing = isPlacing;
      t.combatType = combatType;
      t.hp = hp;
      idx++;
    }
  }
  out.length = idx;
}

/** True if `t` is a valid enemy target for `sourcePlayerId` (faction + alive). */
export function isHostileTarget(t: CombatTarget, sourcePlayerId: number): boolean {
  if (t.playerId === sourcePlayerId) return false;
  if (t.playerId === PLAYER_ID.NEUTRAL) return false; // never attack neutral
  if (t.isDead) return false;
  if (t.isPlacing) return false;
  return true;
}
