/**
 * MarsCraft -> forgeax-engine — command layer (Milestone M5 wiring)
 * =============================================================================
 * Glues the M5 pathing port together and exposes the player's order interface:
 *
 *   PathGrid (passability + regions + clearance)  ──┐
 *   OccupancyGrid (footprints + dynamic unit layer) ─┤
 *   FlowField (local steering)                       ├─> CommandExecutor (issues
 *   Pathfinder (region A*)                           ─┘   Movement targets/paths)
 *                                                         + MovementSystem (drives
 *                                                           the engine Transform)
 *
 * Player input handled here:
 *   - RIGHT-CLICK on the ground -> a `move` order to every selected unit, with
 *     formation offsets so a group fans out around the click instead of stacking.
 *   - `moveSelectedTo(x, z)` -> the same move-issuance, callable synchronously
 *     from the debug hook so the orchestrator can verify deterministically.
 *
 * Screen -> world ground picking: a ray is built from the camera entity Transform
 * (pos + quat) and the perspective fov/aspect, intersected with a flat Y plane,
 * then refined against the terrain `heightAt` (a couple of fixed-point steps so a
 * sloped surface picks at roughly the right XZ). No engine picking dependency.
 */

import { Transform, Camera, quat } from '@forgeax/engine-runtime';
import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Renderable, Movement, commandCurrent, commandQueue, type UnitCommand } from '../components';
import type { MapConfig } from '../mapgen/types';
import { PathGrid } from '../world/path-grid';
import { OccupancyGrid } from '../world/occupancy-grid';
import { FlowField } from './flow-field';
import { Pathfinder } from './pathfinder';
import { CommandExecutor } from './command-executor';
import { installMovement } from './movement';
import type { InputState } from '../input';
import type { SelectionHandle } from './selection';

export interface CommandLayerDeps {
  map: MapConfig;
  cameraEntity: EntityHandle;
  input: InputState;
  selection: SelectionHandle;
  heightAt: (x: number, z: number) => number;
}

export interface CommandLayerHandle {
  pathGrid: PathGrid;
  occupancy: OccupancyGrid;
  flowField: FlowField;
  pathfinder: Pathfinder;
  /** Issue a move order to the current selection (formation-spread). */
  moveSelectedTo(x: number, z: number): void;
  /** Screen pixel -> ground world point (null if the ray misses). */
  screenToGround(px: number, py: number): { x: number; z: number } | null;
}

// ── camera-basis scratch (reused; quat.transformVec3 wants the branded Vec3) ──
type Vec3Out = Parameters<typeof quat.transformVec3>[0];
const _fwd = new Float32Array(3) as unknown as Vec3Out;
const _right = new Float32Array(3) as unknown as Vec3Out;
const _up = new Float32Array(3) as unknown as Vec3Out;

/**
 * Formation offsets for a group: a centered square grid (cell ~2 world units) so
 * destinations spread out and the separation force settles them without stacking.
 */
function formationOffsets(count: number, spacing = 2.0): { dx: number; dz: number }[] {
  if (count <= 1) return [{ dx: 0, dz: 0 }];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const out: { dx: number; dz: number }[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({
      dx: (c - (cols - 1) / 2) * spacing,
      dz: (r - (rows - 1) / 2) * spacing,
    });
  }
  return out;
}

export function installCommandLayer(world: World, deps: CommandLayerDeps): CommandLayerHandle {
  const { map, cameraEntity, input, selection, heightAt } = deps;

  // ── build the pathing stack ────────────────────────────────────────────────
  const pathGrid = new PathGrid(map);
  const occupancy = new OccupancyGrid(pathGrid, map.width, map.height);
  const flowField = new FlowField(pathGrid, map.width, map.height);
  const pathfinder = new Pathfinder(pathGrid);

  const isWalkable = (x: number, z: number) => pathGrid.isWalkableAt(x, z);

  // Unit visual half-size from Renderable.size (factory set size = def.modelSize).
  const visualHalfSize = (e: EntityHandle): number => {
    const r = world.get(e, Renderable);
    return r.ok ? r.value.size * 0.5 : 0.5;
  };

  // ── command executor (runs before movement) ────────────────────────────────
  const executor = new CommandExecutor({
    flowField, pathfinder, pathGrid, isWalkable, visualHalfSize,
  });
  executor.install(world);

  // ── movement system (drives Transform along the terrain) ───────────────────
  const half = map.width / 2;
  const halfH = map.height / 2;
  installMovement(world, {
    getTerrainHeight: heightAt,
    isWalkable,
    bounds: { minX: -half, maxX: half, minZ: -halfH, maxZ: halfH },
    occupancy,
  });

  // ── screen -> world ground picking ─────────────────────────────────────────
  function screenToGround(px: number, py: number): { x: number; z: number } | null {
    const tr = world.get(cameraEntity, Transform);
    const cam = world.get(cameraEntity, Camera);
    if (!tr.ok || !cam.ok) return null;
    const t = tr.value;
    const c = cam.value;
    const q: [number, number, number, number] = [t.quatX, t.quatY, t.quatZ, t.quatW];

    // World-space camera axes (engine default: looks down -Z, right +X, up +Y).
    quat.transformVec3(_fwd, q, [0, 0, -1]);
    quat.transformVec3(_right, q, [1, 0, 0]);
    quat.transformVec3(_up, q, [0, 1, 0]);

    const w = Math.max(1, input.canvasWidth);
    const h = Math.max(1, input.canvasHeight);
    // Pixel -> NDC (y-up).
    const ndcX = (px / w) * 2 - 1;
    const ndcY = -((py / h) * 2 - 1);

    const tanHalfFovY = Math.tan((c.fov as number) / 2);
    const aspect = c.aspect as number;

    // Ray direction through the cursor in world space.
    const sx = ndcX * tanHalfFovY * aspect;
    const sy = ndcY * tanHalfFovY;
    const dirX = _fwd[0] + _right[0] * sx + _up[0] * sy;
    const dirY = _fwd[1] + _right[1] * sx + _up[1] * sy;
    const dirZ = _fwd[2] + _right[2] * sx + _up[2] * sy;
    const dlen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
    const rdx = dirX / dlen;
    const rdy = dirY / dlen;
    const rdz = dirZ / dlen;

    const ox = t.posX;
    const oy = t.posY;
    const oz = t.posZ;

    // Intersect a flat Y=0 plane first; needs the ray to point downward.
    if (rdy >= -1e-4) return null;
    let tHit = (0 - oy) / rdy;
    if (tHit <= 0) return null;
    let gx = ox + rdx * tHit;
    let gz = oz + rdz * tHit;

    // Refine against the heightfield: re-intersect at the sampled terrain height a
    // few times so a sloped surface resolves to ~the right XZ (fixed-point).
    for (let iter = 0; iter < 4; iter++) {
      const hy = heightAt(gx, gz);
      const tH = (hy - oy) / rdy;
      if (tH <= 0) break;
      const nx = ox + rdx * tH;
      const nz = oz + rdz * tH;
      if (Math.abs(nx - gx) < 0.05 && Math.abs(nz - gz) < 0.05) { gx = nx; gz = nz; break; }
      gx = nx;
      gz = nz;
    }

    return { x: gx, z: gz };
  }

  // ── issue a move order to the current selection (formation-spread) ──────────
  function issueMove(cx: number, cz: number): void {
    const selected = selection.getSelected();
    if (selected.length === 0) return;

    // Clamp the group center to a walkable cell so the whole order is reachable.
    const center = pathGrid.clampToWalkable(cx, cz);
    const offsets = formationOffsets(selected.length);

    for (let i = 0; i < selected.length; i++) {
      const e = selected[i];
      // Only units with a Movement component can be ordered to move.
      if (!world.get(e, Movement).ok) continue;
      const off = offsets[i] ?? { dx: 0, dz: 0 };
      let tx = center.x + off.dx;
      let tz = center.z + off.dz;
      // Keep each destination on a walkable cell.
      const wp = pathGrid.clampToWalkable(tx, tz);
      tx = wp.x;
      tz = wp.z;

      const cmd: UnitCommand = { type: 'move', targetX: tx, targetZ: tz, clickX: cx, clickZ: cz };
      commandCurrent.set(e, cmd);
      const q = commandQueue.get(e);
      if (q) q.length = 0; // a fresh move order replaces the queue
    }
  }

  function moveSelectedTo(x: number, z: number): void {
    issueMove(x, z);
  }

  // ── right-click handling (edge-triggered) as an ECS system ─────────────────
  let rightWasDown = false;
  world.addSystem({
    name: 'mc-rightclick-move',
    queries: [],
    resources: [],
    fn: () => {
      const down = input.buttons.right;
      if (down && !rightWasDown) {
        const ground = screenToGround(input.x, input.y);
        if (ground) issueMove(ground.x, ground.z);
      }
      rightWasDown = down;
    },
  });

  return { pathGrid, occupancy, flowField, pathfinder, moveSelectedTo, screenToGround };
}
