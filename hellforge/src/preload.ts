// Title/intro payload preload (plan §阶段 3). loadByGuid only — never
// instantiate or spawn. Camp Scene closure stays on CampSceneLoader; this
// pool cannot cap that ~87-body expand. The pool caps in-flight GUIDs (4).

import { getHeroDef, type HeroDef } from './heroes';
import type { ClassId } from './classes';
import { DEN_MONSTER_KINDS, visualGuidsForKinds, WILD_MONSTER_KINDS } from './monsters';
import { SLAG_MATERIAL_GUID, VOLCANO_VARIANTS } from './volcano-assets';

export const PRELOAD_CONCURRENCY = 4;

/** Same witch.glb as the Veyra NPC in main.ts — payload preload, not a second spawn. */
export const VEYRA_SCENE_GUID = '5e3028dd-ddf6-4104-86d9-318d3e8fb5a6';
export const VEYRA_IDLE_GUID = 'c530adf2-8de6-486a-afaa-9af3a6e6dfd1';

export type PreloadLoader = {
  parseGuid: (guid: string) => { ok: true; value: unknown } | { ok: false };
  loadByGuid: (guid: unknown) => Promise<unknown>;
};

export type AssetPreloader = {
  whenCampReady(classId: ClassId): Promise<void>;
  whenTitleIdle(): Promise<void>;
  whenClassSelected(classId: ClassId): Promise<void>;
  /** Pause title-idle so skip-intro does not fight initializeRuntime. */
  onCharacterConfirmed(): void;
  dispose(): void;
};

export function uniqueGuids(guids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const guid of guids) {
    if (typeof guid !== 'string' || guid.length === 0 || seen.has(guid)) continue;
    seen.add(guid);
    out.push(guid);
  }
  return out;
}

export function heroPayloadGuids(classId: ClassId): string[] {
  const hero: HeroDef = getHeroDef(classId);
  return uniqueGuids([hero.gltf.scene, ...hero.gltf.clips.map((clip) => clip.guid)]);
}

export function veyraPayloadGuids(): string[] {
  return [VEYRA_SCENE_GUID, VEYRA_IDLE_GUID];
}

export function volcanoPayloadGuids(): string[] {
  return uniqueGuids([SLAG_MATERIAL_GUID, ...VOLCANO_VARIANTS.map((variant) => variant.mesh)]);
}

export function wildMonsterPayloadGuids(): string[] {
  return uniqueGuids(visualGuidsForKinds(WILD_MONSTER_KINDS));
}

export function denMonsterPayloadGuids(): string[] {
  return uniqueGuids(visualGuidsForKinds(DEN_MONSTER_KINDS));
}

export function createConcurrencyPool(limit: number) {
  if (!Number.isFinite(limit) || limit < 1) throw new Error('preload pool limit must be >= 1');
  let active = 0;
  const wait: Array<() => void> = [];
  return {
    get active() { return active; },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) await new Promise<void>((resolve) => { wait.push(resolve); });
      active += 1;
      try {
        return await fn();
      } finally {
        active -= 1;
        wait.shift()?.();
      }
    },
  };
}

export function loadResultOk(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!('ok' in value)) return true;
  return (value as { ok: unknown }).ok !== false;
}

export function bootCoverLabel(
  tracker: { phaseComplete(id: string): boolean },
  opts?: { campAssetsReady?: boolean },
): string {
  if (!tracker.phaseComplete('camp') && !opts?.campAssetsReady) return '营地';
  if (!tracker.phaseComplete('hero') || !tracker.phaseComplete('veyra')) return '角色';
  if (!tracker.phaseComplete('monsters-wild')) return '怪物';
  return '渲染准备';
}

export function createAssetPreloader(opts: {
  loader: PreloadLoader;
  concurrency?: number;
}): AssetPreloader {
  const pool = createConcurrencyPool(opts.concurrency ?? PRELOAD_CONCURRENCY);
  const inflight = new Map<string, Promise<void>>();
  let disposed = false;
  let confirmed = false;

  const loadGuid = (guid: string, idle: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (idle && confirmed) return Promise.resolve();
    const hit = inflight.get(guid);
    if (hit) return hit;
    const pending = pool.run(async () => {
      if (disposed) return;
      if (idle && confirmed) {
        inflight.delete(guid);
        return;
      }
      const parsed = opts.loader.parseGuid(guid);
      if (!parsed.ok) return;
      try {
        const result = await opts.loader.loadByGuid(parsed.value);
        if (!loadResultOk(result)) inflight.delete(guid);
      } catch {
        inflight.delete(guid);
      }
    });
    inflight.set(guid, pending);
    void pending.then(() => {
      // Failed loads already deleted inflight so a later retry can run.
    });
    return pending;
  };

  const loadGroup = (guids: readonly string[], idle = false): Promise<void> =>
    Promise.all(uniqueGuids(guids).map((guid) => loadGuid(guid, idle))).then(() => undefined);

  return {
    async whenCampReady(classId) {
      if (disposed) return;
      await Promise.all([
        loadGroup(veyraPayloadGuids()),
        loadGroup(heroPayloadGuids(classId)),
      ]);
    },
    async whenTitleIdle() {
      if (disposed || confirmed) return;
      await Promise.all([
        ...WILD_MONSTER_KINDS.map((kind) => loadGroup(visualGuidsForKinds([kind]), true)),
        loadGroup(volcanoPayloadGuids(), true),
      ]);
    },
    async whenClassSelected(classId) {
      if (disposed) return;
      await loadGroup(heroPayloadGuids(classId));
    },
    onCharacterConfirmed() {
      confirmed = true;
    },
    dispose() {
      disposed = true;
      confirmed = true;
    },
  };
}
