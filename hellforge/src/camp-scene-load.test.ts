import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetGuid } from '@forgeax/engine/pack/source';
import gamePack from '../assets/game.pack';
import {
  CAMP_PRELOAD_ANCHOR_NAME,
  CAMP_SCENE_MAX_ATTEMPTS,
  CampSceneError,
  createCampSceneLoader,
  hostPreloadIsCamp,
  packIndexNeedsAbsoluteRebind,
} from './camp-scene-load';

type Scene = {
  id: string;
  entities?: ReadonlyArray<{ components?: { Name?: { value?: string } } }>;
};
type Root = { id: number };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeAssets(opts?: {
  load?: (guid: unknown) => Promise<{ ok: true; value: Scene } | { ok: false; error: unknown }>;
  instantiate?: () => { ok: true; value: Root } | { ok: false; error: unknown };
}) {
  const loads: unknown[] = [];
  const instantiates: unknown[] = [];
  return {
    loads,
    instantiates,
    packIndexUrl: './pack-index.json' as string | undefined,
    configurePackIndex(url: string) { this.packIndexUrl = url; },
    async loadByGuid(guid: unknown) {
      loads.push(guid);
      if (opts?.load) return opts.load(guid);
      return { ok: true as const, value: { id: 'scene' } };
    },
    instantiate(handle: unknown, world: unknown) {
      instantiates.push({ handle, world });
      if (opts?.instantiate) return opts.instantiate();
      return { ok: true as const, value: { id: instantiates.length } };
    },
  };
}

const parseGuid = (guid: string) => ({ ok: true as const, value: guid });

describe('ensureCampSceneLoaded / instantiate', () => {
  test('concurrent load: load once, instantiate zero', async () => {
    const gate = deferred<{ ok: true; value: Scene }>();
    const assets = makeAssets({ load: () => gate.promise });
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => 'https://example.test/pack-index.json',
    });
    const a = loader.ensureCampSceneLoaded();
    const b = loader.ensureCampSceneLoaded();
    expect(assets.loads).toHaveLength(1);
    gate.resolve({ ok: true, value: { id: 'scene' } });
    expect(await a).toEqual(await b);
    expect(assets.loads).toHaveLength(1);
    expect(assets.instantiates).toHaveLength(0);
    expect(assets.packIndexUrl).toBe('https://example.test/pack-index.json');
  });

  test('concurrent instantiate: load once, instantiate once', async () => {
    const assets = makeAssets();
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => ({ handle: v }) },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => './pack-index.json',
    });
    const [x, y] = await Promise.all([
      loader.ensureCampSceneInstantiated(),
      loader.ensureCampSceneInstantiated(),
    ]);
    expect(x.root).toBe(y.root);
    expect(assets.loads).toHaveLength(1);
    expect(assets.instantiates).toHaveLength(1);
  });

  test('host preloaded camp root is not instantiated again', async () => {
    const assets = makeAssets();
    const preRoot = { id: 99 };
    const preScene: Scene = {
      id: 'host',
      entities: [{ components: { Name: { value: CAMP_PRELOAD_ANCHOR_NAME } } }],
    };
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => './pack-index.json',
      preloaded: { scene: preScene, root: preRoot },
    });
    const got = await loader.ensureCampSceneInstantiated();
    expect(got.root).toBe(preRoot);
    expect(assets.instantiates).toHaveLength(0);
    expect(assets.loads).toHaveLength(0);
  });

  test('host GUID match reuses root even without Veyra anchor', async () => {
    const assets = makeAssets();
    const preRoot = { id: 7 };
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => './pack-index.json',
      preloaded: { scene: { id: 'stub' }, root: preRoot, guid: 'camp' },
    });
    const got = await loader.ensureCampSceneInstantiated();
    expect(got.root).toBe(preRoot);
    expect(assets.instantiates).toHaveLength(0);
  });

  test('den-shaped host preload is ignored; camp instantiates into the real world', async () => {
    const assets = makeAssets();
    const denRoot = { id: 1 };
    const world = {};
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: world,
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => './pack-index.json',
      preloaded: { scene: { id: 'den' }, root: denRoot, guid: 'den-pack' },
    });
    const got = await loader.ensureCampSceneInstantiated();
    expect(got.root).not.toBe(denRoot);
    expect(assets.loads).toHaveLength(1);
    expect(assets.instantiates).toHaveLength(1);
    expect(assets.instantiates[0]).toMatchObject({ world });
  });

  test('SDK default root catalog is rebound before loading under the public subpath', async () => {
    const assets = makeAssets({ load: async () => {
      expect(assets.packIndexUrl).toBe('https://forgeax.github.io/games/hellforge/pack-index.json');
      return { ok: true, value: { id: 'scene' } };
    } });
    assets.packIndexUrl = '/pack-index.json';
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => 'https://forgeax.github.io/games/hellforge/pack-index.json',
    });
    await loader.ensureCampSceneLoaded();
    expect(assets.loads).toHaveLength(1);
  });

  test('already-absolute pack-index is not rebound', async () => {
    const assets = makeAssets();
    assets.packIndexUrl = '/games/hellforge/pack-index.json';
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => 'https://example.test/pack-index.json',
    });
    await loader.ensureCampSceneLoaded();
    expect(assets.packIndexUrl).toBe('/games/hellforge/pack-index.json');
  });

  test('scheme-absolute pack-index is not rebound', async () => {
    const assets = makeAssets();
    assets.packIndexUrl = 'https://cdn.example/pack-index.json';
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => 'https://example.test/pack-index.json',
    });
    await loader.ensureCampSceneLoaded();
    expect(assets.packIndexUrl).toBe('https://cdn.example/pack-index.json');
  });

  test('failed load stays structured; retry creates a new Promise; success instantiates once', async () => {
    let loadN = 0;
    const assets = makeAssets({
      load: async () => {
        loadN += 1;
        if (loadN === 1 || loadN === 2) {
          return { ok: false as const, error: { code: 'not-found', hint: 'missing pack' } };
        }
        return { ok: true as const, value: { id: 'scene' } };
      },
    });
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => './pack-index.json',
    });
    const first = loader.ensureCampSceneLoaded();
    await expect(first).rejects.toBeInstanceOf(CampSceneError);
    await expect(first).rejects.toMatchObject({ code: 'not-found' });
    expect(loadN).toBe(CAMP_SCENE_MAX_ATTEMPTS);

    loader.retryAfterFailure();
    const second = loader.ensureCampSceneLoaded();
    expect(second).not.toBe(first);
    await expect(second).resolves.toEqual({ id: 'scene' });

    const inst = await loader.ensureCampSceneInstantiated();
    loader.retryAfterFailure();
    const inst2 = await loader.ensureCampSceneInstantiated();
    expect(inst2.root).toBe(inst.root);
    expect(assets.instantiates).toHaveLength(1);
  });

  test('dispose drops late load writes (no instantiate after Stop)', async () => {
    const gate = deferred<{ ok: true; value: Scene }>();
    const assets = makeAssets({ load: () => gate.promise });
    const loader = createCampSceneLoader<Scene, Root>({
      assets,
      world: { allocSharedRef: (_k, v) => v },
      instantiateWorld: {},
      parseGuid,
      campSceneGuid: 'camp',
      standalonePackIndexUrl: () => './pack-index.json',
    });
    const p = loader.ensureCampSceneInstantiated();
    loader.dispose();
    gate.resolve({ ok: true, value: { id: 'late' } });
    await expect(p).rejects.toMatchObject({ code: 'camp-scene-stopped' });
    expect(assets.instantiates).toHaveLength(0);
  });

  test('schema-v3 forge.json selects the Pack-derived engine root', () => {
    const forgePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'forge.json');
    const forge = JSON.parse(readFileSync(forgePath, 'utf8')) as Record<string, unknown>;
    expect('defaultScene' in forge).toBe(false);
    expect(forge.id).toBe('hellforge');
    expect('plugins' in forge).toBe(false);
    expect(forge.schemaVersion).toBe('3.0.0');
    expect(forge.roots).toEqual({
      engine: AssetGuid.format(AssetGuid.derive(gamePack.packageId, 'plugin/engine')),
    });
  });
});

describe('hostPreloadIsCamp / packIndexNeedsAbsoluteRebind', () => {
  test('GUID match wins; mismatch rejects even with Veyra', () => {
    const veyra = { entities: [{ components: { Name: { value: CAMP_PRELOAD_ANCHOR_NAME } } }] };
    expect(hostPreloadIsCamp({ campSceneGuid: 'camp', preloadedGuid: 'camp', scene: { id: 'x' } })).toBe(true);
    expect(hostPreloadIsCamp({ campSceneGuid: 'camp', preloadedGuid: 'den', scene: veyra })).toBe(false);
    expect(hostPreloadIsCamp({ campSceneGuid: 'camp', scene: veyra })).toBe(true);
    expect(hostPreloadIsCamp({ campSceneGuid: 'camp', scene: { id: 'den' } })).toBe(false);
  });

  test('only default root or relative pack-index URLs need rebind', () => {
    expect(packIndexNeedsAbsoluteRebind('./pack-index.json')).toBe(true);
    expect(packIndexNeedsAbsoluteRebind('pack-index.json')).toBe(true);
    expect(packIndexNeedsAbsoluteRebind('/pack-index.json')).toBe(true);
    expect(packIndexNeedsAbsoluteRebind('/custom-catalog/pack-index.json')).toBe(false);
    expect(packIndexNeedsAbsoluteRebind('/games/hellforge/pack-index.json')).toBe(false);
    expect(packIndexNeedsAbsoluteRebind('https://cdn.example/pack-index.json')).toBe(false);
    expect(packIndexNeedsAbsoluteRebind(undefined)).toBe(false);
    expect(packIndexNeedsAbsoluteRebind('./other.json')).toBe(false);
  });
});
