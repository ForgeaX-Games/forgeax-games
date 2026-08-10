import {
  Entity,
  Update,
  createQueryState,
  queryRun,
  type EntityHandle,
  type World,
} from '@forgeax/engine-ecs';
import {
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
  type PhysicsWorld,
} from '@forgeax/engine-physics';
import { vec3 } from '@forgeax/engine-math';
import { Name, Transform } from '@forgeax/engine-scene';
import { inState } from '@forgeax/engine-state';
import { FreeCameraMotion, PlayerMotion } from './components/gameplay';
import { GameState } from './gameplay-state';
import { LAST_LIGHT_CAUSEWAY, LAST_LIGHT_TERRACE_COLLIDER } from './environment-layout';

type Vec3 = readonly [number, number, number];
type TraversalCameraMode = 'topdown' | 'orbit' | 'fps' | 'pan';

export const TRAVERSAL_RECOVERY_Y = -5.5;

/**
 * Thin overlapping slabs approximate the authored irregular island from
 * beneath. Their outer corners stay inside the smallest procedural shoreline,
 * so no collider can support a player over visible empty sky.
 */
export const MAIN_ISLAND_SUPPORTS = [
  { name: 'AetherfallTraversalFloor0', position: [0, -0.3, -2] as Vec3, halfExtents: [9.65, 0.3, 4] as Vec3, yaw: 0 },
  { name: 'AetherfallTraversalFloor45', position: [0, -0.3, -2] as Vec3, halfExtents: [9.65, 0.3, 4] as Vec3, yaw: Math.PI / 4 },
  { name: 'AetherfallTraversalFloor90', position: [0, -0.3, -2] as Vec3, halfExtents: [9.65, 0.3, 4] as Vec3, yaw: Math.PI / 2 },
  { name: 'AetherfallTraversalFloor135', position: [0, -0.3, -2] as Vec3, halfExtents: [9.65, 0.3, 4] as Vec3, yaw: Math.PI * 3 / 4 },
  // The main-island lip and rounded observatory terrace visibly overlap along
  // this narrow route. The support stays under those surfaces; it is a floor,
  // never a vertical barrier, and preserves the mission route to Last Light.
  { name: 'AetherfallTraversalCauseway', ...LAST_LIGHT_CAUSEWAY },
] as const;

export type TraversalRecoveryState = {
  lastSafePosition: [number, number, number];
  recoveries: number;
  recovered: boolean;
};

export type TraversalBoundaryCleanupFailure = {
  readonly target: 'recovery-system' | `support-collider:${number}`;
  readonly kind: 'result' | 'throw';
  readonly code: string;
  readonly message: string;
};

export type TraversalBoundaryDisposeResult = {
  readonly ok: boolean;
  readonly complete: boolean;
  readonly attempted: number;
  readonly remaining: number;
  readonly failures: readonly TraversalBoundaryCleanupFailure[];
};

export type TraversalBoundaryHandle = {
  readonly removedOversizedGroundCount: number;
  readonly supportColliders: readonly EntityHandle[];
  readonly snapshot: () => Readonly<TraversalRecoveryState>;
  readonly reset: () => void;
  /**
   * Best-effort cleanup. Every pending target is attempted once per call;
   * successful targets are retired, while failures remain retryable.
   */
  readonly dispose: () => TraversalBoundaryDisposeResult;
};

function cleanupFailure(
  target: TraversalBoundaryCleanupFailure['target'],
  kind: TraversalBoundaryCleanupFailure['kind'],
  cause: unknown,
): TraversalBoundaryCleanupFailure {
  if (kind === 'result') {
    const error = cause as { readonly code?: unknown; readonly hint?: unknown };
    const code = typeof error?.code === 'string' ? error.code : 'cleanup-failed';
    const message = typeof error?.hint === 'string' ? error.hint : code;
    return { target, kind, code, message };
  }
  return {
    target,
    kind,
    code: 'cleanup-threw',
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

function pointInOrientedBox(
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  halfX: number,
  halfZ: number,
  yaw: number,
  inset: number,
): boolean {
  const dx = x - centerX;
  const dz = z - centerZ;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const localX = cosine * dx + sine * dz;
  const localZ = -sine * dx + cosine * dz;
  return Math.abs(localX) <= Math.max(0, halfX - inset)
    && Math.abs(localZ) <= Math.max(0, halfZ - inset);
}

/**
 * Pure traversal footprint used only to retain a reliable recovery point.
 * The observatory rectangle matches the procedural terrace's deliberately
 * inset collider, while the main-island boxes exactly mirror the physical
 * support slabs above.
 */
export function isTraversalSupportPoint(x: number, z: number, inset = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(inset)) return false;
  for (const support of MAIN_ISLAND_SUPPORTS) {
    if (pointInOrientedBox(
      x,
      z,
      support.position[0],
      support.position[2],
      support.halfExtents[0],
      support.halfExtents[2],
      support.yaw,
      Math.max(0, inset),
    )) return true;
  }
  return pointInOrientedBox(
    x,
    z,
    LAST_LIGHT_TERRACE_COLLIDER.position[0],
    LAST_LIGHT_TERRACE_COLLIDER.position[2],
    LAST_LIGHT_TERRACE_COLLIDER.halfExtents[0],
    LAST_LIGHT_TERRACE_COLLIDER.halfExtents[2],
    LAST_LIGHT_TERRACE_COLLIDER.yaw,
    Math.max(0, inset),
  );
}

/** Remove only the exact oversized template floor; unrelated static geometry is untouched. */
export function removeOversizedTemplateGround(world: World): number {
  const query = createQueryState({ with: [Collider, RigidBody, Transform, Entity] });
  const matches: EntityHandle[] = [];
  queryRun(query, world, (bundle) => {
    for (const rawEntity of bundle.Entity.self) {
      if (rawEntity === undefined) continue;
      const entity = rawEntity as EntityHandle;
      const collider = world.get(entity, Collider);
      const body = world.get(entity, RigidBody);
      const transform = world.get(entity, Transform);
      if (!collider.ok || !body.ok || !transform.ok) continue;
      const halfExtents = collider.value.halfExtents;
      if (
        collider.value.shape === ColliderShapeValue.cuboid
        && body.value.type === RigidBodyTypeValue.static
        && Math.abs((halfExtents[0] ?? 0) - 60) < 1e-4
        && Math.abs((halfExtents[1] ?? 0) - 5) < 1e-4
        && Math.abs((halfExtents[2] ?? 0) - 60) < 1e-4
        && Math.abs((transform.value.pos[0] ?? 0)) < 1e-4
        && Math.abs((transform.value.pos[1] ?? 0) + 5) < 1e-4
        && Math.abs((transform.value.pos[2] ?? 0)) < 1e-4
      ) matches.push(entity);
    }
  });
  for (const entity of matches) world.despawn(entity).unwrap();
  return matches.length;
}

export function createTraversalFloorColliders(world: World): EntityHandle[] {
  return MAIN_ISLAND_SUPPORTS.map((support) => {
    const halfYaw = support.yaw * 0.5;
    return world.spawn(
      { component: Name, data: { value: support.name } },
      {
        component: Transform,
        data: {
          pos: [...support.position],
          quat: [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
          scale: [1, 1, 1],
        },
      },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      {
        component: Collider,
        data: {
          shape: ColliderShapeValue.cuboid,
          halfExtents: [...support.halfExtents],
          friction: 0.9,
          restitution: 0,
        },
      },
    ).unwrap();
  });
}

export function stepTraversalRecovery(args: {
  readonly world: World;
  readonly player: EntityHandle;
  readonly physics: PhysicsWorld | undefined;
  readonly state: TraversalRecoveryState;
  readonly cameraMode: TraversalCameraMode;
}): boolean {
  args.state.recovered = false;
  const transform = args.world.get(args.player, Transform);
  if (!transform.ok) return false;
  const x = transform.value.pos[0] ?? Number.NaN;
  const y = transform.value.pos[1] ?? Number.NaN;
  const z = transform.value.pos[2] ?? Number.NaN;
  const invalidPose = !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z);
  const motion = args.world.get(args.player, PlayerMotion);
  const groundedTraversal = args.cameraMode !== 'fps' && motion.ok && motion.value.grounded !== 0;
  if (!invalidPose && groundedTraversal && y >= -2 && isTraversalSupportPoint(x, z, 0.65)) {
    args.state.lastSafePosition = [x, y, z];
  }
  if (!invalidPose && y > TRAVERSAL_RECOVERY_Y) return false;

  const [safeX, safeY, safeZ] = args.state.lastSafePosition;
  args.world.set(args.player, Transform, { pos: [safeX, safeY, safeZ] });
  if (args.physics?.hasBody(args.player)) {
    args.physics.teleport(args.player, vec3.create(safeX, safeY, safeZ));
  }
  if (motion.ok) {
    args.world.set(args.player, PlayerMotion, {
      faceX: motion.value.faceX,
      faceZ: motion.value.faceZ,
      jumpY: safeY,
      freeY: safeY,
      velocityY: 0,
      grounded: 0,
      shootCooldown: motion.value.shootCooldown,
    });
  }
  const freeMotion = args.world.get(args.player, FreeCameraMotion);
  if (freeMotion.ok) {
    args.world.set(args.player, FreeCameraMotion, {
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      walkSpeed: freeMotion.value.walkSpeed,
      runSpeed: freeMotion.value.runSpeed,
    });
  }
  args.state.recoveries += 1;
  args.state.recovered = true;
  return true;
}

/**
 * Replace the graybox safety plane with visible-surface support and recover a
 * genuine fall. This intentionally does not approximate the Sponza facade with
 * an opaque wall: its visible arches need authored collision, not guesswork.
 */
export function installTraversalBoundary(args: {
  readonly world: World;
  readonly player: EntityHandle;
  readonly physics: PhysicsWorld | undefined;
  readonly initialPosition: Vec3;
  readonly getMode: () => TraversalCameraMode;
}): TraversalBoundaryHandle {
  const removedOversizedGroundCount = removeOversizedTemplateGround(args.world);
  const supportColliders = createTraversalFloorColliders(args.world);
  const state: TraversalRecoveryState = {
    lastSafePosition: [...args.initialPosition],
    recoveries: 0,
    recovered: false,
  };
  const systemName = 'aetherfall-traversal-recovery';
  args.world.addSystem(Update, {
    name: systemName,
    runIf: inState(GameState, 'Play'),
    after: ['game-player-movement'],
    before: ['aetherfall-exploration-interaction', 'propagateTransforms'],
    queries: [],
    fn: () => { stepTraversalRecovery({ ...args, state, cameraMode: args.getMode() }); },
  }).unwrap();
  let recoverySystemPending = true;
  const pendingSupports = new Set(supportColliders);
  const reset = (): void => {
    state.lastSafePosition = [...args.initialPosition];
    state.recoveries = 0;
    state.recovered = false;
  };
  const recoverySystemExists = (): boolean => {
    try {
      return args.world.scheduleData()
        .find((schedule) => schedule.name === Update.name)
        ?.systems.some((system) => system.name === systemName) === true;
    } catch {
      return true;
    }
  };
  const supportExists = (entity: EntityHandle): boolean => {
    try {
      return args.world.get(entity, Entity).ok;
    } catch {
      return true;
    }
  };
  return {
    removedOversizedGroundCount,
    supportColliders,
    snapshot: () => ({
      lastSafePosition: [...state.lastSafePosition],
      recoveries: state.recoveries,
      recovered: state.recovered,
    }),
    reset,
    dispose: () => {
      let attempted = 0;
      const failures: TraversalBoundaryCleanupFailure[] = [];
      if (recoverySystemPending && !recoverySystemExists()) {
        recoverySystemPending = false;
      }
      for (const entity of [...pendingSupports]) {
        if (!supportExists(entity)) pendingSupports.delete(entity);
      }
      if (recoverySystemPending) {
        attempted += 1;
        try {
          const removed = args.world.removeSystem(Update, systemName);
          if (removed.ok) recoverySystemPending = false;
          else {
            failures.push(cleanupFailure('recovery-system', 'result', removed.error));
            if (!recoverySystemExists()) recoverySystemPending = false;
          }
        } catch (error) {
          failures.push(cleanupFailure('recovery-system', 'throw', error));
          if (!recoverySystemExists()) recoverySystemPending = false;
        }
      }
      for (const entity of [...pendingSupports]) {
        attempted += 1;
        const target = `support-collider:${entity}` as const;
        try {
          const despawned = args.world.despawn(entity);
          if (despawned.ok) pendingSupports.delete(entity);
          else {
            failures.push(cleanupFailure(target, 'result', despawned.error));
            if (!supportExists(entity)) pendingSupports.delete(entity);
          }
        } catch (error) {
          failures.push(cleanupFailure(target, 'throw', error));
          if (!supportExists(entity)) pendingSupports.delete(entity);
        }
      }
      const remaining = Number(recoverySystemPending) + pendingSupports.size;
      return {
        ok: failures.length === 0 && remaining === 0,
        complete: remaining === 0,
        attempted,
        remaining,
        failures,
      };
    },
  };
}
