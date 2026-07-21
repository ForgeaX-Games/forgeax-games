/**
 * MarsCraft -> forgeax-engine — BuildingLiftSystem (Milestone M8)
 * =============================================================================
 * Port of the Three.js source `web/systems/BuildingLiftSystem.ts` — Terran
 * structures (barracks/factory/armory/command_center/orbital_command) can lift
 * off, fly, and land. Faithful state machine:
 *   grounded -> lifting (2s, rise LIFT_HEIGHT) -> airborne (Movement added, air
 *   move speed) -> flying_to_land (move to target) -> landing (2s, descend +
 *   rotate back to original facing) -> grounded (Movement removed, footprint
 *   re-reserved, production resumed).
 *
 * ECS adaptation:
 *   - lift state lives in a parallel `Map<rawEntity, LiftData>` (the source kept
 *     it the same way, off-component); `liftPaused` is the one shared Building
 *     column (BuildingSystem already pauses production while it's set).
 *   - `pos[1]` (Y) is driven directly on the engine Transform via world.get/set; the
 *     air Movement is added/removed via world.addComponent / removeComponent.
 *   - `world.isAlive(e)` -> `world.get(e, Transform).ok`.
 *
 * Marked seams (faithful subset):
 *   - the source's facing-Y is a scalar `rotationY`; here we only restore the
 *     stored Motion.facingY on land (the movement system derives the quat) —
 *     mid-landing yaw interpolation is dropped (cosmetic).
 *   - land-position legality + push-units-out-of-footprint are wired via the
 *     caller-supplied callbacks (checkLandPosition / onLand) when provided; if
 *     absent, landing always succeeds at the target (the M8-addon seam).
 *
 * NOTE: this is installed but not auto-driven (no lift command UI until M12); it
 * exposes `liftOff` / `landAt` for the verify hook + later command card.
 */

import { Transform } from '@forgeax/engine-runtime';
import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Building, Motion, Movement, BUILDING_STATE, MOVE_TYPE, buildingTypeId,
} from '../components';

const LIFTABLE = new Set(['barracks', 'factory', 'armory', 'command_center', 'orbital_command']);
const LIFT_TIME = 2.0;
const LAND_TIME = 2.0;
const AIR_MOVE_SPEED = 3.2;
const LIFT_HEIGHT = 5.0;
const LAND_ARRIVE = 2.0;

type LiftState = 'grounded' | 'lifting' | 'airborne' | 'landing' | 'flying_to_land';
interface LiftData {
  state: LiftState;
  timer: number;
  baseY: number;
  landX?: number;
  landZ?: number;
}

export interface BuildingLiftDeps {
  heightAt: (x: number, z: number) => number;
  /** Footprint release on lift / re-reserve on land (OccupancyGrid wiring). */
  onLift?: (entity: EntityHandle) => void;
  onLand?: (entity: EntityHandle, x: number, z: number) => void;
  /** Is a landing position legal? (default: always). */
  checkLandPosition?: (x: number, z: number) => boolean;
}

export interface BuildingLiftHandle {
  liftOff(entity: EntityHandle): boolean;
  landAt(entity: EntityHandle, x: number, z: number): boolean;
  getLiftState(entity: EntityHandle): LiftState;
}

export function installBuildingLift(world: World, deps: BuildingLiftDeps): BuildingLiftHandle {
  const liftData = new Map<number, LiftData>();

  function raw(e: EntityHandle): number { return e as unknown as number; }

  function liftOff(entity: EntityHandle): boolean {
    const bldg = world.get(entity, Building);
    const t = world.get(entity, Transform);
    if (!bldg.ok || !t.ok) return false;
    if (bldg.value.state !== BUILDING_STATE.COMPLETE) return false;
    const tid = buildingTypeId.get(entity);
    if (!tid || !LIFTABLE.has(tid)) return false;
    const existing = liftData.get(raw(entity));
    if (existing && existing.state !== 'grounded') return false;

    liftData.set(raw(entity), { state: 'lifting', timer: 0, baseY: t.value.pos[1] });
    world.set(entity, Building, { liftPaused: true });
    deps.onLift?.(entity);
    return true;
  }

  function landAt(entity: EntityHandle, x: number, z: number): boolean {
    const d = liftData.get(raw(entity));
    if (!d || (d.state !== 'airborne' && d.state !== 'flying_to_land')) return false;
    if (deps.checkLandPosition && !deps.checkLandPosition(x, z)) return false;
    d.state = 'flying_to_land';
    d.landX = x;
    d.landZ = z;
    if (world.get(entity, Movement).ok) {
      world.set(entity, Movement, { hasTarget: true, arrived: false, targetX: x, targetZ: z });
    }
    return true;
  }

  function getLiftState(entity: EntityHandle): LiftState {
    return liftData.get(raw(entity))?.state ?? 'grounded';
  }

  function startLanding(entity: EntityHandle, d: LiftData, x: number, z: number): void {
    const t = world.get(entity, Transform);
    if (!t.ok) return;
    d.baseY = deps.heightAt(x, z) + (t.value.scale[1] ?? 1) * 0.5;
    d.state = 'landing';
    d.timer = 0;
    d.landX = undefined;
    d.landZ = undefined;
    // move to the land spot horizontally; keep current (flying) Y — the landing
    // state descends it. pos[1] preserved from the live transform.
    world.set(entity, Transform, { pos: [x, t.value.pos[1], z] });
    if (world.get(entity, Movement).ok) world.set(entity, Movement, { hasTarget: false, arrived: true, currentSpeed: 0 });
  }

  world.addSystem(Update, {
    name: 'mc-building-lift',
    queries: [{ with: [Entity, Building, Transform] }],
    resources: ['Time'],
    fn: () => {
      const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
      if (dt <= 0 || liftData.size === 0) return;

      for (const [rawE, d] of liftData) {
        const entity = rawE as unknown as EntityHandle;
        const t = world.get(entity, Transform);
        if (!t.ok) { liftData.delete(rawE); continue; }

        switch (d.state) {
          case 'lifting': {
            d.timer += dt;
            const p = Math.min(1, d.timer / LIFT_TIME);
            world.set(entity, Transform, { pos: [t.value.pos[0], d.baseY + LIFT_HEIGHT * p, t.value.pos[2]] });
            if (p >= 1) {
              d.state = 'airborne';
              if (world.get(entity, Movement).ok) {
                world.set(entity, Movement, { speed: AIR_MOVE_SPEED, moveType: MOVE_TYPE.AIR });
              } else {
                world.addComponent(entity, { component: Movement, data: { speed: AIR_MOVE_SPEED, moveType: MOVE_TYPE.AIR, hasTarget: false, arrived: true } });
              }
            }
            break;
          }
          case 'flying_to_land': {
            if (d.landX !== undefined && d.landZ !== undefined) {
              const dx = d.landX - t.value.pos[0];
              const dz = d.landZ - t.value.pos[2];
              const mv = world.get(entity, Movement);
              const arrived = mv.ok && !mv.value.hasTarget && mv.value.arrived;
              if (dx * dx + dz * dz < LAND_ARRIVE * LAND_ARRIVE || arrived) {
                startLanding(entity, d, d.landX, d.landZ);
              }
            }
            break;
          }
          case 'landing': {
            d.timer += dt;
            const p = Math.min(1, d.timer / LAND_TIME);
            world.set(entity, Transform, { pos: [t.value.pos[0], d.baseY + LIFT_HEIGHT * (1 - p), t.value.pos[2]] });
            if (p >= 1) {
              world.set(entity, Transform, { pos: [t.value.pos[0], d.baseY, t.value.pos[2]] });
              if (world.get(entity, Movement).ok) world.removeComponent(entity, Movement);
              // restore facing (movement derives the quat from Motion.facingY).
              if (world.get(entity, Motion).ok) world.set(entity, Motion, { facingY: 0 });
              world.set(entity, Building, { liftPaused: false });
              deps.onLand?.(entity, t.value.pos[0], t.value.pos[2]);
              liftData.delete(rawE);
            }
            break;
          }
          case 'airborne':
          case 'grounded':
            break;
        }
      }
    },
  });

  return { liftOff, landAt, getLiftState };
}
