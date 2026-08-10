import { describe, expect, it, vi } from "vitest";
import { FixedUpdate, Update, World, type EntityHandle } from "@forgeax/engine-ecs";
import type { InputSnapshot } from "@forgeax/engine-input";
import { CharacterController, type PhysicsWorld } from "@forgeax/engine-physics";
import { Transform } from "@forgeax/engine-scene";
import { registerStatesPlugin } from "@forgeax/engine-state";
import {
  FreeCameraMotion,
  GameplayInput,
  PlayerMotion,
} from "../assets/plugins/components/gameplay";
import { GAME_DEFAULT_GAMEPLAY_CONFIG } from "../assets/plugins/resources/gameplay";
import {
  installPlayerMovementSystem,
  readPlayerMovementOutcome,
  resolvePlanarLocomotion,
} from "../assets/plugins/systems/player-movement";

const walkSpeed = 6;
const runSpeed = 9;

function locomotion(
  inputX: number,
  inputForward: number,
  yaw = 0,
  running = false,
) {
  return resolvePlanarLocomotion({
    inputX,
    inputForward,
    yaw,
    running,
    walkSpeed,
    runSpeed,
  });
}

function inputSnapshot(args: {
  readonly moveX?: number;
  readonly moveY?: number;
  readonly jump?: boolean;
  readonly running?: boolean;
  readonly wheelDelta?: number;
} = {}): InputSnapshot {
  return {
    getVector: () => ({ x: args.moveX ?? 0, y: args.moveY ?? 0 }),
    action: (name: string) => ({
      isPressed: () => name === "freeRun" ? args.running === true : false,
      justPressed: () => name === "jump" ? args.jump === true : false,
    }),
    mouse: { wheelDelta: args.wheelDelta ?? 0 },
  } as unknown as InputSnapshot;
}

function movementWorld() {
  const world = new World();
  registerStatesPlugin(world);
  world.insertResource(GAME_DEFAULT_GAMEPLAY_CONFIG, {
    movement: { speed: walkSpeed, bound: 22, playerY: 0.75, jumpVelocity: 6.5, gravity: 18 },
    camera: {
      topDownY: 13,
      topDownOffsetZ: 9,
      follow: 8,
      eyeHeight: 0.55,
      panSpeed: 8,
      panHalfHeightMin: 3,
      panHalfHeightMax: 14,
      topQuaternion: [0, 0, 0, 1],
    },
    projectile: { radius: 0.1, halfHeight: 0.1, speed: 24, life: 1.5, shootCooldown: 0.18 },
  });
  const root = world.spawn(
    { component: Transform, data: { pos: [0, 0.75, 0] } },
    { component: PlayerMotion, data: {} },
    { component: FreeCameraMotion, data: {} },
    { component: GameplayInput, data: {} },
    { component: CharacterController, data: { grounded: true } },
  ).unwrap();
  let bodyPosition: readonly [number, number, number] = [0, 0.75, 0];
  const moveAndSlide = vi.fn<PhysicsWorld["moveAndSlide"]>((entity, delta) => {
    const handle = entity as EntityHandle;
    const transform = world.get(handle, Transform).unwrap();
    bodyPosition = [
      (transform.pos[0] ?? 0) + delta[0],
      (transform.pos[1] ?? 0) + delta[1],
      (transform.pos[2] ?? 0) + delta[2],
    ];
    world.set(handle, Transform, { pos: bodyPosition }).unwrap();
    world.set(handle, CharacterController, { grounded: true }).unwrap();
    return delta;
  });
  const teleport = vi.fn<PhysicsWorld["teleport"]>((_entity, position) => {
    bodyPosition = [position[0], position[1], position[2]];
  });
  const physics = {
    hasBody: () => true,
    moveAndSlide,
    teleport,
  } as unknown as PhysicsWorld;
  return {
    world,
    root,
    physics,
    moveAndSlide,
    teleport,
    bodyPosition: () => bodyPosition,
  };
}

describe("Aetherfall v19 planar locomotion", () => {
  it("moves forward along camera forward at yaw zero", () => {
    const result = locomotion(0, 1);
    expect(result.velocityX).toBeCloseTo(0, 6);
    expect(result.velocityZ).toBeCloseTo(-walkSpeed, 6);
    expect(result.faceX).toBeCloseTo(0, 6);
    expect(result.faceZ).toBeCloseTo(-1, 6);
  });

  it("rotates forward movement with a 90 degree camera yaw", () => {
    const result = locomotion(0, 1, Math.PI / 2);
    expect(result.velocityX).toBeCloseTo(-walkSpeed, 6);
    expect(result.velocityZ).toBeCloseTo(0, 6);
    expect(result.faceX).toBeCloseTo(-1, 6);
    expect(result.faceZ).toBeCloseTo(0, 6);
  });

  it("normalizes a digital diagonal without exceeding walk speed", () => {
    const result = locomotion(1, 1);
    expect(Math.hypot(result.velocityX, result.velocityZ)).toBeCloseTo(
      walkSpeed,
      6,
    );
    expect(result.velocityX).toBeCloseTo(Math.SQRT1_2 * walkSpeed, 6);
    expect(result.velocityZ).toBeCloseTo(-Math.SQRT1_2 * walkSpeed, 6);
  });

  it("preserves a quarter-strength analog stick magnitude", () => {
    const result = locomotion(0.25, 0);
    expect(result.inputMagnitude).toBeCloseTo(0.25, 6);
    expect(Math.hypot(result.velocityX, result.velocityZ)).toBeCloseTo(
      walkSpeed * 0.25,
      6,
    );
  });

  it("selects walk and run speed from the same locomotion intent", () => {
    const walking = locomotion(0, 1, 0, false);
    const running = locomotion(0, 1, 0, true);
    expect(Math.hypot(walking.velocityX, walking.velocityZ)).toBeCloseTo(
      walkSpeed,
      6,
    );
    expect(Math.hypot(running.velocityX, running.velocityZ)).toBeCloseTo(
      runSpeed,
      6,
    );
  });

  it("brakes to zero planar velocity when movement input is released", () => {
    const result = locomotion(0, 0, Math.PI / 2, true);
    expect(result.inputMagnitude).toBe(0);
    expect(result.velocityX).toBe(0);
    expect(result.velocityZ).toBe(0);
  });
});

describe("Aetherfall fixed-step player movement", () => {
  it("fails closed with an actionable capability error before registering systems", () => {
    const { world, root } = movementWorld();
    const readInput = vi.fn(() => inputSnapshot({ moveY: 1 }));
    let failure: unknown;

    try {
      installPlayerMovementSystem({
        world,
        root,
        physics: undefined,
        readInput,
        getMode: () => "orbit",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      name: "PlayerMovementCapabilityError",
      code: "player-movement-physics-unavailable",
      capability: "PhysicsWorld",
    });
    expect((failure as Error).message).toContain("PhysicsWorld");
    expect((failure as Error).message).toContain("before installing gameplay");
    expect(world.scheduleData().flatMap((schedule) => schedule.systems).some(
      (system) => system.name.startsWith("game-player-movement"),
    )).toBe(false);
    world.update(2 / 60).unwrap();
    expect(readInput).not.toHaveBeenCalled();
  });

  it("keeps the FPS free-camera branch independent of a physics body", () => {
    const { world, root, physics, moveAndSlide, teleport } = movementWorld();
    const physicsWithoutBody = {
      ...physics,
      hasBody: () => false,
    } as PhysicsWorld;
    installPlayerMovementSystem({
      world,
      root,
      physics: physicsWithoutBody,
      readInput: () => inputSnapshot({ moveY: 1 }),
      getMode: () => "fps",
    });

    world.update(1 / 60).unwrap();
    expect(world.get(root, Transform).unwrap().pos[2]).toBeLessThan(0);
    expect(moveAndSlide).not.toHaveBeenCalled();
    expect(teleport).not.toHaveBeenCalled();
  });

  it("captures held input once per outer update and applies it once per fixed tick", () => {
    const { world, root, physics, moveAndSlide } = movementWorld();
    const readInput = vi.fn(() => inputSnapshot({ moveY: 1 }));
    installPlayerMovementSystem({ world, root, physics, readInput, getMode: () => "orbit" });

    world.update(1 / 120).unwrap();
    expect(moveAndSlide).not.toHaveBeenCalled();
    world.update(1 / 120).unwrap();
    expect(moveAndSlide).toHaveBeenCalledTimes(1);
    world.update(2 / 60).unwrap();
    expect(moveAndSlide).toHaveBeenCalledTimes(3);
    expect(readInput).toHaveBeenCalledTimes(3);
    for (const [, delta] of moveAndSlide.mock.calls) {
      expect(delta[0]).toBeCloseTo(Math.sin(0.08) * walkSpeed / 60, 6);
      expect(delta[2]).toBeCloseTo(-Math.cos(0.08) * walkSpeed / 60, 6);
    }
  });

  it("buffers a jump across a zero-tick frame and consumes the edge only once", () => {
    const { world, root, physics, moveAndSlide } = movementWorld();
    const frames = [inputSnapshot({ jump: true }), inputSnapshot(), inputSnapshot()];
    const readInput = vi.fn(() => frames.shift() ?? inputSnapshot());
    installPlayerMovementSystem({ world, root, physics, readInput, getMode: () => "orbit" });

    world.update(1 / 120).unwrap();
    expect(moveAndSlide).not.toHaveBeenCalled();
    world.update(1 / 120).unwrap();
    expect(moveAndSlide).toHaveBeenCalledTimes(1);
    expect(moveAndSlide.mock.calls[0]![1][1]).toBeGreaterThan(0);
    world.update(2 / 60).unwrap();
    expect(moveAndSlide).toHaveBeenCalledTimes(3);
    expect(moveAndSlide.mock.calls[1]![1][1]).toBeLessThanOrEqual(0);
    expect(moveAndSlide.mock.calls[2]![1][1]).toBeLessThanOrEqual(0);
  });

  it("does not multiply one-frame wheel input across multiple FPS fixed ticks", () => {
    const { world, root, physics } = movementWorld();
    installPlayerMovementSystem({
      world,
      root,
      physics,
      readInput: () => inputSnapshot({ moveY: 1, wheelDelta: 1 }),
      getMode: () => "fps",
    });

    world.update(2 / 60).unwrap();
    expect(world.get(root, FreeCameraMotion).unwrap().walkSpeed).toBeCloseTo(3.3, 6);
  });

  it("keeps planar KCC displacement at zero when no movement input is held", () => {
    const { world, root, physics, moveAndSlide } = movementWorld();
    installPlayerMovementSystem({
      world,
      root,
      physics,
      readInput: () => inputSnapshot(),
      getMode: () => "orbit",
    });

    world.update(2 / 60).unwrap();
    expect(moveAndSlide).toHaveBeenCalledTimes(2);
    for (const [, delta] of moveAndSlide.mock.calls) {
      expect(delta[0]).toBe(0);
      expect(delta[2]).toBe(0);
    }
  });

  it("publishes sprint only from actual fixed-step displacement", () => {
    const moving = movementWorld();
    installPlayerMovementSystem({
      world: moving.world,
      root: moving.root,
      physics: moving.physics,
      readInput: () => inputSnapshot({ moveY: 1, running: true }),
      getMode: () => "orbit",
    });
    moving.world.update(1 / 60).unwrap();
    const movingOutcome = readPlayerMovementOutcome(moving.world, moving.root);
    expect(movingOutcome?.planarSpeed).toBeCloseTo(runSpeed, 4);
    expect(movingOutcome?.sprinting).toBe(true);

    const blocked = movementWorld();
    blocked.moveAndSlide.mockImplementation((_entity, delta) => delta);
    installPlayerMovementSystem({
      world: blocked.world,
      root: blocked.root,
      physics: blocked.physics,
      readInput: () => inputSnapshot({ moveY: 1, running: true }),
      getMode: () => "orbit",
    });
    blocked.world.update(1 / 60).unwrap();
    expect(readPlayerMovementOutcome(blocked.world, blocked.root)).toMatchObject({
      planarDistance: 0,
      planarSpeed: 0,
      sprinting: false,
    });
  });

  it("teleports the KCC body and writes Transform when planar bounds clamp", () => {
    const { world, root, physics, teleport, bodyPosition } = movementWorld();
    world.set(root, Transform, { pos: [21.99, 0.75, 0] }).unwrap();
    installPlayerMovementSystem({
      world,
      root,
      physics,
      readInput: () => inputSnapshot({ moveX: 1 }),
      getMode: () => "topdown",
    });

    world.update(1 / 60).unwrap();
    const transform = world.get(root, Transform).unwrap();
    expect(transform.pos[0]).toBeLessThanOrEqual(22);
    expect(transform.pos[0]).toBeCloseTo(22, 6);
    expect(teleport).toHaveBeenCalledTimes(1);
    expect(Array.from(teleport.mock.calls[0]![1])).toEqual([22, expect.any(Number), 0]);
    expect(bodyPosition()[0]).toBe(22);
  });

  it("bridges Update ordering around FixedUpdate and cleans up idempotently", () => {
    const { world, root, physics } = movementWorld();
    const readInput = vi.fn(() => inputSnapshot());
    const handle = installPlayerMovementSystem({
      world,
      root,
      physics,
      readInput,
      getMode: () => "orbit",
    });
    const update = world.scheduleData().find((schedule) => schedule.name === Update.name);
    const fixed = world.scheduleData().find((schedule) => schedule.name === FixedUpdate.name);
    expect(update?.systems.find((system) => system.name === "game-player-movement-input")).toMatchObject({
      after: ["game-camera-input"],
      before: [FixedUpdate.name],
    });
    expect(fixed?.systems.some((system) => system.name === "game-player-movement-fixed")).toBe(true);
    expect(update?.systems.find((system) => system.name === "game-player-movement")).toMatchObject({
      after: [FixedUpdate.name],
      before: ["propagateTransforms"],
    });

    handle.dispose();
    handle.dispose();
    expect(readPlayerMovementOutcome(world, root)).toBeUndefined();
    expect(world.scheduleData().flatMap((schedule) => schedule.systems).some(
      (system) => system.name.startsWith("game-player-movement"),
    )).toBe(false);
    world.update(2 / 60).unwrap();
    expect(readInput).not.toHaveBeenCalled();
  });
});
