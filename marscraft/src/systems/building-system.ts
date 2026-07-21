/**
 * MarsCraft -> forgeax-engine — BuildingSystem (Milestone M8)
 * =============================================================================
 * Port of the Three.js source `web/systems/BuildingSystem.ts`. An ECS system
 * (installed BEFORE the command layer + movement, source priority 85) that:
 *
 *   1. Construction tick (`constructing`): buildProgress += dt/buildTime; HP
 *      scales 10% -> 100% with progress. Terran needs a builder within 5 units
 *      (multi-SCV speedup: +33% per extra builder); Zerg/Protoss auto-build.
 *      On complete: snap HP to full, `addSupplyMax` for supply providers, release
 *      the builder's `build` command, push it out of the footprint, fire onComplete.
 *   2. Production queue tick (`complete`): the head item's progress advances; when
 *      it finishes, dequeue and either complete-training (spawn the unit via
 *      `spawnUnit` at the rally / building exit, `addSupplyMax` if it provides
 *      supply, apply rally to the new unit) or complete-upgrade (bump the player's
 *      upgrade level — consumed by the M9 stat-modifier pass).
 *   3. Rally handling: a complete building with `hasRally` steers each trained
 *      unit toward `rallyX/rallyZ` (a `move` command), or to a resource (worker
 *      auto-harvest via the harvest handle) / attack target.
 *   4. Footprint release: a building whose Health flips `isDead` releases its
 *      OccupancyGrid footprint (so the cells free up) + prunes companion Maps,
 *      BEFORE the DeathSystem despawns it next.
 *
 * Public API (called by placement.ts + the verify hooks): `trainUnit`,
 * `researchUpgrade`, `setRally`, `checkPrerequisites`, `getUpgradeLevel`,
 * `releaseOccupancy`.
 *
 * ── ECS adaptation (vs the source class with `world.query`/`isAlive`) ─────────
 *   - `Building` is SoA: per-frame the system iterates the query batches
 *     (`qr[0]` is Batch[] — iterated, never treated as one batch) and reads/writes
 *     the columns; the public mutators take an EntityHandle and use world.get/set.
 *   - the production queue / additional-builders are non-numeric -> companion Maps
 *     (`buildingProductionQueue`, `buildingAdditionalBuilders`) keyed by entity.
 *   - `world.isAlive(e)` (no such World method on current engine main) is replaced
 *     by `world.get(e, Transform).ok` everywhere (same pattern as HarvestSystem).
 *   - the source's EventBus emits / i18n UI errors are dropped (HUD lands in M12);
 *     `console.warn` on unaffordable train, like the source.
 *
 * Marked seams (large source branches deferred, NOT silently stubbed):
 *   - Zerg larva/egg morph training (`_trainFromLarva` / egg hatch) — M9 (abilities
 *     / morph milestone). `trainUnit` on a larva-producer falls back to the normal
 *     production queue here so Zerg buildings still train; the larva visual + 75%
 *     refund-on-cancel path is the M9 seam.
 *   - Building morph (Hatchery->Lair, CC->Planetary) + Protoss pylon power fields +
 *     Terran building lift/land — `building-lift.ts` carries the lift seam; morph /
 *     power is ported (M17): `_recomputePower` sets `isPowered` each frame from the
 *     completed-pylon grid, `_tickProduction` halts unpowered buildings, and
 *     `isPoweredAt` gates placement (placement.ts + AI).
 *   - SCV build-wander animation + low-HP auto-burn — cosmetic; dropped.
 */

import { Transform, Children, ChildOf } from '@forgeax/engine-runtime';
import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Building, Health, Faction, Command, Movement, UnitType, Larva,
  BUILDING_STATE, LARVA_STATE, LARVAE_NATURAL_MAX, LARVAE_SPAWN_INTERVAL,
  MAX_PRODUCTION_QUEUE, NO_ENTITY, RACE, PLAYER_ID,
  buildingTypeId, buildingProductionQueue, buildingAdditionalBuilders, buildingLarvaeEntities,
  buildingMorphTargetTypeId, larvaMorphTypeId, unitTypeId, unitDisplayName,
  commandCurrent, commandQueue,
  type ProductionItem, type UnitCommand,
} from '../components';
import { eventBus } from '../core/event-bus';
import { getBuildingDef, getMorphsForBuilding, type BuildingDef } from '../data/buildings';
import { getUnitDef, type RaceType } from '../data/units';
import type { ResourceManager } from './resource-manager';
import type { UnitFactoryCtx } from './unit-factory';
import { spawnUnit } from './unit-factory';
import type { OccupancyGrid } from '../world/occupancy-grid';
import type { HarvestSystemHandle } from './harvest-system';
import type { UpgradeManagerHandle } from './upgrade-manager';
import { rebuildUnitModel, type ModelRebuildDeps } from './form-switch';

/** Buildings that naturally spawn larvae (Zerg town halls). */
const LARVA_PRODUCERS = new Set(['hatchery', 'lair', 'hive']);

/** Pylon energy-field radius (world units) — source `CBuilding.PYLON_POWER_RADIUS`. */
const PYLON_POWER_RADIUS = 7;
/** Protoss buildings that are self-powered (never need a pylon). */
const SELF_POWERED = new Set(['nexus', 'pylon', 'assimilator']);
/** True if `typeId` (a protoss building) requires pylon-field power to function. */
export function requiresPylonPower(typeId: string): boolean {
  return !SELF_POWERED.has(typeId);
}
export { PYLON_POWER_RADIUS };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/** A completed production item, captured during the query loop and spawned
 *  after it (collect-then-spawn — spawnUnit mid-iteration corrupts batches). */
interface PendingTrain {
  entity: EntityHandle;
  typeId: string;
  playerId: number;
  color: number;
  raceCode: number;
  bx: number;
  bz: number;
  hasRally: boolean;
  rallyX: number;
  rallyZ: number;
  rallyResourceEntity: number;
  rallyAttackEntity: number;
}

/** Builder must be within this distance (world units) to count as on-site. */
const BUILD_ARRIVE_DIST = 5.0;
/** Extra build speed per additional on-site SCV (source: +33%). */
const BUILDER_SPEED_BONUS = 0.33;
/** Race code (Building.race u32) -> source race string for spawnUnit. */
const RACE_NAME: Record<number, RaceType> = { 0: 'terran', 1: 'protoss', 2: 'zerg' };

export interface BuildingSystemDeps {
  resourceManager: ResourceManager;
  factoryCtx: UnitFactoryCtx;
  occupancy: OccupancyGrid;
  /** Walkability test for picking a spawn cell around the building exit. */
  isWalkable: (x: number, z: number) => boolean;
  /** Harvest handle — a worker trained with a resource rally auto-harvests. */
  harvest?: HarvestSystemHandle | null;
  /**
   * Upgrade manager — SSOT for per-player upgrade levels + research cost/time.
   * When provided, research uses the real UpgradeDef cost/time + the manager
   * owns level storage (replaces the M8 fixed-100/100/40 stub + local _upgrades).
   */
  upgradeManager?: UpgradeManagerHandle | null;
  /** Debug/build-speed multiplier (default 1). */
  speedMultiplier?: number;
  /** Model rebuild deps (prims + tint) — needed for building-morph model swap + larva spawn. */
  model?: ModelRebuildDeps;
  /** Terrain sampler — for siting spawned larvae on the surface. */
  heightAt?: (x: number, z: number) => number;
}

export interface BuildingSystemHandle {
  /** Enqueue a unit in a complete building's production queue (spends resources). */
  trainUnit(buildingEntity: EntityHandle, typeId: string): boolean;
  /** Enqueue an upgrade research (spends resources). */
  researchUpgrade(buildingEntity: EntityHandle, upgradeId: string): boolean;
  /** Set a building's rally point (a ground point, or a resource / attack target). */
  setRally(buildingEntity: EntityHandle, x: number, z: number, opts?: {
    resourceEntity?: EntityHandle; attackEntity?: EntityHandle;
  }): void;
  /** Does the player own the COMPLETE prerequisites for this building typeId? */
  checkPrerequisites(playerId: number, buildingTypeId: string): boolean;
  /** True if a completed friendly pylon powers (x,z) — Protoss placement gate. */
  isPoweredAt(playerId: number, x: number, z: number): boolean;
  /** Current upgrade level for a player (0 if none). */
  getUpgradeLevel(playerId: number, upgradeId: string): number;
  /** Release a building's footprint + companion-Map side data (death path). */
  releaseOccupancy(entity: EntityHandle): void;
  /**
   * Begin a building MORPH (Hatchery->Lair, CC->Planetary, ...). Charges the cost
   * diff, flips the building to MORPHING; the per-frame tick advances morphProgress
   * over the target's build time and on complete swaps typeId/model/stats.
   */
  morphBuilding(entity: EntityHandle, targetTypeId: string): boolean;
  /** Train a Zerg unit from an idle larva (consumes the larva into a hatching egg). */
  trainFromLarva(buildingEntity: EntityHandle, typeId: string): boolean;
  /** Larvae currently parented to a Zerg town hall (verify hook). */
  probeLarva(buildingEntity: EntityHandle): {
    larvaCount: number;
    larvae: Array<{ entity: number; state: string; morphTypeId: string | null; morphProgress: number }>;
  };
}

export class BuildingSystem {
  private _world!: World;
  private _rm: ResourceManager;
  private _factoryCtx: UnitFactoryCtx;
  private _occupancy: OccupancyGrid;
  private _isWalkable: (x: number, z: number) => boolean;
  private _harvest: HarvestSystemHandle | null;
  private _upgradeMgr: UpgradeManagerHandle | null;
  private _speed: number;
  private _model: ModelRebuildDeps | null;
  private _heightAt: (x: number, z: number) => number;

  /**
   * Per-player upgrade levels FALLBACK — used only when no UpgradeManager is
   * injected (legacy M8 path). With a manager, levels live there (SSOT) and this
   * map is unused.
   */
  private _upgrades = new Map<number, Record<string, number>>();
  /** Per-frame cache of complete building typeIds by player (prereq scan). */
  private _completeByPlayer = new Map<number, Set<string>>();
  /** Per-player completed-pylon positions (rebuilt each frame for the power grid). */
  private _pylonsByPlayer = new Map<number, Array<{ x: number; z: number }>>();
  /** Entities already released this run (death path dedupe). */
  private _released = new Set<number>();

  constructor(deps: BuildingSystemDeps) {
    this._rm = deps.resourceManager;
    this._factoryCtx = deps.factoryCtx;
    this._occupancy = deps.occupancy;
    this._isWalkable = deps.isWalkable;
    this._harvest = deps.harvest ?? null;
    this._upgradeMgr = deps.upgradeManager ?? null;
    this._speed = deps.speedMultiplier ?? 1;
    this._model = deps.model ?? null;
    this._heightAt = deps.heightAt ?? (() => 0);
  }

  install(world: World): BuildingSystemHandle {
    this._world = world;
    world.addSystem(Update, {
      name: 'mc-building-system',
      queries: [
        { with: [Entity, Building, Health, Faction, Transform] },
        { with: [Entity, Larva, Transform] }, // Zerg larvae / hatching eggs
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = (world.getResource<{ dt: number }>('Time')?.dt ?? 0) * this._speed;
        if (dt <= 0) return;
        const batches = qr[0] as unknown as Batch[];

        // Rebuild the per-player complete-building cache once per frame (prereqs).
        this._rebuildCompleteCache(batches);
        // Recompute the Protoss pylon power grid once per frame (sets isPowered).
        this._recomputePower(batches);

        // Collect dead buildings to release + completed trainings to spawn +
        // completed building-morphs to apply — NO world mutation (despawn/spawn)
        // mid-iteration. spawnUnit() / model rebuild during the query loop corrupts
        // the batches (silent throw), so all are captured here and run after.
        const toRelease: EntityHandle[] = [];
        const pendingTrains: PendingTrain[] = [];
        const pendingMorphs: EntityHandle[] = [];
        const pendingLarva: Array<{ building: EntityHandle; x: number; z: number; playerId: number; color: number }> = [];

        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const e = b.Entity.self[i] as EntityHandle;
            if (b.Health.isDead[i]) { toRelease.push(e); continue; }

            const state = b.Building.state[i] as number;
            if (state === BUILDING_STATE.CONSTRUCTING) {
              this._tickConstruction(b, i, e, dt);
            } else if (state === BUILDING_STATE.COMPLETE) {
              this._tickProduction(b, i, e, dt, pendingTrains);
              this._tickLarvaSpawn(b, i, e, dt, pendingLarva);
            } else if (state === BUILDING_STATE.MORPHING) {
              // building morph (Hatchery->Lair); larvae still spawn while morphing.
              if (this._tickBuildingMorph(b, i, dt)) pendingMorphs.push(e);
              this._tickLarvaSpawn(b, i, e, dt, pendingLarva);
            }
            // PLACING: placement commits straight to CONSTRUCTING.
          }
        }

        // advance larva-entity egg morphs (separate archetype) — collect hatches.
        const pendingHatch: EntityHandle[] = [];
        const larvaBatches = qr[1] as unknown as Batch[];
        for (const b of larvaBatches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            const le = b.Entity.self[i] as EntityHandle;
            if (b.Larva.state[i] === LARVA_STATE.MORPHING) {
              const total = b.Larva.morphTime[i] as number;
              if (total > 0) {
                const p = (b.Larva.morphProgress[i] as number) + dt / total;
                b.Larva.morphProgress[i] = p;
                if (p >= 1) pendingHatch.push(le);
              }
            }
          }
        }

        for (const e of toRelease) this.releaseOccupancy(e);
        for (const pt of pendingTrains) this._spawnTraining(pt);
        for (const e of pendingMorphs) this._completeBuildingMorph(e);
        for (const req of pendingLarva) this._spawnLarvaEntity(req.building, req.x, req.z, req.playerId, req.color);
        for (const le of pendingHatch) this._completeEggMorph(le);
      },
    });

    return {
      trainUnit: (be, typeId) => this._trainUnit(be, typeId),
      researchUpgrade: (be, upgradeId) => this._researchUpgrade(be, upgradeId),
      setRally: (be, x, z, opts) => this._setRally(be, x, z, opts),
      checkPrerequisites: (pid, tid) => this._checkPrerequisites(pid, tid),
      isPoweredAt: (pid, x, z) => this.isPoweredAt(pid, x, z),
      getUpgradeLevel: (pid, uid) => this.getUpgradeLevel(pid, uid),
      releaseOccupancy: (e) => this.releaseOccupancy(e),
      morphBuilding: (e, tid) => this._morphBuilding(e, tid),
      trainFromLarva: (be, tid) => this._trainFromLarva(be, tid),
      probeLarva: (be) => this._probeLarva(be),
    };
  }

  // ==========================================================================
  // Per-frame: prereq cache
  // ==========================================================================

  private _rebuildCompleteCache(batches: Batch[]): void {
    this._completeByPlayer.clear();
    for (const b of batches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        if (b.Health.isDead[i]) continue;
        const state = b.Building.state[i] as number;
        // SC2: a morphing building still counts as its base type for prereqs.
        if (state !== BUILDING_STATE.COMPLETE && state !== BUILDING_STATE.MORPHING) continue;
        const e = b.Entity.self[i] as EntityHandle;
        const tid = buildingTypeId.get(e);
        if (!tid) continue;
        const pid = b.Faction.playerId[i] as number;
        let set = this._completeByPlayer.get(pid);
        if (!set) { set = new Set<string>(); this._completeByPlayer.set(pid, set); }
        set.add(tid);
      }
    }
  }

  // ==========================================================================
  // Protoss pylon power grid (source main.ts power-field update)
  // ==========================================================================
  // A Protoss building (except nexus/pylon/assimilator) is POWERED only while a
  // completed friendly pylon sits within PYLON_POWER_RADIUS. Non-Protoss and
  // self-powered buildings are always powered. `isPowered` gates production
  // (_tickProduction) + new placement (isPoweredAt, read by placement.ts).

  private _recomputePower(batches: Batch[]): void {
    // 1. collect completed friendly pylons per player.
    this._pylonsByPlayer.clear();
    for (const b of batches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        if (b.Health.isDead[i]) continue;
        if ((b.Building.state[i] as number) !== BUILDING_STATE.COMPLETE) continue;
        const e = b.Entity.self[i] as EntityHandle;
        if (buildingTypeId.get(e) !== 'pylon') continue;
        const pid = b.Faction.playerId[i] as number;
        let list = this._pylonsByPlayer.get(pid);
        if (!list) { list = []; this._pylonsByPlayer.set(pid, list); }
        list.push({ x: b.Transform.pos[i * 3] as number, z: b.Transform.pos[i * 3 + 2] as number });
      }
    }
    // 2. set isPowered on every building.
    for (const b of batches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        if (b.Health.isDead[i]) continue;
        if ((b.Building.race[i] as number) !== RACE.PROTOSS) { b.Building.isPowered[i] = 1; continue; }
        const e = b.Entity.self[i] as EntityHandle;
        const tid = buildingTypeId.get(e) ?? '';
        if (!requiresPylonPower(tid)) { b.Building.isPowered[i] = 1; continue; }
        b.Building.isPowered[i] =
          this._inPowerField(b.Faction.playerId[i] as number, b.Transform.pos[i * 3] as number, b.Transform.pos[i * 3 + 2] as number) ? 1 : 0;
      }
    }
  }

  /** True if a completed friendly pylon covers (x,z). */
  private _inPowerField(playerId: number, x: number, z: number): boolean {
    const list = this._pylonsByPlayer.get(playerId);
    if (!list) return false;
    const r2 = PYLON_POWER_RADIUS * PYLON_POWER_RADIUS;
    for (const p of list) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /** Public power query (placement.ts gates Protoss ghosts on this). */
  isPoweredAt(playerId: number, x: number, z: number): boolean {
    return this._inPowerField(playerId, x, z);
  }

  // ==========================================================================
  // Construction tick
  // ==========================================================================

  private _tickConstruction(b: Batch, i: number, entity: EntityHandle, dt: number): void {
    const world = this._world;
    const tid = buildingTypeId.get(entity);
    if (!tid) return;
    const raceCode = b.Building.race[i] as number;
    const isAutoConstruct = raceCode === 2 /* zerg */ || raceCode === 1 /* protoss */;

    // Builder count (Terran needs an on-site SCV; Zerg/Protoss build solo).
    let builderCount = 0;
    if (isAutoConstruct) {
      builderCount = 1;
    } else {
      const bx = b.Transform.pos[i * 3] as number;
      const bz = b.Transform.pos[i * 3 + 2] as number;
      // main builder
      const main = b.Building.builderEntity[i] as number;
      if (main >= 0 && this._builderOnSite(main as unknown as EntityHandle, entity, bx, bz)) {
        builderCount++;
      } else if (main >= 0) {
        // main builder gone/off-task -> clear so a promotion can happen
        b.Building.builderEntity[i] = NO_ENTITY;
      }
      // additional builders (multi-SCV speedup)
      const add = buildingAdditionalBuilders.get(entity);
      if (add) {
        for (let k = add.length - 1; k >= 0; k--) {
          const ae = add[k] as unknown as EntityHandle;
          if (this._builderOnSite(ae, entity, bx, bz)) {
            builderCount++;
            // promote one to main if main empty
            if ((b.Building.builderEntity[i] as number) < 0) {
              b.Building.builderEntity[i] = add[k];
              add.splice(k, 1);
            }
          } else if (!world.get(ae, Transform).ok || !this._isBuildingThis(ae, entity)) {
            add.splice(k, 1);
          }
        }
      }
      if (builderCount === 0) return; // no on-site builder -> construction paused
    }

    const speedBonus = isAutoConstruct ? 1.0 : (1.0 + (builderCount - 1) * BUILDER_SPEED_BONUS);
    const buildTime = (b.Building.buildTime[i] as number) || 1;
    const progressGain = (dt * speedBonus) / buildTime;
    const progress = (b.Building.buildProgress[i] as number) + progressGain;
    b.Building.buildProgress[i] = progress;

    // HP scales 10% -> 100% with progress (additive — never overwrite damage).
    const maxHp = b.Health.maxHp[i] as number;
    const expectedHp = Math.max(1, Math.floor(maxHp * (0.1 + 0.9 * Math.min(progress, 1))));
    const curHp = b.Health.hp[i] as number;
    if (curHp > expectedHp) {
      b.Health.hp[i] = expectedHp;
    } else {
      const gain = maxHp * 0.9 * progressGain;
      b.Health.hp[i] = Math.min(expectedHp, curHp + gain);
    }

    if (progress >= 1) {
      this._completeConstruction(b, i, entity, tid);
    }
  }

  private _completeConstruction(b: Batch, i: number, entity: EntityHandle, tid: string): void {
    b.Building.state[i] = BUILDING_STATE.COMPLETE;
    b.Building.buildProgress[i] = 1;
    b.Health.hp[i] = b.Health.maxHp[i];

    const playerId = b.Faction.playerId[i] as number;
    const unitDef = getUnitDef(tid);
    // supply provider (depot / overlord-building / nexus etc.) raises the cap.
    if (unitDef && unitDef.supplyProvide > 0) {
      this._rm.addSupplyMax(playerId, unitDef.supplyProvide);
    }

    // Release the on-site builder: clear its build command + push it out.
    const bx = b.Transform.pos[i * 3] as number;
    const bz = b.Transform.pos[i * 3 + 2] as number;
    // AlertSystem toast (local player only): building complete.
    if (playerId === PLAYER_ID.PLAYER) eventBus.emit('alert:build_complete', { buildingTypeId: tid, x: bx, z: bz });
    const def = getBuildingDef(tid);
    const halfFp = (def?.footprint ?? 2) / 2;
    const main = b.Building.builderEntity[i] as number;
    if (main >= 0) {
      this._releaseBuilder(main as unknown as EntityHandle, entity, bx, bz, halfFp);
    }
    const add = buildingAdditionalBuilders.get(entity);
    if (add) {
      for (const ae of add) this._releaseBuilder(ae as unknown as EntityHandle, entity, bx, bz, halfFp);
      add.length = 0;
    }
    b.Building.builderEntity[i] = NO_ENTITY;
  }

  /** True if entity `be` is alive, within range, and still has a build cmd here. */
  private _builderOnSite(be: EntityHandle, building: EntityHandle, bx: number, bz: number): boolean {
    const world = this._world;
    const t = world.get(be, Transform);
    if (!t.ok) return false;
    if (!this._isBuildingThis(be, building)) return false;
    const dx = t.value.pos[0] - bx;
    const dz = t.value.pos[2] - bz;
    return dx * dx + dz * dz <= BUILD_ARRIVE_DIST * BUILD_ARRIVE_DIST;
  }

  /** Does builder `be`'s current command target `building` with a `build`? */
  private _isBuildingThis(be: EntityHandle, building: EntityHandle): boolean {
    const cmd = commandCurrent.get(be);
    return !!cmd && cmd.type === 'build' && cmd.targetEntity === (building as unknown as number);
  }

  /** Clear a builder's build command, advance its queue, and push it out of the footprint. */
  private _releaseBuilder(be: EntityHandle, building: EntityHandle, bx: number, bz: number, halfFp: number): void {
    const world = this._world;
    const t = world.get(be, Transform);
    if (!t.ok) return;
    // advance the builder's command queue (drop the build, keep shift-queued orders).
    const cur = commandCurrent.get(be);
    if (cur && cur.type === 'build' && cur.targetEntity === (building as unknown as number)) {
      const q = commandQueue.get(be);
      const next = q && q.length ? q.shift()! : null;
      commandCurrent.set(be, next);
    }
    // push out of the footprint (issue a short move to the building edge).
    if (!world.get(be, Movement).ok) return;
    const px = t.value.pos[0];
    const pz = t.value.pos[2];
    const dx = px - bx;
    const dz = pz - bz;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    if (adx > halfFp + 0.5 || adz > halfFp + 0.5) return; // already clear
    const edge = halfFp + 1.0;
    let tx: number, tz: number;
    if (adx < 0.1 && adz < 0.1) {
      tx = bx + edge; tz = pz;
    } else if (adx >= adz) {
      tx = bx + (dx >= 0 ? 1 : -1) * edge; tz = pz;
    } else {
      tx = px; tz = bz + (dz >= 0 ? 1 : -1) * edge;
    }
    const moveCmd: UnitCommand = { type: 'move', targetX: tx, targetZ: tz };
    commandCurrent.set(be, moveCmd);
  }

  // ==========================================================================
  // Production queue tick
  // ==========================================================================

  private _tickProduction(b: Batch, i: number, entity: EntityHandle, dt: number, pending: PendingTrain[]): void {
    // lift pauses production (source `_liftPaused`).
    if (b.Building.liftPaused[i]) return;
    // Protoss pylon power: an unpowered production building halts (source: no
    // production while `!isPowered`). `_recomputePower` set the column this frame.
    if (!b.Building.isPowered[i]) return;

    const queue = buildingProductionQueue.get(entity);
    if (!queue || queue.length === 0) return;

    const item = queue[0];
    item.progress += dt / (item.buildTime || 1);

    if (item.progress >= 1) {
      queue.shift();
      if (item.isUpgrade) {
        this._completeUpgrade(b, i, item.itemId);
      } else {
        // Capture everything the spawn needs from the batch NOW; the actual
        // spawnUnit() runs after the batch loop (collect-then-spawn) so it can't
        // corrupt the in-flight query iteration.
        pending.push({
          entity, typeId: item.itemId,
          playerId: b.Faction.playerId[i] as number,
          color: b.Faction.color[i] as number,
          raceCode: b.Faction.race[i] as number,
          bx: b.Transform.pos[i * 3] as number,
          bz: b.Transform.pos[i * 3 + 2] as number,
          hasRally: !!b.Building.hasRally[i],
          rallyX: b.Building.rallyX[i] as number,
          rallyZ: b.Building.rallyZ[i] as number,
          rallyResourceEntity: b.Building.rallyResourceEntity[i] as number,
          rallyAttackEntity: b.Building.rallyAttackEntity[i] as number,
        });
      }
    }
  }

  private _completeUpgrade(b: Batch, i: number, upgradeId: string): void {
    const playerId = b.Faction.playerId[i] as number;
    // Delegate to the UpgradeManager (SSOT): it bumps the level AND its per-frame
    // system re-applies the affected units' UnitStats.upgrade* columns. Without a
    // manager, fall back to the local level map (legacy M8 path; no stat effect).
    if (playerId === PLAYER_ID.PLAYER) eventBus.emit('alert:upgrade_complete', { upgradeId });
    if (this._upgradeMgr) { this._upgradeMgr.completeUpgrade(playerId, upgradeId); return; }
    let levels = this._upgrades.get(playerId);
    if (!levels) { levels = {}; this._upgrades.set(playerId, levels); }
    levels[upgradeId] = (levels[upgradeId] ?? 0) + 1;
  }

  /** Deferred production completion — runs AFTER the batch loop (collect-then-
   *  spawn). Uses values captured into `pt`, never the (now stale) query batch. */
  private _spawnTraining(pt: PendingTrain): void {
    const { entity, typeId, playerId, color, raceCode, bx, bz } = pt;
    const unitDef = getUnitDef(typeId);
    if (!unitDef) return;
    const race = RACE_NAME[raceCode] ?? unitDef.race;

    const tid = buildingTypeId.get(entity);
    const def = tid ? getBuildingDef(tid) : null;
    const halfFp = (def?.footprint ?? 3) / 2;
    const spawnDist = halfFp + 1.0;

    // SC2: with a rally, spawn toward the rally; else exit on the south side.
    const exitAngle = pt.hasRally ? Math.atan2(pt.rallyZ - bz, pt.rallyX - bx) : Math.PI / 2;

    const trainCount = unitDef.trainCount ?? 1;
    for (let c = 0; c < trainCount; c++) {
      const { x, z } = this._findWalkableSpawnPos(bx, bz, exitAngle, spawnDist);
      const newE = spawnUnit(this._world, this._factoryCtx, {
        typeId, x, z, playerId, playerColor: color, race,
      });
      if (!newE) continue;
      this._applyRallyTo(pt, newE);
    }

    // supply-providing trained unit (e.g. overlord) raises the cap.
    if (unitDef.supplyProvide > 0) {
      this._rm.addSupplyMax(playerId, unitDef.supplyProvide * trainCount);
    }
    // AlertSystem toast (local player only): unit trained.
    if (playerId === PLAYER_ID.PLAYER) eventBus.emit('alert:train_complete', { unitTypeId: typeId, x: bx, z: bz });
  }

  // ==========================================================================
  // Rally
  // ==========================================================================

  private _applyRallyTo(pt: PendingTrain, newE: EntityHandle): void {
    if (!pt.hasRally) return;
    const rx = pt.rallyX;
    const rz = pt.rallyZ;
    const resourceE = pt.rallyResourceEntity;
    const attackE = pt.rallyAttackEntity;

    if (resourceE >= 0 && this._harvest) {
      // worker rallies to a resource -> auto-harvest (no spread; precise target).
      this._harvest.assignWorkersToMineral([newE], resourceE as unknown as EntityHandle);
      return;
    }
    if (attackE >= 0 && this._world.get(attackE as unknown as EntityHandle, Transform).ok) {
      const at = this._world.get(attackE as unknown as EntityHandle, Transform);
      const cmd: UnitCommand = {
        type: 'attack', targetEntity: attackE,
        targetX: at.ok ? at.value.pos[0] : rx, targetZ: at.ok ? at.value.pos[2] : rz,
      };
      commandCurrent.set(newE, cmd);
      const q = commandQueue.get(newE); if (q) q.length = 0;
      return;
    }
    // normal ground rally -> move command (small spread around the point).
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * 1.5;
    const cmd: UnitCommand = {
      type: 'move', targetX: rx + Math.cos(ang) * dist, targetZ: rz + Math.sin(ang) * dist,
    };
    commandCurrent.set(newE, cmd);
    const q = commandQueue.get(newE); if (q) q.length = 0;
  }

  /** Find a walkable spawn cell around the building, preferring `preferredAngle`. */
  private _findWalkableSpawnPos(cx: number, cz: number, preferredAngle: number, baseDist: number): { x: number; z: number } {
    const STEP = Math.PI / 6; // 30 deg
    const MAX_STEPS = 12;
    for (let extra = 0; extra <= 2; extra++) {
      const dist = baseDist + extra;
      for (let s = 0; s < MAX_STEPS; s++) {
        const sign = s === 0 ? 0 : (s % 2 === 1 ? 1 : -1);
        const offset = Math.ceil(s / 2) * STEP * (sign || 1);
        const angle = preferredAngle + offset;
        const x = cx + Math.cos(angle) * dist;
        const z = cz + Math.sin(angle) * dist;
        if (this._isWalkable(x, z)) return { x, z };
      }
    }
    return { x: cx + Math.cos(preferredAngle) * baseDist, z: cz + Math.sin(preferredAngle) * baseDist };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  private _trainUnit(buildingEntity: EntityHandle, typeId: string): boolean {
    const world = this._world;
    const bldg = world.get(buildingEntity, Building);
    const fac = world.get(buildingEntity, Faction);
    if (!bldg.ok || !fac.ok) return false;
    // complete (or morphing larva-producer, which is the M9 seam — accept complete only here).
    if (bldg.value.state !== BUILDING_STATE.COMPLETE) return false;

    const tid = buildingTypeId.get(buildingEntity);
    const def = tid ? getBuildingDef(tid) : null;
    if (!def || !def.canProduce.includes(typeId)) return false;

    const unitDef = getUnitDef(typeId);
    if (!unitDef) return false;
    const playerId = fac.value.playerId;

    // train prerequisites (Zerg: zergling needs spawning_pool, etc.).
    if (unitDef.trainPrerequisite && unitDef.trainPrerequisite.length > 0) {
      const owned = this._completeByPlayer.get(playerId) ?? new Set<string>();
      if (!unitDef.trainPrerequisite.every((p) => owned.has(p))) return false;
    }

    // Zerg larva-producers (hatchery/lair/hive) train via real larvae, not the
    // production queue — consume an idle larva into a hatching egg (M9 ch4).
    if (tid && LARVA_PRODUCERS.has(tid)) {
      return this._trainFromLarva(buildingEntity, typeId);
    }

    let queue = buildingProductionQueue.get(buildingEntity);
    if (!queue) { queue = []; buildingProductionQueue.set(buildingEntity, queue); }
    if (queue.length >= MAX_PRODUCTION_QUEUE) return false;

    if (!this._rm.spend(playerId, unitDef.mineralCost, unitDef.gasCost, unitDef.supplyCost)) {
      const r = this._rm.getResources(playerId);
      // AlertSystem toast (local player only): which requirement is short?
      if (playerId === PLAYER_ID.PLAYER && r) {
        if (unitDef.supplyCost > 0 && r.supply + unitDef.supplyCost > r.supplyMax) eventBus.emit('alert:supply_blocked', {});
        else if (r.gas < unitDef.gasCost) eventBus.emit('alert:not_enough_gas', {});
        else eventBus.emit('alert:not_enough_minerals', {});
      }
      return false;
    }

    const item: ProductionItem = {
      itemId: typeId, isUpgrade: false, progress: 0,
      buildTime: unitDef.buildTime, mineralCost: unitDef.mineralCost, gasCost: unitDef.gasCost,
    };
    queue.push(item);
    return true;
  }

  private _researchUpgrade(buildingEntity: EntityHandle, upgradeId: string): boolean {
    const world = this._world;
    const bldg = world.get(buildingEntity, Building);
    const fac = world.get(buildingEntity, Faction);
    if (!bldg.ok || !fac.ok) return false;
    if (bldg.value.state !== BUILDING_STATE.COMPLETE) return false;

    const tid = buildingTypeId.get(buildingEntity);
    const def = tid ? getBuildingDef(tid) : null;
    if (!def || !def.canResearch.includes(upgradeId)) return false;

    const playerId = fac.value.playerId;
    let queue = buildingProductionQueue.get(buildingEntity);
    if (!queue) { queue = []; buildingProductionQueue.set(buildingEntity, queue); }
    if (queue.length >= MAX_PRODUCTION_QUEUE) return false;
    if (queue.some((it) => it.isUpgrade && it.itemId === upgradeId)) return false;

    // Research cost/time come from the UpgradeManager (real per-level UpgradeDef
    // numbers) when injected — replacing the M8 fixed-100/100/40 placeholder. The
    // manager also enforces max-level (canResearch). Without a manager, fall back
    // to the old fixed cost so the queue still exercises research.
    let cost = 100, gasCost = 100, researchTime = 40;
    if (this._upgradeMgr) {
      const next = this._upgradeMgr.nextResearch(playerId, upgradeId);
      if (!next) return false; // unknown upgrade or already max level
      // also reject if it's already in some building's queue this level (cap above
      // covers per-building; max-level guard via nextResearch covers completed).
      cost = next.mineral; gasCost = next.gas; researchTime = next.time;
    }
    if (!this._rm.spend(playerId, cost, gasCost, 0)) return false;

    const item: ProductionItem = {
      itemId: upgradeId, isUpgrade: true, progress: 0,
      buildTime: researchTime, mineralCost: cost, gasCost,
    };
    queue.push(item);
    return true;
  }

  private _setRally(buildingEntity: EntityHandle, x: number, z: number, opts?: {
    resourceEntity?: EntityHandle; attackEntity?: EntityHandle;
  }): void {
    const world = this._world;
    if (!world.get(buildingEntity, Building).ok) return;
    world.set(buildingEntity, Building, {
      hasRally: true, rallyX: x, rallyZ: z,
      rallyResourceEntity: opts?.resourceEntity != null ? (opts.resourceEntity as unknown as number) : NO_ENTITY,
      rallyAttackEntity: opts?.attackEntity != null ? (opts.attackEntity as unknown as number) : NO_ENTITY,
    });
  }

  private _checkPrerequisites(playerId: number, buildingTypeId: string): boolean {
    const def = getBuildingDef(buildingTypeId);
    if (!def) return false;
    if (def.prerequisite.length === 0) return true;
    const owned = this._completeByPlayer.get(playerId) ?? new Set<string>();
    return def.prerequisite.every((p) => owned.has(p));
  }

  getUpgradeLevel(playerId: number, upgradeId: string): number {
    if (this._upgradeMgr) return this._upgradeMgr.getLevel(playerId, upgradeId);
    return this._upgrades.get(playerId)?.[upgradeId] ?? 0;
  }

  // ==========================================================================
  // Building morph (Hatchery->Lair, CC->Planetary, ...)
  // ==========================================================================

  /** Begin a building morph: charge the cost diff + flip to MORPHING. */
  private _morphBuilding(entity: EntityHandle, targetTypeId: string): boolean {
    const world = this._world;
    const bldg = world.get(entity, Building);
    const fac = world.get(entity, Faction);
    if (!bldg.ok || !fac.ok) return false;
    if (bldg.value.state !== BUILDING_STATE.COMPLETE) {
      console.warn('[marscraft][morphBuilding] building not complete');
      return false;
    }
    // queue must be empty (source rule)
    const q = buildingProductionQueue.get(entity);
    if (q && q.length > 0) { console.warn('[marscraft][morphBuilding] queue not empty'); return false; }

    const fromTypeId = buildingTypeId.get(entity);
    if (!fromTypeId) return false;
    // target must be a valid morph of this building
    if (!getMorphsForBuilding(fromTypeId).some((m) => m.toTypeId === targetTypeId)) {
      console.warn(`[marscraft][morphBuilding] ${fromTypeId} cannot morph to ${targetTypeId}`);
      return false;
    }
    const targetUnit = getUnitDef(targetTypeId);
    const targetBldg = getBuildingDef(targetTypeId);
    if (!targetUnit || !targetBldg) { console.warn('[marscraft][morphBuilding] unknown target'); return false; }

    // prerequisites for the target
    if (!this._checkPrerequisites(fac.value.playerId, targetTypeId)) {
      console.warn('[marscraft][morphBuilding] prerequisites not met');
      return false;
    }

    // cost = target cost - current cost (clamped >= 0)
    const fromUnit = getUnitDef(fromTypeId);
    const mineralCost = Math.max(0, (targetUnit.mineralCost ?? 0) - (fromUnit?.mineralCost ?? 0));
    const gasCost = Math.max(0, (targetUnit.gasCost ?? 0) - (fromUnit?.gasCost ?? 0));
    if (!this._rm.canAfford(fac.value.playerId, mineralCost, gasCost, 0)) {
      console.warn('[marscraft][morphBuilding] insufficient resources');
      return false;
    }
    this._rm.spend(fac.value.playerId, mineralCost, gasCost, 0);

    const morphTime = targetUnit.buildTime || 40;
    world.set(entity, Building, {
      state: BUILDING_STATE.MORPHING, morphProgress: 0, morphTime,
    });
    buildingMorphTargetTypeId.set(entity, targetTypeId);
    return true;
  }

  /** Advance a MORPHING building's progress; returns true when complete. */
  private _tickBuildingMorph(b: Batch, i: number, dt: number): boolean {
    const total = b.Building.morphTime[i] as number;
    if (total <= 0) return false;
    if (!buildingMorphTargetTypeId.get(b.Entity.self[i] as EntityHandle)) return false;
    const p = (b.Building.morphProgress[i] as number) + dt / total;
    b.Building.morphProgress[i] = p;
    return p >= 1;
  }

  /** Apply a completed building morph (collect-then-mutate — runs after the loop). */
  private _completeBuildingMorph(entity: EntityHandle): void {
    const world = this._world;
    const newTypeId = buildingMorphTargetTypeId.get(entity);
    if (!newTypeId) return;
    const oldTypeId = buildingTypeId.get(entity);
    const newUnit = getUnitDef(newTypeId);
    if (!newUnit) return;

    // flip back to complete + clear morph state
    world.set(entity, Building, {
      state: BUILDING_STATE.COMPLETE, morphProgress: 1, morphTime: 0,
    });
    buildingMorphTargetTypeId.set(entity, null);

    // swap typeId companions
    buildingTypeId.set(entity, newTypeId);
    unitTypeId.set(entity, newTypeId);
    unitDisplayName.set(entity, newUnit.displayName);

    // Health (new building may have a different HP pool — full on morph complete)
    const hr = world.get(entity, Health);
    if (hr.ok) world.set(entity, Health, { maxHp: newUnit.hp, hp: newUnit.hp, armor: newUnit.armor });

    // supply diff (e.g. some morphs change supplyProvide)
    const fac = world.get(entity, Faction);
    if (fac.ok) {
      const oldSupply = oldTypeId ? (getUnitDef(oldTypeId)?.supplyProvide ?? 0) : 0;
      const newSupply = newUnit.supplyProvide ?? 0;
      if (newSupply !== oldSupply) this._rm.addSupplyMax(fac.value.playerId, newSupply - oldSupply);
    }

    // model swap to the target building (despawns old child parts + rebuilds).
    if (this._model) rebuildUnitModel(world, this._model, entity, newTypeId, newUnit.modelSize, newUnit);
  }

  // ==========================================================================
  // Zerg larvae (spawn + train-from-larva + egg hatch)
  // ==========================================================================

  /** Periodically spawn larvae up to the natural max for a complete larva-producer. */
  private _tickLarvaSpawn(
    b: Batch, i: number, entity: EntityHandle, dt: number,
    pending: Array<{ building: EntityHandle; x: number; z: number; playerId: number; color: number }>,
  ): void {
    const tid = buildingTypeId.get(entity);
    if (!tid || !LARVA_PRODUCERS.has(tid)) return;

    // prune dead larva refs
    const live = (buildingLarvaeEntities.get(entity) ?? []).filter((le) => this._world.get(le, Transform).ok);
    buildingLarvaeEntities.set(entity, live);

    if (live.length >= LARVAE_NATURAL_MAX) { b.Building.larvaeTimer[i] = 0; return; }

    const t = (b.Building.larvaeTimer[i] as number) + dt;
    if (t >= LARVAE_SPAWN_INTERVAL) {
      b.Building.larvaeTimer[i] = t - LARVAE_SPAWN_INTERVAL;
      // cluster larvae just in front of the building (south, +Z), outside footprint
      const def = getBuildingDef(tid);
      const halfFp = (def?.footprint ?? 5) / 2;
      const angle = Math.PI * 0.5 + (live.length - 1) * 0.18;
      const dist = halfFp + 1.0;
      pending.push({
        building: entity,
        x: (b.Transform.pos[i * 3] as number) + Math.cos(angle) * dist,
        z: (b.Transform.pos[i * 3 + 2] as number) + Math.sin(angle) * dist,
        playerId: b.Faction.playerId[i] as number,
        color: b.Faction.color[i] as number,
      });
    } else {
      b.Building.larvaeTimer[i] = t;
    }
  }

  /** Spawn one larva entity (collect-then-spawn — runs after the loop). */
  private _spawnLarvaEntity(building: EntityHandle, x: number, z: number, playerId: number, color: number): EntityHandle | null {
    const world = this._world;
    if (!world.get(building, Transform).ok) return null;
    const le = spawnUnit(world, this._factoryCtx, {
      typeId: 'larva', x, z, playerId, playerColor: color, race: 'zerg',
    });
    if (!le) return null;
    // attach the Larva component (the factory makes a generic unit, not a larva).
    if (!world.get(le, Larva).ok) {
      world.addComponent(le, {
        component: Larva,
        data: {
          parentBuilding: building as unknown as number, state: LARVA_STATE.IDLE,
          morphProgress: 0, morphTime: 0, wiggleTimer: 0,
          homeX: x, homeZ: z, wiggleTargetX: x, wiggleTargetZ: z,
        },
      });
    }
    larvaMorphTypeId.set(le, null);
    const list = buildingLarvaeEntities.get(building) ?? [];
    list.push(le);
    buildingLarvaeEntities.set(building, list);
    return le;
  }

  /** Train a Zerg unit from an idle larva: morph the larva into a hatching egg. */
  private _trainFromLarva(buildingEntity: EntityHandle, typeId: string): boolean {
    const world = this._world;
    const fac = world.get(buildingEntity, Faction);
    if (!fac.ok) return false;
    const unitDef = getUnitDef(typeId);
    if (!unitDef) return false;

    // find an idle larva
    const larvae = buildingLarvaeEntities.get(buildingEntity) ?? [];
    let idle: EntityHandle | null = null;
    for (const le of larvae) {
      const lr = world.get(le, Larva);
      if (lr.ok && lr.value.state === LARVA_STATE.IDLE && world.get(le, Transform).ok) { idle = le; break; }
    }
    if (!idle) return false; // no idle larva — expected when the AI over-queues; caller retries next tick

    // spend resources
    if (!this._rm.spend(fac.value.playerId, unitDef.mineralCost, unitDef.gasCost, unitDef.supplyCost)) {
      console.warn(`[marscraft][larva] unaffordable: ${typeId}`);
      return false;
    }

    // larva -> morphing egg
    world.set(idle, Larva, { state: LARVA_STATE.MORPHING, morphProgress: 0, morphTime: unitDef.buildTime });
    larvaMorphTypeId.set(idle, typeId);
    // remove from the parent's larva slots (an egg doesn't occupy a larva slot).
    const idx = larvae.indexOf(idle);
    if (idx >= 0) larvae.splice(idx, 1);
    // visual: swap to the egg model.
    if (this._model) {
      const eggDef = getUnitDef('egg');
      if (eggDef) rebuildUnitModel(world, this._model, idle, 'egg', eggDef.modelSize, eggDef);
    }
    return true;
  }

  /** Complete a larva egg morph: spawn the unit + despawn the larva (after loop). */
  private _completeEggMorph(eggEntity: EntityHandle): void {
    const world = this._world;
    const typeId = larvaMorphTypeId.get(eggEntity);
    if (!typeId) return;
    const tr = world.get(eggEntity, Transform);
    const fac = world.get(eggEntity, Faction);
    const lr = world.get(eggEntity, Larva);
    if (!tr.ok || !fac.ok) return;
    const unitDef = getUnitDef(typeId);
    if (!unitDef) return;

    const trainCount = unitDef.trainCount ?? 1;
    for (let c = 0; c < trainCount; c++) {
      const jx = (Math.random() - 0.5) * 0.6;
      const dist = 0.3 + Math.random() * 0.3;
      spawnUnit(world, this._factoryCtx, {
        typeId, x: tr.value.pos[0] + Math.cos(jx) * dist, z: tr.value.pos[2] + Math.sin(jx) * dist,
        playerId: fac.value.playerId, playerColor: fac.value.color, race: 'zerg',
      });
    }
    if (unitDef.supplyProvide > 0) this._rm.addSupplyMax(fac.value.playerId, unitDef.supplyProvide * trainCount);

    // remove the egg from the parent's slot list + despawn it + its model parts.
    if (lr.ok) {
      const parent = lr.value.parentBuilding as unknown as EntityHandle;
      const list = buildingLarvaeEntities.get(parent);
      if (list) { const i = list.indexOf(eggEntity); if (i >= 0) list.splice(i, 1); }
    }
    larvaMorphTypeId.delete(eggEntity);
    // Despawn the egg + ALL its model parts atomically via the engine's subtree
    // despawn (despawnScene = despawnDescendants + root). despawnDescendants
    // walks the parent's `Children` mirror list, which rebuildUnitModel now
    // repairs on the larva→egg swap (see ENGINE-ISSUES-for-ubpa.md: the mirror
    // append arm no-ops on a pre-emptied Children component) — so the egg's real
    // model parts are enumerated and torn down, not orphaned.
    world.despawnScene(eggEntity);
  }

  private _probeLarva(buildingEntity: EntityHandle): {
    larvaCount: number;
    larvae: Array<{ entity: number; state: string; morphTypeId: string | null; morphProgress: number }>;
  } {
    const STATE = ['idle', 'morphing'];
    const world = this._world;
    const larvae = buildingLarvaeEntities.get(buildingEntity) ?? [];
    const out: Array<{ entity: number; state: string; morphTypeId: string | null; morphProgress: number }> = [];
    for (const le of larvae) {
      const lr = world.get(le, Larva);
      if (!lr.ok) continue;
      out.push({
        entity: le as unknown as number,
        state: STATE[lr.value.state] ?? String(lr.value.state),
        morphTypeId: larvaMorphTypeId.get(le) ?? null,
        morphProgress: Number(lr.value.morphProgress.toFixed(3)),
      });
    }
    return { larvaCount: larvae.length, larvae: out };
  }

  /** Release a building's OccupancyGrid footprint + companion-Map side data. */
  releaseOccupancy(entity: EntityHandle): void {
    const raw = entity as unknown as number;
    if (this._released.has(raw)) return;
    this._released.add(raw);
    this._occupancy.release(raw);
    buildingTypeId.delete(entity);
    buildingProductionQueue.delete(entity);
    buildingAdditionalBuilders.delete(entity);
  }
}
