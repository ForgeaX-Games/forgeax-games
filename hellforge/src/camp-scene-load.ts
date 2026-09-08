// Idempotent camp Scene payload load + exactly-once instantiate (plan §阶段 2).
// No engine imports — caller injects assets/world/parseGuid.

export const CAMP_SCENE_MAX_ATTEMPTS = 2;

export class CampSceneError extends Error {
  readonly code: string;
  readonly hint: string;
  readonly details: unknown;
  constructor(opts: { code: string; hint: string; message?: string; details?: unknown }) {
    super(opts.message ?? opts.hint);
    this.name = 'CampSceneError';
    this.code = opts.code;
    this.hint = opts.hint;
    this.details = opts.details;
  }
}

export type LoadResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export type CampSceneLoaderAssets<TScene, TRoot> = {
  packIndexUrl?: string;
  configurePackIndex(url: string): void;
  loadByGuid(guid: unknown): Promise<LoadResult<TScene>>;
  instantiate(handle: unknown, world: unknown): LoadResult<TRoot>;
};

export type CampSceneLoaderWorld<TScene> = {
  allocSharedRef(kind: string, value: TScene): unknown;
};

export type CampSceneLoaderDeps<TScene, TRoot> = {
  assets: CampSceneLoaderAssets<TScene, TRoot> | undefined;
  world: CampSceneLoaderWorld<TScene>;
  /** Real engine World passed to `assets.instantiate` (not the alloc wrapper). */
  instantiateWorld: unknown;
  parseGuid: (guid: string) => LoadResult<unknown>;
  campSceneGuid: string;
  standalonePackIndexUrl: () => string;
  mark?: (name: 'hf:camp-load-start' | 'hf:camp-assets-ready') => void;
  /** Host-instantiated scene. Reused only when it is the encampment (GUID or Veyra). */
  preloaded?: { scene?: TScene; root?: TRoot; guid?: string };
};

export type CampSceneLoader<TScene, TRoot> = {
  ensureCampSceneLoaded(): Promise<TScene>;
  ensureCampSceneInstantiated(): Promise<{ scene: TScene; root: TRoot }>;
  isLoaded(): boolean;
  isInstantiated(): boolean;
  retryAfterFailure(): void;
  dispose(): void;
};

/** Camp pack unique Name; den / boss packs do not have this entity. */
export const CAMP_PRELOAD_ANCHOR_NAME = 'NpcVeyraAnchor';

export function sceneHasNamedEntity(scene: unknown, name: string): boolean {
  if (scene === null || typeof scene !== 'object') return false;
  const entities = (scene as { entities?: unknown }).entities;
  if (!Array.isArray(entities)) return false;
  return entities.some((entity) => {
    if (entity === null || typeof entity !== 'object') return false;
    const value = (entity as { components?: { Name?: { value?: unknown } } }).components?.Name?.value;
    return value === name;
  });
}

/** True only when the host tree is the encampment, not a den pack injected as defaultScene. */
export function hostPreloadIsCamp(opts: {
  campSceneGuid: string;
  preloadedGuid?: string;
  scene?: unknown;
}): boolean {
  if (typeof opts.preloadedGuid === 'string' && opts.preloadedGuid.length > 0) {
    return opts.preloadedGuid === opts.campSceneGuid;
  }
  return sceneHasNamedEntity(opts.scene, CAMP_PRELOAD_ANCHOR_NAME);
}

/**
 * Rebind relative pack-index URLs only. Do not equality-match the relative
 * catalog filename — website `build-games.mjs` rewrites that literal in every
 * JS file, which would disable the detector after bake.
 */
export function packIndexNeedsAbsoluteRebind(url: string | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  if (url.startsWith('/')) return false;
  return url.includes('pack-index');
}

function asCampError(error: unknown, fallbackCode: string, fallbackHint: string): CampSceneError {
  if (error instanceof CampSceneError) return error;
  if (error !== null && typeof error === 'object') {
    const e = error as { code?: string; hint?: string; message?: string; expected?: string };
    const code = typeof e.code === 'string' && e.code.length > 0 ? e.code : fallbackCode;
    const hint = [e.expected, e.hint, e.message].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    ).join(' — ') || fallbackHint;
    return new CampSceneError({ code, hint, details: error });
  }
  return new CampSceneError({
    code: fallbackCode,
    hint: fallbackHint,
    message: error instanceof Error ? error.message : String(error),
    details: error,
  });
}

export function createCampSceneLoader<TScene, TRoot>(
  deps: CampSceneLoaderDeps<TScene, TRoot>,
): CampSceneLoader<TScene, TRoot> {
  const pre = deps.preloaded;
  let disposed = false;
  let loaded: TScene | undefined;
  let instantiated: { scene: TScene; root: TRoot } | undefined;
  if (
    pre?.scene !== undefined &&
    pre.root !== undefined &&
    hostPreloadIsCamp({
      campSceneGuid: deps.campSceneGuid,
      preloadedGuid: pre.guid,
      scene: pre.scene,
    })
  ) {
    loaded = pre.scene;
    instantiated = { scene: pre.scene, root: pre.root };
  }
  let loadPromise: Promise<TScene> | null = null;
  let instantiatePromise: Promise<{ scene: TScene; root: TRoot }> | null = null;
  let markedLoadStart = false;
  let markedAssetsReady = false;

  const stopped = (): CampSceneError =>
    new CampSceneError({
      code: 'camp-scene-stopped',
      hint: 'Play 已停止，忽略迟到的营地加载结果。',
    });

  const rebindPackIndex = (): void => {
    const next = deps.assets;
    if (!next) return;
    const absolute = deps.standalonePackIndexUrl();
    if (!packIndexNeedsAbsoluteRebind(next.packIndexUrl)) return;
    if (next.packIndexUrl === absolute) return;
    next.configurePackIndex(absolute);
  };

  const markLoadStart = (): void => {
    if (markedLoadStart) return;
    markedLoadStart = true;
    deps.mark?.('hf:camp-load-start');
  };
  const markAssetsReady = (): void => {
    if (markedAssetsReady) return;
    markedAssetsReady = true;
    deps.mark?.('hf:camp-assets-ready');
  };

  const loadWithRetry = async (): Promise<TScene> => {
    if (disposed) throw stopped();
    if (loaded !== undefined) {
      markLoadStart();
      markAssetsReady();
      return loaded;
    }
    if (!deps.assets) {
      throw new CampSceneError({
        code: 'camp-scene-no-assets',
        hint: '没有 AssetRegistry，无法加载营地 Scene。',
      });
    }
    const parsed = deps.parseGuid(deps.campSceneGuid);
    if (!parsed.ok) {
      throw new CampSceneError({
        code: 'camp-scene-guid-invalid',
        hint: `营地 GUID 无效：${deps.campSceneGuid}`,
        details: parsed.error,
      });
    }
    rebindPackIndex();
    markLoadStart();
    let last: unknown;
    for (let attempt = 0; attempt < CAMP_SCENE_MAX_ATTEMPTS; attempt++) {
      if (disposed) throw stopped();
      const result = await deps.assets.loadByGuid(parsed.value);
      if (disposed) throw stopped();
      if (result.ok) {
        loaded = result.value;
        markAssetsReady();
        return loaded;
      }
      last = result.error;
    }
    throw asCampError(last, 'camp-scene-load-failed', '营地 Scene payload 加载失败。请检查资产目录后重试。');
  };

  const instantiateWithRetry = async (): Promise<{ scene: TScene; root: TRoot }> => {
    if (disposed) throw stopped();
    if (instantiated) return instantiated;
    const scene = await loadWithRetry();
    if (disposed) throw stopped();
    if (!deps.assets) {
      throw new CampSceneError({
        code: 'camp-scene-no-assets',
        hint: '没有 AssetRegistry，无法实例化营地 Scene。',
      });
    }
    let last: unknown;
    for (let attempt = 0; attempt < CAMP_SCENE_MAX_ATTEMPTS; attempt++) {
      if (disposed) throw stopped();
      const handle = deps.world.allocSharedRef('SceneAsset', scene);
      if (disposed) throw stopped();
      const inst = deps.assets.instantiate(handle, deps.instantiateWorld);
      if (disposed) throw stopped();
      if (inst.ok) {
        instantiated = { scene, root: inst.value };
        return instantiated;
      }
      last = inst.error;
    }
    throw asCampError(last, 'camp-scene-instantiate-failed', '营地 Scene 实例化失败。');
  };

  return {
    ensureCampSceneLoaded() {
      if (disposed) return Promise.reject(stopped());
      if (loaded !== undefined) return Promise.resolve(loaded);
      if (!loadPromise) {
        loadPromise = loadWithRetry().catch((err) => {
          loadPromise = null;
          throw err;
        });
      }
      return loadPromise;
    },
    ensureCampSceneInstantiated() {
      if (disposed) return Promise.reject(stopped());
      if (instantiated) return Promise.resolve(instantiated);
      if (!instantiatePromise) {
        instantiatePromise = instantiateWithRetry().catch((err) => {
          instantiatePromise = null;
          throw err;
        });
      }
      return instantiatePromise;
    },
    isLoaded() {
      return loaded !== undefined;
    },
    isInstantiated() {
      return instantiated !== undefined;
    },
    retryAfterFailure() {
      if (disposed) return;
      if (instantiated) return;
      if (loadPromise !== null && loaded === undefined) loadPromise = null;
      instantiatePromise = null;
    },
    dispose() {
      disposed = true;
      loadPromise = null;
      instantiatePromise = null;
    },
  };
}

export function formatCampSceneError(error: unknown): string {
  if (error instanceof CampSceneError) {
    return `${error.hint} (${error.code})`;
  }
  if (error !== null && typeof error === 'object') {
    const e = error as { expected?: string; hint?: string; message?: string; code?: string };
    const parts = [e.expected, e.hint, e.message, e.code].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    if (parts.length > 0) return parts.join(' — ');
  }
  return error instanceof Error ? error.message : String(error);
}
