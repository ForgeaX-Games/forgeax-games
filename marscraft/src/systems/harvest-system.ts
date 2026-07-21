/**
 * MarsCraft -> forgeax-engine — HarvestSystem port (Milestone M7)
 * =============================================================================
 * Port of the Three.js source `web/systems/HarvestSystem.ts` — the worker
 * gather loop, a state machine over `Harvester.state`:
 *
 *   MINERALS:  idle -> moving_to_mineral -> (dist<1.5) mining(1.8s)
 *              -> carry MINERAL_PER_TRIP -> returning_mineral -> (dist<3 to base)
 *              -> ResourceManager.addMinerals -> moving_to_mineral -> loop
 *
 *   GAS:       idle -> moving_to_gas -> (dist<2.0) harvesting_gas(2.8s)
 *              -> carry GAS_PER_TRIP -> returning_gas -> (dist<3 to base)
 *              -> ResourceManager.addGas -> moving_to_gas -> loop
 *
 * Decrements `Mineral.amount` per trip; an exhausted patch is flagged dead
 * (Health.hp=0 if present) and despawned by THIS system's collect-then-despawn
 * pass (the source let DeathSystem clean it; minerals here carry no Health so we
 * despawn depleted patches directly).
 *
 * ── ECS adaptation (faithful control flow, forgeax storage) ───────────────────
 *  - The source had OO `CHarvester` / `CMineral` / `CGeyser` with methods. Here
 *    Harvester / Mineral / Geyser are SoA. The harvester's own row is read/written
 *    through the batch columns (a per-row `HarvesterView` + `MovementView`); the
 *    TARGET mineral / geyser / base entities are read by handle via `world.get` /
 *    `world.set` (they live on other archetypes).
 *  - The source queried `world.query(...)` for nearest-mineral / nearest-base.
 *    forgeax has no ad-hoc World query, so the system declares EXTRA queries
 *    (`qr[1]` minerals, `qr[2]` bases) and snapshots them once per frame (the same
 *    pattern combat-registry uses), then `_findNearestMineral` / `_findNearestBase`
 *    scan those snapshots — O(N), identical to the source's no-SpatialGrid path.
 *  - `qr[0]` is an ARRAY OF BATCHES (workers span several archetypes) — iterate it.
 *  - The source's `world.isAlive(e)` is replaced by `world.get(e, Transform).ok`
 *    (forgeax World has no isAlive; this is the alive-check death-system uses).
 *  - Long-distance travel: the source set a `harvest`/`return_cargo` command for
 *    CommandExecutor to path; the port's CommandExecutor now executes those as a
 *    MOVE (wired in command-executor.ts). Short hops (<= HARVEST_DIRECT_MOVE_DIST)
 *    set the Movement target directly, exactly as the source did.
 *
 * Runs BEFORE the command-executor + movement (source priority 85 < 90), so a
 * harvest move-command it sets is consumed the same frame.
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Movement, Harvester, Mineral, Geyser, Faction, Building, Health, Motion,
  HARVEST_STATE, CARRY_TYPE, BUILDING_STATE, NO_ENTITY,
  MINERAL_PER_TRIP, GAS_PER_TRIP, MINING_DURATION, GAS_HARVEST_DURATION,
  MINERAL_REACH_DIST, GAS_REACH_DIST, BASE_REACH_DIST,
  GEYSER_MAX_WORKERS, GEYSER_DEPLETED_THRESHOLD,
  geyserCurrentWorkers, geyserAssignedWorkers,
  unitTypeId, commandCurrent, commandQueue,
  type UnitCommand,
} from '../components';
import type { ResourceManager } from './resource-manager';

// ── tuning (ported verbatim from the source) ─────────────────────────────────

/** Auto nearest-mineral search radius (source MINERAL_SEARCH_RADIUS). */
const MINERAL_SEARCH_RADIUS = 15;
/** <= this distance -> direct Movement target; > -> path via a move command. */
const HARVEST_DIRECT_MOVE_DIST = 15;

/** Building typeIds that accept resource delivery (source BASE_TYPE_IDS). */
const BASE_TYPE_IDS = new Set<string>([
  'command_center', 'orbital_command', 'planetary_fortress',
  'hatchery', 'lair', 'hive',
  'nexus',
]);

// ── loose batch type (forgeax query batches are typed-array columns) ──────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/** A snapshotted candidate mineral / base for nearest-search. */
interface XZEntity { entity: EntityHandle; x: number; z: number; }

/**
 * Per-row view over the Harvester SoA columns, mirroring the source CHarvester
 * methods (reset / startMiningMineral / startHarvestingGas) so the ported control
 * flow stays 1:1. Reads/writes go straight to the live batch storage.
 */
class HarvesterView {
  constructor(private b: Batch, private i: number) {}

  get state(): number { return this.b.Harvester.state[this.i]; }
  set state(v: number) { this.b.Harvester.state[this.i] = v; }

  get targetMineral(): number { return this.b.Harvester.targetMineral[this.i]; }
  set targetMineral(v: number) { this.b.Harvester.targetMineral[this.i] = v; }

  get targetGeyser(): number { return this.b.Harvester.targetGeyser[this.i]; }
  set targetGeyser(v: number) { this.b.Harvester.targetGeyser[this.i] = v; }

  get targetBase(): number { return this.b.Harvester.targetBase[this.i]; }
  set targetBase(v: number) { this.b.Harvester.targetBase[this.i] = v; }

  get carryAmount(): number { return this.b.Harvester.carryAmount[this.i]; }
  set carryAmount(v: number) { this.b.Harvester.carryAmount[this.i] = v; }

  get carryType(): number { return this.b.Harvester.carryType[this.i]; }
  set carryType(v: number) { this.b.Harvester.carryType[this.i] = v; }

  get timer(): number { return this.b.Harvester.timer[this.i]; }
  set timer(v: number) { this.b.Harvester.timer[this.i] = v; }

  get isHarvesting(): boolean { return !!this.b.Harvester.isHarvesting[this.i]; }
  set isHarvesting(v: boolean) { this.b.Harvester.isHarvesting[this.i] = v ? 1 : 0; }

  /** Source CHarvester.reset (keeps targetBase, like the source). */
  reset(): void {
    this.state = HARVEST_STATE.IDLE;
    this.targetMineral = NO_ENTITY;
    this.targetGeyser = NO_ENTITY;
    this.carryAmount = 0;
    this.carryType = CARRY_TYPE.NONE;
    this.timer = 0;
    this.isHarvesting = false;
  }

  /** Source CHarvester.startMiningMineral. */
  startMiningMineral(mineral: number, base: number): void {
    this.state = HARVEST_STATE.MOVING_TO_MINERAL;
    this.targetMineral = mineral;
    this.targetBase = base;
    this.targetGeyser = NO_ENTITY;
    this.timer = 0;
    this.isHarvesting = false;
  }

  /** Source CHarvester.startHarvestingGas. */
  startHarvestingGas(geyser: number, base: number): void {
    this.state = HARVEST_STATE.MOVING_TO_GAS;
    this.targetGeyser = geyser;
    this.targetBase = base;
    this.targetMineral = NO_ENTITY;
    this.timer = 0;
    this.isHarvesting = false;
  }
}

/** Per-row Movement view (mirror of the source CMovement mutators used here). */
class MovementView {
  constructor(private b: Batch, private i: number) {}
  setTargetDirect(x: number, z: number): void {
    this.b.Movement.targetX[this.i] = x;
    this.b.Movement.targetZ[this.i] = z;
    this.b.Movement.hasTarget[this.i] = 1;
    this.b.Movement.arrived[this.i] = 0;
    this.b.Movement.useFlowField[this.i] = 0;
  }
  clearTarget(): void {
    this.b.Movement.hasTarget[this.i] = 0;
    this.b.Movement.arrived[this.i] = 1;
    this.b.Movement.useFlowField[this.i] = 0;
  }
}

export interface HarvestSystemDeps {
  resourceManager: ResourceManager;
}

export interface HarvestSystemHandle {
  /**
   * Smart multi-worker mineral assignment (source assignWorkersToMineral):
   * collect available patches within MINERAL_SEARCH_RADIUS of the clicked patch,
   * sort by distance, round-robin the workers across them, and start mining.
   */
  assignWorkersToMineral(workers: EntityHandle[], targetMineral: EntityHandle): void;
  /** Assign one worker to a geyser (source assignWorkerToGeyser). */
  assignWorkerToGeyser(worker: EntityHandle, geyser: EntityHandle): void;
  /**
   * Queue a mineral assignment to run at the start of the NEXT system tick (once
   * the per-frame mineral + base snapshots exist). Use from bootstrap, before any
   * frame has run; `assignWorkersToMineral` is fine to call after frames run.
   */
  queueAssignToMineral(workers: EntityHandle[], targetMineral: EntityHandle): void;
}

export class HarvestSystem {
  private _world!: World;
  private _rm: ResourceManager;

  // per-frame snapshots (rebuilt in the prologue from qr[1]/qr[2]).
  private _minerals: XZEntity[] = [];
  private _bases: Array<XZEntity & { playerId: number }> = [];

  // one-shot assignments queued before the first tick (bootstrap auto-start).
  private _pendingAssigns: Array<{ workers: EntityHandle[]; mineral: EntityHandle }> = [];

  constructor(deps: HarvestSystemDeps) {
    this._rm = deps.resourceManager;
  }

  install(world: World): HarvestSystemHandle {
    this._world = world;
    world.addSystem(Update, {
      name: 'mc-harvest-system',
      queries: [
        { with: [Entity, Transform, Movement, Harvester, Faction] }, // qr[0] workers
        { with: [Entity, Transform, Mineral] },                       // qr[1] minerals
        { with: [Entity, Transform, Faction, Building] },             // qr[2] bases
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource(Time).delta;
        this._snapshotMinerals(qr[1] as unknown as Batch[]);
        this._snapshotBases(qr[2] as unknown as Batch[]);

        // drain bootstrap-queued assignments now that snapshots exist.
        if (this._pendingAssigns.length) {
          const pend = this._pendingAssigns;
          this._pendingAssigns = [];
          for (const p of pend) this._assignWorkersToMineral(p.workers, p.mineral);
        }

        // Depleted patches collected here, despawned after the worker loop
        // (no mid-iteration despawn — corrupts the transient batch view).
        const depleted: EntityHandle[] = [];

        const workers = qr[0] as unknown as Batch[];
        for (const b of workers) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            this._tickWorker(b, i, dt, depleted);
          }
        }

        // collect-then-despawn exhausted minerals. despawnScene = subtree despawn:
        // a mineral's crystal-shard model parts are ChildOf it (resources.ts), and
        // the engine does NOT cascade ChildOf on despawn — a plain despawn(m) would
        // orphan the crystals → propagateTransforms hierarchy-broken. despawnScene
        // walks the ChildOf hierarchy and removes them with the mineral.
        for (const m of depleted) {
          if (world.get(m, Transform).ok) world.despawnScene(m);
        }
      },
    });
    return {
      assignWorkersToMineral: (workers, target) => this._assignWorkersToMineral(workers, target),
      assignWorkerToGeyser: (worker, geyser) => this._assignWorkerToGeyser(worker, geyser),
      queueAssignToMineral: (workers, target) => { this._pendingAssigns.push({ workers, mineral: target }); },
    };
  }

  // ============================================================
  // per-frame snapshots
  // ============================================================

  private _snapshotMinerals(batches: Batch[]): void {
    this._minerals.length = 0;
    for (const b of batches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        this._minerals.push({
          entity: b.Entity.self[i] as EntityHandle,
          x: b.Transform.pos[i * 3], z: b.Transform.pos[i * 3 + 2],
        });
      }
    }
  }

  private _snapshotBases(batches: Batch[]): void {
    this._bases.length = 0;
    for (const b of batches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        const entity = b.Entity.self[i] as EntityHandle;
        // base type? completed? (source _findNearestBase filters)
        const typeId = unitTypeId.get(entity);
        if (!typeId || !BASE_TYPE_IDS.has(typeId)) continue;
        if (b.Building.state[i] !== BUILDING_STATE.COMPLETE) continue;
        this._bases.push({
          entity, x: b.Transform.pos[i * 3], z: b.Transform.pos[i * 3 + 2],
          playerId: b.Faction.playerId[i] as number,
        });
      }
    }
  }

  // ============================================================
  // per-worker state machine
  // ============================================================

  private _tickWorker(b: Batch, i: number, dt: number, depleted: EntityHandle[]): void {
    const entity = b.Entity.self[i] as EntityHandle;
    const h = new HarvesterView(b, i);
    const mv = new MovementView(b, i);
    const tx = b.Transform.pos[i * 3] as number;
    const tz = b.Transform.pos[i * 3 + 2] as number;
    const playerId = b.Faction.playerId[i] as number;
    const rawId = entity as unknown as number;

    // A non-harvest player command interrupts harvesting (source check).
    const cmd = commandCurrent.get(entity);
    if (cmd && h.state !== HARVEST_STATE.IDLE) {
      if (cmd.type !== 'harvest' && cmd.type !== 'return_cargo') {
        this._releaseMineral(h);
        this._releaseGeyser(h, rawId);
        h.reset();
        return;
      }
    }

    switch (h.state) {
      case HARVEST_STATE.IDLE:
        break;
      case HARVEST_STATE.MOVING_TO_MINERAL:
        this._movingToMineral(entity, h, mv, tx, tz, rawId);
        break;
      case HARVEST_STATE.MINING:
        this._mining(entity, h, mv, tx, tz, playerId, dt, depleted);
        break;
      case HARVEST_STATE.RETURNING_MINERAL:
        this._returningMineral(entity, h, mv, tx, tz, playerId);
        break;
      case HARVEST_STATE.MOVING_TO_GAS:
        this._movingToGas(entity, h, mv, tx, tz, rawId);
        break;
      case HARVEST_STATE.HARVESTING_GAS:
        this._harvestingGas(entity, h, mv, tx, tz, playerId, rawId, dt);
        break;
      case HARVEST_STATE.RETURNING_GAS:
        this._returningGas(entity, h, mv, tx, tz, playerId, rawId);
        break;
    }
  }

  // ── mineral path ─────────────────────────────────────────────────────────

  private _movingToMineral(
    entity: EntityHandle, h: HarvesterView, mv: MovementView,
    tx: number, tz: number, rawId: number,
  ): void {
    const world = this._world;

    // target gone? find a replacement
    if (h.targetMineral === NO_ENTITY || !this._alive(h.targetMineral)) {
      const nm = this._findNearestMineral(tx, tz, rawId);
      if (nm !== NO_ENTITY) h.targetMineral = nm;
      else { h.reset(); this._clearHarvestCommand(entity, mv); return; }
    }

    const mt = world.get(this._handle(h.targetMineral), Transform);
    if (!mt.ok) { h.reset(); this._clearHarvestCommand(entity, mv); return; }

    const dx = mt.value.pos[0] - tx;
    const dz = mt.value.pos[2] - tz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < MINERAL_REACH_DIST) {
      this._clearHarvestCommand(entity, mv);
      const mh = this._handle(h.targetMineral);
      const mr = world.get(mh, Mineral);
      if (mr.ok && mr.value.amount > 0) {
        // occupied by someone else? -> find another
        if (mr.value.currentHarvester !== NO_ENTITY && mr.value.currentHarvester !== rawId) {
          const nm = this._findNearestMineral(tx, tz, rawId);
          if (nm !== NO_ENTITY) { h.targetMineral = nm; }
          else { h.timer = 0.5; h.state = HARVEST_STATE.MINING; }
          return;
        }
        world.set(mh, Mineral, { currentHarvester: rawId });
        h.state = HARVEST_STATE.MINING;
        h.timer = MINING_DURATION;
        h.isHarvesting = true;
        this._face(entity, dx, dz);
      } else {
        const nm = this._findNearestMineral(tx, tz, rawId);
        if (nm !== NO_ENTITY) h.targetMineral = nm;
        else h.reset();
      }
    } else {
      this._moveToTarget(entity, mv, 'harvest', mt.value.pos[0], mt.value.pos[2], dist);
    }
  }

  private _mining(
    entity: EntityHandle, h: HarvesterView, mv: MovementView,
    tx: number, tz: number, playerId: number, dt: number, depleted: EntityHandle[],
  ): void {
    const world = this._world;
    h.timer -= dt;
    mv.clearTarget(); // mining stays put

    if (h.timer <= 0) {
      h.isHarvesting = false;
      if (h.targetMineral !== NO_ENTITY && this._alive(h.targetMineral)) {
        const mh = this._handle(h.targetMineral);
        const mr = world.get(mh, Mineral);
        if (mr.ok) {
          const mined = Math.min(mr.value.amount, MINERAL_PER_TRIP);
          const remaining = mr.value.amount - mined;
          h.carryAmount = mined;
          h.carryType = CARRY_TYPE.MINERAL;
          const patch: Partial<{ amount: number; currentHarvester: number }> = { amount: remaining };
          if (mr.value.currentHarvester === (entity as unknown as number)) patch.currentHarvester = NO_ENTITY;
          world.set(mh, Mineral, patch);
          if (remaining <= 0) {
            // depleted -> flag dead if it has Health, else despawn directly
            const hp = world.get(mh, Health);
            if (hp.ok) world.set(mh, Health, { hp: 0, isDead: true });
            else depleted.push(mh);
          }
        }
      }
      // recompute nearest base (so a closer base built later gets used)
      const nb = this._findNearestBase(tx, tz, playerId);
      if (nb !== NO_ENTITY) h.targetBase = nb;
      h.state = HARVEST_STATE.RETURNING_MINERAL;
    }
  }

  private _returningMineral(
    entity: EntityHandle, h: HarvesterView, mv: MovementView,
    tx: number, tz: number, playerId: number,
  ): void {
    const world = this._world;
    if (h.targetBase === NO_ENTITY || !this._alive(h.targetBase)) {
      const nb = this._findNearestBase(tx, tz, playerId);
      if (nb === NO_ENTITY) { h.reset(); this._clearHarvestCommand(entity, mv); return; }
      h.targetBase = nb;
    }
    const bt = world.get(this._handle(h.targetBase), Transform);
    if (!bt.ok) { h.reset(); this._clearHarvestCommand(entity, mv); return; }

    const dx = bt.value.pos[0] - tx;
    const dz = bt.value.pos[2] - tz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < BASE_REACH_DIST) {
      this._clearHarvestCommand(entity, mv);
      this._rm.addMinerals(playerId, h.carryAmount);
      h.carryAmount = 0;
      h.carryType = CARRY_TYPE.NONE;
      // continue mining the same patch, or find a new one
      if (h.targetMineral !== NO_ENTITY && this._alive(h.targetMineral)) {
        const mr = world.get(this._handle(h.targetMineral), Mineral);
        if (mr.ok && mr.value.amount > 0) { h.state = HARVEST_STATE.MOVING_TO_MINERAL; return; }
      }
      const nm = this._findNearestMineral(tx, tz, entity as unknown as number);
      if (nm !== NO_ENTITY) { h.targetMineral = nm; h.state = HARVEST_STATE.MOVING_TO_MINERAL; }
      else h.reset();
    } else {
      this._moveToTarget(entity, mv, 'return_cargo', bt.value.pos[0], bt.value.pos[2], dist);
    }
  }

  // ── gas path ─────────────────────────────────────────────────────────────

  private _movingToGas(
    entity: EntityHandle, h: HarvesterView, mv: MovementView,
    tx: number, tz: number, rawId: number,
  ): void {
    const world = this._world;
    if (h.targetGeyser === NO_ENTITY || !this._alive(h.targetGeyser)) {
      this._releaseGeyser(h, rawId); h.reset(); this._clearHarvestCommand(entity, mv); return;
    }
    const gh = this._handle(h.targetGeyser);
    const gt = world.get(gh, Transform);
    const gr = world.get(gh, Geyser);
    if (!gt.ok || !gr.ok || !gr.value.hasRefinery || gr.value.amount <= GEYSER_DEPLETED_THRESHOLD) {
      this._releaseGeyser(h, rawId); h.reset(); this._clearHarvestCommand(entity, mv); return;
    }
    // refinery must be complete
    if (gr.value.refineryEntity !== NO_ENTITY && this._alive(gr.value.refineryEntity)) {
      const rb = world.get(this._handle(gr.value.refineryEntity), Building);
      if (rb.ok && rb.value.state !== BUILDING_STATE.COMPLETE) {
        this._releaseGeyser(h, rawId); h.reset(); this._clearHarvestCommand(entity, mv); return;
      }
    }

    const dx = gt.value.pos[0] - tx;
    const dz = gt.value.pos[2] - tz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < GAS_REACH_DIST) {
      this._clearHarvestCommand(entity, mv);
      const current = geyserCurrentWorkers.get(gh);
      const canAdd = gr.value.hasRefinery && (current ? current.size : 0) < GEYSER_MAX_WORKERS;
      if (canAdd) {
        current?.add(rawId);
        h.state = HARVEST_STATE.HARVESTING_GAS;
        h.timer = GAS_HARVEST_DURATION;
        h.isHarvesting = true;
        this._face(entity, dx, dz);
      } else {
        h.timer = 0.5; // workers full -> wait
      }
    } else {
      this._moveToTarget(entity, mv, 'harvest', gt.value.pos[0], gt.value.pos[2], dist);
    }
  }

  private _harvestingGas(
    entity: EntityHandle, h: HarvesterView, mv: MovementView,
    tx: number, tz: number, playerId: number, rawId: number, dt: number,
  ): void {
    const world = this._world;
    h.timer -= dt;
    mv.clearTarget();

    if (h.timer <= 0) {
      h.isHarvesting = false;
      if (h.targetGeyser !== NO_ENTITY && this._alive(h.targetGeyser)) {
        const gh = this._handle(h.targetGeyser);
        const gr = world.get(gh, Geyser);
        if (gr.ok) {
          let harvested = 0;
          if (gr.value.hasRefinery && gr.value.amount > GEYSER_DEPLETED_THRESHOLD) {
            harvested = Math.min(gr.value.amount, GAS_PER_TRIP);
            world.set(gh, Geyser, { amount: gr.value.amount - harvested });
          }
          h.carryAmount = harvested;
          h.carryType = CARRY_TYPE.GAS;
          geyserCurrentWorkers.get(gh)?.delete(rawId);
        }
      }
      const nb = this._findNearestBase(tx, tz, playerId);
      if (nb !== NO_ENTITY) h.targetBase = nb;
      h.state = HARVEST_STATE.RETURNING_GAS;
    }
  }

  private _returningGas(
    entity: EntityHandle, h: HarvesterView, mv: MovementView,
    tx: number, tz: number, playerId: number, rawId: number,
  ): void {
    const world = this._world;
    if (h.targetBase === NO_ENTITY || !this._alive(h.targetBase)) {
      const nb = this._findNearestBase(tx, tz, playerId);
      if (nb === NO_ENTITY) { this._releaseGeyser(h, rawId); h.reset(); this._clearHarvestCommand(entity, mv); return; }
      h.targetBase = nb;
    }
    const bt = world.get(this._handle(h.targetBase), Transform);
    if (!bt.ok) { this._releaseGeyser(h, rawId); h.reset(); this._clearHarvestCommand(entity, mv); return; }

    const dx = bt.value.pos[0] - tx;
    const dz = bt.value.pos[2] - tz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < BASE_REACH_DIST) {
      this._clearHarvestCommand(entity, mv);
      this._rm.addGas(playerId, h.carryAmount);
      h.carryAmount = 0;
      h.carryType = CARRY_TYPE.NONE;
      // continue harvesting if refinery complete + geyser not depleted
      if (h.targetGeyser !== NO_ENTITY && this._alive(h.targetGeyser)) {
        const gr = world.get(this._handle(h.targetGeyser), Geyser);
        if (gr.ok && gr.value.hasRefinery && gr.value.amount > GEYSER_DEPLETED_THRESHOLD) {
          let refComplete = true;
          if (gr.value.refineryEntity !== NO_ENTITY && this._alive(gr.value.refineryEntity)) {
            const rb = world.get(this._handle(gr.value.refineryEntity), Building);
            if (rb.ok && rb.value.state !== BUILDING_STATE.COMPLETE) refComplete = false;
          }
          if (refComplete) { h.state = HARVEST_STATE.MOVING_TO_GAS; return; }
        }
      }
      this._releaseGeyser(h, rawId);
      h.reset();
    } else {
      this._moveToTarget(entity, mv, 'return_cargo', bt.value.pos[0], bt.value.pos[2], dist);
    }
  }

  // ============================================================
  // helpers
  // ============================================================

  private _handle(rawId: number): EntityHandle {
    return rawId as unknown as EntityHandle;
  }

  /** Alive-check (forgeax has no World.isAlive; Transform.ok is the proxy). */
  private _alive(rawId: number): boolean {
    if (rawId === NO_ENTITY) return false;
    return this._world.get(this._handle(rawId), Transform).ok;
  }

  /** Face a target direction (writes Motion.facingY + the Transform yaw quat). */
  private _face(entity: EntityHandle, dx: number, dz: number): void {
    const world = this._world;
    const facing = Math.atan2(dx, dz);
    if (world.get(entity, Motion).ok) world.set(entity, Motion, { facingY: facing });
  }

  /** Nearest available mineral within MINERAL_SEARCH_RADIUS (source logic). */
  private _findNearestMineral(x: number, z: number, selfRawId: number): number {
    const world = this._world;
    let nearest = NO_ENTITY;
    let minDistSq = MINERAL_SEARCH_RADIUS * MINERAL_SEARCH_RADIUS;
    for (const m of this._minerals) {
      const mr = world.get(m.entity, Mineral);
      if (!mr.ok || mr.value.amount <= 0) continue;
      if (mr.value.currentHarvester !== NO_ENTITY && mr.value.currentHarvester !== selfRawId) continue;
      const dx = m.x - x, dz = m.z - z;
      const dsq = dx * dx + dz * dz;
      if (dsq < minDistSq) { minDistSq = dsq; nearest = m.entity as unknown as number; }
    }
    return nearest;
  }

  /** Nearest own completed base (source _findNearestBase, from the snapshot). */
  private _findNearestBase(x: number, z: number, playerId: number): number {
    let nearest = NO_ENTITY;
    let minDistSq = Infinity;
    for (const base of this._bases) {
      if (base.playerId !== playerId) continue;
      const dx = base.x - x, dz = base.z - z;
      const dsq = dx * dx + dz * dz;
      if (dsq < minDistSq) { minDistSq = dsq; nearest = base.entity as unknown as number; }
    }
    return nearest;
  }

  private _releaseMineral(h: HarvesterView): void {
    if (h.targetMineral === NO_ENTITY || !this._alive(h.targetMineral)) return;
    const mh = this._handle(h.targetMineral);
    const mr = this._world.get(mh, Mineral);
    if (mr.ok && mr.value.currentHarvester !== NO_ENTITY) {
      this._world.set(mh, Mineral, { currentHarvester: NO_ENTITY });
    }
  }

  private _releaseGeyser(h: HarvesterView, rawId: number): void {
    if (h.targetGeyser === NO_ENTITY || !this._alive(h.targetGeyser)) return;
    const gh = this._handle(h.targetGeyser);
    geyserCurrentWorkers.get(gh)?.delete(rawId);
    geyserAssignedWorkers.get(gh)?.delete(rawId);
  }

  /**
   * Move toward a harvest target: short hop -> set Movement target directly
   * (keeps currentSpeed continuous); long range -> issue a harvest/return_cargo
   * command for the CommandExecutor to path (source _moveToHarvestTarget).
   */
  private _moveToTarget(
    entity: EntityHandle, mv: MovementView,
    type: 'harvest' | 'return_cargo', targetX: number, targetZ: number, dist: number,
  ): void {
    if (dist <= HARVEST_DIRECT_MOVE_DIST) {
      // clear any leftover harvest path-command, then steer directly
      const cmd = commandCurrent.get(entity);
      if (cmd && (cmd.type === 'harvest' || cmd.type === 'return_cargo')) {
        commandCurrent.set(entity, null);
        const q = commandQueue.get(entity); if (q) q.length = 0;
      }
      mv.setTargetDirect(targetX, targetZ);
    } else {
      this._setHarvestMoveCommand(entity, type, targetX, targetZ);
    }
  }

  /** Long-distance: hand off to CommandExecutor via a harvest/return_cargo move. */
  private _setHarvestMoveCommand(
    entity: EntityHandle, type: 'harvest' | 'return_cargo', targetX: number, targetZ: number,
  ): void {
    const cur = commandCurrent.get(entity);
    if (cur && (cur.type === type || cur.type === 'harvest' || cur.type === 'return_cargo')) {
      if (cur.targetX !== undefined && cur.targetZ !== undefined) {
        const dx = (cur.targetX ?? 0) - targetX;
        const dz = (cur.targetZ ?? 0) - targetZ;
        if (dx * dx + dz * dz < 0.5) return; // target unchanged
      }
    }
    commandCurrent.set(entity, { type, targetX, targetZ } as UnitCommand);
  }

  private _clearHarvestCommand(entity: EntityHandle, mv: MovementView): void {
    mv.clearTarget();
    const cmd = commandCurrent.get(entity);
    if (cmd && (cmd.type === 'harvest' || cmd.type === 'return_cargo')) {
      commandCurrent.set(entity, null);
      const q = commandQueue.get(entity); if (q) q.length = 0;
    }
  }

  // ============================================================
  // public assignment API (source assignWorkersToMineral / assignWorkerToGeyser)
  // ============================================================

  private _assignWorkersToMineral(workers: EntityHandle[], targetMineral: EntityHandle): void {
    const world = this._world;
    const tt = world.get(targetMineral, Transform);
    if (!tt.ok) return;

    // collect available patches near the clicked one (re-scan; snapshot may be
    // stale outside the system tick when this is called from a click handler).
    const nearby: { entity: EntityHandle; distSq: number; x: number; z: number }[] = [];
    for (const m of this._minerals) {
      const mr = world.get(m.entity, Mineral);
      if (!mr.ok || mr.value.amount <= 0) continue;
      const dx = m.x - tt.value.pos[0], dz = m.z - tt.value.pos[2];
      const dsq = dx * dx + dz * dz;
      if (dsq <= MINERAL_SEARCH_RADIUS * MINERAL_SEARCH_RADIUS) nearby.push({ entity: m.entity, distSq: dsq, x: m.x, z: m.z });
    }
    nearby.sort((a, b) => a.distSq - b.distSq);
    if (nearby.length === 0) return;

    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      const hr = world.get(w, Harvester);
      const fr = world.get(w, Faction);
      const wt = world.get(w, Transform);
      if (!hr.ok || !fr.ok || !wt.ok) continue;

      this._releaseMineralFor(w);
      this._releaseGeyserFor(w);

      const assigned = nearby[i % nearby.length].entity;
      const base = this._findNearestBase(wt.value.pos[0], wt.value.pos[2], fr.value.playerId);
      if (base === NO_ENTITY) continue;

      world.set(w, Harvester, {
        state: HARVEST_STATE.MOVING_TO_MINERAL,
        targetMineral: assigned as unknown as number,
        targetBase: base,
        targetGeyser: NO_ENTITY,
        timer: 0, isHarvesting: false,
      });
      commandCurrent.set(w, null);
      const q = commandQueue.get(w); if (q) q.length = 0;
    }
  }

  private _assignWorkerToGeyser(worker: EntityHandle, geyser: EntityHandle): void {
    const world = this._world;
    const hr = world.get(worker, Harvester);
    const fr = world.get(worker, Faction);
    const wt = world.get(worker, Transform);
    const gr = world.get(geyser, Geyser);
    if (!hr.ok || !fr.ok || !wt.ok || !gr.ok) return;
    if (!gr.value.hasRefinery || gr.value.amount <= GEYSER_DEPLETED_THRESHOLD) return;
    if (gr.value.refineryEntity !== NO_ENTITY && this._alive(gr.value.refineryEntity)) {
      const rb = world.get(this._handle(gr.value.refineryEntity), Building);
      if (rb.ok && rb.value.state !== BUILDING_STATE.COMPLETE) return;
    }

    this._releaseMineralFor(worker);
    this._releaseGeyserFor(worker);

    const base = this._findNearestBase(wt.value.pos[0], wt.value.pos[2], fr.value.playerId);
    if (base === NO_ENTITY) return;

    world.set(worker, Harvester, {
      state: HARVEST_STATE.MOVING_TO_GAS,
      targetGeyser: geyser as unknown as number,
      targetBase: base,
      targetMineral: NO_ENTITY,
      timer: 0, isHarvesting: false,
    });
    geyserAssignedWorkers.get(geyser)?.add(worker as unknown as number);
    commandCurrent.set(worker, null);
    const q = commandQueue.get(worker); if (q) q.length = 0;
  }

  /** Release the worker's current mineral occupancy (by reading its Harvester). */
  private _releaseMineralFor(worker: EntityHandle): void {
    const hr = this._world.get(worker, Harvester);
    if (!hr.ok) return;
    const tm = hr.value.targetMineral;
    if (tm === NO_ENTITY || !this._alive(tm)) return;
    const mh = this._handle(tm);
    const mr = this._world.get(mh, Mineral);
    if (mr.ok && mr.value.currentHarvester !== NO_ENTITY) {
      this._world.set(mh, Mineral, { currentHarvester: NO_ENTITY });
    }
  }

  private _releaseGeyserFor(worker: EntityHandle): void {
    const hr = this._world.get(worker, Harvester);
    if (!hr.ok) return;
    const tg = hr.value.targetGeyser;
    if (tg === NO_ENTITY || !this._alive(tg)) return;
    const gh = this._handle(tg);
    const rawId = worker as unknown as number;
    geyserCurrentWorkers.get(gh)?.delete(rawId);
    geyserAssignedWorkers.get(gh)?.delete(rawId);
  }
}
