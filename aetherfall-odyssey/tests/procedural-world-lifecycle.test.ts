import { describe, expect, it, vi } from "vitest";
import type { BootstrapContext } from "@forgeax/engine-app";
import { World, type EntityHandle } from "@forgeax/engine-ecs";
import {
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
} from "@forgeax/engine-physics";
import {
  Materials,
  MeshFilter,
  MeshRenderer,
  type Renderer,
} from "@forgeax/engine-render";
import { Transform } from "@forgeax/engine-scene";
import { err, type Handle, type MeshAsset } from "@forgeax/engine-types";
import { createProceduralWorld } from "../assets/plugins/procedural-world";
import { createExplorationState } from "../assets/plugins/exploration-state";
import { ResidualCleanupError } from "../assets/plugins/world-installation-lifecycle";

type SharedAssetHandle = Handle<string, "shared">;

const AUTHORED_MESH: MeshAsset = {
  kind: "mesh",
  vertices: new Float32Array([
    0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0,
    0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1,
  ]),
  indices: new Uint16Array([0, 1, 2]),
  submeshes: [
    {
      indexOffset: 0,
      indexCount: 3,
      vertexCount: 3,
      topology: "triangle-list",
    },
  ],
  aabb: new Float32Array([0, 0, 0, 1, 0, 1]),
};

function rendererWithUpload(result: { readonly ok: boolean }): Renderer {
  return {
    store: {
      uploadTexture: vi.fn(async () => result),
      ensureResident: vi.fn(),
    },
  } as unknown as Renderer;
}

function missingAssetsHost(renderer: Renderer): BootstrapContext {
  return {
    renderer,
    assets: {
      loadByGuid: vi.fn(async () => ({
        ok: false,
        error: {
          code: "test-asset-missing",
          hint: "use the procedural fallback",
        },
      })),
    },
  } as unknown as BootstrapContext;
}

describe("procedural world lifecycle ownership", () => {
  it("reuses the beacon orbitals for ready, attuned, and sanctuary terminal feedback", async () => {
    const world = new World();
    const spawnSpy = vi.spyOn(world, "spawn");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const handle = await createProceduralWorld({
      world,
      host: missingAssetsHost(rendererWithUpload({ ok: true })),
      loaded: null,
    });
    expect(handle).toBeDefined();
    expect(handle).toMatchObject({
      label: "procedural world",
      hasPending: expect.any(Function),
    });
    expect(
      (
        handle as typeof handle & {
          readonly hasPending: () => boolean;
        }
      )!.hasPending(),
    ).toBe(true);

    const spawned = spawnSpy.mock.results.flatMap(({ value }) =>
      value?.ok ? [value.value as EntityHandle] : [],
    );
    const beacon = spawned.find((entity) => {
      const transform = world.get(entity, Transform);
      return (
        transform.ok &&
        Math.abs((transform.value.pos[0] ?? 0) - 1.8) < 1e-6 &&
        Math.abs((transform.value.pos[2] ?? 0) + 16.4) < 1e-6
      );
    });
    const orbitals = spawned.filter((entity) => {
      const transform = world.get(entity, Transform);
      return (
        transform.ok &&
        (transform.value.pos[1] ?? 0) === -20 &&
        (transform.value.scale[0] ?? 0) === 0
      );
    });
    expect(beacon).toBeDefined();
    expect(orbitals).toHaveLength(3);
    const spawnCount = spawnSpy.mock.calls.length;
    const initial = createExplorationState();

    handle!.setExplorationSnapshot({
      ...initial,
      phase: "beacon-unlocked",
      beaconUnlocked: true,
    });
    world.update(0.016).unwrap();
    expect(world.get(beacon!, Transform).unwrap().scale).toEqual(
      new Float32Array([1.02, 1.34, 1.02]),
    );
    for (const orbital of orbitals) {
      const pos = world.get(orbital, Transform).unwrap().pos;
      expect(Math.hypot(pos[0]! - 1.8, pos[2]! + 16.4)).toBeCloseTo(1.12, 5);
    }

    handle!.setExplorationSnapshot({
      ...initial,
      phase: "returning",
      beaconUnlocked: true,
      beaconAttuned: true,
    });
    world.update(0.016).unwrap();
    expect(world.get(beacon!, Transform).unwrap().scale).toEqual(
      new Float32Array([0.62, 1.9, 0.62]),
    );
    for (const orbital of orbitals) {
      const pos = world.get(orbital, Transform).unwrap().pos;
      expect(Math.hypot(pos[0]! - 1.8, pos[2]! + 16.4)).toBeCloseTo(0.58, 5);
    }

    handle!.setExplorationSnapshot({
      ...initial,
      phase: "complete",
      beaconUnlocked: true,
      beaconAttuned: true,
      returnedToSanctuary: true,
    });
    world.update(0.016).unwrap();
    for (const orbital of orbitals) {
      const pos = world.get(orbital, Transform).unwrap().pos;
      expect(Math.hypot(pos[0]!, pos[2]! - 3.1)).toBeCloseTo(0.86, 5);
    }
    expect(spawnSpy).toHaveBeenCalledTimes(spawnCount);

    handle!.dispose();
    expect(
      (
        handle as typeof handle & {
          readonly hasPending: () => boolean;
        }
      )!.hasPending(),
    ).toBe(false);
    warnSpy.mockRestore();
  });

  it("allocates exact per-draw-batch bounds instead of one mesh-wide union", async () => {
    const world = new World();
    const renderer = rendererWithUpload({ ok: true });
    const allocSpy = vi.spyOn(world, "allocSharedRef");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const handle = await createProceduralWorld({
      world,
      host: missingAssetsHost(renderer),
      loaded: null,
    });
    expect(handle).toBeDefined();

    const meshes = allocSpy.mock.calls.flatMap(([kind, asset]) =>
      kind === "MeshAsset" ? [asset as MeshAsset] : [],
    );
    const byVertexBuffer = new Map<ArrayBufferView, MeshAsset[]>();
    for (const mesh of meshes) {
      const siblings = byVertexBuffer.get(mesh.vertices) ?? [];
      siblings.push(mesh);
      byVertexBuffer.set(mesh.vertices, siblings);
    }
    const sharedGeometryBatches = [...byVertexBuffer.values()].filter(
      (siblings) => siblings.length > 1,
    );
    expect(sharedGeometryBatches.length).toBeGreaterThan(0);
    expect(
      sharedGeometryBatches.some(
        (siblings) =>
          new Set(siblings.map((mesh) => Array.from(mesh.aabb ?? []).join(",")))
            .size > 1,
      ),
    ).toBe(true);

    handle!.dispose();
    warnSpy.mockRestore();
  });

  it("releases every procedural caller grant and restores authored render, physics, and transform state", async () => {
    const world = new World();
    const authoredMesh = world.allocSharedRef("MeshAsset", AUTHORED_MESH);
    const authoredMaterial = world.allocSharedRef(
      "MaterialAsset",
      Materials.standard({
        baseColor: [0.12, 0.24, 0.36, 1],
        metallic: 0.2,
        roughness: 0.7,
      }),
    );
    const groundTransform = {
      pos: [7, 1.25, -4] as const,
      quat: [0, 0.382683, 0, 0.92388] as const,
      scale: [3, 0.5, 2] as const,
    };
    const ground = world
      .spawn(
        { component: Transform, data: groundTransform },
        { component: MeshFilter, data: { assetHandle: authoredMesh } },
        { component: MeshRenderer, data: { materials: [authoredMaterial] } },
      )
      .unwrap();
    const hidden = world
      .spawn(
        { component: Transform, data: { pos: [-2, 0.5, 3] } },
        { component: MeshFilter, data: { assetHandle: authoredMesh } },
        { component: MeshRenderer, data: { materials: [authoredMaterial] } },
        {
          component: Collider,
          data: {
            shape: ColliderShapeValue.capsule,
            halfExtents: [0.3, 0.8, 0.4],
            radius: 0.42,
            halfHeight: 1.15,
            friction: 0.37,
            restitution: 0.18,
            density: 2.25,
            isSensor: true,
            collisionGroups: 0x1234,
            solverGroups: 0x5678,
          },
        },
        {
          component: RigidBody,
          data: {
            type: RigidBodyTypeValue.kinematic,
            mass: 3.5,
            linearDamping: 0.12,
            angularDamping: 0.34,
            gravityScale: 0.6,
            ccdEnabled: true,
          },
        },
      )
      .unwrap();
    const semanticLandmark = world
      .spawn(
        { component: Transform, data: { pos: [6.1, 0.5, -6.3] } },
        { component: MeshFilter, data: { assetHandle: authoredMesh } },
        { component: MeshRenderer, data: { materials: [authoredMaterial] } },
        {
          component: Collider,
          data: {
            shape: ColliderShapeValue.cuboid,
            halfExtents: [2.25, 0.32, 2.25],
            friction: 0.8,
          },
        },
        { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      )
      .unwrap();
    world.sharedRefs.release(authoredMesh).unwrap();
    world.sharedRefs.release(authoredMaterial).unwrap();

    const allocSpy = vi.spyOn(world, "allocSharedRef");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const handle = await createProceduralWorld({
      world,
      host: missingAssetsHost(rendererWithUpload({ ok: true })),
      loaded: {
        nodes: [
          { localId: 0, components: { Name: { value: "Ground" } } },
          { localId: 1, components: { Name: { value: "Tree01Trunk" } } },
          { localId: 2, components: { Name: { value: "MemoryShrine_B" } } },
        ],
        mapping: new Map([
          [0, ground],
          [1, hidden],
          [2, semanticLandmark],
        ]),
      },
    });
    expect(handle).toBeDefined();
    const proceduralHandles = allocSpy.mock.results.map(
      (entry) => entry.value as SharedAssetHandle,
    );
    expect(proceduralHandles.length).toBeGreaterThan(10);
    for (const proceduralHandle of proceduralHandles) {
      expect(world.sharedRefs.refcount(proceduralHandle)).toBeGreaterThan(0);
    }
    expect(world.get(hidden, MeshRenderer).ok).toBe(false);
    expect(world.get(hidden, Collider).ok).toBe(false);
    expect(world.get(hidden, RigidBody).ok).toBe(false);
    expect(world.get(semanticLandmark, MeshRenderer).ok).toBe(true);
    expect(world.get(semanticLandmark, Collider).ok).toBe(true);
    expect(world.get(semanticLandmark, RigidBody).ok).toBe(true);

    handle!.dispose();
    handle!.dispose();

    for (const proceduralHandle of proceduralHandles) {
      expect(world.sharedRefs.refcount(proceduralHandle)).toBe(0);
    }
    expect(world.get(ground, MeshFilter).unwrap().assetHandle).toBe(
      authoredMesh,
    );
    expect(
      Array.from(world.get(ground, MeshRenderer).unwrap().materials),
    ).toEqual([authoredMaterial]);
    const restoredGroundTransform = world.get(ground, Transform).unwrap();
    expect(Array.from(restoredGroundTransform.pos)).toEqual(
      groundTransform.pos,
    );
    for (let index = 0; index < groundTransform.quat.length; index += 1) {
      expect(restoredGroundTransform.quat[index]).toBeCloseTo(
        groundTransform.quat[index]!,
        6,
      );
    }
    expect(Array.from(restoredGroundTransform.scale)).toEqual(
      groundTransform.scale,
    );

    expect(
      Array.from(world.get(hidden, MeshRenderer).unwrap().materials),
    ).toEqual([authoredMaterial]);
    const restoredCollider = world.get(hidden, Collider).unwrap();
    expect(restoredCollider.shape).toBe(ColliderShapeValue.capsule);
    for (const [index, expected] of [0.3, 0.8, 0.4].entries()) {
      expect(restoredCollider.halfExtents[index]).toBeCloseTo(expected, 6);
    }
    expect(restoredCollider.radius).toBeCloseTo(0.42, 6);
    expect(restoredCollider.halfHeight).toBeCloseTo(1.15, 6);
    expect(restoredCollider.friction).toBeCloseTo(0.37, 6);
    expect(restoredCollider.restitution).toBeCloseTo(0.18, 6);
    expect(restoredCollider.density).toBeCloseTo(2.25, 6);
    expect(restoredCollider).toMatchObject({
      isSensor: true,
      collisionGroups: 0x1234,
      solverGroups: 0x5678,
    });
    const restoredRigidBody = world.get(hidden, RigidBody).unwrap();
    expect(restoredRigidBody).toMatchObject({
      type: RigidBodyTypeValue.kinematic,
      ccdEnabled: true,
    });
    expect(world.get(semanticLandmark, MeshRenderer).ok).toBe(true);
    expect(world.get(semanticLandmark, Collider).ok).toBe(true);
    expect(world.get(semanticLandmark, RigidBody).ok).toBe(true);
    expect(restoredRigidBody.mass).toBeCloseTo(3.5, 6);
    expect(restoredRigidBody.linearDamping).toBeCloseTo(0.12, 6);
    expect(restoredRigidBody.angularDamping).toBeCloseTo(0.34, 6);
    expect(restoredRigidBody.gravityScale).toBeCloseTo(0.6, 6);
    expect(world.sharedRefs.refcount(authoredMesh)).toBe(3);
    expect(world.sharedRefs.refcount(authoredMaterial)).toBe(3);
    warnSpy.mockRestore();
  });

  it("releases the fallback texture caller grant immediately when upload fails", async () => {
    const world = new World();
    const renderer = rendererWithUpload({ ok: false });
    const allocSpy = vi.spyOn(world, "allocSharedRef");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const handle = await createProceduralWorld({
      world,
      host: missingAssetsHost(renderer),
      loaded: null,
    });
    expect(handle).toBeDefined();
    const fallbackTexture = allocSpy.mock.results[0]
      ?.value as SharedAssetHandle;
    expect(fallbackTexture).toBeDefined();
    expect(world.sharedRefs.refcount(fallbackTexture)).toBe(0);

    handle!.dispose();
    for (const entry of allocSpy.mock.results) {
      expect(world.sharedRefs.refcount(entry.value as SharedAssetHandle)).toBe(
        0,
      );
    }
    warnSpy.mockRestore();
  });

  it("releases the fallback texture grant when the renderer upload throws", async () => {
    const world = new World();
    const renderer = rendererWithUpload({ ok: true });
    renderer.store.uploadTexture = vi.fn(async () => {
      throw new Error("injected-upload-throw");
    });
    const allocSpy = vi.spyOn(world, "allocSharedRef");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      createProceduralWorld({
        world,
        host: missingAssetsHost(renderer),
        loaded: null,
      }),
    ).rejects.toThrow("injected-upload-throw");
    expect(allocSpy).toHaveBeenCalledTimes(1);
    expect(
      world.sharedRefs.refcount(
        allocSpy.mock.results[0]!.value as SharedAssetHandle,
      ),
    ).toBe(0);
    warnSpy.mockRestore();
  });

  it("keeps the authored landmark index when only the middle memory core is loaded", async () => {
    const world = new World();
    const authoredMesh = world.allocSharedRef("MeshAsset", AUTHORED_MESH);
    const authoredMaterial = world.allocSharedRef(
      "MaterialAsset",
      Materials.standard({
        baseColor: [0.2, 0.3, 0.4, 1],
      }),
    );
    const middleCore = world
      .spawn(
        {
          component: Transform,
          data: { pos: [6.1, 1.2, -6.3], scale: [1, 1, 1] },
        },
        { component: MeshFilter, data: { assetHandle: authoredMesh } },
        { component: MeshRenderer, data: { materials: [authoredMaterial] } },
      )
      .unwrap();
    world.sharedRefs.release(authoredMesh).unwrap();
    world.sharedRefs.release(authoredMaterial).unwrap();

    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const handle = await createProceduralWorld({
      world,
      host: missingAssetsHost(rendererWithUpload({ ok: true })),
      loaded: {
        nodes: [
          { localId: 7, components: { Name: { value: "ShrineBMemoryCore" } } },
        ],
        mapping: new Map([[7, middleCore]]),
      },
    });
    expect(handle).toBeDefined();
    handle!.setExplorationSnapshot({
      phase: "exploring",
      activatedTempleIds: ["memory-temple-2"],
      beaconRestored: false,
      sanctuaryReached: false,
    });
    expect(world.get(middleCore, Transform).unwrap().scale).toEqual(
      new Float32Array([0.14, 0.28, 0.14]),
    );
    handle!.dispose();
    warnSpy.mockRestore();
  });

  it("atomically restores authored state and releases all grants after a late batch failure", async () => {
    const world = new World();
    const authoredMesh = world.allocSharedRef("MeshAsset", AUTHORED_MESH);
    const authoredMaterial = world.allocSharedRef(
      "MaterialAsset",
      Materials.standard({
        baseColor: [0.18, 0.28, 0.38, 1],
      }),
    );
    const ground = world
      .spawn(
        { component: Transform, data: { pos: [4, 1, -2], scale: [2, 0.5, 3] } },
        { component: MeshFilter, data: { assetHandle: authoredMesh } },
        { component: MeshRenderer, data: { materials: [authoredMaterial] } },
      )
      .unwrap();
    const route = world
      .spawn(
        { component: Transform, data: { pos: [0, 0.08, -1] } },
        { component: MeshFilter, data: { assetHandle: authoredMesh } },
        { component: MeshRenderer, data: { materials: [authoredMaterial] } },
      )
      .unwrap();
    world.sharedRefs.release(authoredMesh).unwrap();
    world.sharedRefs.release(authoredMaterial).unwrap();

    let residentCalls = 0;
    const renderer = rendererWithUpload({ ok: true });
    renderer.store.ensureResident = vi.fn(() => {
      residentCalls += 1;
      if (residentCalls === 4) throw new Error("injected-late-batch-failure");
    });
    const spawnSpy = vi.spyOn(world, "spawn");
    const allocSpy = vi.spyOn(world, "allocSharedRef");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      createProceduralWorld({
        world,
        host: missingAssetsHost(renderer),
        loaded: {
          nodes: [
            { localId: 0, components: { Name: { value: "Ground" } } },
            { localId: 1, components: { Name: { value: "StonePath01" } } },
          ],
          mapping: new Map([
            [0, ground],
            [1, route],
          ]),
        },
      }),
    ).rejects.toThrow("injected-late-batch-failure");

    expect(world.get(ground, MeshFilter).unwrap().assetHandle).toBe(
      authoredMesh,
    );
    expect(
      Array.from(world.get(ground, MeshRenderer).unwrap().materials),
    ).toEqual([authoredMaterial]);
    expect(Array.from(world.get(ground, Transform).unwrap().pos)).toEqual([
      4, 1, -2,
    ]);
    expect(world.get(route, MeshFilter).unwrap().assetHandle).toBe(
      authoredMesh,
    );
    expect(
      Array.from(world.get(route, MeshRenderer).unwrap().materials),
    ).toEqual([authoredMaterial]);
    for (const result of spawnSpy.mock.results) {
      const spawned = result.value?.ok
        ? (result.value.value as Parameters<typeof world.get>[0])
        : undefined;
      if (spawned !== undefined)
        expect(world.get(spawned, Transform).ok).toBe(false);
    }
    for (const result of allocSpy.mock.results) {
      const handle = result.value as SharedAssetHandle;
      expect(world.sharedRefs.refcount(handle)).toBe(0);
    }
    expect(world.sharedRefs.refcount(authoredMesh)).toBe(2);
    expect(world.sharedRefs.refcount(authoredMaterial)).toBe(2);
    warnSpy.mockRestore();
  });

  it("carries retryable residual ownership when installation and rollback both fail", async () => {
    const world = new World();
    let residentCalls = 0;
    const renderer = rendererWithUpload({ ok: true });
    renderer.store.ensureResident = vi.fn(() => {
      residentCalls += 1;
      if (residentCalls === 4)
        throw new Error("injected-procedural-install-failure");
    });
    const spawnSpy = vi.spyOn(world, "spawn");
    const allocSpy = vi.spyOn(world, "allocSharedRef");
    const originalDespawn = world.despawn.bind(world);
    let rollbackAttempts = 0;
    const despawnSpy = vi
      .spyOn(world, "despawn")
      .mockImplementation((entity) => {
        rollbackAttempts += 1;
        if (rollbackAttempts === 1)
          return err({
            code: "injected-procedural-rollback-failure",
          }) as ReturnType<World["despawn"]>;
        return originalDespawn(entity);
      });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    let installationError: unknown;
    try {
      await createProceduralWorld({
        world,
        host: missingAssetsHost(renderer),
        loaded: null,
      });
    } catch (error) {
      installationError = error;
    }
    expect(installationError).toBeInstanceOf(AggregateError);
    expect(installationError).toBeInstanceOf(ResidualCleanupError);
    expect((installationError as ResidualCleanupError).primary).toBeInstanceOf(
      Error,
    );
    expect(
      ((installationError as ResidualCleanupError).primary as Error).message,
    ).toBe("injected-procedural-install-failure");
    const residualCleanup = (
      installationError as {
        readonly residualCleanup?: { readonly dispose: () => void };
      }
    ).residualCleanup;
    expect(residualCleanup).toBeDefined();
    expect(
      spawnSpy.mock.results.some(
        ({ value }) => value?.ok && world.get(value.value, Transform).ok,
      ),
    ).toBe(true);

    residualCleanup!.dispose();
    const despawnsAfterRetry = despawnSpy.mock.calls.length;
    residualCleanup!.dispose();
    expect(despawnSpy).toHaveBeenCalledTimes(despawnsAfterRetry);
    for (const result of spawnSpy.mock.results) {
      const entity = result.value?.ok
        ? (result.value.value as EntityHandle)
        : undefined;
      if (entity !== undefined) expect(world.get(entity, Transform).ok).toBe(false);
    }
    for (const result of allocSpy.mock.results) {
      const handle = result.value as SharedAssetHandle;
      expect(world.sharedRefs.refcount(handle)).toBe(0);
    }
    warnSpy.mockRestore();
  });

  it.each(["throw", "structured"] as const)(
    "completes cleanup after the first despawn %s, retires successes, and retries only the retained entity",
    async (mode) => {
      const world = new World();
      const authoredMesh = world.allocSharedRef("MeshAsset", AUTHORED_MESH);
      const authoredMaterial = world.allocSharedRef(
        "MaterialAsset",
        Materials.standard({ baseColor: [0.18, 0.28, 0.38, 1] }),
      );
      const ground = world
        .spawn(
          {
            component: Transform,
            data: { pos: [4, 1, -2], scale: [2, 0.5, 3] },
          },
          { component: MeshFilter, data: { assetHandle: authoredMesh } },
          { component: MeshRenderer, data: { materials: [authoredMaterial] } },
        )
        .unwrap();
      world.sharedRefs.release(authoredMesh).unwrap();
      world.sharedRefs.release(authoredMaterial).unwrap();
      const allocSpy = vi.spyOn(world, "allocSharedRef");
      const spawnSpy = vi.spyOn(world, "spawn");
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const handle = await createProceduralWorld({
        world,
        host: missingAssetsHost(rendererWithUpload({ ok: true })),
        loaded: {
          nodes: [{ localId: 0, components: { Name: { value: "Ground" } } }],
          mapping: new Map([[0, ground]]),
        },
      });
      const spawned = spawnSpy.mock.results.flatMap(({ value }) =>
        value?.ok ? [value.value as EntityHandle] : [],
      );
      const proceduralHandles = allocSpy.mock.results.map(
        ({ value }) => value as SharedAssetHandle,
      );
      const releaseSpy = vi.spyOn(world.sharedRefs, "release");
      const originalDespawn = world.despawn.bind(world);
      let failedEntity: EntityHandle | undefined;
      const despawnSpy = vi
        .spyOn(world, "despawn")
        .mockImplementation((entity) => {
          if (failedEntity === undefined) {
            failedEntity = entity;
            if (mode === "throw")
              throw new Error("injected-first-despawn-throw");
            return {
              ok: false,
              error: { code: "injected-first-despawn-failure" },
            } as ReturnType<World["despawn"]>;
          }
          return originalDespawn(entity);
        });

      let cleanupError: unknown;
      try {
        handle!.dispose();
      } catch (error) {
        cleanupError = error;
      }
      expect(cleanupError).toBeInstanceOf(AggregateError);
      expect((cleanupError as AggregateError).errors).toHaveLength(1);
      expect(world.get(failedEntity!, Transform).ok).toBe(true);
      for (const entity of spawned) {
        if (entity !== failedEntity)
          expect(world.get(entity, Transform).ok).toBe(false);
      }
      expect(world.get(ground, MeshFilter).unwrap().assetHandle).toBe(
        authoredMesh,
      );
      expect(
        Array.from(world.get(ground, MeshRenderer).unwrap().materials),
      ).toEqual([authoredMaterial]);
      for (const proceduralHandle of proceduralHandles) {
        expect(
          releaseSpy.mock.calls.some(([handle]) => handle === proceduralHandle),
        ).toBe(true);
      }

      handle!.dispose();
      const callsAfterRetry = despawnSpy.mock.calls.length;
      handle!.dispose();
      expect(despawnSpy).toHaveBeenCalledTimes(callsAfterRetry);
      expect(world.get(failedEntity!, Transform).ok).toBe(false);
      for (const proceduralHandle of proceduralHandles)
        expect(world.sharedRefs.refcount(proceduralHandle)).toBe(0);
      warnSpy.mockRestore();
    },
  );

  it.each(["throw", "structured"] as const)(
    "retains authored restoration grants after a rollback %s and releases them only after retry succeeds",
    async (mode) => {
      const world = new World();
      const authoredMesh = world.allocSharedRef("MeshAsset", AUTHORED_MESH);
      const authoredMaterial = world.allocSharedRef(
        "MaterialAsset",
        Materials.standard({ baseColor: [0.18, 0.28, 0.38, 1] }),
      );
      const ground = world
        .spawn(
          { component: Transform, data: { pos: [4, 1, -2] } },
          { component: MeshFilter, data: { assetHandle: authoredMesh } },
          {
            component: MeshRenderer,
            data: { materials: [authoredMaterial] },
          },
        )
        .unwrap();
      world.sharedRefs.release(authoredMesh).unwrap();
      world.sharedRefs.release(authoredMaterial).unwrap();
      const allocSpy = vi.spyOn(world, "allocSharedRef");
      const spawnSpy = vi.spyOn(world, "spawn");
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const handle = await createProceduralWorld({
        world,
        host: missingAssetsHost(rendererWithUpload({ ok: true })),
        loaded: {
          nodes: [{ localId: 0, components: { Name: { value: "Ground" } } }],
          mapping: new Map([[0, ground]]),
        },
      });
      const proceduralHandles = allocSpy.mock.results.map(
        ({ value }) => value as SharedAssetHandle,
      );
      const spawned = spawnSpy.mock.results.flatMap(({ value }) =>
        value?.ok ? [value.value as EntityHandle] : [],
      );
      const releaseSpy = vi.spyOn(world.sharedRefs, "release");
      const despawnSpy = vi.spyOn(world, "despawn");
      const removeSystemSpy = vi.spyOn(world, "removeSystem");
      const set = world.set.bind(world);
      let restorationAttempts = 0;
      vi.spyOn(world, "set").mockImplementation((...args) => {
        const [entity, component, data] = args;
        if (
          entity === ground &&
          component === MeshFilter &&
          (data as { readonly assetHandle?: unknown }).assetHandle ===
            authoredMesh &&
          restorationAttempts++ === 0
        ) {
          if (mode === "throw")
            throw new Error("injected-restoration-rollback-throw");
          return err({
            code: "injected-restoration-rollback-failure",
          }) as ReturnType<World["set"]>;
        }
        return set(...args);
      });

      let cleanupError: unknown;
      try {
        handle!.dispose();
      } catch (error) {
        cleanupError = error;
      }
      expect(cleanupError).toBeInstanceOf(AggregateError);
      expect((cleanupError as AggregateError).errors).toHaveLength(1);
      expect(world.sharedRefs.refcount(authoredMesh)).toBe(1);
      expect(world.sharedRefs.refcount(authoredMaterial)).toBe(1);
      expect(
        releaseSpy.mock.calls.filter(([released]) => released === authoredMesh),
      ).toHaveLength(0);
      expect(
        releaseSpy.mock.calls.filter(
          ([released]) => released === authoredMaterial,
        ),
      ).toHaveLength(0);
      for (const entity of spawned)
        expect(world.get(entity, Transform).ok).toBe(false);
      const pendingProceduralMesh = world
        .get(ground, MeshFilter)
        .unwrap().assetHandle;
      expect(pendingProceduralMesh).not.toBe(authoredMesh);
      expect(proceduralHandles).toContain(pendingProceduralMesh);
      const pendingProceduralHandles = new Set([
        pendingProceduralMesh,
        ...world.get(ground, MeshRenderer).unwrap().materials,
      ]);
      for (const proceduralHandle of proceduralHandles)
        expect(world.sharedRefs.refcount(proceduralHandle)).toBe(
          pendingProceduralHandles.has(proceduralHandle) ? 1 : 0,
        );
      const despawnsAfterFailure = despawnSpy.mock.calls.length;
      const removalsAfterFailure = removeSystemSpy.mock.calls.length;

      handle!.dispose();
      expect(world.get(ground, MeshFilter).unwrap().assetHandle).toBe(
        authoredMesh,
      );
      expect(
        Array.from(world.get(ground, MeshRenderer).unwrap().materials),
      ).toEqual([authoredMaterial]);
      expect(
        releaseSpy.mock.calls.filter(([released]) => released === authoredMesh),
      ).toHaveLength(1);
      expect(
        releaseSpy.mock.calls.filter(
          ([released]) => released === authoredMaterial,
        ),
      ).toHaveLength(1);
      for (const proceduralHandle of proceduralHandles)
        expect(world.sharedRefs.refcount(proceduralHandle)).toBe(0);
      expect(despawnSpy).toHaveBeenCalledTimes(despawnsAfterFailure);
      expect(removeSystemSpy).toHaveBeenCalledTimes(removalsAfterFailure);

      handle!.dispose();
      expect(
        releaseSpy.mock.calls.filter(([released]) => released === authoredMesh),
      ).toHaveLength(1);
      expect(despawnSpy).toHaveBeenCalledTimes(despawnsAfterFailure);
      expect(removeSystemSpy).toHaveBeenCalledTimes(removalsAfterFailure);
      world.despawn(ground).unwrap();
      expect(world.sharedRefs.refcount(authoredMesh)).toBe(0);
      expect(world.sharedRefs.refcount(authoredMaterial)).toBe(0);
      warnSpy.mockRestore();
    },
  );
});
