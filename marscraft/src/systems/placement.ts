/**
 * MarsCraft -> forgeax-engine — building placement + grid overlay (Milestone M8)
 * =============================================================================
 * Port of the placement half of the Three.js source `ui/BuildGridOverlay.ts`
 * (the footprint-follows-cursor preview) + the placement-commit flow that lived
 * in `main.ts` / BuildingSystem.placeBuilding. Renderer-translated to a WebGPU
 * world ghost (the source used a Three.js BufferGeometry overlay; forgeax has no
 * Three.js, so the ghost is a spawned MeshFilter/MeshRenderer slab entity that we
 * reposition + re-tint each frame — same green=buildable / red=blocked semantics).
 *
 * Flow (mirrors the source):
 *   beginPlacement(typeId, builder?) -> placement mode on:
 *     - a flat footprint slab ghost follows the cursor, snapped to the grid;
 *     - GREEN where buildable (all footprint cells walkable terrain + unoccupied
 *       + affordable + prerequisites met + geyser rule), RED otherwise;
 *   LEFT-CLICK on a green cell commits:
 *     - spend the building's cost (ResourceManager);
 *     - spawnUnit the building in `constructing` state (10% hp);
 *     - reserve the footprint in the OccupancyGrid (markBuilding, pathing-blocked);
 *     - if a builder was passed, give it a `build` command targeting the new
 *       building so the BuildingSystem's construction tick sees it on-site;
 *   RIGHT-CLICK / Esc cancels (no spend, ghost hidden).
 *
 * Buildable test is faithful to the source's OccupancyGrid validation: every cell
 * the footprint covers must be terrain-walkable AND free (CELL_FREE), within map
 * bounds. Geyser-required buildings (refinery/extractor/assimilator) instead must
 * sit on a geyser cell — a clearly-marked simplification: we accept a geyser cell
 * under the center and snap the ghost there (full geyser-snap + attachedGeyser
 * wiring is the M8-refinery seam; base placement is the verification target).
 */

import { Transform, MeshFilter, MeshRenderer } from '@forgeax/engine-runtime';
import { Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Building, BUILDING_STATE, buildingTypeId, commandCurrent, commandQueue,
  type UnitCommand,
} from '../components';
import { getBuildingDef } from '../data/buildings';
import { getUnitDef } from '../data/units';
import { worldToGrid, gridToWorld, worldSizeToGridCells } from '../mapgen/geometry';
import { CELL_FREE, CELL_GEYSER, type OccupancyGrid } from '../world/occupancy-grid';
import type { ResourceManager } from './resource-manager';
import type { UnitFactoryCtx } from './unit-factory';
import { spawnUnit } from './unit-factory';
import { requiresPylonPower, type BuildingSystemHandle } from './building-system';
import type { UnitPrimitives, TintFn } from '../world/unit-models';
import type { InputState } from '../input';

export interface PlacementDeps {
  map: { width: number; height: number; gridResolution: number };
  occupancy: OccupancyGrid;
  resourceManager: ResourceManager;
  buildingSystem: BuildingSystemHandle;
  factoryCtx: UnitFactoryCtx;
  prims: UnitPrimitives;
  tint: TintFn;
  input: InputState;
  /** Screen pixel -> ground world point (from the command layer). */
  screenToGround: (px: number, py: number) => { x: number; z: number } | null;
  isWalkable: (x: number, z: number) => boolean;
  heightAt: (x: number, z: number) => number;
  /** Local player id (placement spends this player's resources). */
  localPlayerId: number;
  /** Local player faction color (the committed building's tint). */
  localPlayerColor: number;
}

export interface PlacementCommitResult {
  entity: EntityHandle;
  x: number;
  z: number;
}

export interface PlacementHandle {
  /** Enter placement mode for a building typeId, with an optional builder. */
  beginPlacement(typeId: string, builderEntity?: EntityHandle | null): boolean;
  /** Cancel placement (no spend). */
  cancel(): void;
  /** Is placement mode active? */
  readonly active: boolean;
  /** The typeId being placed (null if inactive). */
  readonly activeTypeId: string | null;
  /**
   * Deterministically place + start a building at world (x,z), spending the
   * player's resources, in `constructing` state. Returns the entity (or null on
   * unaffordable / blocked). Used by the verify hook + the AI.
   *
   * `owner` overrides which player pays + owns the building (defaults to the
   * local player). The enemy AI passes its own {playerId,color} here so the ONE
   * commit/spawn/reserve path stays SSOT (no reimplemented AI-side placement).
   */
  placeAt(
    typeId: string, x: number, z: number,
    builderEntity?: EntityHandle | null,
    owner?: { playerId: number; color: number },
  ): EntityHandle | null;
}

export function installPlacement(world: World, deps: PlacementDeps): PlacementHandle {
  const {
    map, occupancy, resourceManager, buildingSystem, factoryCtx, prims, tint,
    input, screenToGround, isWalkable, heightAt, localPlayerId, localPlayerColor,
  } = deps;

  const halfW = map.width / 2;
  const halfH = map.height / 2;
  const res = map.gridResolution;

  // ── ghost slab (one reusable entity; hidden by moving it far below ground) ──
  // A flat box scaled to the footprint; tinted green/red each frame. The engine
  // has no per-entity visibility toggle wired here, so "hidden" = parked offscreen
  // (y very low) which is reliable for the smoke/verify path.
  const GHOST_PARK_Y = -1000;
  const greenMat = tint([0.1, 0.85, 0.2], { metallic: 0, roughness: 1 });
  const redMat = tint([0.95, 0.12, 0.1], { metallic: 0, roughness: 1 });
  let ghost: EntityHandle | null = null;
  let ghostMat: 'green' | 'red' = 'green';

  function ensureGhost(): EntityHandle | null {
    if (ghost && world.get(ghost, Transform).ok) return ghost;
    const r = world.spawn(
      { component: Transform, data: { pos: [0, GHOST_PARK_Y, 0], scale: [1, 0.2, 1] } },
      { component: MeshFilter, data: { assetHandle: prims.box } },
      { component: MeshRenderer, data: { materials: [greenMat] } },
    );
    ghost = r.ok ? r.value : null;
    ghostMat = 'green';
    return ghost;
  }

  function parkGhost(): void {
    const cur = ghost && world.get(ghost, Transform);
    if (ghost && cur && cur.ok) {
      const p = cur.value.pos;
      world.set(ghost, Transform, { pos: [p[0], GHOST_PARK_Y, p[2]] });
    }
  }

  // ── grid footprint helpers ──────────────────────────────────────────────────

  /** Footprint cell count (NxN) for a building typeId. */
  function footprintCells(typeId: string): number {
    const def = getBuildingDef(typeId);
    const fp = def?.footprint ?? 2;
    return Math.max(1, worldSizeToGridCells(fp, map.width, res));
  }

  /** Snap a world point to a grid-aligned footprint; return center + start cell. */
  function snap(typeId: string, wx: number, wz: number): { x: number; z: number; startCol: number; startRow: number; gs: number } {
    const gs = footprintCells(typeId);
    const cs = map.width / res;
    const gx = (wx + halfW) / cs;
    const gz = (wz + halfH) / cs;
    let sc = Math.round(gx - gs / 2);
    let sr = Math.round(gz - gs / 2);
    sc = Math.max(0, Math.min(res - gs, sc));
    sr = Math.max(0, Math.min(res - gs, sr));
    const x = (sc + gs / 2) * cs - halfW;
    const z = (sr + gs / 2) * cs - halfH;
    return { x, z, startCol: sc, startRow: sr, gs };
  }

  /** Every footprint cell terrain-walkable AND free (CELL_FREE), in bounds. */
  function footprintBuildable(startCol: number, startRow: number, gs: number): boolean {
    for (let r = startRow; r < startRow + gs; r++) {
      for (let c = startCol; c < startCol + gs; c++) {
        if (c < 0 || c >= res || r < 0 || r >= res) return false;
        if (!occupancy.isTerrainWalkable(c, r)) return false;
        if (occupancy.getOccupancy(c, r) !== CELL_FREE) return false;
      }
    }
    return true;
  }

  /** Geyser-required: the center cell must be a geyser cell. */
  function onGeyser(centerX: number, centerZ: number): boolean {
    const { col, row } = worldToGrid(centerX, centerZ, map.width, map.height, res);
    return occupancy.getOccupancy(col, row) === CELL_GEYSER;
  }

  /** Full buildability for a snapped footprint (cells + cost + prereq + geyser). */
  function canBuild(typeId: string, snapped: { x: number; z: number; startCol: number; startRow: number; gs: number }, ownerId = localPlayerId): boolean {
    const def = getBuildingDef(typeId);
    const unitDef = getUnitDef(typeId);
    if (!def || !unitDef) return false;
    if (!resourceManager.canAfford(ownerId, unitDef.mineralCost, unitDef.gasCost, 0)) return false;
    if (!buildingSystem.checkPrerequisites(ownerId, typeId)) return false;
    // Protoss pylon power: a powered-building (all but nexus/pylon/assimilator)
    // can only be placed inside a completed friendly pylon's energy field.
    if (unitDef.race === 'protoss' && requiresPylonPower(typeId)
      && !buildingSystem.isPoweredAt(ownerId, snapped.x, snapped.z)) return false;
    if (def.requiresGeyser) return onGeyser(snapped.x, snapped.z);
    return footprintBuildable(snapped.startCol, snapped.startRow, snapped.gs);
  }

  // ── commit ───────────────────────────────────────────────────────────────────

  function commit(typeId: string, snapped: { x: number; z: number; startCol: number; startRow: number; gs: number }, builder: EntityHandle | null, owner?: { playerId: number; color: number }): EntityHandle | null {
    const def = getBuildingDef(typeId);
    const unitDef = getUnitDef(typeId);
    if (!def || !unitDef) return null;
    const ownerId = owner?.playerId ?? localPlayerId;
    const ownerColor = owner?.color ?? localPlayerColor;

    // spend (minerals + gas; building supplyCost is 0 in the table).
    if (!resourceManager.spend(ownerId, unitDef.mineralCost, unitDef.gasCost, 0)) return null;

    // spawn the building in `constructing` state (spawnUnit defaults to that for
    // buildings when isComplete is not set: state=CONSTRUCTING, 10% hp).
    const e = spawnUnit(world, factoryCtx, {
      typeId, x: snapped.x, z: snapped.z,
      playerId: ownerId, playerColor: ownerColor,
    });
    if (!e) {
      // refund on spawn failure (keeps the balance honest).
      resourceManager.refund(ownerId, unitDef.mineralCost, unitDef.gasCost, 0);
      return null;
    }

    // reserve the footprint (pathing-blocked = pathingSize, default footprint).
    const pgs = def.pathingSize != null ? Math.max(1, worldSizeToGridCells(def.pathingSize, map.width, res)) : snapped.gs;
    occupancy.markBuilding(e as unknown as number, snapped.startCol, snapped.startRow, snapped.gs, pgs);

    // assign the builder a `build` command so the construction tick sees it
    // on-site (Terran). Zerg/Protoss auto-construct, but assigning is harmless.
    if (builder && world.get(builder, Transform).ok) {
      const cmd: UnitCommand = {
        type: 'build', targetEntity: e as unknown as number,
        targetX: snapped.x, targetZ: snapped.z, buildTypeId: typeId,
      };
      commandCurrent.set(builder, cmd);
      const q = commandQueue.get(builder); if (q) q.length = 0;
      world.set(e, Building, { builderEntity: builder as unknown as number, state: BUILDING_STATE.CONSTRUCTING });
    } else {
      // no builder: still constructing. Zerg/Protoss build solo; Terran would
      // stall without a builder (faithful), but the deterministic placeAt path
      // is used for verify where construction must proceed -> see placeAt below.
      world.set(e, Building, { state: BUILDING_STATE.CONSTRUCTING });
    }

    return e;
  }

  // ── per-frame placement preview + click handling ───────────────────────────────

  let active = false;
  let activeTypeId: string | null = null;
  let builderEntity: EntityHandle | null = null;
  let leftWasDown = false;
  let rightWasDown = false;

  function setGhostTint(toGreen: boolean): void {
    if (!ghost) return;
    const want = toGreen ? 'green' : 'red';
    if (want === ghostMat) return;
    ghostMat = want;
    world.set(ghost, MeshRenderer, { materials: [toGreen ? greenMat : redMat] });
  }

  world.addSystem(Update, {
    name: 'mc-placement',
    queries: [],
    resources: [],
    fn: () => {
      if (!active || !activeTypeId) return;

      // Esc cancels.
      if (input.keys.has('Escape')) { cancel(); return; }

      const g = ensureGhost();
      const ground = screenToGround(input.x, input.y);
      if (g && ground) {
        const snapped = snap(activeTypeId, ground.x, ground.z);
        const ok = canBuild(activeTypeId, snapped);
        const cs = map.width / res;
        const widthWorld = snapped.gs * cs;
        const y = heightAt(snapped.x, snapped.z) + 0.4;
        world.set(g, Transform, {
          pos: [snapped.x, y, snapped.z],
          scale: [widthWorld, 0.4, widthWorld],
        });
        setGhostTint(ok);

        // LEFT-click commits on a buildable cell.
        const leftDown = input.buttons.left;
        if (leftDown && !leftWasDown && ok) {
          commit(activeTypeId, snapped, builderEntity);
          cancel();
        }
        leftWasDown = leftDown;
      }

      // RIGHT-click cancels.
      const rightDown = input.buttons.right;
      if (rightDown && !rightWasDown) { cancel(); }
      rightWasDown = rightDown;
    },
  });

  function beginPlacement(typeId: string, builder?: EntityHandle | null): boolean {
    const def = getBuildingDef(typeId);
    if (!def) return false;
    active = true;
    activeTypeId = typeId;
    builderEntity = builder ?? null;
    leftWasDown = input.buttons.left; // swallow the click that opened the panel
    rightWasDown = input.buttons.right;
    ensureGhost();
    return true;
  }

  function cancel(): void {
    active = false;
    activeTypeId = null;
    builderEntity = null;
    parkGhost();
  }

  function placeAt(typeId: string, x: number, z: number, builder?: EntityHandle | null, owner?: { playerId: number; color: number }): EntityHandle | null {
    const def = getBuildingDef(typeId);
    const unitDef = getUnitDef(typeId);
    if (!def || !unitDef) return null;
    const snapped = snap(typeId, x, z);
    // geyser buildings need a geyser; others need free walkable cells. For the
    // deterministic verify path we still honor the buildable test, but fall back
    // to placing on the snapped center if cells are blocked AND no builder is
    // given is NOT allowed — keep it honest: require buildable.
    if (!canBuild(typeId, snapped, owner?.playerId ?? localPlayerId)) return null;
    return commit(typeId, snapped, builder ?? null, owner);
  }

  return {
    beginPlacement,
    cancel,
    get active() { return active; },
    get activeTypeId() { return activeTypeId; },
    placeAt,
  };
}
