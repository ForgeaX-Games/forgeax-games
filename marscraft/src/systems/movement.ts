/**
 * MarsCraft -> forgeax-engine — MovementSystem port (Milestone M5)
 * =============================================================================
 * Port of the Three.js source `web/systems/MovementSystem.ts`. Integrates each
 * unit's velocity, steering, arrival, terrain-follow and facing into the engine
 * `Transform`. Runs AFTER the CommandExecutor (which sets the move targets).
 *
 * Faithfully ported behaviour:
 *   - two move modes: FlowField (flowDirX/Z) vs target seek (targetX/Z)
 *   - building-push handling (movement.isPushed) takes priority
 *   - separation force (units don't overlap), per-layer (ground/air/hover),
 *     dynamic pair radius from both units' half-sizes, idle units too (weaker)
 *   - wall repulsion (probe 8 directions, push off blocked cells)
 *   - multi-direction wall slide (axis-aligned then ±angle offsets)
 *   - passability check (multi-point for wide units) blocks moves into walls
 *   - acceleration toward a facing-scaled target speed; creep boost
 *   - turn-rate-limited facing; terrain height follow (ground sits, air floats)
 *   - arrival within arrivalThreshold clears the target
 *
 * ── ECS adaptation ───────────────────────────────────────────────────────────
 * Transform / Movement / Motion are SoA columns. The source's `transform.x/z`,
 * `transform.rotationY` and `transform.fallVelocity` map to `Transform.posX/posZ`,
 * `Motion.facingY` and `Motion.fallVelocity`; the engine `Transform` stores
 * rotation as a quaternion, so each frame we derive the yaw quat from `facingY`
 * (a rotation about +Y) and write it back. Per-frame separation needs every
 * mover's position; we gather them from the batch into a scratch array.
 *
 * The dropped pieces are systems not yet ported and are clearly inert here:
 *   - stun/lockdown buff gates, dash control (M9 abilities)
 *   - hazard-block / friendly-building passthrough / harvesting-skip (M7/M8/M9)
 *   - the verbose per-second debug logging (dev-only, omitted)
 * Local avoidance via the OccupancyGrid: we refresh its dynamic unit layer each
 * frame (clearUnits + addUnit per mover) as M5 requires; the separation force
 * itself reads live positions exactly like the source.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform, quat } from '@forgeax/engine-runtime';
import { Movement, Motion, Renderable, MOVE_TYPE } from '../components';
import type { OccupancyGrid } from '../world/occupancy-grid';

export interface MovementBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MovementDeps {
  /** Terrain surface sampler (unit sits / floats above this). */
  getTerrainHeight: (x: number, z: number) => number;
  /** Passability query (world coords). null = no blocking (open field). */
  isWalkable?: ((x: number, z: number) => boolean) | null;
  /** Movement clamp bounds (map extents). */
  bounds?: MovementBounds | null;
  /** Optional dynamic occupancy grid to refresh each frame. */
  occupancy?: OccupancyGrid | null;
}

// Collision/pathing radius = visual radius * this (matches CommandExecutor).
const PATHING_RADIUS_RATIO = 0.7;
const WALL_PROBE_DIST = 1.2;
const WALL_REPULSION_STRENGTH = 4.0;
const SLIDE_ANGLES = [
  Math.PI / 6, -Math.PI / 6,
  Math.PI / 4, -Math.PI / 4,
  Math.PI / 3, -Math.PI / 3,
  Math.PI / 2, -Math.PI / 2,
  Math.PI * 2 / 3, -Math.PI * 2 / 3,
];

const SEPARATION_STRENGTH = 4.0;
const SEPARATION_RADIUS = 1.8;

const FLY_HEIGHT = 4.5;
const FLY_SMOOTH = 0.05;
const GRAVITY = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/** Scratch row read from the batch (one mover). */
interface MoverPos {
  x: number;
  z: number;
  moveType: number;
  halfSize: number;
}

/** A mover gathered across all batches: its owning batch + row index + pos. */
interface Mover {
  b: Batch;
  i: number;
  x: number;
  z: number;
  moveType: number;
  halfSize: number;
}

/** Reusable yaw-quat scratch (rotation about +Y by facingY). */
const _yawQuat = quat.create();

/**
 * Install the movement system. It steers every unit with a Movement component,
 * integrating into Transform, following terrain via `getTerrainHeight`, and
 * (optionally) honoring `isWalkable` for hard wall blocking + slide.
 */
export function installMovement(world: World, deps: MovementDeps): void {
  const getTerrainHeight = deps.getTerrainHeight;
  const isWalkable = deps.isWalkable ?? null;
  const bounds = deps.bounds ?? null;
  const occupancy = deps.occupancy ?? null;

  // Pre-allocated scratch (grown as needed) — both reused across frames so the
  // per-frame movement pass allocates nothing on the hot path (was a fresh array +
  // one object per mover every frame).
  let positions: MoverPos[] = [];
  const movers: Mover[] = [];

  // ── single-point passability (terrain only; hazard/friendly-building = M7+) ──
  const isPassable = (x: number, z: number): boolean => {
    if (isWalkable && !isWalkable(x, z)) return false;
    return true;
  };

  // ── multi-point passability for wide units (center + 4 cardinal edges) ──
  const isPassableForUnit = (x: number, z: number, halfSize: number): boolean => {
    if (!isPassable(x, z)) return false;
    if (halfSize > 0.5) {
      if (!isPassable(x + halfSize, z)) return false;
      if (!isPassable(x - halfSize, z)) return false;
      if (!isPassable(x, z + halfSize)) return false;
      if (!isPassable(x, z - halfSize)) return false;
    }
    return true;
  };

  world.addSystem({
    name: 'mc-movement',
    queries: [{ with: [Entity, Transform, Movement, Motion, Renderable] }],
    resources: ['Time'],
    fn: (_w, qr) => {
      const dt = world.getResource<{ dt: number }>('Time').dt;
      // qr[0] is an ARRAY of batches (one per archetype) — units span several
      // archetypes (different optional components). Separation + occupancy must
      // see EVERY mover across ALL batches, so we do two passes over them.
      const batches = qr[0] as unknown as Batch[];

      // ── Pass 1: gather every mover across all batches into a flat list +
      //    refresh occupancy. `positions` is the global separation set (aligned
      //    1:1 with `movers`). ──
      if (occupancy) occupancy.clearUnits();
      // POOLED: reuse the `movers` scratch objects (mutate in place); `mc` is the live
      // count, `movers.length = mc` trims extras while keeping [0,mc) for next frame.
      let mc = 0;
      for (const b of batches) {
        const n = b.Entity.self.length as number;
        if (n === 0) continue;
        const hasRenderable = !!b.Renderable;
        for (let i = 0; i < n; i++) {
          const x = b.Transform.posX[i];
          const z = b.Transform.posZ[i];
          const moveType = b.Movement.moveType[i];
          const size = hasRenderable ? b.Renderable.size[i] : 1;
          const halfSize = size * 0.5 * PATHING_RADIUS_RATIO;
          let mv = movers[mc];
          if (mv === undefined) { mv = { b, i, x, z, moveType, halfSize }; movers[mc] = mv; }
          else { mv.b = b; mv.i = i; mv.x = x; mv.z = z; mv.moveType = moveType; mv.halfSize = halfSize; }
          mc++;
          if (occupancy) occupancy.addUnit(x, z);
        }
      }
      movers.length = mc;

      const n = movers.length;
      if (n === 0) return;

      // Mirror the flat mover list into the reusable `positions` scratch (the
      // separation force reads this — it must contain ALL movers across batches).
      if (positions.length < n) {
        positions = new Array<MoverPos>(n);
        for (let i = 0; i < n; i++) positions[i] = { x: 0, z: 0, moveType: 0, halfSize: 0.5 };
      }
      for (let i = 0; i < n; i++) {
        const m = movers[i];
        const p = positions[i];
        p.x = m.x; p.z = m.z; p.moveType = m.moveType; p.halfSize = m.halfSize;
      }

      // ── Pass 2: per-mover integration (separation compares each mover against
      //    all others in the global flat list). ──
      for (let mi = 0; mi < n; mi++) {
        const mover = movers[mi];
        const b = mover.b;
        // `mi` indexes the global flat list (positions / separation `oi` loops);
        // `bi` is this mover's row within its OWN batch (all b.* column access).
        const bi = mover.i;
        const hasRenderable = !!b.Renderable;
        const entity = b.Entity.self[bi] as EntityHandle;

        let tx = b.Transform.posX[bi];
        let tz = b.Transform.posZ[bi];
        const moveType = b.Movement.moveType[bi];
        const speed = b.Movement.speed[bi];
        const turnRate = b.Movement.turnRate[bi];
        const arrivalThreshold = b.Movement.arrivalThreshold[bi];
        const myHalfSize = positions[mi].halfSize;

        let facingY = b.Motion.facingY[bi];
        let fallVelocity = b.Motion.fallVelocity[bi];
        let currentSpeed = b.Movement.currentSpeed[bi];

        // ---- building push (priority; does not interrupt the command queue) ----
        if (b.Movement.isPushed[bi]) {
          const pdx = b.Movement.pushTargetX[bi] - tx;
          const pdz = b.Movement.pushTargetZ[bi] - tz;
          const pDist = Math.sqrt(pdx * pdx + pdz * pdz);
          if (pDist < 0.15) {
            b.Movement.isPushed[bi] = 0;
          } else {
            const pushSpeed = Math.max(speed, 6.0);
            const pStep = Math.min(pushSpeed * dt, pDist);
            tx += (pdx / pDist) * pStep;
            tz += (pdz / pDist) * pStep;
            b.Transform.posX[bi] = tx;
            b.Transform.posZ[bi] = tz;
            writeTerrainY(b, bi, tx, tz, moveType, dt, getTerrainHeight, hasRenderable, fallVelocity);
            continue;
          }
        }

        // ---- determine move direction ----
        let moveX = 0;
        let moveZ = 0;
        let wantMove = false;

        const useFlowField = !!b.Movement.useFlowField[bi];
        const hasTarget = !!b.Movement.hasTarget[bi];
        const arrived = !!b.Movement.arrived[bi];

        if (useFlowField) {
          moveX = b.Movement.flowDirX[bi];
          moveZ = b.Movement.flowDirZ[bi];
          wantMove = moveX !== 0 || moveZ !== 0;
        } else if (hasTarget && !arrived) {
          const dx = b.Movement.targetX[bi] - tx;
          const dz = b.Movement.targetZ[bi] - tz;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist < arrivalThreshold) {
            b.Movement.arrived[bi] = 1;
            b.Movement.hasTarget[bi] = 0;
            // still update terrain Y before continuing
            writeTerrainY(b, bi, tx, tz, moveType, dt, getTerrainHeight, hasRenderable, fallVelocity);
            continue;
          }

          moveX = dx / dist;
          moveZ = dz / dist;
          wantMove = true;

          // decelerate near the target
          const decelDist = speed * 0.4;
          if (dist < decelDist) {
            const factor = dist / decelDist;
            moveX *= factor;
            moveZ *= factor;
          }
        }

        if (!wantMove) {
          // No move intent -> decelerate.
          currentSpeed = Math.max(0, currentSpeed - speed * dt * 5);

          // Idle separation (weaker) so stacked units spread.
          const myLayer = moveType;
          let idleSepX = 0;
          let idleSepZ = 0;
          for (let oi = 0; oi < n; oi++) {
            if (oi === mi) continue;
            const other = positions[oi];
            if (other.moveType !== myLayer) continue;
            const dx = tx - other.x;
            const dz = tz - other.z;
            const pairRadius = Math.max(SEPARATION_RADIUS, myHalfSize + other.halfSize);
            const sepR2 = pairRadius * pairRadius;
            const dist2 = dx * dx + dz * dz;
            if (dist2 < sepR2 && dist2 > 0.01) {
              const d = Math.sqrt(dist2);
              const force = (pairRadius - d) / pairRadius;
              idleSepX += (dx / d) * force;
              idleSepZ += (dz / d) * force;
            }
          }
          if (idleSepX !== 0 || idleSepZ !== 0) {
            const idleSepStr = SEPARATION_STRENGTH * 0.6;
            let pushX = idleSepX * idleSepStr * dt;
            let pushZ = idleSepZ * idleSepStr * dt;
            const pushLen = Math.sqrt(pushX * pushX + pushZ * pushZ);
            const maxPush = speed * dt * 0.3;
            if (pushLen > maxPush) {
              const scale = maxPush / pushLen;
              pushX *= scale;
              pushZ *= scale;
            }
            const newX = tx + pushX;
            const newZ = tz + pushZ;
            const isIdleAir = myLayer === MOVE_TYPE.AIR;
            if (isIdleAir || isPassableForUnit(newX, newZ, myHalfSize)) {
              tx = newX;
              tz = newZ;
            }
          }

          b.Movement.currentSpeed[bi] = currentSpeed;
          b.Transform.posX[bi] = tx;
          b.Transform.posZ[bi] = tz;
          writeTerrainY(b, bi, tx, tz, moveType, dt, getTerrainHeight, hasRenderable, fallVelocity);
          continue;
        }

        const halfSize = myHalfSize;

        // ---- wall repulsion (ground only) ----
        if (moveType === MOVE_TYPE.GROUND && isWalkable) {
          const wallProbeDist = Math.max(WALL_PROBE_DIST, halfSize + 0.5);
          let wallRepX = 0;
          let wallRepZ = 0;
          for (let d = 0; d < 8; d++) {
            const angle = d * Math.PI / 4;
            const probeX = tx + Math.sin(angle) * wallProbeDist;
            const probeZ = tz + Math.cos(angle) * wallProbeDist;
            if (!isPassable(probeX, probeZ)) {
              wallRepX -= Math.sin(angle);
              wallRepZ -= Math.cos(angle);
            }
          }
          if (wallRepX !== 0 || wallRepZ !== 0) {
            const repLen = Math.sqrt(wallRepX * wallRepX + wallRepZ * wallRepZ);
            wallRepX /= repLen;
            wallRepZ /= repLen;
            const repPush = WALL_REPULSION_STRENGTH * dt;
            const repNewX = tx + wallRepX * repPush;
            const repNewZ = tz + wallRepZ * repPush;
            if (isPassableForUnit(repNewX, repNewZ, halfSize * 0.5)) {
              tx = repNewX;
              tz = repNewZ;
            }
          }
        }

        // ---- separation force (per layer; dynamic pair radius) ----
        {
          const isAirUnit = moveType === MOVE_TYPE.AIR;
          const myLayer = moveType;
          let sepX = 0;
          let sepZ = 0;
          let nearWall = false;

          if (!isAirUnit && isWalkable) {
            const nearWallDist = Math.max(0.8, halfSize);
            for (let d = 0; d < 4; d++) {
              const angle = d * Math.PI / 2;
              const px = tx + Math.sin(angle) * nearWallDist;
              const pz = tz + Math.cos(angle) * nearWallDist;
              if (!isPassable(px, pz)) { nearWall = true; break; }
            }
          }

          for (let oi = 0; oi < n; oi++) {
            if (oi === mi) continue;
            const other = positions[oi];
            if (other.moveType !== myLayer) continue;
            const dx = tx - other.x;
            const dz = tz - other.z;
            const pairRadius = Math.max(SEPARATION_RADIUS, halfSize + other.halfSize);
            const sepR2 = pairRadius * pairRadius;
            const dist2 = dx * dx + dz * dz;
            if (dist2 < sepR2 && dist2 > 0.01) {
              const d = Math.sqrt(dist2);
              const force = (pairRadius - d) / pairRadius;
              sepX += (dx / d) * force;
              sepZ += (dz / d) * force;
            }
          }

          if (sepX !== 0 || sepZ !== 0) {
            const sepStrength = nearWall ? SEPARATION_STRENGTH * 0.3 : SEPARATION_STRENGTH;
            let pushX = sepX * sepStrength * dt;
            let pushZ = sepZ * sepStrength * dt;
            const pushLen = Math.sqrt(pushX * pushX + pushZ * pushZ);
            const maxPush = speed * dt * 0.5;
            if (pushLen > maxPush) {
              const scale = maxPush / pushLen;
              pushX *= scale;
              pushZ *= scale;
            }
            const sepNewX = tx + pushX;
            const sepNewZ = tz + pushZ;
            if (isAirUnit || isPassableForUnit(sepNewX, sepNewZ, halfSize)) {
              tx = sepNewX;
              tz = sepNewZ;
            }
          }
        }

        // ---- keep the move direction pure (flow/target only) ----
        const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (len > 0.01) {
          moveX /= len;
          moveZ /= len;
        }

        // ---- turning ----
        const targetAngle = Math.atan2(moveX, moveZ);
        let angleDiff = targetAngle - facingY;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const maxTurn = turnRate * dt;
        if (Math.abs(angleDiff) > maxTurn) {
          facingY += Math.sign(angleDiff) * maxTurn;
        } else {
          facingY = targetAngle;
        }
        while (facingY > Math.PI) facingY -= Math.PI * 2;
        while (facingY < -Math.PI) facingY += Math.PI * 2;

        // ---- acceleration (facing-scaled target speed + creep boost) ----
        const facingFactor = 1 - Math.abs(angleDiff) / Math.PI;
        const creepMult = b.Movement.creepBoosted[bi] ? 1.3 : 1.0;
        const effectiveSpeed = speed * creepMult;
        const targetSpeed = effectiveSpeed * Math.max(0.3, facingFactor);

        if (currentSpeed < targetSpeed) {
          currentSpeed = Math.min(targetSpeed, currentSpeed + effectiveSpeed * dt * 4);
        } else {
          currentSpeed = Math.max(targetSpeed, currentSpeed - effectiveSpeed * dt * 2);
        }

        // ---- move (passability + multi-direction slide) ----
        const dir = facingY;
        const step = currentSpeed * dt;
        const newX = tx + Math.sin(dir) * step;
        const newZ = tz + Math.cos(dir) * step;
        const slideHalfSize = halfSize * 0.5;

        if (moveType === MOVE_TYPE.GROUND && isWalkable) {
          if (isPassableForUnit(newX, newZ, halfSize)) {
            tx = newX;
            tz = newZ;
          } else {
            let slid = false;
            if (isPassableForUnit(newX, tz, slideHalfSize)) {
              tx = newX;
              slid = true;
            } else if (isPassableForUnit(tx, newZ, slideHalfSize)) {
              tz = newZ;
              slid = true;
            }
            if (!slid) {
              for (const offset of SLIDE_ANGLES) {
                const slideDir = dir + offset;
                const sx = tx + Math.sin(slideDir) * step * 0.7;
                const sz = tz + Math.cos(slideDir) * step * 0.7;
                if (isPassableForUnit(sx, sz, slideHalfSize)) {
                  tx = sx;
                  tz = sz;
                  slid = true;
                  break;
                }
              }
            }
            if (!slid) {
              currentSpeed *= 0.7;
            }
          }
        } else {
          // air / hover / no pathing -> move directly
          tx = newX;
          tz = newZ;
        }

        // ---- bounds clamp ----
        if (bounds) {
          tx = Math.max(bounds.minX, Math.min(bounds.maxX, tx));
          tz = Math.max(bounds.minZ, Math.min(bounds.maxZ, tz));
        }

        // ---- write back position + facing + speed ----
        b.Transform.posX[bi] = tx;
        b.Transform.posZ[bi] = tz;
        b.Motion.facingY[bi] = facingY;
        b.Movement.currentSpeed[bi] = currentSpeed;

        // yaw quaternion from facingY (rotation about +Y)
        quat.fromAxisAngle(_yawQuat, [0, 1, 0], facingY);
        b.Transform.quatX[bi] = _yawQuat[0];
        b.Transform.quatY[bi] = _yawQuat[1];
        b.Transform.quatZ[bi] = _yawQuat[2];
        b.Transform.quatW[bi] = _yawQuat[3];

        // terrain follow (reads back the just-updated fallVelocity)
        fallVelocity = b.Motion.fallVelocity[bi];
        writeTerrainY(b, bi, tx, tz, moveType, dt, getTerrainHeight, hasRenderable, fallVelocity);
      }
    },
  });
}

/**
 * Update Transform.posY to follow the terrain (ground sits on it; air floats
 * FLY_HEIGHT above with smoothing; post-dash fall uses gravity). Writes both
 * posY and Motion.fallVelocity. `halfSize` here is the FULL visual half-size
 * (model rests on its base), distinct from the pathing half-size.
 */
function writeTerrainY(
  b: Batch,
  i: number,
  x: number,
  z: number,
  moveType: number,
  dt: number,
  getTerrainHeight: (x: number, z: number) => number,
  hasRenderable: boolean,
  fallVelocity: number,
): void {
  const terrainY = getTerrainHeight(x, z);
  const size = hasRenderable ? b.Renderable.size[i] : 1;
  const halfSize = size / 2;
  let y = b.Transform.posY[i];

  if (moveType === MOVE_TYPE.AIR) {
    const targetY = terrainY + halfSize + FLY_HEIGHT;
    y += (targetY - y) * FLY_SMOOTH;
    b.Transform.posY[i] = y;
    b.Motion.fallVelocity[i] = 0;
    return;
  }

  const groundY = terrainY + halfSize;
  if (fallVelocity > 0 && y > groundY) {
    fallVelocity += GRAVITY * dt;
    y -= fallVelocity * dt;
    if (y <= groundY) {
      y = groundY;
      fallVelocity = 0;
    }
    b.Transform.posY[i] = y;
    b.Motion.fallVelocity[i] = fallVelocity;
  } else {
    b.Transform.posY[i] = groundY;
    b.Motion.fallVelocity[i] = 0;
  }
}
