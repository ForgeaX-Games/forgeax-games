/**
 * MarsCraft -> forgeax-engine — SimpleAI (Milestone M13 — CLOSED, chunks 1 + 2)
 * =============================================================================
 * Port of the AI CORE + ADVANCED behaviors from the Three.js source
 * `web/systems/SimpleAI.ts` (4800 LOC). Drives ONE enemy player:
 *
 *   Economy  — keep workers trained up to the effective cap, assign idle workers
 *              to the nearest mineral patch (harvest-system), build the race's
 *              gas structure + put workers on gas when the build order calls it.
 *   Build order — step through the race's BUILD_ORDER (data/ai-build-orders.ts):
 *              wait_workers / build / gas / train, advancing on completion,
 *              recording a block reason when stuck (resources / prereq / no cell).
 *   Attack waves — when army >= attackThreshold, idle -> rallying (gather at a
 *              point 35% toward the enemy) -> attacking (attack_move to the enemy
 *              base). After a wave the threshold rises (attackThreshold2).
 *   Production — train army units toward the race's targetComposition (biggest
 *              deficit first) from complete production buildings, up to army cap.
 *
 * ── What is REAL here vs the M13 chunk-2 seam ────────────────────────────────
 *   CHUNK 1 (economy skeleton): the update loop, per-frame ECS snapshot, worker
 *   economy + harvest assignment, gas structure + gas workers, the BUILD_ORDER
 *   executor (build/gas/train/wait, prereq-gated, block reasons), army production
 *   by composition deficit, and the idle->rallying->attacking wave state machine.
 *
 *   CHUNK 2 (advanced behaviors — NOW REAL, all wired to the real systems):
 *     - Combat micro: focus-fire the lowest-hp/highest-threat enemy via an
 *       `attack` command (the attack-system honors commandCurrent.attack +
 *       targetEntity), retreat units below retreatHpRatio toward base (re-commit
 *       when healed), pull the army + up to 4 workers home on base-under-attack.
 *     - Scouting: send one idle worker to the enemy base (revealing it updates the
 *       observed enemy-base attack target); track death/arrival, then re-mine.
 *     - Adaptive threat (hard AI): _threatLevel 0/1/2 from recent defenses +
 *       own-vs-enemy strength -> defensive stance (hold army) + stricter expand.
 *     - Expansion: build a new town hall at the nearest un-taken map.baseLocations
 *       via the SAME placement.placeAt commit path (ENEMY owner).
 *     - Research: spend on the race's upgradePriority via buildingSystem.researchUpgrade.
 *     - Building-morph: the build-order `morph` step now calls
 *       buildingSystem.morphBuilding (Hatchery->Lair, CC->Planetary, Gateway->WarpGate).
 *   Zerg-larva production stays routed through the building-system's larva code
 *   (trainUnit on a larva-producer), so Zerg still trains.
 *
 *   Still SIMPLIFIED (documented, not faked): multi-prong split attack (source's
 *   L2 flank branch — this port issues a single-axis attack-move), enemy-strategy
 *   guess (rush/macro/turtle) with its per-strategy expand multipliers (the
 *   numeric _threatLevel drives the stance instead), the enemy-memory decay map
 *   (strength is computed from currently-visible enemies each cycle), and the
 *   mineral-line rebalance / stalled-construction-resume / critical-rebuild
 *   helpers (economy resilience niceties, not core behavior).
 *
 * ── ECS adaptation (vs the source class with world.query / getComponent) ──────
 *   - Runs as ONE ECS system. Its queries (qr[0..3]) snapshot, per frame:
 *       qr[0] all units (Entity+Transform+Faction+UnitType) — own workers/army +
 *             enemy units; qr[1] all buildings (Entity+Transform+Faction+Building
 *             +Health); qr[2] minerals; qr[3] geysers.
 *     No ad-hoc world.query — the source's per-frame world.query calls become
 *     reads over these snapshots (same pattern as harvest-system / combat-registry).
 *   - Commands: the source `_emit(RTSCommand)` becomes DIRECT writes to
 *     `commandCurrent`/`commandQueue` (move/attack_move) + calls to the real
 *     systems (buildingSystem.trainUnit / placement.placeAt / harvest.assign*).
 *   - Building placement reuses `placement.placeAt(..., owner)` (the ONE
 *     commit/spawn/reserve path) with the AI's {playerId,color} — no reimplemented
 *     AI-side build/spend/occupancy.
 *   - No world mutation mid-iteration: the update runs AFTER the query batch loops
 *     finish (the fn snapshots first, then acts), so spawnUnit/despawn inside the
 *     real systems it calls never corrupts this system's batches.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Faction, UnitType, Building, Health, Attack, Mineral, Geyser, Harvester,
  UNIT_CATEGORY, BUILDING_STATE, RACE, NO_ENTITY,
  unitTypeId, buildingTypeId, buildingProductionQueue,
  commandCurrent, commandQueue,
  type UnitCommand,
} from '../components';
import { getUnitDef, type RaceType } from '../data/units';
import { getBuildingDef } from '../data/buildings';
import { getUpgradeDef } from '../data/upgrades';
import {
  DIFFICULTY_CONFIGS, RACE_CONFIGS,
  type AIDifficulty, type DifficultyConfig, type RaceConfig, type BuildStep,
} from '../data/ai-build-orders';
import type { ResourceManager } from './resource-manager';
import { requiresPylonPower, type BuildingSystemHandle } from './building-system';
import type { PlacementHandle } from './placement';
import type { HarvestSystemHandle } from './harvest-system';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

const RACE_CODE_TO_NAME: Record<number, RaceType> = {
  [RACE.TERRAN]: 'terran', [RACE.PROTOSS]: 'protoss', [RACE.ZERG]: 'zerg',
};

/** A snapshotted XZ resource/entity for nearest-search. */
interface XZE { entity: EntityHandle; x: number; z: number; }

/** Per-frame AI snapshot (source AISnapshot, ECS-sourced). */
interface AISnapshot {
  workers: EntityHandle[];
  idleWorkers: EntityHandle[];
  army: EntityHandle[];
  idleArmy: EntityHandle[];
  armyFarFromBase: EntityHandle[];
  buildings: EntityHandle[];
  completeBuildingTypes: Set<string>;
  buildingCounts: Map<string, number>;
  pendingBuildingTypes: Set<string>;
  productionBuildings: EntityHandle[];
  hasBase: boolean;
  baseX: number;
  baseZ: number;
  minerals: number;
  gas: number;
  supply: number;
  supplyMax: number;
  supplyFree: number;
  allEnemyUnits: EntityHandle[];
  /** Enemy army units within the AI's own base defense radius. */
  enemyUnitsNearBase: EntityHandle[];
  /** AI army units near the AI's own base (recall/defense pool). */
  armyNearBase: EntityHandle[];
  /** Rough combat strength of the AI's whole army (DPS·0.5 + hp·0.3). */
  ownStrength: number;
  /** Rough combat strength of visible enemy units (same metric). */
  enemyStrength: number;
  /** Non-empty mineral patches within ~35u of the AI's base (expansion gate). */
  nearbyMineralCount: number;
  enemyBaseX: number;
  enemyBaseZ: number;
}

export interface SimpleAIDeps {
  playerId: number;
  color: number;
  race: RaceType;
  difficulty: AIDifficulty;
  resourceManager: ResourceManager;
  buildingSystem: BuildingSystemHandle;
  placement: PlacementHandle;
  harvest: HarvestSystemHandle;
  isWalkable: (x: number, z: number) => boolean;
  map: { width: number; height: number };
  /**
   * Map-designer base-location centers (mapConfig.baseLocations). The AI expands
   * to the nearest un-taken one; empty = no expansion (falls back to no-op).
   */
  baseLocations?: Array<{ x: number; z: number }>;
  /** Fallback enemy (player) base position, used until one is observed. */
  enemyBase: { x: number; z: number };
}

/** Live AI status for the verify hook (source AIDebugState, trimmed). */
export interface AIState {
  playerId: number;
  race: string;
  gameTime: number;
  buildOrderIndex: number;
  buildOrderTotal: number;
  buildOrderComplete: boolean;
  currentStep: string;
  blockReason: string;
  attackPhase: 'idle' | 'rallying' | 'attacking';
  attackWave: number;
  attackThreshold: number;
  armySize: number;
  workerCount: number;
  minerals: number;
  gas: number;
  supply: number;
  supplyMax: number;
  // ── M13 chunk 2 advanced-behavior state ──
  /** Adaptive threat level (0 safe / 1 alert / 2 danger). */
  threatLevel: 0 | 1 | 2;
  /** Rough own vs enemy strength (verify: threat rises when enemy > own). */
  ownStrength: number;
  enemyStrength: number;
  /** Is a scout currently out finding the enemy base? */
  scouting: boolean;
  /** Number of completed scouting runs. */
  scoutRuns: number;
  /** Extra town halls the AI has queued/built beyond the start base. */
  expansions: number;
  /** Distinct upgrades the AI has queued for research. */
  researchesStarted: number;
  /** Building morphs the AI has kicked off (Hatchery->Lair, CC->Orbital, ...). */
  morphsStarted: number;
  /** Enemy units currently at the AI base (defense trigger). */
  enemyAtBase: number;
}

/** Live micro status for the verify hook (probeAiMicro). */
export interface AIMicroState {
  threatLevel: 0 | 1 | 2;
  ownStrength: number;
  enemyStrength: number;
  /** Army units currently ordered to retreat (wounded, heading home). */
  retreating: number;
  /** Current focus-fire target entity id (-1 = none). */
  focusTarget: number;
  /** Are workers currently pulled to defend the base? */
  workersDefending: boolean;
  scouting: boolean;
  scoutRuns: number;
  expansions: number;
  researchesStarted: number;
  morphsStarted: number;
  enemyAtBase: number;
}

export interface SimpleAIHandle {
  state(): AIState;
  micro(): AIMicroState;
  setDifficulty(name: AIDifficulty): boolean;
}

export class SimpleAI {
  private _world!: World;
  private readonly _playerId: number;
  private readonly _color: number;
  private _race: RaceType;
  private _raceConfig: RaceConfig;
  private _config: DifficultyConfig;
  private readonly _rm: ResourceManager;
  private readonly _bsys: BuildingSystemHandle;
  private readonly _placement: PlacementHandle;
  private readonly _harvest: HarvestSystemHandle;
  private readonly _isWalkable: (x: number, z: number) => boolean;
  private readonly _mapW: number;
  private readonly _mapH: number;
  private readonly _baseLocations: Array<{ x: number; z: number }>;
  private _enemyBaseX: number;
  private _enemyBaseZ: number;

  private _gameTime = 0;
  private _timer = 0;

  // build order progress
  private _buildOrderIndex = 0;
  private _blockReason = '';

  // military state machine
  private _attackWave = 0;
  private _attackPhase: 'idle' | 'rallying' | 'attacking' = 'idle';
  private _rallyStartTime = 0;
  private _gatherX = 0;
  private _gatherZ = 0;
  private _idleWithArmyTimer = 0;
  private _isAttacking = false;

  // build-site spiral cursor
  private _nextBuildAngle = 0;

  // last-observed status for the state() hook
  private _lastArmy = 0;
  private _lastWorkers = 0;

  // ── M13 chunk 2: advanced-behavior state ──
  /** Adaptive threat level (hard AI). 0 safe / 1 alert / 2 danger. */
  private _threatLevel: 0 | 1 | 2 = 0;
  /** Times the base was attacked recently (decays over time). */
  private _recentDefenseCount = 0;
  private _lastDefenseTime = 0;
  private _lastOwnStrength = 0;
  private _lastEnemyStrength = 0;
  /** Consecutive decision cycles with excess minerals (source _excessResourceTicks). */
  private _excessResourceTicks = 0;
  /** Building types the AI has EVER completed — for rebuild of lost critical buildings. */
  private readonly _knownBuildingTypes = new Set<string>();

  // scouting
  private _scoutSent = false;
  private _scoutEntity: EntityHandle | null = null;
  private _scoutCompletedCount = 0;

  // research
  private _researchesStarted = new Set<string>();

  // expansion / morph counters (for the state hook + one-shot gating)
  private _expansionsStarted = 0;
  private _morphsStarted = 0;
  /** Morph build-order steps already dispatched (index-keyed, one-shot). */
  private _morphStepsDone = new Set<number>();

  // combat-micro live status (for probeAiMicro)
  private _retreatingCount = 0;
  private _focusTarget = -1;
  private _workersDefending = false;
  private _lastEnemyAtBase = 0;

  // per-frame resource snapshots (rebuilt each system tick)
  private _minerals: XZE[] = [];
  private _geysers: XZE[] = [];

  constructor(deps: SimpleAIDeps) {
    this._playerId = deps.playerId;
    this._color = deps.color;
    this._race = deps.race;
    this._raceConfig = RACE_CONFIGS[deps.race];
    this._config = DIFFICULTY_CONFIGS[deps.difficulty];
    this._rm = deps.resourceManager;
    this._bsys = deps.buildingSystem;
    this._placement = deps.placement;
    this._harvest = deps.harvest;
    this._isWalkable = deps.isWalkable;
    this._mapW = deps.map.width;
    this._mapH = deps.map.height;
    this._baseLocations = deps.baseLocations ?? [];
    this._enemyBaseX = deps.enemyBase.x;
    this._enemyBaseZ = deps.enemyBase.z;
  }

  install(world: World): SimpleAIHandle {
    this._world = world;
    world.addSystem({
      name: 'mc-simple-ai',
      queries: [
        { with: [Entity, Transform, Faction, UnitType] },            // qr[0] units
        { with: [Entity, Transform, Faction, Building, Health] },    // qr[1] buildings
        { with: [Entity, Transform, Mineral] },                      // qr[2] minerals
        { with: [Entity, Transform, Geyser] },                       // qr[3] geysers
      ],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        if (dt <= 0) return;
        this._gameTime += dt;
        this._timer += dt;
        if (this._timer < this._config.decisionInterval) return;
        this._timer = 0;

        // Snapshot resources first (used by build-site / gas search after loop).
        this._snapshotResources(qr[2] as unknown as Batch[], qr[3] as unknown as Batch[]);
        // Snapshot everything else, THEN act — no world mutation mid-iteration.
        const snap = this._collectSnapshot(qr[0] as unknown as Batch[], qr[1] as unknown as Batch[]);
        this._lastArmy = snap.army.length;
        this._lastWorkers = snap.workers.length;
        this._lastEnemyAtBase = snap.enemyUnitsNearBase.length;
        if (!snap.hasBase) { this._blockReason = 'no base (GG)'; return; }

        // Adaptive threat assessment (hard AI) — must precede economy/expansion
        // (they read _threatLevel) + military (defensive stance).
        if (this._config.adaptiveStrategy) this._updateThreatAssessment(snap);

        this._updateRallyToProduction(snap);
        this._advanceBuildOrder(snap);
        this._manageEconomy(snap);
        this._manageProduction(snap);
        this._manageMilitary(snap);
        this._manageWorkerDefense(snap);
        this._manageScout(snap);
        this._manageResearch(snap);
        this._manageExpansion(snap);
        // remember every building type ever completed (for rebuild), then run the
        // excess-resource + rebuild managers (source _manageExcessResources / _manageRebuild).
        for (const t of snap.completeBuildingTypes) this._knownBuildingTypes.add(t);
        this._manageExcessResources(snap);
        this._manageRebuild(snap);
      },
    });

    return {
      state: () => this._state(),
      micro: () => this._micro(),
      setDifficulty: (name) => {
        const cfg = DIFFICULTY_CONFIGS[name];
        if (!cfg) return false;
        this._config = cfg;
        return true;
      },
    };
  }

  // ==========================================================================
  // Per-frame snapshots
  // ==========================================================================

  private _snapshotResources(mineralBatches: Batch[], geyserBatches: Batch[]): void {
    this._minerals.length = 0;
    for (const b of mineralBatches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        if ((b.Mineral.amount[i] as number) <= 0) continue;
        this._minerals.push({ entity: b.Entity.self[i], x: b.Transform.pos[i * 3], z: b.Transform.pos[i * 3 + 2] });
      }
    }
    this._geysers.length = 0;
    for (const b of geyserBatches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        this._geysers.push({ entity: b.Entity.self[i], x: b.Transform.pos[i * 3], z: b.Transform.pos[i * 3 + 2] });
      }
    }
  }

  private _collectSnapshot(unitBatches: Batch[], buildingBatches: Batch[]): AISnapshot {
    const workers: EntityHandle[] = [];
    const idleWorkers: EntityHandle[] = [];
    const army: EntityHandle[] = [];
    const idleArmy: EntityHandle[] = [];
    const buildings: EntityHandle[] = [];
    const completeBuildingTypes = new Set<string>();
    const buildingCounts = new Map<string, number>();
    const pendingBuildingTypes = new Set<string>();
    const productionBuildings: EntityHandle[] = [];
    const allEnemyUnits: EntityHandle[] = [];
    let hasBase = false;
    let baseX = 0;
    let baseZ = 0;
    let baseSet = false;

    // observed enemy (player) base: first enemy base-equivalent building seen.
    let obsEnemyBaseX = this._enemyBaseX;
    let obsEnemyBaseZ = this._enemyBaseZ;
    let obsEnemyBaseSet = false;

    // ── buildings ──
    for (const b of buildingBatches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        const e = b.Entity.self[i] as EntityHandle;
        if (b.Health.isDead[i]) continue;
        const pid = b.Faction.playerId[i] as number;
        const tid = buildingTypeId.get(e);
        const state = b.Building.state[i] as number;
        const bx = b.Transform.pos[i * 3] as number;
        const bz = b.Transform.pos[i * 3 + 2] as number;

        if (pid === this._playerId) {
          if (!tid) continue;
          buildings.push(e);
          if (state === BUILDING_STATE.COMPLETE || state === BUILDING_STATE.MORPHING) {
            completeBuildingTypes.add(tid);
            buildingCounts.set(tid, (buildingCounts.get(tid) ?? 0) + 1);
            const bDef = getBuildingDef(tid);
            if (bDef && bDef.canProduce.length > 0) productionBuildings.push(e);
            if (this._raceConfig.baseEquivalents.includes(tid)) {
              hasBase = true;
              if (!baseSet) { baseX = bx; baseZ = bz; baseSet = true; }
            }
          } else if (state === BUILDING_STATE.CONSTRUCTING || state === BUILDING_STATE.PLACING) {
            pendingBuildingTypes.add(tid);
          }
        } else if (pid !== 99) {
          // enemy building — locate the player base
          if (!obsEnemyBaseSet && tid && (state === BUILDING_STATE.COMPLETE)) {
            const bDef = getBuildingDef(tid);
            const eqBases = ['command_center', 'orbital_command', 'planetary_fortress', 'hatchery', 'lair', 'hive', 'nexus'];
            if (bDef && eqBases.includes(tid)) { obsEnemyBaseX = bx; obsEnemyBaseZ = bz; obsEnemyBaseSet = true; }
          }
        }
      }
    }

    // ── units ──
    for (const b of unitBatches) {
      const n = b.Entity.self.length as number;
      for (let i = 0; i < n; i++) {
        const e = b.Entity.self[i] as EntityHandle;
        const pid = b.Faction.playerId[i] as number;
        const cat = b.UnitType.category[i] as number;
        // buildings also carry UnitType (category BUILDING) — skip them here.
        if (cat === UNIT_CATEGORY.BUILDING) continue;
        const tid = unitTypeId.get(e);

        if (pid === this._playerId) {
          // zerg overlord counts as neither worker nor army (supply unit).
          if (tid === 'overlord' || tid === 'larva' || tid === 'egg') continue;
          if (cat === UNIT_CATEGORY.WORKER) {
            workers.push(e);
            const cmd = commandCurrent.get(e);
            const hr = this._world.get(e, Harvester);
            const harvIdle = !hr.ok || hr.value.state === 0 /* IDLE */;
            if (!cmd && harvIdle) idleWorkers.push(e); // else busy
          } else {
            army.push(e);
            const cmd = commandCurrent.get(e);
            if (!cmd) idleArmy.push(e);
          }
        } else if (pid !== 99) {
          allEnemyUnits.push(e);
        }
      }
    }

    // classify army by distance to base (near = recall/defense pool)
    const armyFarFromBase: EntityHandle[] = [];
    const armyNearBase: EntityHandle[] = [];
    const nearSq = 30 * 30;
    for (const e of army) {
      const t = this._world.get(e, Transform);
      if (!t.ok) continue;
      const dx = t.value.pos[0] - baseX;
      const dz = t.value.pos[2] - baseZ;
      if (dx * dx + dz * dz >= nearSq) armyFarFromBase.push(e);
      else armyNearBase.push(e);
    }

    // enemy units within the base defense radius (25u, source detectRadius).
    const enemyUnitsNearBase: EntityHandle[] = [];
    if (hasBase) {
      const defSq = 25 * 25;
      for (const e of allEnemyUnits) {
        const t = this._world.get(e, Transform);
        if (!t.ok) continue;
        const dx = t.value.pos[0] - baseX;
        const dz = t.value.pos[2] - baseZ;
        if (dx * dx + dz * dz < defSq) enemyUnitsNearBase.push(e);
      }
    }

    // rough strengths (DPS·0.5 + hp·0.3 over non-worker/-building units).
    const ownStrength = this._estimateStrength(army);
    const enemyStrength = this._estimateStrength(allEnemyUnits);
    this._lastOwnStrength = ownStrength;
    this._lastEnemyStrength = enemyStrength;

    // non-empty minerals within ~35u of the base (expansion saturation gate).
    let nearbyMineralCount = 0;
    const mrSq = 35 * 35;
    for (const m of this._minerals) {
      const dx = m.x - baseX, dz = m.z - baseZ;
      if (dx * dx + dz * dz <= mrSq) nearbyMineralCount++;
    }

    this._enemyBaseX = obsEnemyBaseX;
    this._enemyBaseZ = obsEnemyBaseZ;

    const res = this._rm.getResources(this._playerId);
    const minerals = res?.minerals ?? 0;
    const gas = res?.gas ?? 0;
    const supply = res?.supply ?? 0;
    const supplyMax = res?.supplyMax ?? 0;

    return {
      workers, idleWorkers, army, idleArmy, armyFarFromBase,
      buildings, completeBuildingTypes, buildingCounts, pendingBuildingTypes, productionBuildings,
      hasBase, baseX, baseZ,
      minerals, gas, supply, supplyMax, supplyFree: supplyMax - supply,
      allEnemyUnits, enemyUnitsNearBase, armyNearBase, ownStrength, enemyStrength,
      nearbyMineralCount,
      enemyBaseX: obsEnemyBaseX, enemyBaseZ: obsEnemyBaseZ,
    };
  }

  /** Rough combat strength = Σ(DPS·0.5 + hp·0.3) over non-worker/-building units. */
  private _estimateStrength(units: EntityHandle[]): number {
    let total = 0;
    for (const e of units) {
      const h = this._world.get(e, Health);
      if (!h.ok || h.value.isDead) continue;
      const ut = this._world.get(e, UnitType);
      if (ut.ok && (ut.value.category === UNIT_CATEGORY.WORKER || ut.value.category === UNIT_CATEGORY.BUILDING)) continue;
      const a = this._world.get(e, Attack);
      const dps = a.ok ? a.value.damage / Math.max(0.5, a.value.cooldown) : 0;
      total += dps * 0.5 + h.value.hp * 0.3;
    }
    return total;
  }

  // ==========================================================================
  // Rally point -> production buildings (new units auto-move out)
  // ==========================================================================

  private _updateRallyToProduction(snap: AISnapshot): void {
    const dirX = this._enemyBaseX - snap.baseX;
    const dirZ = this._enemyBaseZ - snap.baseZ;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    const nx = dirX / len, nz = dirZ / len;
    const rallyDist = Math.min(15, len * 0.2);
    const rx = snap.baseX + nx * rallyDist;
    const rz = snap.baseZ + nz * rallyDist;
    for (const e of snap.productionBuildings) {
      const tid = buildingTypeId.get(e);
      if (!tid) continue;
      const bDef = getBuildingDef(tid);
      if (!bDef || bDef.canProduce.length === 0) continue;
      // don't override a worker-producing town-hall's mineral rally with a ground
      // rally (keeps starting-base SCV auto-harvest intact) — only rally combat
      // producers + non-base structures.
      if (this._raceConfig.baseEquivalents.includes(tid)) continue;
      this._bsys.setRally(e, rx, rz);
    }
  }

  // ==========================================================================
  // Build order executor
  // ==========================================================================

  private _advanceBuildOrder(snap: AISnapshot): void {
    const bo = this._raceConfig.buildOrder;
    if (this._buildOrderIndex >= bo.length) { this._blockReason = ''; return; }
    this._blockReason = '';

    const maxSteps = 5;
    let processed = 0;
    let blocked = false;
    const placedThisCycle = new Set<string>();

    while (this._buildOrderIndex < bo.length && processed < maxSteps && !blocked) {
      const step = bo[this._buildOrderIndex];
      processed++;
      switch (step.action) {
        case 'wait_workers':
          if (snap.workers.length >= (step.count ?? 0)) this._buildOrderIndex++;
          else { this._blockReason = `wait_workers ${snap.workers.length}/${step.count ?? 0}`; blocked = true; }
          break;

        case 'wait_supply':
          if (snap.supplyFree >= (step.count ?? 0)) this._buildOrderIndex++;
          else { this._blockReason = `wait_supply ${snap.supplyFree}/${step.count ?? 0}`; blocked = true; }
          break;

        case 'build': {
          const tid = step.typeId;
          if (!tid) { this._buildOrderIndex++; break; }
          if (snap.completeBuildingTypes.has(tid) || snap.pendingBuildingTypes.has(tid) || placedThisCycle.has(tid)) {
            this._buildOrderIndex++; break;
          }
          if (!this._bsys.checkPrerequisites(this._playerId, tid)) {
            this._blockReason = `prereq: ${tid}`; blocked = true; break;
          }
          if (this._tryBuildStructure(tid, snap)) {
            placedThisCycle.add(tid); this._buildOrderIndex++;
          } else {
            this._blockReason = this._buildBlockReason(tid, snap); blocked = true;
          }
          break;
        }

        case 'gas': {
          const gasId = this._raceConfig.gasTypeId;
          if (snap.completeBuildingTypes.has(gasId) || snap.pendingBuildingTypes.has(gasId) || placedThisCycle.has(gasId)) {
            this._buildOrderIndex++; break;
          }
          if (this._tryBuildGas(snap)) { placedThisCycle.add(gasId); this._buildOrderIndex++; }
          else { this._blockReason = 'gas: no geyser/resources'; blocked = true; }
          break;
        }

        case 'train':
          if (step.typeId) this._tryTrainUnit(step.typeId, snap);
          this._buildOrderIndex++;
          break;

        case 'morph': {
          // Building-morph (Hatchery->Lair, CC->Planetary, Gateway->WarpGate):
          // wire to the real buildingSystem.morphBuilding. If the target already
          // exists (morph completed) OR is pending (MORPHING) -> advance. Once the
          // morph is dispatched, advance (the per-frame building system finishes
          // it); if it can't be dispatched yet (prereq/resources/queue), block so
          // the order waits (the source stepped past — this is stricter/faithful
          // to the source's _tryMorphBuilding gate).
          const toId = step.typeId;
          const fromId = step.fromTypeId;
          if (!toId || !fromId) { this._buildOrderIndex++; break; }
          if (snap.completeBuildingTypes.has(toId) || snap.pendingBuildingTypes.has(toId)) {
            this._buildOrderIndex++; break;
          }
          if (this._tryMorphBuilding(fromId, toId, snap)) {
            this._buildOrderIndex++;
          } else {
            // no complete source building yet, or can't afford — wait here so the
            // build order doesn't skip the tech step (unlike chunk-1's step-past).
            this._blockReason = `morph ${fromId}->${toId}`; blocked = true;
          }
          break;
        }
      }
    }
  }

  /**
   * Morph the first complete `fromTypeId` building this player owns into
   * `toTypeId` via the real buildingSystem (charges the cost diff, flips MORPHING;
   * the building system's per-frame tick finishes it). Returns true on dispatch.
   */
  private _tryMorphBuilding(fromTypeId: string, toTypeId: string, snap: AISnapshot): boolean {
    const targetDef = getUnitDef(toTypeId);
    if (!targetDef) return false;
    if (!this._bsys.checkPrerequisites(this._playerId, toTypeId)) return false;
    const sourceDef = getUnitDef(fromTypeId);
    const mineralCost = Math.max(0, (targetDef.mineralCost ?? 0) - (sourceDef?.mineralCost ?? 0));
    const gasCost = Math.max(0, (targetDef.gasCost ?? 0) - (sourceDef?.gasCost ?? 0));
    if (!this._rm.canAfford(this._playerId, mineralCost, gasCost, 0)) return false;

    for (const be of snap.buildings) {
      if (buildingTypeId.get(be) !== fromTypeId) continue;
      const bld = this._world.get(be, Building);
      if (!bld.ok || bld.value.state !== BUILDING_STATE.COMPLETE) continue;
      // morph requires an empty production queue (buildingSystem rule).
      const q = buildingProductionQueue.get(be);
      if (q && q.length > 0) continue;
      if (this._bsys.morphBuilding(be, toTypeId)) { this._morphsStarted++; return true; }
    }
    return false;
  }

  private _buildBlockReason(typeId: string, snap: AISnapshot): string {
    const ud = getUnitDef(typeId);
    if (!ud) return `unknown ${typeId}`;
    const reasons: string[] = [];
    if (snap.minerals < ud.mineralCost) reasons.push(`M ${Math.floor(snap.minerals)}/${ud.mineralCost}`);
    if (snap.gas < ud.gasCost) reasons.push(`G ${Math.floor(snap.gas)}/${ud.gasCost}`);
    if (snap.workers.length === 0) reasons.push('no worker');
    return reasons.length ? `${typeId}: ${reasons.join(', ')}` : `${typeId}: no cell`;
  }

  // ==========================================================================
  // Economy: workers + supply + gas
  // ==========================================================================

  private _manageEconomy(snap: AISnapshot): void {
    // idle workers -> nearest mineral patch
    for (const w of snap.idleWorkers) {
      const t = this._world.get(w, Transform);
      if (!t.ok) continue;
      const m = this._findBestMineral(t.value.pos[0], t.value.pos[2], snap.baseX, snap.baseZ);
      if (m) this._harvest.assignWorkersToMineral([w], m);
    }

    // train workers up to the effective cap
    const cap = this._effectiveMaxWorkers(snap);
    if (snap.workers.length < cap && snap.hasBase && snap.supplyFree > 0) {
      this._tryTrainUnit(this._raceConfig.workerTypeId, snap);
    }

    // supply pre-build when nearly capped
    this._manageSupply(snap);

    // put workers on gas once a gas structure is complete
    this._manageGas(snap);
  }

  /** Effective worker cap = min(config, ~2/patch near base + 4 margin). */
  private _effectiveMaxWorkers(snap: AISnapshot): number {
    let near = 0;
    const rSq = 35 * 35;
    for (const m of this._minerals) {
      const dx = m.x - snap.baseX, dz = m.z - snap.baseZ;
      if (dx * dx + dz * dz <= rSq) near++;
    }
    const gasBuildings = snap.buildingCounts.get(this._raceConfig.gasTypeId) ?? 0;
    const optimal = near * 2 + gasBuildings * 3 + 4;
    return Math.min(this._config.maxWorkers, Math.max(optimal, 16));
  }

  private _manageSupply(snap: AISnapshot): void {
    const threshold = this._raceConfig.supplyIsUnit ? 2 : 4;
    if (snap.supplyFree > threshold) return;
    if (snap.supplyMax >= 240) return; // MAX_SUPPLY_CAP
    if (this._raceConfig.supplyIsUnit) {
      this._tryTrainUnit('overlord', snap);
    } else {
      const sid = this._raceConfig.supplyTypeId;
      if (snap.pendingBuildingTypes.has(sid)) return; // already building one
      this._tryBuildStructure(sid, snap);
    }
  }

  private _manageGas(snap: AISnapshot): void {
    const gasId = this._raceConfig.gasTypeId;
    if (!snap.completeBuildingTypes.has(gasId)) return;
    // find AI gas buildings + assign up to 3 workers each from mineral line.
    for (const be of snap.buildings) {
      const tid = buildingTypeId.get(be);
      if (tid !== gasId) continue;
      const bld = this._world.get(be, Building);
      if (!bld.ok || bld.value.state !== BUILDING_STATE.COMPLETE) continue;
      const geyserE = bld.value.attachedGeyser;
      if (geyserE < 0) continue;
      const geyser = this._world.get(geyserE as unknown as EntityHandle, Geyser);
      if (!geyser.ok) continue;
      // count current gas workers by scanning own workers' harvester target.
      let current = 0;
      const candidates: EntityHandle[] = [];
      for (const w of snap.workers) {
        const hr = this._world.get(w, Harvester);
        if (!hr.ok) continue;
        if (hr.value.targetGeyser === geyserE) current++;
        else if (hr.value.targetGeyser === NO_ENTITY) candidates.push(w);
      }
      let assigned = 0;
      const need = 3 - current;
      for (const w of candidates) {
        if (assigned >= need) break;
        this._harvest.assignWorkerToGeyser(w, geyserE as unknown as EntityHandle);
        assigned++;
      }
    }
  }

  private _findBestMineral(wx: number, wz: number, baseX: number, baseZ: number): EntityHandle | null {
    let best: EntityHandle | null = null;
    let bestScore = -Infinity;
    const rSq = 35 * 35;
    for (const m of this._minerals) {
      const dbx = m.x - baseX, dbz = m.z - baseZ;
      if (dbx * dbx + dbz * dbz > rSq) continue;
      const mr = this._world.get(m.entity, Mineral);
      if (!mr.ok || mr.value.amount <= 0) continue;
      const dx = m.x - wx, dz = m.z - wz;
      const distSq = dx * dx + dz * dz;
      const hasWorker = mr.value.currentHarvester !== NO_ENTITY;
      const score = (hasWorker ? 0 : 10000) - distSq;
      if (score > bestScore) { bestScore = score; best = m.entity; }
    }
    return best;
  }

  // ==========================================================================
  // Building placement (via placement.placeAt with AI owner override)
  // ==========================================================================

  private _findAvailableWorker(snap: AISnapshot): EntityHandle | null {
    for (const w of snap.idleWorkers) {
      const cmd = commandCurrent.get(w);
      if (cmd && cmd.type === 'build') continue;
      return w;
    }
    for (const w of snap.workers) {
      const cmd = commandCurrent.get(w);
      if (cmd && cmd.type === 'build') continue;
      return w;
    }
    return null;
  }

  private _tryBuildStructure(typeId: string, snap: AISnapshot): boolean {
    if (snap.workers.length === 0) return false;
    if (!this._bsys.checkPrerequisites(this._playerId, typeId)) return false;
    const ud = getUnitDef(typeId);
    if (!ud) return false;
    if (!this._rm.canAfford(this._playerId, ud.mineralCost, ud.gasCost, 0)) return false;
    const builder = this._findAvailableWorker(snap);
    if (!builder) return false;
    const pos = this._findBuildPosition(typeId, snap);
    if (!pos) return false;
    const e = this._placement.placeAt(typeId, pos.x, pos.z, builder, { playerId: this._playerId, color: this._color });
    return e !== null;
  }

  private _tryBuildGas(snap: AISnapshot): boolean {
    if (snap.workers.length === 0) return false;
    const gasId = this._raceConfig.gasTypeId;
    const ud = getUnitDef(gasId);
    if (!ud) return false;
    if (!this._rm.canAfford(this._playerId, ud.mineralCost, ud.gasCost, 0)) return false;
    const geyser = this._findFreeGeyserNearBase(snap);
    if (!geyser) return false;
    const builder = this._findAvailableWorker(snap);
    if (!builder) return false;
    const e = this._placement.placeAt(gasId, geyser.x, geyser.z, builder, { playerId: this._playerId, color: this._color });
    return e !== null;
  }

  private _findFreeGeyserNearBase(snap: AISnapshot): XZE | null {
    let best: XZE | null = null;
    let bestSq = Infinity;
    const rSq = 30 * 30;
    for (const g of this._geysers) {
      const gr = this._world.get(g.entity, Geyser);
      if (!gr.ok || gr.value.hasRefinery) continue;
      const dx = g.x - snap.baseX, dz = g.z - snap.baseZ;
      const distSq = dx * dx + dz * dz;
      if (distSq > rSq) continue;
      if (distSq < bestSq) { bestSq = distSq; best = g; }
    }
    return best;
  }

  /**
   * Spiral search for a walkable build cell near the base. placement.placeAt does
   * the authoritative footprint/free/cost/prereq validation, so this just offers
   * candidate centers on a walkable spiral; placeAt rejects blocked ones.
   */
  private _findBuildPosition(typeId: string, snap: AISnapshot): { x: number; z: number } | null {
    const bDef = getBuildingDef(typeId);
    const footprint = bDef?.footprint ?? 2;
    const halfW = this._mapW / 2, halfH = this._mapH / 2;
    const minDist = footprint + 3;
    // Protoss powered buildings must land inside a friendly pylon field — else
    // placement.placeAt rejects them and the build order stalls (mirrors the
    // engine's pylon-power gate). Filter spiral candidates by power for those.
    const needsPower = getUnitDef(typeId)?.race === 'protoss' && requiresPylonPower(typeId);
    for (let ring = 1; ring <= 10; ring++) {
      const dist = minDist + 1 + (ring - 1) * Math.max(3, minDist - 1);
      const angleStep = Math.max(Math.PI / 12, minDist / dist);
      for (let a = 0; a < Math.PI * 2; a += angleStep) {
        const angle = a + this._nextBuildAngle;
        const bx = snap.baseX + Math.cos(angle) * dist;
        const bz = snap.baseZ + Math.sin(angle) * dist;
        const hf = footprint / 2;
        if (bx - hf < -halfW + 1 || bx + hf > halfW - 1 || bz - hf < -halfH + 1 || bz + hf > halfH - 1) continue;
        if (!this._isWalkable(bx, bz)) continue;
        if (needsPower && !this._bsys.isPoweredAt(this._playerId, bx, bz)) continue;
        this._nextBuildAngle += 1.2;
        return { x: bx, z: bz };
      }
    }
    return null;
  }

  // ==========================================================================
  // Army production (by target-composition deficit)
  // ==========================================================================

  private _effectiveMaxArmy(): number {
    const gameMin = this._gameTime / 60;
    const dyn = this._config.maxArmy + Math.floor(gameMin * this._config.maxArmyPerMinute);
    return Math.min(dyn, this._config.maxArmyCap);
  }

  private _manageProduction(snap: AISnapshot): void {
    if (snap.army.length >= this._effectiveMaxArmy()) return;
    if (snap.supplyFree <= 0) return;

    // count current army by type
    const counts = new Map<string, number>();
    for (const e of snap.army) {
      const tid = unitTypeId.get(e);
      if (tid) counts.set(tid, (counts.get(tid) ?? 0) + 1);
    }

    // candidate units = composition entries whose tech is unlocked (trainable by
    // some complete production building + train prereqs met).
    const comp = this._raceConfig.targetComposition;
    const trainable = new Set<string>();
    for (const be of snap.productionBuildings) {
      const tid = buildingTypeId.get(be);
      if (!tid) continue;
      const bDef = getBuildingDef(tid);
      if (!bDef) continue;
      for (const u of bDef.canProduce) if (u in comp) trainable.add(u);
    }
    const active: string[] = [];
    let totalWeight = 0;
    for (const u of Object.keys(comp)) {
      if (!trainable.has(u)) continue;
      const ud = getUnitDef(u);
      if (!ud) continue;
      if (ud.trainPrerequisite && ud.trainPrerequisite.length > 0) {
        if (!ud.trainPrerequisite.every((p) => snap.completeBuildingTypes.has(p))) continue;
      }
      active.push(u);
      totalWeight += comp[u];
    }
    if (active.length === 0 || totalWeight === 0) return;

    const totalArmy = Math.max(1, snap.army.length);
    // deficit = desired ratio - current ratio; biggest first
    const ranked = active
      .map((u) => {
        const desired = comp[u] / totalWeight;
        const current = (counts.get(u) ?? 0) / totalArmy;
        return { u, deficit: desired - current };
      })
      .sort((a, b) => b.deficit - a.deficit);

    // train the top-deficit unit from a free (empty-queue) production building.
    for (const { u } of ranked) {
      if (snap.army.length >= this._effectiveMaxArmy()) break;
      const ud = getUnitDef(u);
      if (!ud) continue;
      if (!this._rm.canAfford(this._playerId, ud.mineralCost, ud.gasCost, ud.supplyCost)) continue;
      if (this._tryTrainUnit(u, snap)) return; // one per cycle keeps it steady
    }
  }

  private _tryTrainUnit(typeId: string, snap: AISnapshot): boolean {
    const ud = getUnitDef(typeId);
    if (!ud) return false;
    if (!this._rm.canAfford(this._playerId, ud.mineralCost, ud.gasCost, ud.supplyCost)) return false;

    // find a complete AI building that can produce this unit (prefer empty queue).
    let fallback: EntityHandle | null = null;
    for (const be of snap.buildings) {
      const bld = this._world.get(be, Building);
      if (!bld.ok || bld.value.state !== BUILDING_STATE.COMPLETE) continue;
      const tid = buildingTypeId.get(be);
      if (!tid) continue;
      const bDef = getBuildingDef(tid);
      if (!bDef || !bDef.canProduce.includes(typeId)) continue;
      const q = buildingProductionQueue.get(be);
      if (!q || q.length === 0) return this._bsys.trainUnit(be, typeId);
      if (!fallback) fallback = be;
    }
    if (fallback) return this._bsys.trainUnit(fallback, typeId);
    return false;
  }

  // ==========================================================================
  // Military: idle -> rallying -> attacking wave state machine
  // ==========================================================================

  private _manageMilitary(snap: AISnapshot): void {
    // Reset per-cycle micro status (recomputed below).
    this._retreatingCount = 0;
    this._focusTarget = -1;

    // ── combat micro: pull wounded units back toward base (kite/heal) ──
    if (this._config.retreatHpRatio > 0) this._retreatWoundedUnits(snap);

    if (!this._config.willAttack) { this._rallyIdleArmy(snap); return; }

    // ── base under attack: recall + focus-fire defense (highest priority) ──
    if (snap.enemyUnitsNearBase.length > 0) {
      // record a defense event (decayed in _updateThreatAssessment).
      if (this._config.adaptiveStrategy && this._gameTime - this._lastDefenseTime > 30) {
        this._recentDefenseCount++;
        this._lastDefenseTime = this._gameTime;
      }
      // abort an in-progress rally: defending home comes first.
      if (this._attackPhase === 'rallying') this._attackPhase = 'idle';
      if (this._config.willFocusFire) this._defendBaseWithFocusFire(snap);
      else this._defendBase(snap.armyNearBase, snap.baseX, snap.baseZ);
      // recall idle far-away army to help.
      for (const e of snap.armyFarFromBase) {
        if (commandCurrent.get(e)) continue;
        this._issue(e, 'attack_move', snap.baseX + (Math.random() - 0.5) * 6, snap.baseZ + (Math.random() - 0.5) * 6);
      }
      return;
    }

    // ── defensive stance: threat=2 holds the army home instead of pushing ──
    if (this._threatLevel >= 2 && this._attackPhase === 'idle') {
      this._rallyIdleArmy(snap);
      return;
    }

    const dirX = this._enemyBaseX - snap.baseX;
    const dirZ = this._enemyBaseZ - snap.baseZ;

    switch (this._attackPhase) {
      case 'idle': {
        const threshold = this._currentThreshold();
        if (snap.army.length >= threshold) {
          this._idleWithArmyTimer += this._config.decisionInterval;
          // gather 35% of the way to the enemy base
          this._gatherX = snap.baseX + dirX * 0.35;
          this._gatherZ = snap.baseZ + dirZ * 0.35;
          this._attackPhase = 'rallying';
          this._rallyStartTime = this._gameTime;
          this._sendToGather(snap.army);
        } else {
          this._idleWithArmyTimer = 0;
          this._rallyIdleArmy(snap);
        }
        break;
      }

      case 'rallying': {
        const gathered = this._countNear(snap.army, this._gatherX, this._gatherZ, 12);
        const ratio = snap.army.length > 0 ? gathered / snap.army.length : 0;
        this._sendToGather(snap.idleArmy);
        const timeout = this._gameTime - this._rallyStartTime > 15;
        if (ratio >= 0.8 || timeout) {
          this._attackPhase = 'attacking';
          this._attackWave++;
          this._isAttacking = true;
          this._attackMove(snap.army);
        }
        break;
      }

      case 'attacking': {
        // wave over: army thinned below 40% of the first threshold, OR most units
        // have drifted back near the base -> reset to idle (threshold rose).
        const thinned = snap.army.length < this._config.attackThreshold * 0.4;
        const returned = snap.armyFarFromBase.length <= 2;
        if (thinned || returned) {
          this._attackPhase = 'idle';
          this._isAttacking = false;
          break;
        }
        // keep pushing idle stragglers toward the enemy base
        for (const e of snap.idleArmy) {
          this._issue(e, 'attack_move', this._enemyBaseX + (Math.random() - 0.5) * 8, this._enemyBaseZ + (Math.random() - 0.5) * 8);
        }
        break;
      }
    }
  }

  private _currentThreshold(): number {
    const base = this._attackWave === 0 ? this._config.attackThreshold : this._config.attackThreshold2;
    // never exceed 90% of the army cap (avoids a permanent deadlock).
    return Math.min(base, Math.max(1, Math.floor(this._effectiveMaxArmy() * 0.9)));
  }

  private _rallyIdleArmy(snap: AISnapshot): void {
    const dirX = this._enemyBaseX - snap.baseX;
    const dirZ = this._enemyBaseZ - snap.baseZ;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    const rallyDist = Math.min(15, len * 0.2);
    const rx = snap.baseX + (dirX / len) * rallyDist;
    const rz = snap.baseZ + (dirZ / len) * rallyDist;
    for (const e of snap.idleArmy) {
      this._issue(e, 'attack_move', rx + (Math.random() - 0.5) * 6, rz + (Math.random() - 0.5) * 6);
    }
  }

  private _sendToGather(units: EntityHandle[]): void {
    for (const e of units) {
      if (commandCurrent.get(e)) continue; // don't override existing orders
      this._issue(e, 'attack_move', this._gatherX + (Math.random() - 0.5) * 8, this._gatherZ + (Math.random() - 0.5) * 8);
    }
  }

  private _attackMove(army: EntityHandle[]): void {
    for (const e of army) {
      this._issue(e, 'attack_move', this._enemyBaseX + (Math.random() - 0.5) * 6, this._enemyBaseZ + (Math.random() - 0.5) * 6);
    }
  }

  private _issue(e: EntityHandle, type: 'move' | 'attack_move', tx: number, tz: number): void {
    const cmd: UnitCommand = { type, targetX: tx, targetZ: tz };
    commandCurrent.set(e, cmd);
    const q = commandQueue.get(e); if (q) q.length = 0;
  }

  private _countNear(units: EntityHandle[], x: number, z: number, radius: number): number {
    const rSq = radius * radius;
    let n = 0;
    for (const e of units) {
      const t = this._world.get(e, Transform);
      if (!t.ok) continue;
      const dx = t.value.pos[0] - x, dz = t.value.pos[2] - z;
      if (dx * dx + dz * dz <= rSq) n++;
    }
    return n;
  }

  // ==========================================================================
  // Combat micro (retreat wounded / focus-fire / base defense)
  // ==========================================================================

  /**
   * Pull army units below `retreatHpRatio` HP back toward the base (away from the
   * enemy). Only re-issues if not already retreating; healthy units untouched, so
   * they re-commit to the fight once healed (their attack-move/attack resumes).
   */
  private _retreatWoundedUnits(snap: AISnapshot): void {
    const ratio = this._config.retreatHpRatio;
    const dirX = snap.baseX - this._enemyBaseX;
    const dirZ = snap.baseZ - this._enemyBaseZ;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    const nx = dirX / len, nz = dirZ / len;
    let retreating = 0;
    for (const e of snap.army) {
      const h = this._world.get(e, Health);
      if (!h.ok || h.value.maxHp <= 0) continue;
      if (h.value.hp / h.value.maxHp > ratio) continue; // healthy -> stays committed
      const cur = commandCurrent.get(e);
      if (cur && cur.type === 'move') { retreating++; continue; } // already retreating
      const rx = snap.baseX + nx * 10 + (Math.random() - 0.5) * 4;
      const rz = snap.baseZ + nz * 10 + (Math.random() - 0.5) * 4;
      this._issue(e, 'move', rx, rz);
      retreating++;
    }
    this._retreatingCount = retreating;
  }

  /** Recall + focus-fire the lowest-hp / highest-threat enemy at the base. */
  private _defendBaseWithFocusFire(snap: AISnapshot): void {
    const focus = this._findBestFocusTarget(snap.enemyUnitsNearBase);
    this._focusTarget = focus !== null ? (focus as unknown as number) : -1;
    for (const e of snap.armyNearBase) {
      // don't override a unit already locked onto a target (mid-attack).
      const a = this._world.get(e, Attack);
      if (a.ok && a.value.targetEntity >= 0 && a.value.isAttacking) continue;
      if (focus !== null) {
        const cmd: UnitCommand = {
          type: 'attack', targetEntity: focus as unknown as number,
          targetX: snap.baseX, targetZ: snap.baseZ,
        };
        commandCurrent.set(e, cmd);
        const q = commandQueue.get(e); if (q) q.length = 0;
      } else if (!commandCurrent.get(e)) {
        this._issue(e, 'attack_move', snap.baseX + (Math.random() - 0.5) * 8, snap.baseZ + (Math.random() - 0.5) * 8);
      }
    }
  }

  /** Lowest-hp-first, threat-weighted focus target (source _findBestFocusTarget). */
  private _findBestFocusTarget(enemies: EntityHandle[]): EntityHandle | null {
    let best: EntityHandle | null = null;
    let bestScore = -Infinity;
    for (const e of enemies) {
      const h = this._world.get(e, Health);
      if (!h.ok || h.value.hp <= 0 || h.value.maxHp <= 0) continue;
      const a = this._world.get(e, Attack);
      const threat = a.ok ? a.value.damage / Math.max(0.5, a.value.cooldown) : 1;
      const hpRatio = h.value.hp / h.value.maxHp;
      const score = threat / (hpRatio + 0.1); // low hp + high threat -> high score
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  /** Recall to the base without focus-fire (easy AI / willFocusFire=false). */
  private _defendBase(army: EntityHandle[], baseX: number, baseZ: number): void {
    for (const e of army) {
      const a = this._world.get(e, Attack);
      if (a.ok && a.value.isAttacking) continue;
      const cur = commandCurrent.get(e);
      if (cur && (cur.type === 'attack_move' || cur.type === 'attack')) continue;
      this._issue(e, 'attack_move', baseX + (Math.random() - 0.5) * 8, baseZ + (Math.random() - 0.5) * 8);
    }
  }

  /** Pull up to 4 nearby workers to swarm a small base attack (source S4). */
  private _manageWorkerDefense(snap: AISnapshot): void {
    const hasEnemyAtBase = snap.enemyUnitsNearBase.length > 0;
    if (hasEnemyAtBase && !this._workersDefending) {
      const enemyCount = snap.enemyUnitsNearBase.length;
      const armyNearby = snap.armyNearBase.length;
      // small rush + not enough army on hand -> pull workers.
      if (enemyCount <= 4 && armyNearby < enemyCount && snap.workers.length >= 4) {
        this._workersDefend(snap);
        this._workersDefending = true;
      }
    } else if (!hasEnemyAtBase && this._workersDefending) {
      this._workersDefending = false;
    }
  }

  private _workersDefend(snap: AISnapshot): void {
    // enemy centroid.
    let ex = 0, ez = 0, n = 0;
    for (const e of snap.enemyUnitsNearBase) {
      const t = this._world.get(e, Transform);
      if (t.ok) { ex += t.value.pos[0]; ez += t.value.pos[2]; n++; }
    }
    if (n === 0) return;
    ex /= n; ez /= n;
    // nearest 4 workers.
    const ranked = snap.workers
      .map((e) => {
        const t = this._world.get(e, Transform);
        if (!t.ok) return { e, d: Infinity };
        const dx = t.value.pos[0] - ex, dz = t.value.pos[2] - ez;
        return { e, d: dx * dx + dz * dz };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    for (const { e } of ranked) {
      this._issue(e, 'attack_move', ex + (Math.random() - 0.5) * 3, ez + (Math.random() - 0.5) * 3);
    }
  }

  // ==========================================================================
  // Adaptive threat assessment (hard AI)
  // ==========================================================================

  /**
   * Compute `_threatLevel` (0 safe / 1 alert / 2 danger) from recent base
   * attacks + the observed enemy-vs-own strength ratio. Source
   * _updateThreatAssessment (strategy-guess branch dropped — the numeric threat
   * is what expansion/military read).
   */
  private _updateThreatAssessment(snap: AISnapshot): void {
    const gameMin = this._gameTime / 60;
    // decay: no attack for 3 min -> ease off the counter.
    if (this._gameTime - this._lastDefenseTime > 180) {
      this._recentDefenseCount = Math.max(0, this._recentDefenseCount - 1);
      this._lastDefenseTime = this._gameTime;
    }

    let threat: 0 | 1 | 2 = 0;
    if (this._recentDefenseCount >= 2) threat = 2;
    else if (this._recentDefenseCount >= 1) threat = 1;

    const own = snap.ownStrength;
    const enemy = snap.enemyStrength;
    if (enemy > 0 && own < enemy * 0.7) threat = Math.max(threat, 1) as 0 | 1 | 2;
    if (enemy > 0 && own < enemy * 0.4) threat = 2;
    // early flood of enemy army -> rush -> danger.
    if (gameMin < 3 && enemy > 30) threat = 2;

    this._threatLevel = threat;
  }

  // ==========================================================================
  // Scouting
  // ==========================================================================

  /**
   * Send one idle worker to the enemy base to reveal it (the observed base then
   * becomes the attack target via _collectSnapshot's enemy-building scan). Tracks
   * the scout: on death/arrival it returns to mining and a run completes. Early:
   * 1 scout; after 5 min a 2nd is allowed.
   */
  private _manageScout(snap: AISnapshot): void {
    if (!this._config.willScout) return;

    if (this._scoutSent && this._scoutEntity !== null) {
      const scout = this._scoutEntity;
      const h = this._world.get(scout, Health);
      // dead -> run over.
      if (!h.ok || h.value.isDead) {
        this._scoutSent = false; this._scoutEntity = null; this._scoutCompletedCount++;
        return;
      }
      const cmd = commandCurrent.get(scout);
      // arrived (command cleared) -> back to mining, run over.
      if (!cmd) {
        const t = this._world.get(scout, Transform);
        if (t.ok) {
          const m = this._findBestMineral(t.value.pos[0], t.value.pos[2], snap.baseX, snap.baseZ);
          if (m) this._harvest.assignWorkersToMineral([scout], m);
        }
        this._scoutSent = false; this._scoutEntity = null; this._scoutCompletedCount++;
        return;
      }
      // wounded -> recall home.
      if (h.value.maxHp > 0 && h.value.hp < h.value.maxHp * 0.5) {
        this._issue(scout, 'move', snap.baseX + (Math.random() - 0.5) * 4, snap.baseZ + (Math.random() - 0.5) * 4);
      }
      return;
    }

    const maxScouts = this._gameTime > 300 ? 2 : 1;
    if (this._scoutCompletedCount >= maxScouts) return;
    if (snap.workers.length < 8) return;
    if (snap.idleWorkers.length === 0) return;
    const scout = snap.idleWorkers[snap.idleWorkers.length - 1];
    if (!scout) return;
    this._issue(scout, 'move', this._enemyBaseX + (Math.random() - 0.5) * 10, this._enemyBaseZ + (Math.random() - 0.5) * 10);
    this._scoutSent = true;
    this._scoutEntity = scout;
  }

  // ==========================================================================
  // Research / upgrades
  // ==========================================================================

  /**
   * Research the race's `upgradePriority` upgrades via the real
   * buildingSystem.researchUpgrade once the economy is up (>=10 workers + gas)
   * and the first attack has gone out. One research per decision cycle.
   */
  private _manageResearch(snap: AISnapshot): void {
    if (!this._config.willResearch) return;
    const prio = this._raceConfig.upgradePriority;
    if (!prio || prio.length === 0) return;
    if (snap.workers.length < 10) return;
    if (!snap.completeBuildingTypes.has(this._raceConfig.gasTypeId)) return;
    if (this._attackWave < 1) return; // don't tie up the sole early production building

    for (const [upgradeId, reqBuildingTypeId] of prio) {
      const def = getUpgradeDef(upgradeId);
      if (!def) continue;
      const level = this._bsys.getUpgradeLevel(this._playerId, upgradeId);
      if (level >= def.maxLevel) continue;
      if (!snap.completeBuildingTypes.has(reqBuildingTypeId)) continue;
      const cost = def.mineralCostPerLevel * (level + 1);
      const gasCost = def.gasCostPerLevel * (level + 1);
      if (!this._rm.canAfford(this._playerId, cost, gasCost, 0)) continue;

      // find a complete building of the required type that can research it.
      for (const be of snap.buildings) {
        if (buildingTypeId.get(be) !== reqBuildingTypeId) continue;
        const bld = this._world.get(be, Building);
        if (!bld.ok || bld.value.state !== BUILDING_STATE.COMPLETE) continue;
        const bDef = getBuildingDef(reqBuildingTypeId);
        if (!bDef || !bDef.canResearch.includes(upgradeId)) continue;
        if (this._bsys.researchUpgrade(be, upgradeId)) {
          this._researchesStarted.add(upgradeId);
          return; // one per cycle
        }
      }
    }
  }

  // ==========================================================================
  // Expansion (new town hall at the next map base location)
  // ==========================================================================

  /**
   * Build a new town hall at the nearest un-taken `baseLocations` center when the
   * time + army + (saturation | excess-mineral) conditions are met. Uses the same
   * placement.placeAt commit path (ENEMY owner) as every other AI build.
   */
  private _manageExpansion(snap: AISnapshot): void {
    if (!this._config.willExpand) return;
    if (this._baseLocations.length === 0) return;

    const cfg = this._config;
    const baseCount = this._countBases(snap);
    const maxBases = Math.min(5, 3 + Math.floor(this._gameTime / 300));
    if (baseCount >= maxBases) return;

    // already building one?
    for (const baseId of this._raceConfig.baseEquivalents) {
      if (snap.pendingBuildingTypes.has(baseId)) return;
    }

    const extraBases = Math.max(0, baseCount - 1);
    // time + army gates (defensive stance stretches them via threat level).
    const timeMul = this._threatLevel === 2 ? 1.5 : this._threatLevel === 1 ? 1.0 : 0.7;
    const armyMul = this._threatLevel === 2 ? 1.8 : this._threatLevel === 1 ? 1.0 : 0.7;
    const minTime = (cfg.expandMinTime + extraBases * cfg.expandExtraTimePerBase) * timeMul;
    if (this._gameTime < minTime) return;
    const minArmy = Math.ceil((cfg.expandMinArmy + extraBases * cfg.expandExtraArmyPerBase) * armyMul);
    if (snap.army.length < minArmy) return;

    // don't expand while the base is under attack, or badly outmatched.
    if (snap.enemyUnitsNearBase.length > 0) return;
    if (snap.enemyStrength > 0 && snap.ownStrength < snap.enemyStrength * 0.6) return;

    // need at least one production building + build order ~60% through.
    if (snap.productionBuildings.length < 1) return;
    const bo = this._raceConfig.buildOrder;
    const boProgress = bo.length > 0 ? this._buildOrderIndex / bo.length : 1;
    if (boProgress < 0.6) return;

    // trigger: mineral line saturated OR minerals hoarding.
    const optimalWorkers = snap.nearbyMineralCount * 2;
    const excessThreshold = Math.ceil(cfg.expandExcessMineralThreshold * (this._threatLevel === 2 ? 1.5 : 1));
    const saturated = snap.workers.length >= optimalWorkers && snap.workers.length >= 16;
    const excess = snap.minerals >= excessThreshold && snap.workers.length >= 18 && snap.army.length >= minArmy;
    if (!saturated && !excess) return;

    // resources for the town hall (+100 buffer).
    const baseTypeId = this._raceConfig.baseEquivalents[0];
    const baseDef = getUnitDef(baseTypeId);
    if (!baseDef) return;
    if (snap.minerals < baseDef.mineralCost + 100) return;
    if (!this._rm.canAfford(this._playerId, baseDef.mineralCost, baseDef.gasCost, 0)) return;

    const loc = this._findExpansionLocation(snap);
    if (!loc) return;
    const builder = this._findAvailableWorker(snap);
    if (!builder) return;
    const e = this._placement.placeAt(baseTypeId, loc.x, loc.z, builder, { playerId: this._playerId, color: this._color });
    if (e) this._expansionsStarted++;
  }

  private _countBases(snap: AISnapshot): number {
    let n = 0;
    for (const baseId of this._raceConfig.baseEquivalents) n += snap.buildingCounts.get(baseId) ?? 0;
    return n;
  }

  /**
   * Spend BANKED minerals so the AI never sits idle on a big bank (source
   * `_manageExcessResources`). Requires 2 consecutive over-threshold cycles
   * (anti-flicker): Zerg → extra Hatchery (≤3 bases); else / Zerg-with-bases →
   * extra production buildings up to `maxProductionBuildings`; if those are full →
   * extra supply. One structure per cycle.
   */
  private _manageExcessResources(snap: AISnapshot): void {
    if (snap.minerals < this._config.excessMineralThreshold) { this._excessResourceTicks = 0; return; }
    this._excessResourceTicks++;
    if (this._excessResourceTicks < 2) return;

    // Zerg banks → extra Hatchery (up to 3 bases).
    if (this._race === 'zerg') {
      const bases = this._countBases(snap);
      const pendingBase = ['hatchery', 'lair', 'hive'].some((b) => snap.pendingBuildingTypes.has(b));
      if (bases < 3 && !pendingBase && this._tryBuildStructure('hatchery', snap)) { this._excessResourceTicks = 0; return; }
    }

    // extra production buildings up to the difficulty cap.
    for (const prodTypeId of this._raceConfig.productionBuildings) {
      const cur = snap.buildingCounts.get(prodTypeId) ?? 0;
      if (cur >= this._config.maxProductionBuildings) continue;
      if (snap.pendingBuildingTypes.has(prodTypeId)) continue;
      if (!this._bsys.checkPrerequisites(this._playerId, prodTypeId)) continue;
      if (this._tryBuildStructure(prodTypeId, snap)) { this._excessResourceTicks = 0; return; }
    }

    // production full → extra supply so army production isn't supply-blocked.
    if (snap.supplyFree < 8) {
      if (this._raceConfig.supplyIsUnit) this._tryTrainUnit('overlord', snap);
      else this._tryBuildStructure(this._raceConfig.supplyTypeId, snap);
    }
  }

  /**
   * (Re)build lost or missing critical buildings (source `_manageRebuild`), so a
   * razed barracks/pool or a never-built tech prereq doesn't permanently stall the
   * AI. Two classes: KNOWN-CRITICAL (supply / gas / production) rebuilt only if
   * once completed; MUST-HAVE (unit train-prerequisites + build-order buildings,
   * once the build order is done) built whenever absent. One structure per cycle;
   * a missing direct prerequisite is recovered first.
   */
  private _manageRebuild(snap: AISnapshot): void {
    const knownCritical = new Set<string>([
      this._raceConfig.supplyTypeId, this._raceConfig.gasTypeId, ...this._raceConfig.productionBuildings,
    ]);
    const mustHave = new Set<string>();
    for (const unitId of Object.keys(this._raceConfig.targetComposition)) {
      const ud = getUnitDef(unitId);
      if (ud?.trainPrerequisite) for (const p of ud.trainPrerequisite) mustHave.add(p);
    }
    if (this._buildOrderIndex >= this._raceConfig.buildOrder.length) {
      for (const step of this._raceConfig.buildOrder) if (step.action === 'build' && step.typeId) mustHave.add(step.typeId);
    }

    for (const typeId of new Set([...knownCritical, ...mustHave])) {
      const isKnownOnly = knownCritical.has(typeId) && !mustHave.has(typeId);
      if (isKnownOnly && !this._knownBuildingTypes.has(typeId)) continue; // never had it → not a rebuild
      if ((snap.buildingCounts.get(typeId) ?? 0) > 0 || snap.pendingBuildingTypes.has(typeId)) continue;
      const ud = getUnitDef(typeId);
      if (ud && snap.minerals < ud.mineralCost) continue;
      if (!this._bsys.checkPrerequisites(this._playerId, typeId)) {
        // must-have with an unmet prereq → try to (re)build a missing DIRECT prereq first.
        if (mustHave.has(typeId)) {
          const def = getBuildingDef(typeId);
          for (const pre of def?.prerequisite ?? []) {
            if ((snap.buildingCounts.get(pre) ?? 0) === 0 && !snap.pendingBuildingTypes.has(pre)
              && this._bsys.checkPrerequisites(this._playerId, pre) && this._tryBuildStructure(pre, snap)) return;
          }
        }
        continue;
      }
      if (this._tryBuildStructure(typeId, snap)) return; // one per cycle
    }
  }

  /** Nearest un-taken map base location (>=20u from any owned base). */
  private _findExpansionLocation(snap: AISnapshot): { x: number; z: number } | null {
    // own base positions.
    const ownBases: Array<{ x: number; z: number }> = [];
    for (const be of snap.buildings) {
      const tid = buildingTypeId.get(be);
      if (!tid || !this._raceConfig.baseEquivalents.includes(tid)) continue;
      const t = this._world.get(be, Transform);
      if (t.ok) ownBases.push({ x: t.value.pos[0], z: t.value.pos[2] });
    }
    let best: { x: number; z: number } | null = null;
    let bestScore = Infinity;
    for (const loc of this._baseLocations) {
      // skip already-owned locations.
      let taken = false;
      let minBaseDist = Infinity;
      for (const bp of ownBases) {
        const dx = loc.x - bp.x, dz = loc.z - bp.z;
        const d = dx * dx + dz * dz;
        if (d < 20 * 20) { taken = true; break; }
        if (d < minBaseDist) minBaseDist = d;
      }
      if (taken) continue;
      if (minBaseDist === Infinity) {
        const dx = loc.x - snap.baseX, dz = loc.z - snap.baseZ;
        minBaseDist = dx * dx + dz * dz;
      }
      // prefer near own bases; lightly penalize sites on the enemy's half.
      const edx = loc.x - this._enemyBaseX, edz = loc.z - this._enemyBaseZ;
      const distToEnemy = edx * edx + edz * edz;
      const penalty = distToEnemy < minBaseDist ? minBaseDist * 0.3 : 0;
      const score = minBaseDist + penalty;
      if (score < bestScore) { bestScore = score; best = { x: loc.x, z: loc.z }; }
    }
    return best;
  }

  // ==========================================================================
  // Verify hook
  // ==========================================================================

  private _state(): AIState {
    const bo = this._raceConfig.buildOrder;
    const idx = this._buildOrderIndex;
    const step = idx < bo.length ? bo[idx] : null;
    const res = this._rm.getResources(this._playerId);
    const stepStr = step ? `${step.action}${step.typeId ? ':' + step.typeId : ''}${step.count ? ':' + step.count : ''}` : 'done';
    return {
      playerId: this._playerId,
      race: this._race,
      gameTime: Number(this._gameTime.toFixed(1)),
      buildOrderIndex: idx,
      buildOrderTotal: bo.length,
      buildOrderComplete: idx >= bo.length,
      currentStep: stepStr,
      blockReason: this._blockReason,
      attackPhase: this._attackPhase,
      attackWave: this._attackWave,
      attackThreshold: this._currentThreshold(),
      armySize: this._lastArmy,
      workerCount: this._lastWorkers,
      minerals: Math.floor(res?.minerals ?? 0),
      gas: Math.floor(res?.gas ?? 0),
      supply: res?.supply ?? 0,
      supplyMax: res?.supplyMax ?? 0,
      threatLevel: this._threatLevel,
      ownStrength: Math.round(this._lastOwnStrength),
      enemyStrength: Math.round(this._lastEnemyStrength),
      scouting: this._scoutSent,
      scoutRuns: this._scoutCompletedCount,
      expansions: this._expansionsStarted,
      researchesStarted: this._researchesStarted.size,
      morphsStarted: this._morphsStarted,
      enemyAtBase: this._lastEnemyAtBase,
    };
  }

  /** Live combat-micro status (source AIDebugState micro fields). */
  private _micro(): AIMicroState {
    return {
      threatLevel: this._threatLevel,
      ownStrength: Math.round(this._lastOwnStrength),
      enemyStrength: Math.round(this._lastEnemyStrength),
      retreating: this._retreatingCount,
      focusTarget: this._focusTarget,
      workersDefending: this._workersDefending,
      scouting: this._scoutSent,
      scoutRuns: this._scoutCompletedCount,
      expansions: this._expansionsStarted,
      researchesStarted: this._researchesStarted.size,
      morphsStarted: this._morphsStarted,
      enemyAtBase: this._lastEnemyAtBase,
    };
  }
}
