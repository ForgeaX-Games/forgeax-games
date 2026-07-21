/**
 * MarsCraft -> forgeax-engine — CommandExecutor port (Milestone M5)
 * =============================================================================
 * Port of the Three.js source `web/systems/CommandExecutor.ts` (the MOVE / STOP /
 * attack-move / patrol path-issuance core). Runs BEFORE the movement system:
 * reads each unit's current command, computes a path (FlowField first, region A*
 * fallback) and sets the SoA `Movement` target / flow direction / flags.
 *
 * Two-level pathing (faithful to the source):
 *   1. FlowField direct to the final target (snapped so a formation shares one
 *      field). Very short hops + clear line-of-sight -> direct seek (no field).
 *   2. FlowField unreachable ([0,0]) -> region A* portal waypoints, navigated
 *      segment by segment via FlowField / direct seek.
 *   - Stuck detection forces a repath; walkable-version change clears all caches.
 *
 * ── REAL vs M6/M8 seams ──────────────────────────────────────────────────────
 *   REAL (this milestone): 'move', 'stop', 'attack_move' (as move; the "pause to
 *   attack" branch is gated on `Attack.isAttacking`, which the M2 Attack
 *   component already carries), 'patrol' (ping-pong move), plus the public
 *   `navigateEntityTo` API.
 *   SEAM (left as marked early-returns / advanceQueue): 'attack', 'hold',
 *   'build', 'harvest', 'return_cargo', 'follow', 'repair', 'garrison',
 *   'pickup', 'ability_move' — these need combat / economy / building / ability
 *   systems (M6/M7/M8/M9) to be meaningful. They consume the command (advance
 *   the queue) so a unit never wedges on an order this milestone can't fulfil.
 *
 * ── ECS adaptation ───────────────────────────────────────────────────────────
 * The source had OO `CMovement` / `CCommand` with methods (setTarget,
 * clearTarget, advanceQueue, ...). forgeax `Movement` is SoA (a batch column) and
 * commands live in the `commandCurrent` / `commandQueue` Map companions. We build
 * a tiny per-row `MovementView` (reads/writes the batch arrays at index i) and a
 * `CommandView` (reads/writes the Maps), so the ported control flow stays 1:1.
 */

import { Time, Update, Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Movement, Command, Attack, MOVE_TYPE,
  commandCurrent, commandQueue,
  type UnitCommand,
} from '../components';
import { FlowField, type FlowFieldData } from './flow-field';
import { Pathfinder, type Waypoint } from './pathfinder';
import type { PathGrid } from '../world/path-grid';

// ============================================================
// Tuning constants (ported verbatim)
// ============================================================

const ARRIVAL_DIST = 0.3;
/** M8: builder is "on site" within this distance of the build target (source 5.0). */
const BUILD_ARRIVE_DIST = 5.0;
const WAYPOINT_ARRIVAL_DIST = 3.0;
const DIRECT_NAV_DIST_MIN = 0.3;
const LOS_MAX_DIST = 20;
const LOS_STEP = 0.4;
const STUCK_TIME_MS = 2000;
const STUCK_DIST = 1.0;
const FLOW_FIELD_SNAP = 3;
/** Collision/pathing radius = visual radius * this ratio (RTS convention). */
const PATHING_RADIUS_RATIO = 0.7;

// ============================================================
// M9 ch3 garrison/pickup seam handler (settable; null = consume-only)
// ============================================================
// The `garrison` (this unit boards the target carrier) and `pickup` (this carrier
// loads the target unit) commands need the GarrisonSystem. Rather than thread it
// through every deps chain, the GarrisonSystem registers a handler here at install
// time. When unset the commands degrade to consume-only (prior behaviour).
type GarrisonCmdHandler = (world: World, self: EntityHandle, target: EntityHandle, mode: 'garrison' | 'pickup') => boolean;
let _garrisonCmdHandler: GarrisonCmdHandler | null = null;
/** Wire garrison/pickup commands to the GarrisonSystem. */
export function setGarrisonCommandHandler(fn: GarrisonCmdHandler): void { _garrisonCmdHandler = fn; }
/** Distance within which a boarding/pickup command completes (units). */
const GARRISON_REACH_DIST = 3.0;

// ============================================================
// Per-row adapters bridging SoA Movement <-> the source's OO CMovement
// ============================================================

/** Batch shape (loose: forgeax query batches are typed-array columns). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/**
 * A live view over one Movement row (batch index i) exposing the exact mutators
 * the ported source called on `CMovement`. Writes go straight to the SoA columns.
 */
class MovementView {
  constructor(private b: Batch, private i: number) {}

  get moveType(): number { return this.b.Movement.moveType[this.i]; }
  get speed(): number { return this.b.Movement.speed[this.i]; }

  get hasTarget(): boolean { return !!this.b.Movement.hasTarget[this.i]; }
  set hasTarget(v: boolean) { this.b.Movement.hasTarget[this.i] = v ? 1 : 0; }

  get arrived(): boolean { return !!this.b.Movement.arrived[this.i]; }
  set arrived(v: boolean) { this.b.Movement.arrived[this.i] = v ? 1 : 0; }

  get targetX(): number { return this.b.Movement.targetX[this.i]; }
  set targetX(v: number) { this.b.Movement.targetX[this.i] = v; }
  get targetZ(): number { return this.b.Movement.targetZ[this.i]; }
  set targetZ(v: number) { this.b.Movement.targetZ[this.i] = v; }

  get useFlowField(): boolean { return !!this.b.Movement.useFlowField[this.i]; }
  set useFlowField(v: boolean) { this.b.Movement.useFlowField[this.i] = v ? 1 : 0; }

  get flowDirX(): number { return this.b.Movement.flowDirX[this.i]; }
  set flowDirX(v: number) { this.b.Movement.flowDirX[this.i] = v; }
  get flowDirZ(): number { return this.b.Movement.flowDirZ[this.i]; }
  set flowDirZ(v: number) { this.b.Movement.flowDirZ[this.i] = v; }

  get isPushed(): boolean { return !!this.b.Movement.isPushed[this.i]; }

  /** Source CMovement.setTarget. */
  setTarget(x: number, z: number): void {
    this.b.Movement.targetX[this.i] = x;
    this.b.Movement.targetZ[this.i] = z;
    this.b.Movement.hasTarget[this.i] = 1;
    this.b.Movement.arrived[this.i] = 0;
  }

  /** Source CMovement.clearTarget. */
  clearTarget(): void {
    this.b.Movement.hasTarget[this.i] = 0;
    this.b.Movement.arrived[this.i] = 1;
  }
}

/** Transform view (CommandExecutor only reads x/z). */
interface TransformXZ { x: number; z: number; }

/**
 * Command adapter over the `commandCurrent` / `commandQueue` Map companions,
 * mirroring the source CCommand methods used by the move/stop/patrol paths.
 */
class CommandView {
  constructor(private e: EntityHandle) {}

  get current(): UnitCommand | null {
    return commandCurrent.get(this.e) ?? null;
  }
  set current(c: UnitCommand | null) {
    commandCurrent.set(this.e, c);
  }

  /** Source CCommand.setCommand — replace current (does not touch the queue). */
  setCommand(c: UnitCommand): void {
    commandCurrent.set(this.e, c);
  }

  /** Source CCommand.clear — drop current + queue. */
  clear(): void {
    commandCurrent.set(this.e, null);
    const q = commandQueue.get(this.e);
    if (q) q.length = 0;
  }

  /** Source CCommand.advanceQueue — pop the next queued command, else go idle. */
  advanceQueue(): void {
    const q = commandQueue.get(this.e);
    if (q && q.length > 0) {
      commandCurrent.set(this.e, q.shift()!);
    } else {
      commandCurrent.set(this.e, null);
    }
  }
}

/** Per-entity A* fallback path state. */
interface EntityPathState {
  waypoints: Waypoint[];
  currentIdx: number;
  targetKey: string;
}

// ============================================================
// CommandExecutor
// ============================================================

export interface CommandExecutorDeps {
  flowField: FlowField;
  pathfinder: Pathfinder;
  pathGrid: PathGrid;
  /** Passability query (world coords) — used for target rewrite + LOS. */
  isWalkable: (x: number, z: number) => boolean;
  /** Visual half-size (world units) per entity — drives clearance + LOS width. */
  visualHalfSize: (e: EntityHandle) => number;
}

export class CommandExecutor {
  public flowField: FlowField;
  public pathfinder: Pathfinder;
  public pathGrid: PathGrid;
  public isWalkable: (x: number, z: number) => boolean;
  private _visualHalfSize: (e: EntityHandle) => number;

  /** Cached FlowField references (same target shared across a frame's units). */
  private _cachedFields = new Map<string, FlowFieldData | null>();
  private _lastCacheTime = 0;
  private _lastWalkableVersion = 0;

  private _pathStates = new Map<number, EntityPathState>();
  private _cleanupCounter = 0;
  private _stuckCheck = new Map<number, { x: number; z: number; time: number }>();
  private _gameTimeMs = 0;

  constructor(deps: CommandExecutorDeps) {
    this.flowField = deps.flowField;
    this.pathfinder = deps.pathfinder;
    this.pathGrid = deps.pathGrid;
    this.isWalkable = deps.isWalkable;
    this._visualHalfSize = deps.visualHalfSize;
  }

  /** Register the ECS system. Runs before the movement system. */
  install(world: World): void {
    world.addSystem(Update, {
      name: 'mc-command-executor',
      queries: [{ with: [Entity, Transform, Movement, Command] }],
      resources: ['Time'],
      fn: (_w, qr) => {
        const dt = world.getResource(Time).delta;
        // qr[0] is an ARRAY of batches (one per archetype) — units span several
        // archetypes (different optional components), so iterate them all.
        const batches = qr[0] as unknown as Batch[];
        this._prologue(world, dt);
        for (const b of batches) {
          const n = b.Entity.self.length as number;
          for (let i = 0; i < n; i++) {
            this._tickEntity(world, b, i);
          }
        }
      },
    });
  }

  // ============================================================
  // Per-frame prologue (runs ONCE per frame, before any entity)
  // ============================================================

  private _prologue(world: World, dt: number): void {
    this._gameTimeMs += dt * 1000;
    const now = this._gameTimeMs;

    // Sync deterministic time to the FlowField.
    this.flowField.gameTimeMs = this._gameTimeMs;

    // walkable-version change (building placed/removed) -> drop all caches.
    const curVersion = this.flowField.walkableVersion;
    if (curVersion !== this._lastWalkableVersion) {
      this._cachedFields.clear();
      this._pathStates.clear();
      this._stuckCheck.clear();
      this._lastWalkableVersion = curVersion;
      this._lastCacheTime = now;
    }

    // Periodically drop the field-reference cache (FlowField has its own TTL).
    if (now - this._lastCacheTime > 5000) {
      this._cachedFields.clear();
      this._lastCacheTime = now;
    }

    // Periodically prune dead path/stuck state (~every 120 frames).
    this._cleanupCounter++;
    if (this._cleanupCounter > 120) {
      this._cleanupCounter = 0;
      this._cleanupPathStates(world);
    }
  }

  // ============================================================
  // Per-entity tick (runs for every entity across ALL batches)
  // ============================================================

  private _tickEntity(world: World, b: Batch, i: number): void {
    const entity = b.Entity.self[i] as EntityHandle;
    const movement = new MovementView(b, i);
    const command = new CommandView(entity);
    const transform: TransformXZ = { x: b.Transform.pos[i * 3], z: b.Transform.pos[i * 3 + 2] };

    // Being pushed by a building -> skip; movement finishes the push first.
    if (movement.isPushed) return;

    if (!command.current) {
      // No command -> stop FlowField drive.
      if (movement.useFlowField) {
        movement.useFlowField = false;
        movement.flowDirX = 0;
        movement.flowDirZ = 0;
      }
      this._pathStates.delete(entity as unknown as number);
      this._stuckCheck.delete(entity as unknown as number);
      return;
    }

    this._executeCommand(world, entity, transform, movement, command);
  }

  // ============================================================
  // Command dispatch
  // ============================================================

  private _executeCommand(
    world: World,
    entity: EntityHandle,
    transform: TransformXZ,
    movement: MovementView,
    command: CommandView,
  ): void {
    const cmd = command.current!;

    switch (cmd.type) {
      case 'move':
        this._executeMove(entity, transform, movement, command, cmd);
        break;

      case 'attack_move':
        // Attack-move = move; pause when an attack is in progress (M6 sets the
        // flag). `_attackInProgress` reads M2's Attack.isAttacking if present.
        if (this._attackInProgress(world, entity)) {
          movement.useFlowField = false;
          movement.hasTarget = false;
          break;
        }
        this._executeMove(entity, transform, movement, command, cmd);
        break;

      case 'patrol':
        this._executePatrol(entity, transform, movement, command, cmd);
        break;

      case 'stop':
        movement.clearTarget();
        movement.useFlowField = false;
        movement.flowDirX = 0;
        movement.flowDirZ = 0;
        this._pathStates.delete(entity as unknown as number);
        command.clear();
        break;

      // ── M7 economy: harvest / return_cargo are MOVE orders issued by the
      // HarvestSystem (which runs before this) for long-distance travel to a
      // mineral / geyser / base. Execute them as a plain move so the worker
      // paths via FlowField / A* exactly like the source delegated to here. The
      // HarvestSystem clears the command once it arrives (short-range reach).
      case 'harvest':
      case 'return_cargo':
        this._executeMove(entity, transform, movement, command, cmd);
        // _executeMove advances the queue on arrival; keep the harvest type so
        // the HarvestSystem still recognises it as its own in-flight command.
        if (command.current && command.current.type !== cmd.type) {
          command.current.type = cmd.type;
        }
        break;

      // ── M8 building: walk the builder to the site, then HOLD on arrival
      // (keep the `build` command current so the BuildingSystem's construction
      // tick recognises the on-site SCV and advances buildProgress). Unlike a
      // plain move, arrival does NOT advance the queue — the BuildingSystem clears
      // / advances the builder's command when the structure completes. ──
      case 'build': {
        if (cmd.targetX === undefined || cmd.targetZ === undefined) { command.advanceQueue(); break; }
        const dxB = cmd.targetX - transform.x;
        const dzB = cmd.targetZ - transform.z;
        if (dxB * dxB + dzB * dzB <= BUILD_ARRIVE_DIST * BUILD_ARRIVE_DIST) {
          // on-site: stop and let the BuildingSystem build (command stays).
          movement.clearTarget();
          movement.useFlowField = false;
          this._pathStates.delete(entity as unknown as number);
        } else {
          // travel to the site (FlowField / A* like a move), but keep the type.
          this._executeMove(entity, transform, movement, command, cmd);
          if (command.current && command.current.type !== 'build') command.current.type = 'build';
        }
        break;
      }

      // ── M9 ch3: garrison (board the target carrier) / pickup (load the
      // target unit into this carrier) — walk into range, then load. ──
      case 'garrison':
      case 'pickup': {
        const targetRaw = cmd.targetEntity;
        if (targetRaw === undefined || targetRaw < 0) { command.advanceQueue(); break; }
        const target = targetRaw as unknown as EntityHandle;
        const tt = world.get(target, Transform);
        if (!tt.ok) { command.advanceQueue(); break; }
        const dxG = tt.value.pos[0] - transform.x;
        const dzG = tt.value.pos[2] - transform.z;
        if (dxG * dxG + dzG * dzG <= GARRISON_REACH_DIST * GARRISON_REACH_DIST) {
          movement.clearTarget();
          movement.useFlowField = false;
          this._pathStates.delete(entity as unknown as number);
          if (_garrisonCmdHandler) {
            // garrison: self boards target; pickup: target boards self.
            if (cmd.type === 'garrison') _garrisonCmdHandler(world, entity, target, 'garrison');
            else _garrisonCmdHandler(world, entity, target, 'pickup');
          }
          command.advanceQueue();
        } else {
          // travel toward the carrier/unit (keep the command current).
          const moveCmd: UnitCommand = { type: cmd.type, targetX: tt.value.pos[0], targetZ: tt.value.pos[2], targetEntity: targetRaw };
          this._executeMove(entity, transform, movement, command, moveCmd);
          if (command.current && command.current.type !== cmd.type) command.current.type = cmd.type;
        }
        break;
      }

      // ── M6 combat seam ──
      case 'attack':
      case 'hold':
      // ── M8 building seam ──
      case 'repair':
      // ── M9 ability seam ──
      case 'follow':
      case 'ability_move':
        // These need systems not yet ported. Consume the order so the unit does
        // not wedge waiting on an unfulfillable command this milestone.
        movement.clearTarget();
        movement.useFlowField = false;
        this._pathStates.delete(entity as unknown as number);
        command.advanceQueue();
        break;
    }
  }

  /**
   * True if the unit's M2 Attack component is currently mid-attack. The Attack
   * component + `isAttacking` flag already exist (M2); the flag is only ever SET
   * by the M6 AttackSystem, so until combat lands this returns false and
   * attack-move behaves exactly as a plain move (a faithful, inert seam).
   */
  private _attackInProgress(world: World, entity: EntityHandle): boolean {
    const r = world.get(entity, Attack);
    return r.ok ? !!r.value.isAttacking : false;
  }

  // ============================================================
  // Move (FlowField first, A* fallback)
  // ============================================================

  private _executeMove(
    entity: EntityHandle,
    transform: TransformXZ,
    movement: MovementView,
    command: CommandView,
    cmd: UnitCommand,
  ): void {
    if (cmd.targetX === undefined || cmd.targetZ === undefined) {
      command.advanceQueue();
      this._pathStates.delete(entity as unknown as number);
      return;
    }

    // ---- target rewrite (once, ground only): if the target is inside a
    // building/obstacle, snap it to the nearest walkable edge toward the unit ----
    if (movement.moveType !== MOVE_TYPE.AIR
        && !this.isWalkable(cmd.targetX, cmd.targetZ)
        && !(cmd as UnitCommand & { _edgeAdjusted?: boolean })._edgeAdjusted) {
      const adjusted = this._findEdgeTarget(transform.x, transform.z, cmd.targetX, cmd.targetZ);
      (cmd as UnitCommand & { _edgeAdjusted?: boolean })._edgeAdjusted = true;
      cmd.targetX = adjusted.x;
      cmd.targetZ = adjusted.z;
    }

    // ---- already at the final target? ----
    const finalDx = cmd.targetX - transform.x;
    const finalDz = cmd.targetZ - transform.z;
    const finalDist = Math.sqrt(finalDx * finalDx + finalDz * finalDz);

    if (finalDist < ARRIVAL_DIST) {
      movement.useFlowField = false;
      movement.flowDirX = 0;
      movement.flowDirZ = 0;
      movement.clearTarget();
      this._pathStates.delete(entity as unknown as number);
      this._stuckCheck.delete(entity as unknown as number);
      command.advanceQueue();
      return;
    }

    // ---- air units: straight flight, ignore terrain blocking ----
    if (movement.moveType === MOVE_TYPE.AIR) {
      movement.useFlowField = false;
      movement.setTarget(cmd.targetX, cmd.targetZ);
      return;
    }

    // ---- stuck detection: little movement over STUCK_TIME_MS -> force repath ----
    const now = this._gameTimeMs;
    const eid = entity as unknown as number;
    let forceRepath = false;
    {
      const sc = this._stuckCheck.get(eid);
      if (sc) {
        const elapsed = now - sc.time;
        if (elapsed > STUCK_TIME_MS) {
          const movedDx = transform.x - sc.x;
          const movedDz = transform.z - sc.z;
          const movedDist = Math.sqrt(movedDx * movedDx + movedDz * movedDz);
          if (movedDist < STUCK_DIST) {
            forceRepath = true;
            this._pathStates.delete(eid);
          }
          this._stuckCheck.set(eid, { x: transform.x, z: transform.z, time: now });
        }
      } else {
        this._stuckCheck.set(eid, { x: transform.x, z: transform.z, time: now });
      }
    }

    const minClearance = this._getMinClearance(entity);
    const halfSize = this._getHalfSize(entity);

    // ---- 1st priority: FlowField direct to the final target ----
    if (!forceRepath && this._tryFlowFieldToTarget(transform, movement, cmd.targetX, cmd.targetZ, finalDist, minClearance, halfSize)) {
      this._pathStates.delete(eid);
      return;
    }

    // ---- 2nd priority: A* portal-waypoint fallback (FlowField unreachable) ----
    const targetKey = `${Math.round(cmd.targetX * 2)},${Math.round(cmd.targetZ * 2)},${minClearance}`;
    let pathState = this._pathStates.get(eid);

    if (forceRepath || !pathState || pathState.targetKey !== targetKey) {
      pathState = this._computePathState(transform, cmd.targetX, cmd.targetZ, targetKey);
      if (pathState) {
        this._pathStates.set(eid, pathState);
      } else {
        this._pathStates.delete(eid);
        // A* also failed -> last resort: direct seek.
        movement.useFlowField = false;
        movement.setTarget(cmd.targetX, cmd.targetZ);
        return;
      }
    }

    // ---- navigate along the A* waypoints ----
    let navX = cmd.targetX;
    let navZ = cmd.targetZ;

    if (pathState && pathState.waypoints.length > 0) {
      const wp = pathState.waypoints[pathState.currentIdx];
      const wpDx = wp.x - transform.x;
      const wpDz = wp.z - transform.z;
      const wpDist = Math.sqrt(wpDx * wpDx + wpDz * wpDz);

      const isLastWaypoint = pathState.currentIdx >= pathState.waypoints.length - 1;
      const wpArrivalDist = isLastWaypoint ? ARRIVAL_DIST : WAYPOINT_ARRIVAL_DIST;

      if (wpDist < wpArrivalDist) {
        pathState.currentIdx++;
        if (pathState.currentIdx >= pathState.waypoints.length) {
          this._pathStates.delete(eid);
          navX = cmd.targetX;
          navZ = cmd.targetZ;
        } else {
          const nextWp = pathState.waypoints[pathState.currentIdx];
          navX = nextWp.x;
          navZ = nextWp.z;
        }
      } else {
        navX = wp.x;
        navZ = wp.z;
      }
    }

    this._navigateTo(transform, movement, navX, navZ, minClearance, halfSize);
  }

  /**
   * Target inside a building/obstacle: ray from the unit toward the target,
   * return the nearest walkable point on the obstacle edge. Fan-search fallback.
   */
  private _findEdgeTarget(
    unitX: number, unitZ: number,
    targetX: number, targetZ: number,
  ): { x: number; z: number } {
    const dx = targetX - unitX;
    const dz = targetZ - unitZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) return { x: targetX, z: targetZ };

    const dirX = dx / dist;
    const dirZ = dz / dist;

    for (let step = 0.5; step <= dist + 1; step += 0.5) {
      const px = targetX - dirX * step;
      const pz = targetZ - dirZ * step;
      if (this.isWalkable(px, pz)) return { x: px, z: pz };
    }

    for (let radius = 0.5; radius <= 6; radius += 0.5) {
      const baseAngle = Math.atan2(dirX, dirZ);
      for (let offset = 0; offset <= Math.PI; offset += Math.PI / 12) {
        for (const sign of [1, -1]) {
          const angle = baseAngle + Math.PI + sign * offset;
          const px = targetX + Math.sin(angle) * radius;
          const pz = targetZ + Math.cos(angle) * radius;
          if (this.isWalkable(px, pz)) return { x: px, z: pz };
        }
      }
    }

    return { x: targetX, z: targetZ };
  }

  // ============================================================
  // Patrol (ping-pong A <-> B)
  // ============================================================

  private _executePatrol(
    entity: EntityHandle,
    transform: TransformXZ,
    movement: MovementView,
    command: CommandView,
    cmd: UnitCommand,
  ): void {
    if (cmd.targetX === undefined || cmd.targetZ === undefined) {
      command.advanceQueue();
      this._pathStates.delete(entity as unknown as number);
      return;
    }

    const dx = cmd.targetX - transform.x;
    const dz = cmd.targetZ - transform.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ARRIVAL_DIST) {
      // Reached the patrol point -> flip direction (target = where we started).
      const newTarget: UnitCommand = {
        type: 'patrol',
        targetX: transform.x,
        targetZ: transform.z,
      };
      command.current = newTarget;
      this._pathStates.delete(entity as unknown as number);
      return;
    }

    this._executeMove(entity, transform, movement, command, cmd);
    // Restore the patrol type (_executeMove may have advanced the queue).
    if (command.current && command.current.type !== 'patrol') {
      command.current.type = 'patrol';
    }
  }

  // ============================================================
  // Navigation helpers (ported)
  // ============================================================

  /** Min clearance (cells) from the unit's full visual radius (conservative). */
  private _getMinClearance(entity: EntityHandle): number {
    const visualHalfSize = this._visualHalfSize(entity);
    const cellSize = this.pathGrid.cellSize || 0.5;
    return Math.ceil(visualHalfSize / cellSize);
  }

  /** Collision half-size (world units) for LOS width + field navigation. */
  private _getHalfSize(entity: EntityHandle): number {
    return this._visualHalfSize(entity) * PATHING_RADIUS_RATIO;
  }

  /**
   * Try FlowField direct to the final target.
   * @returns true = a valid direction was set; false = FlowField can't reach it.
   */
  private _tryFlowFieldToTarget(
    transform: TransformXZ,
    movement: MovementView,
    targetX: number,
    targetZ: number,
    dist: number,
    minClearance: number,
    halfSize: number,
  ): boolean {
    // Very short hop -> unconditional direct seek.
    if (dist < DIRECT_NAV_DIST_MIN) {
      movement.useFlowField = false;
      movement.setTarget(targetX, targetZ);
      return true;
    }

    // Medium range with clear LOS + adequate local clearance -> direct seek
    // (nicer feel; avoids field/wall-repulsion tug-of-war in tight spots).
    const localClearance = this.pathGrid.getClearanceAt(transform.x, transform.z);
    if (dist < LOS_MAX_DIST && localClearance >= minClearance
        && this._hasLineOfSight(transform.x, transform.z, targetX, targetZ, halfSize)) {
      movement.useFlowField = false;
      movement.setTarget(targetX, targetZ);
      return true;
    }

    // Far / occluded -> FlowField (snap target so a formation shares the field).
    // Progressive clearance fallback: full -> half -> 1 -> 0.
    const snapX = Math.round(targetX / FLOW_FIELD_SNAP) * FLOW_FIELD_SNAP;
    const snapZ = Math.round(targetZ / FLOW_FIELD_SNAP) * FLOW_FIELD_SNAP;

    const steps: number[] = [minClearance];
    if (minClearance > 2) steps.push(Math.floor(minClearance / 2));
    if (minClearance > 1) steps.push(1);
    if (minClearance > 0) steps.push(0);

    for (const mc of steps) {
      const key = `${snapX},${snapZ},${mc}`;
      let field = this._cachedFields.get(key);
      if (field === undefined) {
        field = this.flowField.getField(snapX, snapZ, mc);
        this._cachedFields.set(key, field);
      }
      if (field) {
        const [dirX, dirZ] = this.flowField.getDirection(field, transform.x, transform.z);
        if (dirX !== 0 || dirZ !== 0) {
          movement.useFlowField = true;
          movement.flowDirX = dirX;
          movement.flowDirZ = dirZ;
          movement.hasTarget = false;
          return true;
        }
      }
    }

    return false;
  }

  /** Line-of-sight: sample isWalkable along the ray (+ offset lines for wide units). */
  private _hasLineOfSight(x1: number, z1: number, x2: number, z2: number, halfSize = 0): boolean {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.1) return true;

    const steps = Math.ceil(dist / LOS_STEP);
    const stepX = dx / steps;
    const stepZ = dz / steps;

    for (let i = 1; i < steps; i++) {
      const sx = x1 + stepX * i;
      const sz = z1 + stepZ * i;
      if (!this.isWalkable(sx, sz)) return false;
    }

    if (halfSize > 0.5) {
      const invDist = 1 / dist;
      const perpX = -dz * invDist * halfSize;
      const perpZ = dx * invDist * halfSize;
      for (let i = 1; i < steps; i++) {
        const cx = x1 + stepX * i;
        const cz = z1 + stepZ * i;
        if (!this.isWalkable(cx + perpX, cz + perpZ)) return false;
        if (!this.isWalkable(cx - perpX, cz - perpZ)) return false;
      }
    }

    return true;
  }

  private _computePathState(
    transform: TransformXZ,
    targetX: number,
    targetZ: number,
    targetKey: string,
  ): EntityPathState | undefined {
    const waypoints = this.pathfinder.findPath(transform.x, transform.z, targetX, targetZ);
    // null = unreachable; [] = same region (no waypoints needed).
    if (!waypoints || waypoints.length === 0) return undefined;
    return { waypoints, currentIdx: 0, targetKey };
  }

  /** Navigate to a coordinate via FlowField or direct seek (A* segment). */
  private _navigateTo(
    transform: TransformXZ,
    movement: MovementView,
    navX: number,
    navZ: number,
    minClearance = 0,
    halfSize = 0,
  ): void {
    const dx = navX - transform.x;
    const dz = navZ - transform.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < DIRECT_NAV_DIST_MIN) {
      movement.useFlowField = false;
      movement.setTarget(navX, navZ);
      return;
    }

    if (dist < LOS_MAX_DIST && this._hasLineOfSight(transform.x, transform.z, navX, navZ, halfSize)) {
      movement.useFlowField = false;
      movement.setTarget(navX, navZ);
      return;
    }

    const snapX = Math.round(navX / FLOW_FIELD_SNAP) * FLOW_FIELD_SNAP;
    const snapZ = Math.round(navZ / FLOW_FIELD_SNAP) * FLOW_FIELD_SNAP;
    const key = `${snapX},${snapZ},${minClearance}`;
    let field = this._cachedFields.get(key);
    if (field === undefined) {
      field = this.flowField.getField(snapX, snapZ, minClearance);
      this._cachedFields.set(key, field);
    }

    if (field) {
      const [dirX, dirZ] = this.flowField.getDirection(field, transform.x, transform.z);
      if (dirX !== 0 || dirZ !== 0) {
        movement.useFlowField = true;
        movement.flowDirX = dirX;
        movement.flowDirZ = dirZ;
        movement.hasTarget = false;
        return;
      }
    }

    // clearance-aware field had no direction -> minClearance=0 fallback.
    if (minClearance > 0) {
      const fallbackKey = `${snapX},${snapZ},0`;
      let fallbackField = this._cachedFields.get(fallbackKey);
      if (fallbackField === undefined) {
        fallbackField = this.flowField.getField(snapX, snapZ, 0);
        this._cachedFields.set(fallbackKey, fallbackField);
      }
      if (fallbackField) {
        const [dirX, dirZ] = this.flowField.getDirection(fallbackField, transform.x, transform.z);
        if (dirX !== 0 || dirZ !== 0) {
          movement.useFlowField = true;
          movement.flowDirX = dirX;
          movement.flowDirZ = dirZ;
          movement.hasTarget = false;
          return;
        }
      }
    }

    movement.useFlowField = false;
    movement.setTarget(navX, navZ);
  }

  private _cleanupPathStates(world: World): void {
    // forgeax World has no `isAlive` — the liveness proxy is `world.get(e, Transform).ok`
    // (every unit carries Transform). Using isAlive threw `world.isAlive is not a function`
    // and aborted world.update() every frame (breaking render + fog + input).
    for (const eid of Array.from(this._pathStates.keys())) {
      if (!world.get(eid as unknown as EntityHandle, Transform).ok) this._pathStates.delete(eid);
    }
    for (const eid of Array.from(this._stuckCheck.keys())) {
      if (!world.get(eid as unknown as EntityHandle, Transform).ok) this._stuckCheck.delete(eid);
    }
  }
}
