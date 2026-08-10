import type { BootstrapContext } from "@forgeax/engine-app";
import { World, type EntityHandle } from "@forgeax/engine-ecs";
import { Transform } from "@forgeax/engine-scene";
import { describe, expect, it, vi } from "vitest";
import {
  createThresholdMonument,
  GOTHIC_SENTINEL_POSITION,
  GOTHIC_SENTINEL_SCALE,
  GOTHIC_SENTINEL_SCENE_GUID,
  GOTHIC_SENTINEL_YAW,
  THRESHOLD_DOOR_POSITION,
  THRESHOLD_DOOR_SCALE,
  THRESHOLD_DOOR_SCENE_GUID,
  THRESHOLD_DOOR_YAW,
} from "../assets/plugins/threshold-monument";
import { ResidualCleanupError } from "../assets/plugins/world-installation-lifecycle";

describe("Aetherfall threshold monument owner", () => {
  it("pins the door and one asymmetric sentinel to the observatory facade", () => {
    expect(THRESHOLD_DOOR_SCENE_GUID).toBe(
      "019fddf1-5e4b-7578-91fd-66a8e526a9a1",
    );
    expect(THRESHOLD_DOOR_POSITION).toEqual([1.86, 0.04, -24.72]);
    expect(THRESHOLD_DOOR_SCALE).toBe(1.35);
    expect(THRESHOLD_DOOR_YAW).toBe(0);
    expect(GOTHIC_SENTINEL_SCENE_GUID).toBe(
      "019fdde8-bbe8-778b-816a-5d058ef3f977",
    );
    expect(GOTHIC_SENTINEL_POSITION).toEqual([4.39, 0.02, -24]);
    expect(GOTHIC_SENTINEL_SCALE).toBe(1.15);
    expect(GOTHIC_SENTINEL_YAW).toBe(Math.PI);
  });

  it("loads both scenes before all-or-none instantiation, places both roots, and disposes idempotently", async () => {
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
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        if (world.get(entity, Transform).ok) world.despawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });

    const monument = await createThresholdMonument({
      world,
      host: { assets } as unknown as BootstrapContext,
    });
    expect(monument).toBeDefined();
    expect(monument).toMatchObject({
      label: "threshold monument",
      hasPending: expect.any(Function),
    });
    expect(
      (
        monument as typeof monument & {
          readonly hasPending: () => boolean;
        }
      )!.hasPending(),
    ).toBe(true);
    expect(assets.loadByGuid).toHaveBeenCalledTimes(2);
    expect(assets.instantiate).toHaveBeenCalledTimes(2);
    expect(callerHandles).toHaveLength(2);
    callerHandles.forEach((handle) =>
      expect(world.sharedRefs.refcount(handle as never)).toBe(0),
    );

    const doorTransform = world.get(monument!.doorRoot, Transform).unwrap();
    Array.from(doorTransform.pos).forEach((value, index) => {
      expect(value).toBeCloseTo(THRESHOLD_DOOR_POSITION[index]!, 5);
    });
    const sentinelTransform = world
      .get(monument!.sentinelRoot, Transform)
      .unwrap();
    Array.from(sentinelTransform.pos).forEach((value, index) => {
      expect(value).toBeCloseTo(GOTHIC_SENTINEL_POSITION[index]!, 5);
    });
    expect(sentinelTransform.quat[1]).toBeCloseTo(1, 6);
    expect(sentinelTransform.quat[3]).toBeCloseTo(0, 6);

    monument!.dispose();
    monument!.dispose();
    expect(
      (
        monument as typeof monument & {
          readonly hasPending: () => boolean;
        }
      )!.hasPending(),
    ).toBe(false);
    expect(despawnScene).toHaveBeenCalledTimes(2);
    roots.forEach((root) => expect(world.get(root, Transform).ok).toBe(false));
  });

  it("rolls the door back when sentinel instantiation fails and releases both caller grants", async () => {
    const world = new World();
    const callerHandles: number[] = [];
    let doorRoot: EntityHandle | undefined;
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((handle: number, targetWorld: World) => {
        callerHandles.push(handle);
        calls += 1;
        if (calls === 2)
          return { ok: false, error: { code: "test-sentinel-failure" } };
        doorRoot = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        return { ok: true, value: doorRoot };
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
      await createThresholdMonument({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).toBeUndefined();
    expect(despawnScene).toHaveBeenCalledWith(doorRoot);
    expect(world.get(doorRoot!, Transform).ok).toBe(false);
    callerHandles.forEach((handle) =>
      expect(world.sharedRefs.refcount(handle as never)).toBe(0),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[aetherfall] threshold monument instantiate failed: sentinel test-sentinel-failure",
    );
    errorSpy.mockRestore();
  });

  it("does not instantiate a partial monument when either scene fails to load", async () => {
    const world = new World();
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => {
        calls += 1;
        return calls === 2
          ? { ok: false, error: { code: "test-sentinel-load-failure" } }
          : { ok: true, value: { kind: "scene", entities: [], mounts: [] } };
      }),
      instantiate: vi.fn(),
    } as unknown as NonNullable<BootstrapContext["assets"]>;
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(
      await createThresholdMonument({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).toBeUndefined();
    expect(assets.instantiate).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[aetherfall] threshold monument load failed: sentinel test-sentinel-load-failure",
    );
    errorSpy.mockRestore();
  });

  it("rolls the first root back when the second synchronous instantiate throws and releases both caller grants", async () => {
    const world = new World();
    const callerHandles: number[] = [];
    let doorRoot: EntityHandle | undefined;
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((handle: number, targetWorld: World) => {
        callerHandles.push(handle);
        calls += 1;
        if (calls === 2) throw new Error("test-sentinel-instantiate-throw");
        doorRoot = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        return { ok: true, value: doorRoot };
      }),
    } as unknown as NonNullable<BootstrapContext["assets"]>;
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        world.despawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });

    await expect(
      createThresholdMonument({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).rejects.toThrow("test-sentinel-instantiate-throw");
    expect(despawnScene).toHaveBeenCalledWith(doorRoot);
    expect(world.get(doorRoot!, Transform).ok).toBe(false);
    callerHandles.forEach((handle) =>
      expect(world.sharedRefs.refcount(handle as never)).toBe(0),
    );
  });

  it("rolls both current roots back in reverse order when placement throws", async () => {
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
      if (placements === 2) throw new Error("test-threshold-placement-throw");
      return set(...args);
    });
    const cleanupOrder: EntityHandle[] = [];
    vi.spyOn(world, "despawnScene").mockImplementation((entity) => {
      cleanupOrder.push(entity);
      world.despawn(entity).unwrap();
      return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
    });

    await expect(
      createThresholdMonument({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).rejects.toThrow("test-threshold-placement-throw");
    expect(cleanupOrder).toEqual([roots[1], roots[0]]);
    roots.forEach((root) => expect(world.get(root, Transform).ok).toBe(false));
    callerHandles.forEach((handle) =>
      expect(world.sharedRefs.refcount(handle as never)).toBe(0),
    );
  });

  it("propagates an asynchronous scene-load rejection before any caller grant or root exists", async () => {
    const world = new World();
    const assets = {
      loadByGuid: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { kind: "scene", entities: [], mounts: [] },
        })
        .mockRejectedValueOnce(new Error("test-sentinel-load-rejection")),
      instantiate: vi.fn(),
    } as unknown as NonNullable<BootstrapContext["assets"]>;

    await expect(
      createThresholdMonument({
        world,
        host: { assets } as unknown as BootstrapContext,
      }),
    ).rejects.toThrow("test-sentinel-load-rejection");
    expect(assets.instantiate).not.toHaveBeenCalled();
  });

  it("carries retryable residual ownership when a failed second instance cannot roll the first root back", async () => {
    const world = new World();
    let doorRoot: EntityHandle | undefined;
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((_handle: number, targetWorld: World) => {
        calls += 1;
        if (calls === 2)
          return { ok: false, error: { code: "test-sentinel-failure" } };
        doorRoot = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        return { ok: true, value: doorRoot };
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
            error: { code: "test-door-rollback-failure" },
          } as ReturnType<World["despawnScene"]>;
        originalDespawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    let rollbackError: unknown;
    try {
      await createThresholdMonument({
        world,
        host: { assets } as unknown as BootstrapContext,
      });
    } catch (error) {
      rollbackError = error;
    }
    expect(rollbackError).toBeInstanceOf(AggregateError);
    expect(rollbackError).toBeInstanceOf(ResidualCleanupError);
    expect((rollbackError as ResidualCleanupError).primary).toMatchObject({
      code: "test-sentinel-failure",
    });
    expect((rollbackError as ResidualCleanupError).rollbackErrors).toHaveLength(
      1,
    );
    const residualCleanup = (
      rollbackError as {
        readonly residualCleanup?: { readonly dispose: () => void };
      }
    ).residualCleanup;
    expect(residualCleanup).toBeDefined();
    expect(world.get(doorRoot!, Transform).ok).toBe(true);

    residualCleanup!.dispose();
    residualCleanup!.dispose();
    expect(despawnScene).toHaveBeenCalledTimes(2);
    expect(world.get(doorRoot!, Transform).ok).toBe(false);
  });

  it("reports rollback errors without false residual authority when liveness proves cleanup completed", async () => {
    const world = new World();
    let doorRoot: EntityHandle | undefined;
    let calls = 0;
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: "scene", entities: [], mounts: [] },
      })),
      instantiate: vi.fn((_handle: number, targetWorld: World) => {
        calls += 1;
        if (calls === 2)
          return { ok: false, error: { code: "test-sentinel-failure" } };
        doorRoot = targetWorld
          .spawn({ component: Transform, data: {} })
          .unwrap();
        return { ok: true, value: doorRoot };
      }),
    } as unknown as NonNullable<BootstrapContext["assets"]>;
    vi.spyOn(world, "despawnScene").mockImplementation((entity) => {
      world.despawn(entity).unwrap();
      throw new Error("test-despawn-reported-after-completion");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    let rollbackError: unknown;
    try {
      await createThresholdMonument({
        world,
        host: { assets } as unknown as BootstrapContext,
      });
    } catch (error) {
      rollbackError = error;
    }
    expect(rollbackError).toBeInstanceOf(AggregateError);
    expect(rollbackError).not.toBeInstanceOf(ResidualCleanupError);
    expect(
      (rollbackError as { readonly residualCleanup?: unknown })
        .residualCleanup,
    ).toBeUndefined();
    expect(world.get(doorRoot!, Transform).ok).toBe(false);
  });

  it("completes best-effort disposal after throw and structured error, then retries only retained roots", async () => {
    const world = new World();
    const roots: EntityHandle[] = [];
    const assets = {
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
    let cleanupCalls = 0;
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        cleanupCalls += 1;
        if (cleanupCalls === 1) throw new Error("test-sentinel-despawn-throw");
        if (cleanupCalls === 2)
          return {
            ok: false,
            error: { code: "test-door-despawn-failure" },
          } as ReturnType<World["despawnScene"]>;
        world.despawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World["despawnScene"]>;
      });
    const monument = await createThresholdMonument({
      world,
      host: { assets } as unknown as BootstrapContext,
    });

    let cleanupError: unknown;
    try {
      monument!.dispose();
    } catch (error) {
      cleanupError = error;
    }
    expect(cleanupError).toBeInstanceOf(AggregateError);
    expect((cleanupError as AggregateError).errors).toHaveLength(2);
    expect(despawnScene).toHaveBeenCalledTimes(2);
    roots.forEach((root) => expect(world.get(root, Transform).ok).toBe(true));
    monument!.dispose();
    monument!.dispose();
    expect(despawnScene).toHaveBeenCalledTimes(4);
    roots.forEach((root) => expect(world.get(root, Transform).ok).toBe(false));
  });
});
