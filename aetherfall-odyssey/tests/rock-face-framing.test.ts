import type { BootstrapContext } from "@forgeax/engine-app";
import { World, type EntityHandle } from "@forgeax/engine-ecs";
import { Collider, RigidBody } from "@forgeax/engine-physics";
import { Transform } from "@forgeax/engine-scene";
import { describe, expect, it, vi } from "vitest";
import {
  createRockFaceFraming,
  ROCK_FACE_FRAMING_PLACEMENTS,
  ROCK_FACE_SCENE_GUID,
} from "../assets/plugins/rock-face-framing";
import { ResidualCleanupError } from "../assets/plugins/world-installation-lifecycle";

function successfulAssets(world: World, roots: EntityHandle[]) {
  return {
    loadByGuid: vi.fn(async () => ({
      ok: true,
      value: { kind: "scene", entities: [], mounts: [] },
    })),
    instantiate: vi.fn((_handle: number, targetWorld: World) => {
      const root = targetWorld
        .spawn({ component: Transform, data: {} })
        .unwrap();
      roots.push(root);
      return { ok: true, value: root };
    }),
  } as unknown as NonNullable<BootstrapContext["assets"]>;
}

describe("Aetherfall Rock Face foreground framing", () => {
  it("pins one imported scene and two asymmetric side masses outside the route centre", () => {
    expect(ROCK_FACE_SCENE_GUID).toBe("019fde01-daea-7c2d-aeab-0b80822a2445");
    expect(ROCK_FACE_FRAMING_PLACEMENTS).toEqual([
      { id: "left", position: [-9.8, -1.35, 0.65], scale: 1.6, yaw: 0.24 },
      { id: "right", position: [10.1, -1.45, -0.4], scale: 1.72, yaw: -0.31 },
    ]);
  });

  it("loads once, instantiates both roots, adds paired physical masses, and disposes in reverse order", async () => {
    const world = new World();
    const roots: EntityHandle[] = [];
    const assets = successfulAssets(world, roots);
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        if (world.get(entity, Transform).ok) world.despawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });

    const framing = await createRockFaceFraming({
      world,
      host: { assets } as unknown as BootstrapContext,
    });

    expect(framing).toBeDefined();
    expect(framing).toMatchObject({
      label: "Rock Face framing",
      hasPending: expect.any(Function),
    });
    expect(
      (
        framing as typeof framing & {
          readonly hasPending: () => boolean;
        }
      )!.hasPending(),
    ).toBe(true);
    expect(assets.loadByGuid).toHaveBeenCalledTimes(1);
    expect(assets.instantiate).toHaveBeenCalledTimes(2);
    expect(framing!.roots).toHaveLength(2);
    expect(framing!.colliders).toHaveLength(2);
    for (let index = 0; index < framing!.roots.length; index += 1) {
      const transform = world.get(framing!.roots[index]!, Transform).unwrap();
      const placement = ROCK_FACE_FRAMING_PLACEMENTS[index]!;
      Array.from(transform.pos).forEach((value, axis) => {
        expect(value).toBeCloseTo(placement.position[axis]!, 5);
      });
      expect(world.get(framing!.colliders[index]!, RigidBody).ok).toBe(true);
      expect(world.get(framing!.colliders[index]!, Collider).ok).toBe(true);
    }

    framing!.dispose();
    framing!.dispose();
    expect(
      (
        framing as typeof framing & {
          readonly hasPending: () => boolean;
        }
      )!.hasPending(),
    ).toBe(false);
    expect(despawnScene).toHaveBeenCalledTimes(2);
    for (const entity of [...roots, ...framing!.colliders]) {
      expect(world.get(entity, Transform).ok).toBe(false);
    }
  });

  it("rolls back the first root and creates no collider when the second instance fails", async () => {
    const world = new World();
    let firstRoot: EntityHandle | undefined;
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((_handle: number, targetWorld: World) => {
        calls += 1;
        if (calls === 2)
          return { ok: false, error: { code: "test-right-failure" } };
        firstRoot = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        return { ok: true, value: firstRoot };
      }),
    } as unknown as NonNullable<BootstrapContext["assets"]>;
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        world.despawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(
      await createRockFaceFraming({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).toBeUndefined();
    expect(despawnScene).toHaveBeenCalledWith(firstRoot);
    expect(world.get(firstRoot!, Transform).ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[aetherfall] Rock Face framing instantiate failed: right test-right-failure",
    );
    errorSpy.mockRestore();
  });

  it("rolls the first root back when the second synchronous instantiate throws and releases both caller grants", async () => {
    const world = new World();
    const callerHandles: number[] = [];
    let firstRoot: EntityHandle | undefined;
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((handle: number, targetWorld: World) => {
        callerHandles.push(handle);
        calls += 1;
        if (calls === 2) throw new Error("test-right-instantiate-throw");
        firstRoot = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        return { ok: true, value: firstRoot };
      }),
    } as unknown as NonNullable<BootstrapContext["assets"]>;
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        world.despawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });

    await expect(
      createRockFaceFraming({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).rejects.toThrow("test-right-instantiate-throw");
    expect(despawnScene).toHaveBeenCalledWith(firstRoot);
    expect(world.get(firstRoot!, Transform).ok).toBe(false);
    callerHandles.forEach((handle) =>
      expect(world.sharedRefs.refcount(handle as never)).toBe(0),
    );
  });

  it("rolls colliders and both roots back in reverse order when placement throws", async () => {
    const world = new World();
    const roots: EntityHandle[] = [];
    const callerHandles: number[] = [];
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((handle: number, targetWorld: World) => {
        callerHandles.push(handle);
        const root = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        roots.push(root);
        return { ok: true, value: root };
      }),
    } as unknown as NonNullable<BootstrapContext["assets"]>;
    const set = world.set.bind(world);
    let placements = 0;
    vi.spyOn(world, "set").mockImplementation((...args) => {
      placements += 1;
      if (placements === 2) throw new Error("test-rock-placement-throw");
      return set(...args);
    });
    const despawnedColliders: EntityHandle[] = [];
    vi.spyOn(world, "despawn").mockImplementation((entity) => {
      despawnedColliders.push(entity);
      return World.prototype.despawn.call(world, entity);
    });
    const despawnedRoots: EntityHandle[] = [];
    vi.spyOn(world, "despawnScene").mockImplementation((entity) => {
      despawnedRoots.push(entity);
      World.prototype.despawn.call(world, entity).unwrap();
      return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
    });

    await expect(
      createRockFaceFraming({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).rejects.toThrow("test-rock-placement-throw");
    expect(despawnedColliders).toHaveLength(1);
    expect(despawnedRoots).toEqual([roots[1], roots[0]]);
    roots.forEach((root) => expect(world.get(root, Transform).ok).toBe(false));
    callerHandles.forEach((handle) =>
      expect(world.sharedRefs.refcount(handle as never)).toBe(0),
    );
  });

  it("propagates an asynchronous scene-load rejection before any caller grant or root exists", async () => {
    const world = new World();
    const assets = {
      loadByGuid: vi.fn(async () => {
        throw new Error("test-rock-load-rejection");
      }),
      instantiate: vi.fn(),
    } as unknown as NonNullable<BootstrapContext["assets"]>;

    await expect(
      createRockFaceFraming({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).rejects.toThrow("test-rock-load-rejection");
    expect(assets.instantiate).not.toHaveBeenCalled();
  });

  it("reports structured rollback failure instead of silently losing the first root", async () => {
    const world = new World();
    let firstRoot: EntityHandle | undefined;
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((_handle: number, targetWorld: World) => {
        calls += 1;
        if (calls === 2)
          return { ok: false, error: { code: "test-right-failure" } };
        firstRoot = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        return { ok: true, value: firstRoot };
      }),
    } as unknown as NonNullable<BootstrapContext["assets"]>;
    const originalDespawn = world.despawn.bind(world);
    let cleanupAttempts = 0;
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1)
          return {
            ok: false,
            error: { code: "test-root-cleanup-failure" },
          } as ReturnType<World["despawnScene"]>;
        originalDespawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    let rollbackError: unknown;
    try {
      await createRockFaceFraming({
        world,
        host: { assets } as unknown as BootstrapContext,
      });
    } catch (error) {
      rollbackError = error;
    }
    expect(rollbackError).toBeInstanceOf(AggregateError);
    expect(rollbackError).toBeInstanceOf(ResidualCleanupError);
    expect((rollbackError as AggregateError).errors).toHaveLength(2);
    expect(world.get(firstRoot!, Transform).ok).toBe(true);
    const residualCleanup = (
      rollbackError as {
        readonly residualCleanup?: { readonly dispose: () => void };
      }
    ).residualCleanup;
    expect(residualCleanup).toBeDefined();
    residualCleanup!.dispose();
    residualCleanup!.dispose();
    expect(despawnScene).toHaveBeenCalledTimes(2);
    expect(world.get(firstRoot!, Transform).ok).toBe(false);
  });

  it("carries only the residual collider when placement rollback partially fails", async () => {
    const world = new World();
    const roots: EntityHandle[] = [];
    const assets = successfulAssets(world, roots);
    const set = world.set.bind(world);
    let placementCalls = 0;
    vi.spyOn(world, "set").mockImplementation((...args) => {
      placementCalls += 1;
      if (placementCalls === 2) throw new Error("test-rock-placement-throw");
      return set(...args);
    });
    vi.spyOn(world, "despawnScene").mockImplementation((entity) => {
      World.prototype.despawn.call(world, entity).unwrap();
      return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
    });
    const originalDespawn = world.despawn.bind(world);
    let colliderAttempts = 0;
    const despawn = vi.spyOn(world, "despawn").mockImplementation((entity) => {
      colliderAttempts += 1;
      if (colliderAttempts === 1)
        return {
          ok: false,
          error: { code: "test-collider-rollback-failure" },
        } as ReturnType<World["despawn"]>;
      return originalDespawn(entity);
    });

    let rollbackError: unknown;
    try {
      await createRockFaceFraming({
        world,
        host: { assets } as unknown as BootstrapContext,
      });
    } catch (error) {
      rollbackError = error;
    }
    expect(rollbackError).toBeInstanceOf(AggregateError);
    expect(rollbackError).toBeInstanceOf(ResidualCleanupError);
    const residualCleanup = (
      rollbackError as {
        readonly residualCleanup?: { readonly dispose: () => void };
      }
    ).residualCleanup;
    expect(residualCleanup).toBeDefined();
    expect(world.inspect().entityCount).toBe(1);

    residualCleanup!.dispose();
    const callsAfterRetry = despawn.mock.calls.length;
    residualCleanup!.dispose();
    expect(despawn).toHaveBeenCalledTimes(callsAfterRetry);
    expect(world.inspect().entityCount).toBe(0);
  });

  it("completes reverse disposal after collider throw and structured failure, then retries only retained colliders", async () => {
    const world = new World();
    const roots: EntityHandle[] = [];
    const assets = successfulAssets(world, roots);
    vi.spyOn(world, "despawnScene").mockImplementation((entity) => {
      if (world.get(entity, Transform).ok) world.despawn(entity).unwrap();
      return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
    });
    const originalDespawn = world.despawn.bind(world);
    let colliderCleanupCalls = 0;
    const despawn = vi.spyOn(world, "despawn").mockImplementation((entity) => {
      colliderCleanupCalls += 1;
      if (colliderCleanupCalls === 1)
        throw new Error("test-right-collider-despawn-throw");
      if (colliderCleanupCalls === 2)
        return {
          ok: false,
          error: { code: "test-left-collider-despawn-failure" },
        } as ReturnType<World["despawn"]>;
      return originalDespawn(entity);
    });
    const framing = await createRockFaceFraming({
      world,
      host: { assets } as unknown as BootstrapContext,
    });

    let cleanupError: unknown;
    try {
      framing!.dispose();
    } catch (error) {
      cleanupError = error;
    }
    expect(cleanupError).toBeInstanceOf(AggregateError);
    expect((cleanupError as AggregateError).errors).toHaveLength(2);
    const colliderDespawnCalls = () =>
      despawn.mock.calls.filter(([entity]) =>
        framing!.colliders.includes(entity),
      ).length;
    expect(colliderDespawnCalls()).toBe(2);
    roots.forEach((root) => expect(world.get(root, Transform).ok).toBe(false));
    framing!.colliders.forEach((collider) =>
      expect(world.get(collider, Transform).ok).toBe(true),
    );
    framing!.dispose();
    framing!.dispose();
    expect(colliderDespawnCalls()).toBe(4);
    framing!.colliders.forEach((collider) =>
      expect(world.get(collider, Transform).ok).toBe(false),
    );
  });
});
