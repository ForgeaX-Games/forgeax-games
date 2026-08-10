import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AssetRegistry } from "@forgeax/engine-assets-runtime";
import {
  PARTICLE_SIMULATION_RESOURCE_KEY,
  ParticleEffectPlayer,
  type ParticleSimulation,
  parseParticleEffectSource,
} from "@forgeax/engine-vfx";
import { Disabled, FixedUpdate, World } from "@forgeax/engine-ecs";
import { Camera, perspective, type Renderer } from "@forgeax/engine-render";
import { Name, Transform } from "@forgeax/engine-scene";
import type { RenderFeature } from "@forgeax/engine-render";
import {
  activeScoringTargetEntities,
  createScoringTargetQuery,
  firstScoringTarget,
  scoringTargetEntities,
  ScoringTarget,
} from "../assets/plugins/scoring-target";
import {
  GAME_DEFAULT_GAMEPLAY_CONFIG,
  installGameplayConfig,
} from "../assets/plugins/resources/gameplay";
import { createVfxHitLoop } from "../assets/plugins/vfx-hit-loop";
import { describe, expect, it, vi } from "vitest";

const assetRoot = resolve(import.meta.dirname, "../assets");

function readEffect(fileName: string) {
  const pack = JSON.parse(
    readFileSync(resolve(assetRoot, fileName), "utf8"),
  ) as {
    schemaVersion: string;
    kind: string;
    assets: Array<{
      guid: string;
      kind: string;
      execution: string;
      payload: unknown;
    }>;
  };
  expect(pack).toMatchObject({
    schemaVersion: "2.0.0",
    kind: "internal-text-package",
  });
  expect(pack.assets).toHaveLength(1);
  const entry = pack.assets[0];
  expect(entry).toMatchObject({ kind: "particle-effect", execution: "cooked" });
  if (entry === undefined) throw new Error(`${fileName} has no asset entry`);
  const parsed = parseParticleEffectSource(entry.payload);
  if (!parsed.ok) throw new Error(parsed.error.hint);
  return { guid: entry.guid, effect: parsed.value };
}

function lifecycleAssets(): AssetRegistry {
  const effects = [
    readEffect("hit-vfx-effect.pack.json").effect,
    readEffect("charge-vfx-effect.pack.json").effect,
  ];
  let loadIndex = 0;
  return {
    parseGuid: (guid: string) => guid,
    loadByGuid: vi.fn(async () => ({ ok: true, value: effects[loadIndex++] })),
    loaders: { registerPackLoader: vi.fn() },
  } as unknown as AssetRegistry;
}

function lifecycleWorld(): {
  readonly world: World;
  readonly target: number;
  readonly camera: number;
} {
  const world = new World();
  const target = world.spawn({ component: Transform, data: {} }).unwrap();
  const camera = world
    .spawn(
      { component: Transform, data: { pos: [0, 2, 6] } },
      { component: Camera, data: perspective({ fov: 60, aspect: 16 / 9 }) },
    )
    .unwrap();
  return { world, target, camera };
}

function localRenderer(result: "ok" | "error" | "throw" = "ok"): {
  readonly renderer: Renderer;
  readonly installed: RenderFeature<unknown>[];
} {
  const installed: RenderFeature<unknown>[] = [];
  return {
    installed,
    renderer: {
      renderFeatureDiagnostics: () => [],
      installRenderFeature: vi.fn(async (feature: RenderFeature<unknown>) => {
        installed.push(feature);
        if (result === "throw")
          throw new Error("injected-render-feature-throw");
        return result === "ok"
          ? { ok: true, value: undefined }
          : {
              ok: false,
              error: {
                code: "render-feature-registration-failed",
                hint: "injected lifecycle failure",
              },
            };
      }),
    } as unknown as Renderer,
  };
}

function hasFixedSystem(world: World, name: string): boolean {
  return (
    world
      .inspect()
      .schedules.find((entry) => entry.schedule.name === FixedUpdate.name)
      ?.systems.some((system) => system.name === name) === true
  );
}

describe("game-default authored VFX effects", () => {
  it("keeps hit and charge effects as separate GUID-addressed Pack assets", () => {
    const hit = readEffect("hit-vfx-effect.pack.json");
    const charge = readEffect("charge-vfx-effect.pack.json");
    expect(hit.guid).not.toBe(charge.guid);
    expect(hit.effect.emitters.map((emitter) => emitter.output.kind)).toEqual([
      "billboard",
      "mesh",
    ]);
    expect(
      charge.effect.emitters.map((emitter) => emitter.output.kind),
    ).toEqual(["billboard", "mesh"]);
  });

  it("keeps the charge lesson on stock rate, burst, and box-shape operators", () => {
    const charge = readEffect("charge-vfx-effect.pack.json").effect;
    expect(charge.emitters.map((emitter) => emitter.schedule.rate)).toEqual([
      14, 4,
    ]);
    expect(
      charge.emitters.map((emitter) => emitter.schedule.bursts?.[0]?.time),
    ).toEqual([0, 0.15]);
    expect(charge.emitters[1]?.operators.spawn[0]).toMatchObject({
      kind: "shape",
      version: 1,
      params: { shape: "box", extents: [0.7, 0.35, 0.7] },
    });
  });

  it("keeps disabled targets in the ECS-owned reset roster", () => {
    const world = new World();
    const target = world
      .spawn({ component: ScoringTarget, data: { points: 10, slot: 0 } })
      .unwrap();
    const query = createScoringTargetQuery();
    expect(activeScoringTargetEntities(world, query)).toEqual([target]);
    world.addComponent(target, { component: Disabled, data: {} }).unwrap();
    expect(activeScoringTargetEntities(world, query)).toHaveLength(0);
    expect(scoringTargetEntities(world, query)).toEqual([target]);
    world.removeComponent(target, Disabled).unwrap();
    expect(activeScoringTargetEntities(world, query)).toEqual([target]);
  });

  it("prefers the authored RedBox as the primary mission target", () => {
    const world = new World();
    const incidental = world
      .spawn({ component: ScoringTarget, data: { points: 25, slot: 0 } })
      .unwrap();
    const authored = world
      .spawn(
        { component: Name, data: { value: "RedBox" } },
        { component: ScoringTarget, data: { points: 10, slot: 1 } },
      )
      .unwrap();
    const query = createScoringTargetQuery();
    expect(firstScoringTarget(world, query)).toBe(authored);
    expect(firstScoringTarget(world, query)).not.toBe(incidental);
  });

  it("keeps tuning discoverable as one ECS World resource", () => {
    const world = new World();
    installGameplayConfig(world, {
      movement: {
        speed: 6,
        bound: 11,
        playerY: 0.75,
        jumpVelocity: 6.5,
        gravity: 18,
      },
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
      projectile: {
        radius: 0.12,
        halfHeight: 0.16,
        speed: 24,
        life: 1.5,
        shootCooldown: 0.18,
      },
    });
    expect(
      world.getResource<{ movement: { speed: number } }>(
        GAME_DEFAULT_GAMEPLAY_CONFIG,
      ).movement.speed,
    ).toBe(6);
  });

  it("disposes the local VFX owner in reverse order and stays inert after disposal", async () => {
    const { world, target, camera } = lifecycleWorld();
    const { renderer, installed } = localRenderer();
    const allocSpy = vi.spyOn(world, "allocSharedRef");

    const handle = await createVfxHitLoop({
      world,
      assets: lifecycleAssets(),
      renderer,
      target,
      camera,
    });

    const effectHandles = allocSpy.mock.results.map((entry) => entry.value);
    expect(effectHandles).toHaveLength(2);
    expect(world.get(target, ParticleEffectPlayer).ok).toBe(true);
    expect(world.hasResource(PARTICLE_SIMULATION_RESOURCE_KEY)).toBe(true);
    expect(hasFixedSystem(world, "vfx-particle-simulation")).toBe(true);
    expect(installed).toHaveLength(1);
    const simulation = world.getResource<ParticleSimulation>(
      PARTICLE_SIMULATION_RESOURCE_KEY,
    );
    const advanceSpy = vi.spyOn(simulation, "advance");

    handle.dispose();
    handle.dispose();
    handle.trigger();
    handle.beginCharge();

    expect(advanceSpy).toHaveBeenCalledTimes(1);
    expect(advanceSpy).toHaveBeenCalledWith(world, []);
    expect(world.get(target, ParticleEffectPlayer).ok).toBe(false);
    expect(world.hasResource(PARTICLE_SIMULATION_RESOURCE_KEY)).toBe(false);
    expect(hasFixedSystem(world, "vfx-particle-simulation")).toBe(false);
    for (const effectHandle of effectHandles) {
      expect(world.sharedRefs.refcount(effectHandle)).toBe(0);
    }
    const extracted = installed[0]!.extract({
      worlds: [world],
      owner: 0,
      frameNumber: 1,
    } as never);
    expect(extracted.ok).toBe(true);
    if (extracted.ok) {
      expect(
        (extracted.value as { readonly observations: readonly unknown[] })
          .observations,
      ).toEqual([]);
    }
  });

  it("rolls back every acquired owner when local RenderFeature installation fails", async () => {
    const { world, target, camera } = lifecycleWorld();
    const { renderer, installed } = localRenderer("error");
    const allocSpy = vi.spyOn(world, "allocSharedRef");

    const handle = await createVfxHitLoop({
      world,
      assets: lifecycleAssets(),
      renderer,
      target,
      camera,
    });

    expect(handle.snapshot()).toMatchObject({
      available: false,
      errorCode: "render-feature-registration-failed",
    });
    expect(installed).toHaveLength(1);
    expect(installed[0]!.dispose).toBeDefined();
    expect(
      (
        installed[0] as ReturnType<typeof installed.at> & {
          diagnostics?: () => { readiness: string };
        }
      )?.diagnostics?.().readiness,
    ).toBe("disabled");
    expect(world.get(target, ParticleEffectPlayer).ok).toBe(false);
    expect(world.hasResource(PARTICLE_SIMULATION_RESOURCE_KEY)).toBe(false);
    expect(hasFixedSystem(world, "vfx-particle-simulation")).toBe(false);
    for (const entry of allocSpy.mock.results) {
      expect(world.sharedRefs.refcount(entry.value)).toBe(0);
    }
    handle.dispose();
  });

  it("rolls back all acquired owners when RenderFeature installation throws", async () => {
    const { world, target, camera } = lifecycleWorld();
    const { renderer, installed } = localRenderer("throw");
    const allocSpy = vi.spyOn(world, "allocSharedRef");

    await expect(
      createVfxHitLoop({
        world,
        assets: lifecycleAssets(),
        renderer,
        target,
        camera,
      }),
    ).rejects.toThrow("injected-render-feature-throw");

    expect(installed).toHaveLength(1);
    expect(
      (
        installed[0] as RenderFeature<unknown> & {
          diagnostics?: () => { readiness: string };
        }
      ).diagnostics?.().readiness,
    ).toBe("disabled");
    expect(hasFixedSystem(world, "vfx-particle-simulation")).toBe(false);
    expect(world.hasResource(PARTICLE_SIMULATION_RESOURCE_KEY)).toBe(false);
    expect(world.get(target, ParticleEffectPlayer).ok).toBe(false);
    for (const entry of allocSpy.mock.results) {
      expect(world.sharedRefs.refcount(entry.value)).toBe(0);
    }
  });
});
