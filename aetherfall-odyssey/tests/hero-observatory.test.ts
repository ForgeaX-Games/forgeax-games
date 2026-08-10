import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { BootstrapContext } from '@forgeax/engine-app';
import { World, type EntityHandle } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import {
  createHeroObservatory,
  HERO_OBSERVATORY_POSITION,
  HERO_OBSERVATORY_SCALE,
  HERO_OBSERVATORY_SCENE_GUID,
  HERO_OBSERVATORY_YAW,
} from '../assets/plugins/hero-observatory';
import { aetherfallOrbitPose } from '../assets/plugins/camera-orbit';

const SOURCE_BOUNDS = {
  min: [-4.719604969024658, 0.060314398258924484, -0.8616464734077454],
  max: [4.719634056091309, 7.522127628326416, 0.6537888050079346],
} as const;

describe('Aetherfall hero observatory placement', () => {
  it('pins the licensed scene package as a distant backdrop beyond the interactive Last Light', () => {
    expect(HERO_OBSERVATORY_SCENE_GUID).toBe('019fdca7-6c1f-7287-99b2-17e1b488382a');
    expect(HERO_OBSERVATORY_POSITION).toEqual([1.8, -1, -25.5]);
    expect(HERO_OBSERVATORY_POSITION[2]).toBeLessThan(-24);
    expect(HERO_OBSERVATORY_SCALE).toBe(0.92);
    expect(HERO_OBSERVATORY_YAW).toBe(0);
  });

  it('keeps approach and objective cameras outside the facade with bounded screen occupancy', () => {
    const minX = HERO_OBSERVATORY_POSITION[0] + SOURCE_BOUNDS.min[0] * HERO_OBSERVATORY_SCALE;
    const maxX = HERO_OBSERVATORY_POSITION[0] + SOURCE_BOUNDS.max[0] * HERO_OBSERVATORY_SCALE;
    const minY = HERO_OBSERVATORY_POSITION[1] + SOURCE_BOUNDS.min[1] * HERO_OBSERVATORY_SCALE;
    const maxY = HERO_OBSERVATORY_POSITION[1] + SOURCE_BOUNDS.max[1] * HERO_OBSERVATORY_SCALE;
    const minZ = HERO_OBSERVATORY_POSITION[2] + SOURCE_BOUNDS.min[2] * HERO_OBSERVATORY_SCALE;
    const maxZ = HERO_OBSERVATORY_POSITION[2] + SOURCE_BOUNDS.max[2] * HERO_OBSERVATORY_SCALE;
    const facadeCenterX = (minX + maxX) * 0.5;
    const facadeCenterZ = (minZ + maxZ) * 0.5;
    const facadeHalfWidth = (maxX - minX) * 0.5;
    const playerSamples = [
      [0, -12.75],
      [1.8, -16.4],
      [0.272, -18.849],
    ] as const;

    for (const [playerX, playerZ] of playerSamples) {
      const pose = aetherfallOrbitPose({
        playerX,
        playerY: 0,
        playerZ,
        lookYaw: 0,
        lookPitch: 0,
      });
      const cameraInsideFacade = pose.pos[0] >= minX && pose.pos[0] <= maxX
        && pose.pos[1] >= minY && pose.pos[1] <= maxY
        && pose.pos[2] >= minZ && pose.pos[2] <= maxZ;
      expect(cameraInsideFacade).toBe(false);
      const distance = Math.hypot(pose.pos[0] - facadeCenterX, pose.pos[2] - facadeCenterZ);
      expect(Math.atan2(facadeHalfWidth, distance) * 180 / Math.PI).toBeLessThan(18);
    }

    // The nearest facade plane remains well beyond the beacon interaction
    // point and the supported rear edge of the Last Light terrace.
    expect(-16.4 - maxZ).toBeGreaterThan(8);
    expect(-19.5 - maxZ).toBeGreaterThan(5);
  });

  it('retains the ForgeaX scene sub-asset GUID and verified CC BY attribution', () => {
    const sidecarUrl = new URL('../assets/models/hero-observatory/hero-observatory.glb.meta.json', import.meta.url);
    const attributionUrl = new URL('../assets/models/hero-observatory/ATTRIBUTION.md', import.meta.url);
    const sidecar = JSON.parse(readFileSync(sidecarUrl, 'utf8')) as {
      subAssets?: Array<{ guid?: string; kind?: string; sourceIndex?: number; sourceKey?: string }>;
    };
    expect(sidecar.subAssets).toContainEqual({
      guid: HERO_OBSERVATORY_SCENE_GUID,
      kind: 'scene',
      sourceIndex: 0,
      sourceKey: 'scene:Aetherfall Hero Observatory',
    });
    expect(readFileSync(attributionUrl, 'utf8')).toContain('Creative Commons Attribution 3.0 Unported');
  });

  it('retains a complete binary glTF payload with a matching declared length', () => {
    const glb = readFileSync(new URL('../assets/models/hero-observatory/hero-observatory.glb', import.meta.url));
    expect(glb.subarray(0, 4).toString('ascii')).toBe('glTF');
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.byteLength);
  });

  it('pins the lossless nine-draw hero package without changing geometry or PBR coverage', () => {
    const glb = readFileSync(new URL('../assets/models/hero-observatory/hero-observatory.glb', import.meta.url));
    const jsonLength = glb.readUInt32LE(12);
    expect(glb.readUInt32LE(16)).toBe(0x4e4f534a);
    const payload = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
      accessors: Array<{ count: number; min?: number[]; max?: number[] }>;
      images: unknown[];
      materials: Array<{ name?: string }>;
      meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; indices: number; material: number }> }>;
      nodes: Array<{ mesh: number; name?: string }>;
      scenes: Array<{ nodes?: number[] }>;
      textures: unknown[];
      extensionsUsed?: string[];
    };
    const primitives = payload.meshes.flatMap((mesh) => mesh.primitives);
    const triangleCount = primitives.reduce((sum, primitive) => sum + payload.accessors[primitive.indices]!.count / 3, 0);
    const uploadVertices = primitives.reduce((sum, primitive) => sum + payload.accessors[primitive.attributes.POSITION]!.count, 0);
    expect(payload.scenes).toHaveLength(1);
    expect(payload.nodes).toHaveLength(1);
    expect(payload.nodes[0]).toEqual({ name: 'Aetherfall Hero Observatory', mesh: 0 });
    expect(payload.scenes[0]?.nodes).toEqual([0]);
    expect(payload.nodes.filter((node) => node.mesh !== undefined)).toHaveLength(1);
    expect(payload.extensionsUsed?.filter((extension) => /physics/i.test(extension)) ?? []).toHaveLength(0);
    expect(payload.meshes).toHaveLength(1);
    expect(primitives).toHaveLength(9);
    expect([...new Set(primitives.map((primitive) => primitive.material))].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(payload.materials).toHaveLength(9);
    expect(payload.textures).toHaveLength(27);
    expect(payload.images).toHaveLength(27);
    expect(triangleCount).toBe(26_329);
    expect(uploadVertices).toBe(21_031);
    expect(glb.byteLength).toBeLessThan(9_500_000);
  });

  it('keeps joined primitive attributes dense and non-interleaved for the ForgeaX importer', () => {
    const glb = readFileSync(new URL('../assets/models/hero-observatory/hero-observatory.glb', import.meta.url));
    const jsonLength = glb.readUInt32LE(12);
    const payload = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as {
      accessors: Array<{
        bufferView?: number;
        componentType: number;
        normalized?: boolean;
        sparse?: unknown;
        type: string;
      }>;
      bufferViews: Array<{ byteStride?: number }>;
      meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices: number }> }>;
    };
    const primitives = payload.meshes.flatMap((mesh) => mesh.primitives);
    const attributeAccessors = primitives.flatMap((primitive) => Object.values(primitive.attributes));
    const componentWidths = { VEC2: 8, VEC3: 12, VEC4: 16 } as const;
    expect(attributeAccessors).toHaveLength(36);
    for (const accessorIndex of attributeAccessors) {
      const accessor = payload.accessors[accessorIndex]!;
      expect(accessor.bufferView).toBeTypeOf('number');
      expect(accessor.sparse).toBeUndefined();
      expect(accessor.componentType).toBe(5126);
      expect(accessor.normalized ?? false).toBe(false);
      expect(['VEC2', 'VEC3', 'VEC4']).toContain(accessor.type);
      const elementWidth = componentWidths[accessor.type as keyof typeof componentWidths];
      expect(payload.bufferViews[accessor.bufferView!]!.byteStride ?? elementWidth).toBe(elementWidth);
    }
  });

  it('executes load, instantiate, placement, caller-grant release, and disposal', async () => {
    const world = new World();
    let root: EntityHandle | undefined;
    let callerHandle: number | undefined;
    let callerRefcountInsideInstantiate = -1;
    const assets = {
      loadByGuid: vi.fn(async () => ({ ok: true, value: { kind: 'scene', entities: [], mounts: [] } })),
      instantiate: vi.fn((handle: number, targetWorld: World) => {
        callerHandle = handle;
        callerRefcountInsideInstantiate = targetWorld.sharedRefs.refcount(handle as never);
        root = targetWorld.spawn({ component: Transform, data: {} }).unwrap();
        return { ok: true, value: root };
      }),
    } as unknown as NonNullable<BootstrapContext['assets']>;
    const despawnScene = vi.spyOn(world, 'despawnScene').mockImplementation((entity) => {
      world.despawn(entity).unwrap();
      return { ok: true, value: 1 } as ReturnType<World['despawnScene']>;
    });

    const handle = await createHeroObservatory({
      world,
      host: { assets } as unknown as BootstrapContext,
    });
    expect(handle).toBeDefined();
    expect(callerRefcountInsideInstantiate).toBe(1);
    expect(callerHandle).toBeDefined();
    expect(world.sharedRefs.refcount(callerHandle as never)).toBe(0);
    const placed = Array.from(world.get(handle!.root, Transform).unwrap().pos);
    expect(placed[0]).toBeCloseTo(HERO_OBSERVATORY_POSITION[0], 5);
    expect(placed[1]).toBeCloseTo(HERO_OBSERVATORY_POSITION[1], 5);
    expect(placed[2]).toBeCloseTo(HERO_OBSERVATORY_POSITION[2], 5);
    const transform = world.get(handle!.root, Transform).unwrap();
    expect(transform.quat[1]).toBeCloseTo(Math.sin(HERO_OBSERVATORY_YAW / 2), 6);
    expect(transform.quat[3]).toBeCloseTo(Math.cos(HERO_OBSERVATORY_YAW / 2), 6);
    Array.from(transform.scale).forEach((value) => expect(value).toBeCloseTo(HERO_OBSERVATORY_SCALE, 6));

    handle!.dispose();
    handle!.dispose();
    expect(despawnScene).toHaveBeenCalledTimes(1);
    expect(despawnScene).toHaveBeenCalledWith(handle!.root);
    expect(world.get(handle!.root, Transform).ok).toBe(false);
  });

  it.each(['structured', 'throw'] as const)(
    'rolls back the instantiated scene when root placement has a %s failure',
    async (mode) => {
      const world = new World();
      let root: EntityHandle | undefined;
      let callerHandle: number | undefined;
      const assets = {
        loadByGuid: vi.fn(async () => ({ ok: true, value: { kind: 'scene', entities: [], mounts: [] } })),
        instantiate: vi.fn((handle: number, targetWorld: World) => {
          callerHandle = handle;
          root = targetWorld.spawn({ component: Transform, data: {} }).unwrap();
          return { ok: true, value: root };
        }),
      } as unknown as NonNullable<BootstrapContext['assets']>;
      const despawnScene = vi.spyOn(world, 'despawnScene').mockImplementation((entity) => {
        world.despawn(entity).unwrap();
        return { ok: true, value: 1 } as ReturnType<World['despawnScene']>;
      });
      vi.spyOn(world, 'set').mockImplementation(() => {
        if (mode === 'throw') throw new Error('injected-placement-throw');
        return {
          ok: false,
          error: { code: 'test-placement-failure', hint: 'injected placement failure' },
        } as never;
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const created = createHeroObservatory({
        world,
        host: { assets } as unknown as BootstrapContext,
      });
      if (mode === 'throw') {
        await expect(created).rejects.toThrow('injected-placement-throw');
      } else {
        await expect(created).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(
          '[aetherfall] hero observatory placement failed: test-placement-failure',
        );
      }

      expect(root).toBeDefined();
      expect(despawnScene).toHaveBeenCalledTimes(1);
      expect(world.get(root!, Transform).ok).toBe(false);
      expect(callerHandle).toBeDefined();
      expect(world.sharedRefs.refcount(callerHandle as never)).toBe(0);
      errorSpy.mockRestore();
    },
  );

  it('releases the caller SceneAsset grant when instantiation fails', async () => {
    const world = new World();
    let callerHandle: number | undefined;
    const assets = {
      loadByGuid: vi.fn(async () => ({ ok: true, value: { kind: 'scene', entities: [], mounts: [] } })),
      instantiate: vi.fn((handle: number) => {
        callerHandle = handle;
        return { ok: false, error: { code: 'test-instantiate-failure' } };
      }),
    } as unknown as NonNullable<BootstrapContext['assets']>;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const handle = await createHeroObservatory({
      world,
      host: { assets } as unknown as BootstrapContext,
    });
    expect(handle).toBeUndefined();
    expect(callerHandle).toBeDefined();
    expect(world.sharedRefs.refcount(callerHandle as never)).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith('[aetherfall] hero observatory instantiate failed: test-instantiate-failure');
    errorSpy.mockRestore();
  });

  it('reports explicit registry-missing and scene-load failure boundaries', async () => {
    const world = new World();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await createHeroObservatory({ world, host: undefined })).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[aetherfall] hero observatory unavailable: asset registry missing');

    const assets = {
      loadByGuid: vi.fn(async () => ({ ok: false, error: { code: 'test-load-failure' } })),
    } as unknown as NonNullable<BootstrapContext['assets']>;
    expect(await createHeroObservatory({
      world,
      host: { assets } as unknown as BootstrapContext,
    })).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('[aetherfall] hero observatory load failed: test-load-failure');
    errorSpy.mockRestore();
  });
});
