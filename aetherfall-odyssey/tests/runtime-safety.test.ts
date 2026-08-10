import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BootstrapContext } from "@forgeax/engine-app";
import type { AssetRegistry } from "@forgeax/engine-assets-runtime";
import { Update, World } from "@forgeax/engine-ecs";
import type { InputSnapshot } from "@forgeax/engine-input";
import {
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
} from "@forgeax/engine-physics";
import {
  MeshFilter,
  MeshRenderer,
  type Renderer,
} from "@forgeax/engine-render";
import { Transform } from "@forgeax/engine-scene";
import { requireAuthoredScene } from "../assets/plugins/scene-load-policy";
import {
  explorationWorldFeedbackSignature,
  installExplorationSystem,
} from "../assets/plugins/exploration-system";
import { createExplorationState } from "../assets/plugins/exploration-state";
import { spawnStaticCollider } from "../assets/plugins/procedural-world";
import { Projectile } from "../assets/plugins/components/gameplay";
import { createCustomProjectileMesh } from "../assets/plugins/custom-projectile-mesh";
import { createProjectilePresentation } from "../assets/plugins/projectile-presentation";
import {
  startGameplaySessionPrefetch,
  startGameplaySessionWorldInstallation,
} from "../assets/plugins/gameplay-session";
import {
  ResidualCleanupError,
  throwAfterFailedRollback,
} from "../assets/plugins/world-installation-lifecycle";

vi.mock("../assets/plugins/hit-flash-material", () => ({
  createHitFlashMaterial: (world: World) =>
    world.allocSharedRef("MaterialAsset", {
      kind: "material",
      passes: [],
      values: {},
    }),
}));
vi.mock("../assets/shaders/chromatic-aberration.wgsl", () => ({
  default: { wgsl: "" },
}));
vi.mock("../assets/shaders/depth-of-field.wgsl", () => ({
  default: { wgsl: "" },
}));
vi.mock("../assets/shaders/atmospheric-fog.wgsl", () => ({
  default: { wgsl: "" },
}));
vi.mock("../assets/shaders/animated-target.wgsl", () => ({
  default: { wgsl: "" },
}));

type UploadMode = "ok" | "error" | "throw";

function projectileRenderer(mode: UploadMode): {
  readonly renderer: Renderer;
  readonly evictTexture: ReturnType<typeof vi.fn>;
  readonly evictMesh: ReturnType<typeof vi.fn>;
} {
  const evictTexture = vi.fn(() => ({ freed: 1, errors: [] }));
  const evictMesh = vi.fn(() => ({ freed: 1, errors: [] }));
  return {
    evictTexture,
    evictMesh,
    renderer: {
      store: {
        uploadTexture: vi.fn(async () => {
          if (mode === "throw")
            throw new Error("injected-texture-upload-throw");
          return mode === "ok"
            ? { ok: true, value: undefined }
            : {
                ok: false,
                error: {
                  code: "texture-upload-failed",
                  hint: "injected structured upload failure",
                },
              };
        }),
        ensureResident: vi.fn(() => ({ ok: true, value: undefined })),
        updateMesh: vi.fn(),
        getMeshGpuHandles: vi.fn(() => ({})),
        evictTexture,
        evictMesh,
      },
    } as unknown as Renderer,
  };
}

function projectilePresentationArgs(world: World, renderer: Renderer) {
  return {
    world,
    host: { renderer } as unknown as BootstrapContext,
    player: undefined,
    primaryTarget: () => undefined,
    targetEntities: () => [],
    meshHandleSwap: undefined,
    fbxMeshSwap: undefined,
    gltfMeshSwap: undefined,
    jpegTextureSwap: undefined,
    chromaticAberration: {
      setIntensity: vi.fn(),
      snapshot: () => ({ intensity: 0 }),
    } as never,
    comparisonEvidenceMode: false,
  };
}

function updateSystemInstalled(world: World, name: string): boolean {
  return (
    world
      .inspect()
      .schedules.find((entry) => entry.schedule.name === Update.name)
      ?.systems.some((system) => system.name === name) === true
  );
}

describe("Aetherfall runtime safety contracts", () => {
  it("preserves pending cleanup authority even when a cleanup owner reports no rollback error", () => {
    const residualCleanup = {
      label: "silent pending owner",
      hasPending: () => true,
      dispose: () => undefined,
    };
    expect(() =>
      throwAfterFailedRollback({
        primary: new Error("primary-install-failure"),
        rollbackErrors: [],
        residualCleanup,
        message: "installation rollback left silent residual state",
      }),
    ).toThrow(ResidualCleanupError);
  });

  it("keeps complete rollback reporting distinct from residual ownership", () => {
    const primary = new Error("primary-install-failure");
    const completeCleanup = {
      label: "complete owner",
      hasPending: () => false,
      dispose: () => undefined,
    };
    let withoutRollbackReport: unknown;
    try {
      throwAfterFailedRollback({
        primary,
        rollbackErrors: [],
        residualCleanup: completeCleanup,
        message: "complete rollback",
      });
    } catch (error) {
      withoutRollbackReport = error;
    }
    expect(withoutRollbackReport).toBe(primary);

    const rollbackReport = new Error("cleanup-completed-with-report");
    let withRollbackReport: unknown;
    try {
      throwAfterFailedRollback({
        primary,
        rollbackErrors: [rollbackReport],
        residualCleanup: completeCleanup,
        message: "complete rollback with report",
      });
    } catch (error) {
      withRollbackReport = error;
    }
    expect(withRollbackReport).toBeInstanceOf(AggregateError);
    expect(withRollbackReport).not.toBeInstanceOf(ResidualCleanupError);
    expect((withRollbackReport as AggregateError).errors).toEqual([
      primary,
      rollbackReport,
    ]);
  });

  it("fails before constructing an incomplete fallback when the authored scene is unavailable", () => {
    expect(() => requireAuthoredScene(null)).toThrow(
      "authored scene could not be loaded",
    );
    expect(requireAuthoredScene({ scene: "ready" })).toEqual({
      scene: "ready",
    });
  });

  it("registers exploration after movement and before transform propagation", () => {
    const world = new World();
    const anchor = () =>
      world.spawn({ component: Transform, data: {} }).unwrap();
    installExplorationSystem({
      world,
      player: anchor(),
      readInput: () => ({}) as InputSnapshot,
      temples: {
        "memory-temple-1": { entity: anchor(), interactionRadius: 2.8 },
        "memory-temple-2": { entity: anchor(), interactionRadius: 2.8 },
        "memory-temple-3": { entity: anchor(), interactionRadius: 2.8 },
      },
      beacon: { entity: anchor(), interactionRadius: 3.5 },
      sanctuary: { entity: anchor(), interactionRadius: 3.5 },
    });
    const update = world
      .scheduleData()
      .find((schedule) => schedule.name === "Update");
    const system = update?.systems.find(
      (candidate) => candidate.name === "aetherfall-exploration-interaction",
    );
    expect(system?.after).toEqual([
      "input-frame-start-scan",
      "game-player-movement",
    ]);
    expect(system?.before).toEqual(["propagateTransforms"]);
  });

  it("keeps world-feedback writes independent from HUD-only distance changes", () => {
    const exploring = createExplorationState();
    expect(explorationWorldFeedbackSignature(exploring)).toBe(
      explorationWorldFeedbackSignature({ ...exploring }),
    );
    expect(
      explorationWorldFeedbackSignature({
        ...exploring,
        activatedTempleIds: ["memory-temple-1"],
      }),
    ).not.toBe(explorationWorldFeedbackSignature(exploring));
  });

  it("creates an explicit scaled static cuboid for visible obstacles", () => {
    const world = new World();
    const entity = spawnStaticCollider(
      world,
      [3, 2, -5],
      [2, 3, 4],
      [0.5, 1, 0.75],
      0.4,
    );
    const transform = world.get(entity, Transform).unwrap();
    const body = world.get(entity, RigidBody).unwrap();
    const collider = world.get(entity, Collider).unwrap();
    expect(Array.from(transform.pos)).toEqual([3, 2, -5]);
    expect(Array.from(transform.scale)).toEqual([2, 3, 4]);
    expect(body.type).toBe(RigidBodyTypeValue.static);
    expect(collider.shape).toBe(ColliderShapeValue.cuboid);
    expect(Array.from(collider.halfExtents)).toEqual([0.5, 1, 0.75]);
  });
});

describe("projectile presentation lifecycle", () => {
  it.each(["error", "throw"] as const)(
    "releases the texture grant when uploadTexture returns %s",
    async (mode) => {
      const world = new World();
      const { renderer } = projectileRenderer(mode);
      const alloc = vi.spyOn(world, "allocSharedRef");

      if (mode === "throw") {
        await expect(
          createCustomProjectileMesh(world, renderer),
        ).rejects.toThrow("injected-texture-upload-throw");
      } else {
        await expect(
          createCustomProjectileMesh(world, renderer),
        ).resolves.toBeUndefined();
      }

      expect(alloc).toHaveBeenCalledTimes(1);
      expect(world.sharedRefs.refcount(alloc.mock.results[0]!.value)).toBe(0);
    },
  );

  it("uses only custom grants on custom success and disposes them exactly once", async () => {
    const world = new World();
    const { renderer, evictTexture, evictMesh } = projectileRenderer("ok");
    const alloc = vi.spyOn(world, "allocSharedRef");
    const presentation = await createProjectilePresentation(
      projectilePresentationArgs(world, renderer),
    );
    const targets = alloc.mock.calls.map(([target]) => target);

    expect(presentation.customProjectile).toBeDefined();
    expect(targets.filter((target) => target === "TextureAsset")).toHaveLength(
      1,
    );
    expect(targets.filter((target) => target === "MeshAsset")).toHaveLength(1);
    expect(targets.filter((target) => target === "MaterialAsset")).toHaveLength(
      4,
    );

    presentation.dispose();
    presentation.dispose();

    for (const result of alloc.mock.results) {
      expect(world.sharedRefs.refcount(result.value)).toBe(0);
    }
    expect(evictTexture).toHaveBeenCalledTimes(1);
    expect(evictMesh).toHaveBeenCalledTimes(1);
  });

  it("creates fallback mesh and material only after custom upload is unavailable", async () => {
    const world = new World();
    const { renderer } = projectileRenderer("error");
    const alloc = vi.spyOn(world, "allocSharedRef");
    const presentation = await createProjectilePresentation(
      projectilePresentationArgs(world, renderer),
    );
    const targets = alloc.mock.calls.map(([target]) => target);

    expect(presentation.customProjectile).toBeUndefined();
    expect(targets).toEqual([
      "TextureAsset",
      "MaterialAsset",
      "MeshAsset",
      "MaterialAsset",
    ]);
    expect(world.sharedRefs.refcount(alloc.mock.results[0]!.value)).toBe(0);

    presentation.dispose();
    for (const result of alloc.mock.results) {
      expect(world.sharedRefs.refcount(result.value)).toBe(0);
    }
  });

  it("removes presentation systems and residual projectiles before releasing grants", async () => {
    const world = new World();
    const { renderer } = projectileRenderer("ok");
    const presentation = await createProjectilePresentation(
      projectilePresentationArgs(world, renderer),
    );
    let ticks = 0;
    for (const name of [
      "game-projectile-simulation",
      "game-default-sprite-animation",
    ]) {
      world
        .addSystem(Update, {
          name,
          queries: [],
          fn: () => {
            ticks += 1;
          },
        })
        .unwrap();
    }
    const projectile = world
      .spawn(
        { component: Transform, data: {} },
        {
          component: MeshFilter,
          data: { assetHandle: presentation.projectileMesh },
        },
        {
          component: MeshRenderer,
          data: { materials: [presentation.projectileMaterial] },
        },
        {
          component: Projectile,
          data: {
            age: 0,
            velocityX: 0,
            velocityY: 0,
            velocityZ: 0,
            impactScale: 1,
          },
        },
      )
      .unwrap();
    world.update(0).unwrap();
    expect(ticks).toBe(2);

    presentation.dispose();
    world.update(0).unwrap();

    expect(ticks).toBe(2);
    expect(updateSystemInstalled(world, "game-projectile-simulation")).toBe(
      false,
    );
    expect(updateSystemInstalled(world, "game-default-sprite-animation")).toBe(
      false,
    );
    expect(world.get(projectile, Projectile).ok).toBe(false);
  });

  it("registers projectile presentation cleanup with the gameplay host", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../assets/plugins/gameplay-session.ts"),
      "utf8",
    );
    expect(source).toContain(
      "host?.registerCleanup?.(() => projectilePresentation.dispose());",
    );
  });
});

describe("gameplay session cache-only prefetch", () => {
  function deferredAssets() {
    const pending: Array<{
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    }> = [];
    const loadByGuid = vi.fn(
      (guid: unknown) =>
        new Promise((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    return {
      assets: { loadByGuid } as unknown as AssetRegistry,
      loadByGuid,
      pending,
    };
  }

  it("starts every independent load before any completes and reports stable input order", async () => {
    const { assets, loadByGuid, pending } = deferredAssets();
    const prefetch = startGameplaySessionPrefetch(assets, true);

    expect(prefetch.started.length).toBeGreaterThan(10);
    expect(loadByGuid).toHaveBeenCalledTimes(prefetch.started.length);
    expect(pending).toHaveLength(prefetch.started.length);

    for (let index = pending.length - 1; index >= 0; index -= 1) {
      pending[index]!.resolve({ ok: true, value: prefetch.started[index] });
    }
    const outcomes = await prefetch.settled;
    expect(outcomes.map(({ guid }) => guid)).toEqual(prefetch.started);
    expect(outcomes.every(({ status }) => status === "fulfilled")).toBe(true);
  });

  it("contains rejected speculative loads without changing deterministic outcome order", async () => {
    const { assets, pending } = deferredAssets();
    const prefetch = startGameplaySessionPrefetch(assets, false);
    const failedGuid = prefetch.started[3]!;

    for (let index = 0; index < prefetch.started.length; index += 1) {
      const guid = prefetch.started[index]!;
      if (guid === failedGuid)
        pending[index]!.reject(new Error("prefetch-failed"));
      else pending[index]!.resolve({ ok: true, value: guid });
    }

    await expect(prefetch.settled).resolves.toEqual(
      prefetch.started.map((guid) => ({
        guid,
        status: guid === failedGuid ? "rejected" : "fulfilled",
      })),
    );
  });

  it("contains synchronous speculative load throws while starting every remaining read", async () => {
    const pending: Array<(value: unknown) => void> = [];
    let callIndex = 0;
    const loadByGuid = vi.fn(() => {
      const currentIndex = callIndex++;
      if (currentIndex === 2) throw new Error("synchronous-prefetch-failure");
      return new Promise((resolve) => pending.push(resolve));
    });
    const prefetch = startGameplaySessionPrefetch(
      { loadByGuid } as unknown as AssetRegistry,
      false,
    );

    expect(loadByGuid).toHaveBeenCalledTimes(prefetch.started.length);
    expect(pending).toHaveLength(prefetch.started.length - 1);
    for (const resolve of pending) resolve({ ok: true, value: null });
    const outcomes = await prefetch.settled;
    expect(outcomes[2]).toEqual({
      guid: prefetch.started[2],
      status: "rejected",
    });
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(prefetch.started.length - 1);
  });

  it("starts every cache read before serial World installers and disposes them in reverse order", async () => {
    const world = new World();
    const { assets, pending } = deferredAssets();
    const prefetch = startGameplaySessionPrefetch(assets, true);
    const installOrder: string[] = [];
    const cleanupOrder: string[] = [];
    const roots = new Map<string, number>();
    let resolveFox!: (handle: { dispose: () => void }) => void;
    const foxReady = new Promise<{ dispose: () => void }>((resolve) => {
      resolveFox = resolve;
    });
    const constructor = (name: string) =>
      vi.fn(async () => {
        installOrder.push(name);
        const root = world.spawn({ component: Transform, data: {} }).unwrap();
        roots.set(name, root);
        const handle = {
          dispose: () => {
            cleanupOrder.push(name);
            world.despawn(root).unwrap();
          },
        };
        return name === "fox" ? await foxReady : handle;
      });
    const constructors = {
      fox: constructor("fox"),
      procedural: constructor("procedural"),
      hero: constructor("hero"),
      threshold: constructor("threshold"),
      rock: constructor("rock"),
    };
    const installation = startGameplaySessionWorldInstallation(
      constructors as never,
    );

    expect(pending).toHaveLength(prefetch.started.length);
    expect(installOrder).toEqual(["fox"]);
    expect(constructors.procedural).not.toHaveBeenCalled();
    resolveFox({
      dispose: () => {
        cleanupOrder.push("fox");
        world.despawn(roots.get("fox")!).unwrap();
      },
    });
    await installation.settled;
    expect(installOrder).toEqual([
      "fox",
      "procedural",
      "hero",
      "threshold",
      "rock",
    ]);

    installation.dispose();
    expect(cleanupOrder).toEqual([
      "rock",
      "threshold",
      "hero",
      "procedural",
      "fox",
    ]);
    const spawnCallsAfterStop = world.inspect().entityCount;
    for (const request of pending) request.resolve({ ok: true, value: null });
    await prefetch.settled;
    expect(world.inspect().entityCount).toBe(spawnCallsAfterStop);
    expect(world.inspect().entityCount).toBe(0);
  });

  it.each(["resolve", "reject"] as const)(
    "stops serial installation after a deferred first installer %s without late mutation or unhandled rejection",
    async (mode) => {
      const world = new World();
      let resolveFox!: (handle: { dispose: () => void }) => void;
      let rejectFox!: (error: unknown) => void;
      const foxReady = new Promise<{ dispose: () => void }>(
        (resolve, reject) => {
          resolveFox = resolve;
          rejectFox = reject;
        },
      );
      const foxRoot = world.spawn({ component: Transform, data: {} }).unwrap();
      const lateConstructor = vi.fn(async () => {
        const root = world.spawn({ component: Transform, data: {} }).unwrap();
        return { dispose: () => world.despawn(root).unwrap() };
      });
      const installation = startGameplaySessionWorldInstallation({
        fox: vi.fn(() => foxReady),
        procedural: lateConstructor,
        hero: lateConstructor,
        threshold: lateConstructor,
        rock: lateConstructor,
      } as never);
      installation.dispose();

      if (mode === "reject") rejectFox(new Error("late-fox-rejection"));
      else
        resolveFox({
          dispose: () => {
            world.despawn(foxRoot).unwrap();
          },
        });
      await expect(installation.settled).resolves.toBeDefined();
      expect(lateConstructor).not.toHaveBeenCalled();
      expect(world.inspect().entityCount).toBe(mode === "resolve" ? 0 : 1);
      if (mode === "reject") world.despawn(foxRoot).unwrap();
    },
  );

  it("rolls accepted installers back in reverse order when a later installer fails", async () => {
    const world = new World();
    const cleanupOrder: string[] = [];
    const constructor = (name: string) =>
      vi.fn(async () => {
        const root = world.spawn({ component: Transform, data: {} }).unwrap();
        return {
          dispose: () => {
            cleanupOrder.push(name);
            world.despawn(root).unwrap();
          },
        };
      });
    const rock = constructor("rock");
    const installation = startGameplaySessionWorldInstallation({
      fox: constructor("fox"),
      procedural: constructor("procedural"),
      hero: vi.fn(async () => {
        throw new Error("hero-install-failed");
      }),
      threshold: constructor("threshold"),
      rock,
    } as never);

    await expect(installation.settled).rejects.toThrow("hero-install-failed");
    expect(cleanupOrder).toEqual(["procedural", "fox"]);
    expect(rock).not.toHaveBeenCalled();
    expect(world.inspect().entityCount).toBe(0);
    expect(() => installation.dispose()).not.toThrow();
  });

  it("adopts a required installer's residual owner before fail-closed rollback and retains it for Stop retry", async () => {
    let cleanupAttempts = 0;
    const residualCleanup = {
      label: "procedural world",
      hasPending: () => cleanupAttempts < 3,
      dispose: vi.fn(() => {
        cleanupAttempts += 1;
        if (cleanupAttempts < 3)
          throw new Error("required-residual-still-live");
      }),
    };
    const primary = new Error("procedural-install-failed");
    const failure = new ResidualCleanupError({
      primary,
      rollbackErrors: [new Error("procedural-rollback-failed")],
      message: "procedural install and rollback failed",
      residualCleanup,
    });
    const retiredFox = vi.fn(() => undefined);
    const late = vi.fn(async () => undefined);
    const installation = startGameplaySessionWorldInstallation({
      fox: async () => ({ dispose: retiredFox }),
      procedural: async () => {
        throw failure;
      },
      hero: late,
      threshold: late,
      rock: late,
    } as never);

    let observed: unknown;
    try {
      await installation.settled;
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(AggregateError);
    expect((observed as AggregateError).errors).toContain(failure);
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(2);
    expect(retiredFox).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();

    expect(() => installation.dispose()).not.toThrow();
    expect(() => installation.dispose()).not.toThrow();
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(3);
    expect(retiredFox).toHaveBeenCalledTimes(1);
  });

  it("degrades an optional residual failure only after an immediate retry proves cleanup complete", async () => {
    let pending = true;
    const residualCleanup = {
      label: "threshold monument",
      hasPending: () => pending,
      dispose: vi.fn(() => {
        pending = false;
      }),
    };
    const failure = new ResidualCleanupError({
      primary: new Error("threshold-install-failed"),
      rollbackErrors: [new Error("rollback-failed")],
      message: "threshold install and rollback failed",
      residualCleanup,
    });
    const rock = vi.fn(async () => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const installation = startGameplaySessionWorldInstallation({
      fox: async () => undefined,
      procedural: async () => undefined,
      hero: async () => undefined,
      threshold: async () => {
        throw failure;
      },
      rock,
    } as never);

    await expect(installation.settled).resolves.toMatchObject({
      thresholdMonument: undefined,
    });
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(1);
    expect(rock).toHaveBeenCalledTimes(1);
    installation.dispose();
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("optional threshold monument failed"),
    );
    errorSpy.mockRestore();
  });

  it("fails closed when an optional residual remains live, then lets Stop retry only that owner", async () => {
    let cleanupAttempts = 0;
    const residualCleanup = {
      label: "Rock Face framing",
      hasPending: () => cleanupAttempts < 3,
      dispose: vi.fn(() => {
        cleanupAttempts += 1;
        if (cleanupAttempts < 3)
          throw new Error("optional-residual-still-live");
      }),
    };
    const failure = new ResidualCleanupError({
      primary: new Error("rock-install-failed"),
      rollbackErrors: [new Error("rollback-failed")],
      message: "rock install and rollback failed",
      residualCleanup,
    });
    const installation = startGameplaySessionWorldInstallation({
      fox: async () => undefined,
      procedural: async () => undefined,
      hero: async () => undefined,
      threshold: async () => undefined,
      rock: async () => {
        throw failure;
      },
    } as never);

    let observed: unknown;
    try {
      await installation.settled;
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(AggregateError);
    expect((observed as AggregateError).errors).toContain(failure);
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(2);

    expect(() => installation.dispose()).not.toThrow();
    expect(() => installation.dispose()).not.toThrow();
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(3);
  });

  it("retires a normal installation handle that reports an error after effective cleanup", async () => {
    let pending = true;
    const completedWithReport = {
      label: "normal completed owner",
      hasPending: () => pending,
      dispose: vi.fn(() => {
        pending = false;
        throw new Error("cleanup-completed-with-report");
      }),
    };
    const installation = startGameplaySessionWorldInstallation({
      fox: async () => completedWithReport,
      procedural: async () => undefined,
      hero: async () => undefined,
      threshold: async () => undefined,
      rock: async () => undefined,
    } as never);
    await installation.settled;

    expect(() => installation.dispose()).toThrow(
      "Gameplay session world cleanup failed",
    );
    expect(() => installation.dispose()).not.toThrow();
    expect(completedWithReport.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["complete", "pending"] as const)(
    "adopts a constructor residual that settles after Stop and leaves it %s according to cleanup outcome",
    async (outcome) => {
      let rejectFox!: (error: unknown) => void;
      const foxReady = new Promise<never>((_resolve, reject) => {
        rejectFox = reject;
      });
      let attempts = 0;
      const residualCleanup = {
        label: "late fox residual",
        hasPending: () =>
          outcome === "pending" ? attempts < 3 : attempts < 1,
        dispose: vi.fn(() => {
          attempts += 1;
          if (outcome === "pending" && attempts < 3)
            throw new Error("late-residual-still-pending");
        }),
      };
      const failure = new ResidualCleanupError({
        primary: new Error("late-fox-install-failed"),
        rollbackErrors: [new Error("late-fox-rollback-failed")],
        residualCleanup,
        message: "late fox install and rollback failed",
      });
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const lateConstructor = vi.fn(async () => undefined);
      const installation = startGameplaySessionWorldInstallation({
        fox: vi.fn(() => foxReady),
        procedural: lateConstructor,
        hero: lateConstructor,
        threshold: lateConstructor,
        rock: lateConstructor,
      } as never);
      installation.dispose();
      rejectFox(failure);

      if (outcome === "complete") {
        await expect(installation.settled).resolves.toBeDefined();
        installation.dispose();
        expect(residualCleanup.dispose).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("late fox residual"),
          failure,
        );
      } else {
        await expect(installation.settled).rejects.toBeInstanceOf(
          AggregateError,
        );
        expect(residualCleanup.dispose).toHaveBeenCalledTimes(2);
        expect(() => installation.dispose()).not.toThrow();
        expect(() => installation.dispose()).not.toThrow();
        expect(residualCleanup.dispose).toHaveBeenCalledTimes(3);
      }
      expect(lateConstructor).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it("logs one structured aggregate when an after-Stop residual cleanup completes with a report", async () => {
    let rejectFox!: (error: unknown) => void;
    const foxReady = new Promise<never>((_resolve, reject) => {
      rejectFox = reject;
    });
    let pending = true;
    const cleanupReport = new Error("late-cleanup-completed-with-report");
    const residualCleanup = {
      label: "late reported residual",
      hasPending: () => pending,
      dispose: vi.fn(() => {
        pending = false;
        throw cleanupReport;
      }),
    };
    const failure = new ResidualCleanupError({
      primary: new Error("late-reported-install-failed"),
      rollbackErrors: [new Error("late-reported-rollback-failed")],
      residualCleanup,
      message: "late reported install and rollback failed",
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const installation = startGameplaySessionWorldInstallation({
      fox: vi.fn(() => foxReady),
      procedural: async () => undefined,
      hero: async () => undefined,
      threshold: async () => undefined,
      rock: async () => undefined,
    } as never);
    installation.dispose();
    rejectFox(failure);

    await expect(installation.settled).resolves.toBeDefined();
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, report] = errorSpy.mock.calls[0]!;
    expect(message).toContain("late reported residual");
    expect(report).toBeInstanceOf(AggregateError);
    expect((report as AggregateError).errors).toEqual([
      failure,
      cleanupReport,
    ]);

    installation.dispose();
    expect(residualCleanup.dispose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("deduplicates one residual owner already held by the session", async () => {
    let attempts = 0;
    const sharedOwner = {
      label: "shared residual owner",
      hasPending: () => attempts < 3,
      dispose: vi.fn(() => {
        attempts += 1;
        if (attempts < 3) throw new Error("shared-owner-still-pending");
      }),
    };
    const failure = new ResidualCleanupError({
      primary: new Error("shared-owner-install-failed"),
      rollbackErrors: [new Error("shared-owner-rollback-failed")],
      residualCleanup: sharedOwner,
      message: "shared owner install and rollback failed",
    });
    const installation = startGameplaySessionWorldInstallation({
      fox: async () => sharedOwner,
      procedural: async () => {
        throw failure;
      },
      hero: async () => undefined,
      threshold: async () => undefined,
      rock: async () => undefined,
    } as never);

    await expect(installation.settled).rejects.toBeInstanceOf(AggregateError);
    expect(sharedOwner.dispose).toHaveBeenCalledTimes(2);
    expect(() => installation.dispose()).not.toThrow();
    expect(() => installation.dispose()).not.toThrow();
    expect(sharedOwner.dispose).toHaveBeenCalledTimes(3);
  });

  it("attempts every owned cleanup when multiple owners fail and retries only the pending set", async () => {
    const owner = (label: string) => {
      let attempts = 0;
      return {
        label,
        hasPending: () => attempts < 2,
        dispose: vi.fn(() => {
          attempts += 1;
          if (attempts < 2) throw new Error(`${label}-still-pending`);
        }),
      };
    };
    const fox = owner("fox owner");
    const procedural = owner("procedural owner");
    const installation = startGameplaySessionWorldInstallation({
      fox: async () => fox,
      procedural: async () => procedural,
      hero: async () => {
        throw new Error("hero-install-failed");
      },
      threshold: async () => undefined,
      rock: async () => undefined,
    } as never);

    await expect(installation.settled).rejects.toBeInstanceOf(AggregateError);
    expect(procedural.dispose).toHaveBeenCalledTimes(1);
    expect(fox.dispose).toHaveBeenCalledTimes(1);
    expect(() => installation.dispose()).not.toThrow();
    expect(() => installation.dispose()).not.toThrow();
    expect(procedural.dispose).toHaveBeenCalledTimes(2);
    expect(fox.dispose).toHaveBeenCalledTimes(2);
  });
});
