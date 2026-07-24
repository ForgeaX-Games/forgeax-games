// PR2c T5-fix2 — executable delayed-load race: hide() during in-flight show()
// must leave zero preview DirectionalLight/PointLight after the load settles.
// Pure helper tests cannot observe this ownership path.

import { describe, expect, mock, test } from 'bun:test';

const DirectionalLight = Symbol('DirectionalLight');
const PointLight = Symbol('PointLight');
const Transform = Symbol('Transform');
const MeshFilter = Symbol('MeshFilter');
const MeshRenderer = Symbol('MeshRenderer');
const Camera = Symbol('Camera');
const SceneInstance = Symbol('SceneInstance');
const Skin = Symbol('Skin');
const AnimationPlayer = Symbol('AnimationPlayer');
const ChildOf = Symbol('ChildOf');

mock.module('@forgeax/engine-runtime', () => ({
  AnimationPlayer,
  Camera,
  ChildOf,
  DirectionalLight,
  Materials: {
    standard: (data: unknown) => data,
  },
  MeshFilter,
  MeshRenderer,
  PointLight,
  SceneInstance,
  Skin,
  Transform,
  perspective: (p: unknown) => p,
  quat: {
    create: () => [0, 0, 0, 1],
    fromAxisAngle: () => undefined,
    multiply: () => undefined,
  },
}));

mock.module('@forgeax/engine-pack/guid', () => ({
  AssetGuid: {
    parse: (dashForm: string) => {
      if (!/^[0-9a-f-]{36}$/i.test(dashForm)) {
        return { ok: false as const, error: new Error('bad guid') };
      }
      return { ok: true as const, value: dashForm };
    },
  },
}));

mock.module('@forgeax/engine-assets-runtime', () => ({
  HANDLE_CUBE: 1,
}));

mock.module('./heroes', () => ({
  getHeroDef: () => ({
    id: 'sorceress',
    displayName: 'Sorceress',
    gltf: {
      scene: '019f439f-a25e-7fd4-a8b4-595783b0359f',
      clips: [
        { name: 'idle', guid: '019f439f-a25e-7fd4-a8b4-595b8b491fe9' },
      ],
    },
    scale: 1.3,
    baseStats: {},
    growth: {},
    skills: [],
  }),
}));

const { installHeroPreview } = await import('./hero-preview');

type Comp = { component: unknown; data: unknown };
type LiveEntity = {
  id: number;
  comps: Map<unknown, unknown>;
};

function makeOwnershipWorld() {
  let nextId = 1;
  const live = new Map<number, LiveEntity>();

  const world = {
    spawn(...comps: Comp[]) {
      const id = nextId++;
      const compsMap = new Map<unknown, unknown>();
      for (const c of comps) compsMap.set(c.component, c.data);
      live.set(id, { id, comps: compsMap });
      return { unwrap: () => id };
    },
    despawn(e: number) {
      live.delete(e);
    },
    set(e: number, component: unknown, data: unknown) {
      const ent = live.get(e);
      if (!ent) return;
      const prev = (ent.comps.get(component) ?? {}) as Record<string, unknown>;
      ent.comps.set(component, { ...prev, ...(data as Record<string, unknown>) });
    },
    get(e: number, component: unknown) {
      const ent = live.get(e);
      if (!ent || !ent.comps.has(component)) return { ok: false as const };
      return { ok: true as const, value: ent.comps.get(component) };
    },
    allocSharedRef(_kind: string, value: unknown) {
      return value ?? {};
    },
    addComponent(e: number, entry: Comp) {
      const ent = live.get(e);
      if (!ent) return;
      ent.comps.set(entry.component, entry.data);
    },
    removeComponent(e: number, component: unknown) {
      live.get(e)?.comps.delete(component);
    },
  };

  const countPreviewLights = (): number => {
    let n = 0;
    for (const ent of live.values()) {
      if (ent.comps.has(DirectionalLight) || ent.comps.has(PointLight)) n += 1;
    }
    return n;
  };

  const previewLightKinds = (): string[] => {
    const kinds: string[] = [];
    for (const ent of live.values()) {
      if (ent.comps.has(DirectionalLight)) kinds.push('DirectionalLight');
      if (ent.comps.has(PointLight)) kinds.push('PointLight');
    }
    return kinds;
  };

  return { world, live, countPreviewLights, previewLightKinds };
}

describe('hero-preview async race after hide (PR2c T5-fix2 / C2)', () => {
  test('hide during deferred ring load leaves 0 preview lights after settle', async () => {
    const { world, countPreviewLights, previewLightKinds } = makeOwnershipWorld();
    const camera = world.spawn({ component: Camera, data: {} }).unwrap() as number;

    let settleRing: (() => void) | null = null;
    const ringLoadStarted = Promise.withResolvers<void>();

    const assets = {
      loadByGuid: async (_guid: unknown) => {
        // First await in ensureStageFx is the select-ring mesh — suspend there.
        if (settleRing === null) {
          ringLoadStarted.resolve();
          await new Promise<void>((resolve) => {
            settleRing = resolve;
          });
        }
        return { ok: true as const, value: { stub: true } };
      },
      instantiate: () => ({
        ok: true as const,
        value: world.spawn({
          component: SceneInstance,
          data: { mapping: [] },
        }).unwrap(),
      }),
    };

    const preview = installHeroPreview({
      world: world as never,
      assets: assets as never,
      camera: camera as never,
      getAspect: () => 16 / 9,
      proj: { fov: 50, near: 0.1, far: 100 },
    });

    const showPromise = preview.show('sorceress');
    await ringLoadStarted.promise;

    // Sol reproduction: confirm/back fires hide while ring asset is still loading.
    preview.hide();
    expect(countPreviewLights()).toBe(0);

    settleRing?.();
    await showPromise;

    expect(countPreviewLights()).toBe(0);
    expect(previewLightKinds()).toEqual([]);
  });
});
