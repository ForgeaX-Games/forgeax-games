import {
  CharacterController,
  type PhysicsWorld,
} from "@forgeax/engine-physics";
import {
  FixedTime,
  FixedUpdate,
  type EntityHandle,
  type World,
  Update,
} from "@forgeax/engine-ecs";
import { Transform } from "@forgeax/engine-scene";
import type { InputSnapshot } from "@forgeax/engine-input";
import { quat } from "@forgeax/engine-runtime";
import { vec3 } from "@forgeax/engine-math";
import { inState } from "@forgeax/engine-state";
import { ORBIT_INITIAL_YAW } from "../camera-orbit";
import {
  resetFreeCamera,
  stepFreeCamera,
  type FreeCameraState,
} from "../free-camera";
import { GameState } from "../gameplay-state";
import {
  FreeCameraMotion,
  GameplayInput,
  PlayerMotion,
} from "../components/gameplay";
import {
  GAME_DEFAULT_GAMEPLAY_CONFIG,
  type GameplayConfig,
} from "../resources/gameplay";

export const PLAYER_RUN_SPEED_MULTIPLIER = 1.5;

export type PlanarLocomotionArgs = {
  readonly inputX: number;
  readonly inputForward: number;
  readonly yaw: number;
  readonly running: boolean;
  readonly walkSpeed: number;
  readonly runSpeed: number;
};

export type PlanarLocomotion = {
  readonly inputMagnitude: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly faceX: number;
  readonly faceZ: number;
};

/** Resolve analog movement into a camera-relative world-space planar velocity. */
export function resolvePlanarLocomotion(
  args: PlanarLocomotionArgs,
): PlanarLocomotion {
  const inputX = Number.isFinite(args.inputX) ? args.inputX : 0;
  const inputForward = Number.isFinite(args.inputForward)
    ? args.inputForward
    : 0;
  const rawMagnitude = Math.hypot(inputX, inputForward);
  if (rawMagnitude <= Number.EPSILON) {
    return {
      inputMagnitude: 0,
      velocityX: 0,
      velocityZ: 0,
      faceX: 0,
      faceZ: 0,
    };
  }

  const inputMagnitude = Math.min(1, rawMagnitude);
  const localX = inputX / rawMagnitude;
  const localForward = inputForward / rawMagnitude;
  const yaw = Number.isFinite(args.yaw) ? args.yaw : 0;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const faceX = cosYaw * localX - sinYaw * localForward;
  const faceZ = -sinYaw * localX - cosYaw * localForward;
  const requestedSpeed = args.running ? args.runSpeed : args.walkSpeed;
  const speed = Number.isFinite(requestedSpeed)
    ? Math.max(0, requestedSpeed)
    : 0;
  return {
    inputMagnitude,
    velocityX: faceX * speed * inputMagnitude,
    velocityZ: faceZ * speed * inputMagnitude,
    faceX,
    faceZ,
  };
}

export type PlayerMovementSystemContext = {
  readonly world: World;
  readonly root: EntityHandle;
  readonly readInput: () => InputSnapshot;
  readonly getMode: () => "topdown" | "orbit" | "fps" | "pan";
  readonly physics: PhysicsWorld | undefined;
};

export type PlayerMovementSystemHandle = {
  readonly dispose: () => void;
};

export const PLAYER_MOVEMENT_PHYSICS_UNAVAILABLE =
  "player-movement-physics-unavailable";

/** Structured startup failure for a movement system that cannot move safely. */
export class PlayerMovementCapabilityError extends Error {
  readonly code = PLAYER_MOVEMENT_PHYSICS_UNAVAILABLE;
  readonly capability = "PhysicsWorld";
  readonly remediation =
    "Create the app with a 3D physics backend and insert PhysicsWorld before installing gameplay.";

  constructor() {
    super(
      "[aetherfall] PhysicsWorld is required for runtime-switchable Orbit, Topdown, and Pan player movement. Create the app with a 3D physics backend and insert PhysicsWorld before installing gameplay.",
    );
    this.name = "PlayerMovementCapabilityError";
  }
}

/** Resolve the capability once so installation cannot leave inert systems behind. */
export function requirePlayerMovementPhysics(
  physics: PhysicsWorld | undefined,
): PhysicsWorld {
  if (physics === undefined) throw new PlayerMovementCapabilityError();
  return physics;
}

export type PlayerMovementOutcome = {
  readonly fixedTick: number;
  readonly planarDistance: number;
  readonly planarSpeed: number;
  readonly sprinting: boolean;
};

const PLAYER_MOVEMENT_OUTCOMES = "aetherfallPlayerMovementOutcomes";
const PLAYER_MOVEMENT_DISTANCE_EPSILON = 1e-5;
type OwnedPlayerMovementOutcome = PlayerMovementOutcome & {
  readonly owner: symbol;
};

/** Read the last completed fixed-step result without exposing its writer. */
export function readPlayerMovementOutcome(
  world: World,
  root: EntityHandle,
): PlayerMovementOutcome | undefined {
  if (!world.hasResource(PLAYER_MOVEMENT_OUTCOMES)) return undefined;
  const outcome = world
    .getResource<ReadonlyMap<number, OwnedPlayerMovementOutcome>>(
      PLAYER_MOVEMENT_OUTCOMES,
    )
    .get(root);
  if (outcome === undefined) return undefined;
  return {
    fixedTick: outcome.fixedTick,
    planarDistance: outcome.planarDistance,
    planarSpeed: outcome.planarSpeed,
    sprinting: outcome.sprinting,
  };
}

type PlayerMovementIntent = {
  readonly moveX: number;
  readonly moveForward: number;
  readonly freeUp: boolean;
  readonly freeDown: boolean;
  readonly running: boolean;
  readonly mode: "topdown" | "orbit" | "fps" | "pan";
};

const ZERO_MOVEMENT_INTENT: PlayerMovementIntent = {
  moveX: 0,
  moveForward: 0,
  freeUp: false,
  freeDown: false,
  running: false,
  mode: "orbit",
};

function runMovementCleanup(steps: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, "Player movement cleanup failed");
}

/** Owns frame input capture, fixed-step KCC integration, and ECS pose writes. */
export function installPlayerMovementSystem(
  ctx: PlayerMovementSystemContext,
): PlayerMovementSystemHandle {
  const physics = requirePlayerMovementPhysics(ctx.physics);
  const outcomeOwner = Symbol("player-movement-outcome-owner");
  let intent = ZERO_MOVEMENT_INTENT;
  let pendingJump = false;
  let pendingWheelDelta = 0;
  let inputInstalled = false;
  let fixedInstalled = false;
  let bridgeInstalled = false;

  const publishOutcome = (outcome: PlayerMovementOutcome): void => {
    const current = ctx.world.hasResource(PLAYER_MOVEMENT_OUTCOMES)
      ? ctx.world.getResource<ReadonlyMap<number, OwnedPlayerMovementOutcome>>(
          PLAYER_MOVEMENT_OUTCOMES,
        )
      : new Map<number, OwnedPlayerMovementOutcome>();
    const next = new Map(current);
    next.set(ctx.root, { ...outcome, owner: outcomeOwner });
    ctx.world.insertResource(PLAYER_MOVEMENT_OUTCOMES, next);
  };

  const clearOutcome = (): void => {
    if (!ctx.world.hasResource(PLAYER_MOVEMENT_OUTCOMES)) return;
    const current = ctx.world.getResource<
      ReadonlyMap<number, OwnedPlayerMovementOutcome>
    >(PLAYER_MOVEMENT_OUTCOMES);
    if (current.get(ctx.root)?.owner !== outcomeOwner) return;
    const next = new Map(current);
    next.delete(ctx.root);
    if (next.size === 0) ctx.world.removeResource(PLAYER_MOVEMENT_OUTCOMES);
    else ctx.world.insertResource(PLAYER_MOVEMENT_OUTCOMES, next);
  };

  const dispose = (): void => {
    const steps: Array<() => void> = [];
    if (bridgeInstalled) {
      steps.push(() => {
        ctx.world.removeSystem(Update, "game-player-movement").unwrap();
        bridgeInstalled = false;
      });
    }
    if (fixedInstalled) {
      steps.push(() => {
        ctx.world
          .removeSystem(FixedUpdate, "game-player-movement-fixed")
          .unwrap();
        fixedInstalled = false;
      });
    }
    if (inputInstalled) {
      steps.push(() => {
        ctx.world
          .removeSystem(Update, "game-player-movement-input")
          .unwrap();
        inputInstalled = false;
      });
    }
    steps.push(clearOutcome);
    runMovementCleanup(steps);
  };

  try {
    ctx.world.addSystem(Update, {
      name: "game-player-movement-input",
      runIf: inState(GameState, "Play"),
      after: ["game-camera-input"],
      before: [FixedUpdate],
      queries: [],
      fn: () => {
        const snap = ctx.readInput();
        const mode = ctx.getMode();
        const arrowUp = snap.action("arrowUp").isPressed();
        const arrowDown = snap.action("arrowDown").isPressed();
        const arrowLeft = snap.action("arrowLeft").isPressed();
        const arrowRight = snap.action("arrowRight").isPressed();
        const move = snap.getVector(
          "moveLeft",
          "moveRight",
          "moveBack",
          "moveForward",
        );
        const topDown = mode === "topdown";
        intent = {
          moveForward:
            move.y +
            (topDown ? Number(arrowUp) - Number(arrowDown) : 0),
          moveX:
            move.x +
            (topDown ? Number(arrowRight) - Number(arrowLeft) : 0),
          freeUp: snap.action("freeUp").isPressed(),
          freeDown: snap.action("freeDown").isPressed(),
          running: snap.action("freeRun").isPressed(),
          mode,
        };
        pendingJump ||= snap.action("jump").justPressed();
        const wheelDelta = Number.isFinite(snap.mouse.wheelDelta)
          ? snap.mouse.wheelDelta
          : 0;
        pendingWheelDelta += wheelDelta;
      },
    }).unwrap();
    inputInstalled = true;

    ctx.world.addSystem(FixedUpdate, {
      name: "game-player-movement-fixed",
      runIf: inState(GameState, "Play"),
      after: ["game-fixed-simulation"],
      queries: [],
      fn: () => {
        const dt = ctx.world.getResource(FixedTime).delta;
        const config = ctx.world.getResource<GameplayConfig>(
          GAME_DEFAULT_GAMEPLAY_CONFIG,
        );
        const motionResult = ctx.world.get(ctx.root, PlayerMotion);
        const transformResult = ctx.world.get(ctx.root, Transform);
        const freeMotionResult = ctx.world.get(ctx.root, FreeCameraMotion);
        const inputResult = ctx.world.get(ctx.root, GameplayInput);
        if (
          !motionResult.ok ||
          !transformResult.ok ||
          !freeMotionResult.ok ||
          !inputResult.ok
        )
          return;
        const mode = intent.mode;
        const hasPhysicsBody = physics.hasBody(ctx.root);
        const jumpPressed = pendingJump && hasPhysicsBody;
        if (hasPhysicsBody || mode === "fps") pendingJump = false;
        const wheelDelta = pendingWheelDelta;
        pendingWheelDelta = 0;
        let jumpY = motionResult.value.jumpY;
        let freeY = motionResult.value.freeY;
        let vy = motionResult.value.velocityY;
        let grounded = motionResult.value.grounded !== 0;
        let faceX = motionResult.value.faceX;
        let faceZ = motionResult.value.faceZ;
        let px = transformResult.value.pos[0] ?? 0;
        let pz = transformResult.value.pos[2] ?? 0;
        const startX = px;
        const startZ = pz;
        const freeCamera: FreeCameraState = {
          velocityX: freeMotionResult.value.velocityX,
          velocityY: freeMotionResult.value.velocityY,
          velocityZ: freeMotionResult.value.velocityZ,
          walkSpeed: freeMotionResult.value.walkSpeed,
          runSpeed: freeMotionResult.value.runSpeed,
        };
        const f = intent.moveForward;
        const s = intent.moveX;
        let mvx = 0;
        let mvz = 0;
        if (mode !== "fps") {
          freeY = jumpY;
          resetFreeCamera(freeCamera);
        }
        if (mode === "fps") {
          const fwdX = -Math.sin(inputResult.value.lookYaw);
          const fwdZ = -Math.cos(inputResult.value.lookYaw);
          const rgtX = -fwdZ;
          const rgtZ = fwdX;
          faceX = fwdX;
          faceZ = fwdZ;
          const vertical =
            Number(intent.freeUp) - Number(intent.freeDown);
          const delta = stepFreeCamera(
            freeCamera,
            dt,
            [fwdX * f + rgtX * s, vertical, fwdZ * f + rgtZ * s],
            intent.running,
            wheelDelta,
          );
          px = Math.max(
            -config.movement.bound,
            Math.min(config.movement.bound, px + (delta[0] ?? 0)),
          );
          pz = Math.max(
            -config.movement.bound,
            Math.min(config.movement.bound, pz + (delta[2] ?? 0)),
          );
          freeY = Math.max(0.2, freeY + (delta[1] ?? 0));
        } else {
          const locomotion = resolvePlanarLocomotion({
            inputX: s,
            inputForward: f,
            yaw:
              mode === "orbit"
                ? ORBIT_INITIAL_YAW + inputResult.value.lookYaw
                : 0,
            running: intent.running,
            walkSpeed: config.movement.speed,
            runSpeed: config.movement.speed * PLAYER_RUN_SPEED_MULTIPLIER,
          });
          mvx = locomotion.velocityX;
          mvz = locomotion.velocityZ;
          if (locomotion.inputMagnitude > 0) {
            faceX = locomotion.faceX;
            faceZ = locomotion.faceZ;
          }
        }

        if (mode !== "fps" && hasPhysicsBody) {
          const before = ctx.world.get(ctx.root, CharacterController);
          grounded = before.ok && before.value.grounded === true;
          if (jumpPressed && grounded) {
            vy = config.movement.jumpVelocity;
            grounded = false;
          }
          vy -= config.movement.gravity * dt;
          if (grounded && vy < 0) vy = -config.movement.gravity * dt;
          physics.moveAndSlide(
            ctx.root,
            vec3.create(mvx * dt, vy * dt, mvz * dt),
          );
          const tr = ctx.world.get(ctx.root, Transform);
          if (tr.ok) {
            const resolvedX = tr.value.pos[0] ?? px;
            const resolvedZ = tr.value.pos[2] ?? pz;
            px = Math.max(
              -config.movement.bound,
              Math.min(config.movement.bound, resolvedX),
            );
            pz = Math.max(
              -config.movement.bound,
              Math.min(config.movement.bound, resolvedZ),
            );
            jumpY = tr.value.pos[1] ?? jumpY;
            if (px !== resolvedX || pz !== resolvedZ) {
              // moveAndSlide applies the correction immediately for any later
              // fixed ticks in this outer update; teleport makes the bound
              // authoritative in the following physics sync as well.
              physics.moveAndSlide(
                ctx.root,
                vec3.create(px - resolvedX, 0, pz - resolvedZ),
              );
              physics.teleport(ctx.root, vec3.create(px, jumpY, pz));
              ctx.world
                .set(ctx.root, Transform, { pos: [px, jumpY, pz] })
                .unwrap();
            }
          }
          const after = ctx.world.get(ctx.root, CharacterController);
          grounded = after.ok && after.value.grounded === true;
          if (grounded) vy = 0;
        } else if (mode !== "fps") {
          jumpY = config.movement.playerY;
        } else if (hasPhysicsBody) {
          physics.teleport(ctx.root, vec3.create(px, freeY, pz));
        }

        const yaw = Math.atan2(-faceX, -faceZ);
        const q = quat.eulerY(yaw);
        if (mode === "fps") {
          ctx.world.set(ctx.root, Transform, {
            pos: [px, freeY, pz],
            quat: [q[0]!, q[1]!, q[2]!, q[3]!],
          });
        } else {
          ctx.world.set(ctx.root, Transform, {
            quat: [q[0]!, q[1]!, q[2]!, q[3]!],
          });
        }
        ctx.world.set(ctx.root, PlayerMotion, {
          faceX,
          faceZ,
          jumpY,
          freeY,
          velocityY: vy,
          grounded: grounded ? 1 : 0,
        });
        ctx.world.set(ctx.root, FreeCameraMotion, freeCamera);
        const completedTransform = ctx.world.get(ctx.root, Transform);
        const completedX = completedTransform.ok
          ? (completedTransform.value.pos[0] ?? startX)
          : startX;
        const completedZ = completedTransform.ok
          ? (completedTransform.value.pos[2] ?? startZ)
          : startZ;
        const measuredDistance = Math.hypot(
          completedX - startX,
          completedZ - startZ,
        );
        const planarDistance = Number.isFinite(measuredDistance)
          ? measuredDistance
          : 0;
        const planarSpeed = dt > 0 ? planarDistance / dt : 0;
        publishOutcome({
          fixedTick: ctx.world.getResource(FixedTime).tick,
          planarDistance,
          planarSpeed,
          sprinting:
            intent.running &&
            planarDistance > PLAYER_MOVEMENT_DISTANCE_EPSILON,
        });
      },
    }).unwrap();
    fixedInstalled = true;

    // Preserve the existing Update schedule name as the post-fixed ordering
    // boundary consumed by camera, projectile, traversal, and exploration.
    ctx.world.addSystem(Update, {
      name: "game-player-movement",
      runIf: inState(GameState, "Play"),
      after: [FixedUpdate],
      before: ["propagateTransforms"],
      queries: [],
      fn: () => {},
    }).unwrap();
    bridgeInstalled = true;
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Player movement installation and rollback failed",
      );
    }
    throw error;
  }

  return { dispose };
}
