import { describe, expect, it, vi } from "vitest";
import { AnimationPlayer } from "@forgeax/engine-animation";
import type { BootstrapContext } from "@forgeax/engine-app";
import { Update, World } from "@forgeax/engine-ecs";
import type { EntityHandle } from "@forgeax/engine-ecs";
import type { InputSnapshot } from "@forgeax/engine-input";
import { MeshRenderer } from "@forgeax/engine-render";
import { Transform } from "@forgeax/engine-scene";
import type {
  AnimationClip,
  Handle,
  MaterialAsset,
  SceneAsset,
} from "@forgeax/engine-types";
import { PlayerBodyPart } from "../assets/plugins/components/gameplay";
import {
  FOX_CLIP_GUIDS,
  FOX_FEET_OFFSET_Y,
  FOX_FORWARD_ROTATION,
  FOX_PRESENTATION_CLEARCOAT,
  FOX_PRESENTATION_CLEARCOAT_ROUGHNESS,
  FOX_PRESENTATION_ROUGHNESS,
  FOX_SCENE_GUID,
  FOX_WORLD_SCALE,
  createFoxPlayer,
  foxAnimationWeights,
  installFoxAnimationPlayer,
  installFoxPlayerRuntime,
  installFoxPresentationMaterials,
  withFoxPresentation,
} from "../assets/plugins/fox-player";

type ClipHandle = Handle<"AnimationClip", "shared">;

function clipPayload(name: string): AnimationClip {
  return {
    kind: "animation-clip",
    name,
    duration: 1,
    channels: [],
  } as unknown as AnimationClip;
}

function inputSnapshot(moving: boolean): InputSnapshot {
  return {
    getVector: () => (moving ? { x: 1, y: 0 } : { x: 0, y: 0 }),
    action: () => ({ isPressed: () => false }),
  } as unknown as InputSnapshot;
}

function fakeHost(loadByGuid: ReturnType<typeof vi.fn>): BootstrapContext {
  return { assets: { loadByGuid } } as unknown as BootstrapContext;
}

function expectScale(
  world: World,
  entity: EntityHandle,
  expected: readonly [number, number, number],
): void {
  const actual = Array.from(world.get(entity, Transform).unwrap().scale);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!);
  }
}

function expectBodyScale(
  world: World,
  entity: EntityHandle,
  expected: readonly [number, number, number],
): void {
  const actual = world.get(entity, PlayerBodyPart).unwrap();
  expect(actual.baseScaleX).toBeCloseTo(expected[0]);
  expect(actual.baseScaleY).toBeCloseTo(expected[1]);
  expect(actual.baseScaleZ).toBeCloseTo(expected[2]);
}

describe("Fox animation resource ownership", () => {
  it("selects locomotion clips from actual movement outcome rather than input intent", () => {
    expect(foxAnimationWeights(undefined)).toEqual([1, 0, 0]);
    expect(foxAnimationWeights({
      fixedTick: 10,
      planarDistance: 0,
      planarSpeed: 0,
      sprinting: false,
    })).toEqual([1, 0, 0]);
    expect(foxAnimationWeights({
      fixedTick: 11,
      planarDistance: 0.05,
      planarSpeed: 3,
      sprinting: false,
    })).toEqual([0, 1, 0]);
    expect(foxAnimationWeights({
      fixedTick: 12,
      planarDistance: 0.15,
      planarSpeed: 9,
      sprinting: true,
    })).toEqual([0, 0, 1]);
    expect(foxAnimationWeights({
      fixedTick: 13,
      planarDistance: 0,
      planarSpeed: 9,
      sprinting: true,
    })).toEqual([1, 0, 0]);
  });
  it("uses the Quaternius scene, locomotion clips, and +Z to -Z placement contract", () => {
    expect(FOX_SCENE_GUID).toBe("019fdd58-2e01-7b74-a568-bb8340e30734");
    expect(FOX_CLIP_GUIDS).toEqual({
      idle: "019fdd58-2e01-7b74-a568-bb8b4d30fdaa",
      walk: "019fdd58-2e01-7b74-a568-bb9177671295",
      gallop: "019fdd58-2e01-7b74-a568-bb8910831820",
    });
    expect(FOX_FORWARD_ROTATION).toEqual([0, 1, 0, 0]);
    expect(FOX_WORLD_SCALE).toBe(0.5);
    expect(FOX_FEET_OFFSET_Y).toBe(-0.75);
  });

  it("transfers three caller clip grants to the AnimationPlayer component", () => {
    const world = new World();
    const root = world.spawn().unwrap();
    const clip = (name: string): ClipHandle =>
      world.allocSharedRef("AnimationClip", {
        kind: "animation-clip",
        name,
        duration: 1,
        channels: [],
      } as unknown as AnimationClip);
    const clips = [clip("idle"), clip("walk"), clip("gallop")] as const;

    installFoxAnimationPlayer(world, root, clips);
    expect(world.get(root, AnimationPlayer).ok).toBe(true);
    for (const handle of clips)
      expect(world.sharedRefs.refcount(handle)).toBe(1);

    world.despawn(root).unwrap();
    for (const handle of clips)
      expect(world.sharedRefs.refcount(handle)).toBe(0);
  });

  it("accepts a textureless imported pbr-skin color while applying bounded coat tuning", () => {
    const source: MaterialAsset = {
      kind: "material",
      colorSpace: "linear",
      passes: [{ name: "Forward", program: { module: "forgeax::pbr-skin" } }],
      values: {
        baseColor: [0.47, 0.17, 0.06, 1],
        metallic: 0,
        roughness: 0.58,
      },
    };

    expect(withFoxPresentation(source)).toMatchObject({
      values: {
        baseColor: source.values?.baseColor,
        metallic: 0,
        roughness: FOX_PRESENTATION_ROUGHNESS,
        clearcoat: FOX_PRESENTATION_CLEARCOAT,
        clearcoatRoughness: FOX_PRESENTATION_CLEARCOAT_ROUGHNESS,
      },
    });
    expect(
      withFoxPresentation({ ...source, values: { roughness: 0.58 } }),
    ).toBeUndefined();
    expect(
      withFoxPresentation({
        ...source,
        passes: [
          {
            name: "Forward",
            program: { module: "forgeax::default-standard-pbr" },
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("clones all five presentation materials without changing slot order or leaking handles", () => {
    const world = new World();
    const colors = [
      [0.47, 0.17, 0.06, 1],
      [0.03, 0.03, 0.03, 1],
      [0.02, 0.02, 0.02, 1],
      [0.36, 0.38, 0.33, 1],
      [0.1, 0.1, 0.1, 1],
    ] as const;
    const sources = colors.map((baseColor) =>
      world.allocSharedRef<"MaterialAsset", MaterialAsset>("MaterialAsset", {
        kind: "material",
        passes: [{ name: "Forward", program: { module: "forgeax::pbr-skin" } }],
        values: { baseColor, metallic: 0, roughness: 0.5 },
      }),
    );
    const entity = world
      .spawn({ component: MeshRenderer, data: { materials: sources } })
      .unwrap();
    for (const source of sources)
      expect(world.sharedRefs.refcount(source)).toBe(2);

    expect(installFoxPresentationMaterials(world, entity)).toBe(true);
    const installed = world.get(entity, MeshRenderer).unwrap().materials;
    expect(installed).toHaveLength(5);
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index]!;
      const clone = installed[index]!;
      expect(clone).not.toBe(source);
      expect(
        world.sharedRefs.resolve<"MaterialAsset", MaterialAsset>(clone).unwrap()
          .values?.baseColor,
      ).toEqual(colors[index]);
      expect(world.sharedRefs.refcount(source)).toBe(1);
      expect(world.sharedRefs.refcount(clone)).toBe(1);
    }

    world.despawn(entity).unwrap();
    for (const clone of installed)
      expect(world.sharedRefs.refcount(clone)).toBe(0);
    for (const source of sources) {
      world.sharedRefs.release(source).unwrap();
      expect(world.sharedRefs.refcount(source)).toBe(0);
    }
  });

  it("rejects an incomplete five-slot material set without mutation or leaked clones", () => {
    const world = new World();
    const sources = Array.from({ length: 5 }, (_, index) =>
      world.allocSharedRef<"MaterialAsset", MaterialAsset>("MaterialAsset", {
        kind: "material",
        passes: [
          {
            name: "Forward",
            program: {
              module:
                index === 3
                  ? "forgeax::default-standard-pbr"
                  : "forgeax::pbr-skin",
            },
          },
        ],
        values: {
          baseColor: [index / 5, 0.1, 0.2, 1],
          metallic: 0,
          roughness: 0.5,
        },
      }),
    );
    const entity = world
      .spawn({ component: MeshRenderer, data: { materials: sources } })
      .unwrap();

    expect(installFoxPresentationMaterials(world, entity)).toBe(false);
    expect(
      Array.from(world.get(entity, MeshRenderer).unwrap().materials),
    ).toEqual(sources);
    for (const source of sources)
      expect(world.sharedRefs.refcount(source)).toBe(2);

    world.despawn(entity).unwrap();
    for (const source of sources) world.sharedRefs.release(source).unwrap();
  });

  it("waits for rejected sibling loaders without allocating shared clip grants", async () => {
    const world = new World();
    const loadByGuid = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: {} as SceneAsset })
      .mockResolvedValueOnce({ ok: true, value: clipPayload("idle") })
      .mockRejectedValueOnce(new Error("walk loader rejected"))
      .mockResolvedValueOnce({ ok: true, value: clipPayload("gallop") });
    const allocSpy = vi.spyOn(world, "allocSharedRef");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      createFoxPlayer({
        world,
        host: fakeHost(loadByGuid),
        player: world.spawn().unwrap(),
        readInput: () => inputSnapshot(false),
      }),
    ).resolves.toBeUndefined();

    expect(loadByGuid).toHaveBeenCalledTimes(4);
    expect(allocSpy).not.toHaveBeenCalled();
  });

  it("does not allocate clip grants when a sibling loader returns a structured failure", async () => {
    const world = new World();
    const loadByGuid = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: {} as SceneAsset })
      .mockResolvedValueOnce({ ok: true, value: clipPayload("idle") })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "asset-not-imported" },
      })
      .mockResolvedValueOnce({ ok: true, value: clipPayload("gallop") });
    const allocSpy = vi.spyOn(world, "allocSharedRef");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      createFoxPlayer({
        world,
        host: fakeHost(loadByGuid),
        player: world.spawn().unwrap(),
        readInput: () => inputSnapshot(false),
      }),
    ).resolves.toBeUndefined();

    expect(allocSpy).not.toHaveBeenCalled();
  });

  it("removes locomotion writes, despawns once, and restores authored graybox scales on dispose", () => {
    const world = new World();
    world
      .addSystem(Update, {
        name: "game-player-movement",
        queries: [],
        fn: () => {},
      })
      .unwrap();
    const root = world.spawn().unwrap();
    const torso = world
      .spawn(
        {
          component: PlayerBodyPart,
          data: { baseScaleX: 0.5, baseScaleY: 0.55, baseScaleZ: 0.28 },
        },
        { component: Transform, data: { scale: [0.5, 0.55, 0.28] } },
      )
      .unwrap();
    const leg = world
      .spawn(
        {
          component: PlayerBodyPart,
          data: { baseScaleX: 0.18, baseScaleY: 0.5, baseScaleZ: 0.18 },
        },
        { component: Transform, data: { scale: [0.18, 0.5, 0.18] } },
      )
      .unwrap();
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        world.despawn(entity).unwrap();
        return { ok: true, value: 1, unwrap: () => 1 } as never;
      });
    const removeSystem = vi.spyOn(world, "removeSystem");
    const setSpy = vi.spyOn(world, "set");
    const handle = installFoxPlayerRuntime(world, root, () => inputSnapshot(true));

    expect(Array.from(world.get(torso, Transform).unwrap().scale)).toEqual([
      0, 0, 0,
    ]);
    expect(Array.from(world.get(leg, Transform).unwrap().scale)).toEqual([
      0, 0, 0,
    ]);
    setSpy.mockClear();
    world.update(0).unwrap();
    expect(setSpy).not.toHaveBeenCalledWith(root, AnimationPlayer, {
      weights: [0, 1, 0],
    });

    handle.dispose();
    expectScale(world, torso, [0.5, 0.55, 0.28]);
    expectScale(world, leg, [0.18, 0.5, 0.18]);
    expectBodyScale(world, torso, [0.5, 0.55, 0.28]);
    expectBodyScale(world, leg, [0.18, 0.5, 0.18]);

    setSpy.mockClear();
    world.update(0).unwrap();
    expect(setSpy).not.toHaveBeenCalled();
    handle.dispose();
    expect(despawnScene).toHaveBeenCalledTimes(1);
    expect(removeSystem).toHaveBeenCalledTimes(1);
  });

  it("rolls back hidden graybox state and root when locomotion system installation throws", () => {
    const world = new World();
    world
      .addSystem(Update, {
        name: "game-player-movement",
        queries: [],
        fn: () => {},
      })
      .unwrap();
    const root = world.spawn().unwrap();
    const torso = world
      .spawn(
        {
          component: PlayerBodyPart,
          data: { baseScaleX: 0.5, baseScaleY: 0.55, baseScaleZ: 0.28 },
        },
        { component: Transform, data: { scale: [0.5, 0.55, 0.28] } },
      )
      .unwrap();
    const despawnScene = vi
      .spyOn(world, "despawnScene")
      .mockImplementation((entity) => {
        world.despawn(entity).unwrap();
        return { ok: true, value: 1, unwrap: () => 1 } as never;
      });
    vi.spyOn(world, "addSystem").mockImplementationOnce(() => {
      throw new Error("system install failed");
    });

    expect(() =>
      installFoxPlayerRuntime(world, root, () => inputSnapshot(false)),
    ).toThrow("system install failed");
    expectScale(world, torso, [0.5, 0.55, 0.28]);
    expectBodyScale(world, torso, [0.5, 0.55, 0.28]);
    expect(despawnScene).toHaveBeenCalledTimes(1);
  });
});
