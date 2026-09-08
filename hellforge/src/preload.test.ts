import { describe, expect, test } from 'bun:test';
import { LoadTracker } from './load-tracker';
import {
  bootCoverLabel,
  createAssetPreloader,
  createConcurrencyPool,
  denMonsterPayloadGuids,
  heroPayloadGuids,
  loadResultOk,
  PRELOAD_CONCURRENCY,
  uniqueGuids,
  veyraPayloadGuids,
  volcanoPayloadGuids,
  wildMonsterPayloadGuids,
} from './preload';
import { DEN_MONSTER_KINDS, visualGuidsForKinds, WILD_MONSTER_KINDS } from './monsters';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('preload guid lists', () => {
  test('wild list is the three campaign kinds and excludes den-only bosses', () => {
    const wild = new Set(wildMonsterPayloadGuids());
    const den = new Set(denMonsterPayloadGuids());
    expect(wildMonsterPayloadGuids()).toHaveLength(WILD_MONSTER_KINDS.length * 6);
    expect(denMonsterPayloadGuids()).toHaveLength(DEN_MONSTER_KINDS.length * 6);
    for (const guid of den) expect(wild.has(guid)).toBe(false);
    expect(visualGuidsForKinds(['slaglord']).some((g) => wild.has(g))).toBe(false);
  });

  test('hero/veyra/volcano lists are unique non-empty GUIDs', () => {
    const hero = heroPayloadGuids('sorceress');
    expect(hero.length).toBeGreaterThan(1);
    expect(new Set(hero).size).toBe(hero.length);
    expect(veyraPayloadGuids()).toHaveLength(2);
    expect(volcanoPayloadGuids().length).toBe(1 + 8);
    expect(uniqueGuids(['a', 'a', '', 'b'])).toEqual(['a', 'b']);
  });
});

describe('concurrency pool', () => {
  test('never exceeds the cap', async () => {
    const pool = createConcurrencyPool(2);
    let peak = 0;
    const gate = deferred<void>();
    const tasks = [0, 1, 2, 3, 4].map(() => pool.run(async () => {
      peak = Math.max(peak, pool.active);
      await gate.promise;
    }));
    await Bun.sleep(10);
    expect(peak).toBe(2);
    expect(pool.active).toBe(2);
    gate.resolve();
    await Promise.all(tasks);
    expect(pool.active).toBe(0);
  });
});

describe('createAssetPreloader', () => {
  test('duplicate GUIDs load once', async () => {
    const loads: string[] = [];
    const loader = createAssetPreloader({
      loader: {
        parseGuid: (guid) => ({ ok: true as const, value: guid }),
        async loadByGuid(guid) {
          loads.push(String(guid));
          return { ok: true };
        },
      },
    });
    await Promise.all([
      loader.whenClassSelected('sorceress'),
      loader.whenClassSelected('sorceress'),
    ]);
    expect(new Set(loads)).toEqual(new Set(heroPayloadGuids('sorceress')));
  });

  test('title idle does not fetch den monster GUIDs and caps in-flight GUIDs', async () => {
    let active = 0;
    let peak = 0;
    const loads: string[] = [];
    const loader = createAssetPreloader({
      concurrency: 4,
      loader: {
        parseGuid: (guid) => ({ ok: true as const, value: guid }),
        async loadByGuid(guid) {
          loads.push(String(guid));
          active += 1;
          peak = Math.max(peak, active);
          await Bun.sleep(5);
          active -= 1;
          return { ok: true };
        },
      },
    });
    await loader.whenTitleIdle();
    const den = new Set(denMonsterPayloadGuids());
    for (const guid of loads) expect(den.has(guid)).toBe(false);
    expect(peak).toBeLessThanOrEqual(PRELOAD_CONCURRENCY);
  });

  test('camp-ready preloads veyra + current hero only (no instantiate)', async () => {
    const loads: string[] = [];
    const loader = createAssetPreloader({
      loader: {
        parseGuid: (guid) => ({ ok: true as const, value: guid }),
        async loadByGuid(guid) { loads.push(String(guid)); return { ok: true }; },
      },
    });
    await loader.whenCampReady('sorceress');
    const expected = new Set([...veyraPayloadGuids(), ...heroPayloadGuids('sorceress')]);
    expect(new Set(loads)).toEqual(expected);
  });

  test('confirm pauses title idle so later GUIDs do not start', async () => {
    const started: string[] = [];
    const gate = deferred<void>();
    const loader = createAssetPreloader({
      concurrency: 1,
      loader: {
        parseGuid: (guid) => ({ ok: true as const, value: guid }),
        async loadByGuid(guid) {
          started.push(String(guid));
          await gate.promise;
          return { ok: true };
        },
      },
    });
    const idle = loader.whenTitleIdle();
    await Bun.sleep(10);
    loader.onCharacterConfirmed();
    gate.resolve();
    await idle;
    expect(started.length).toBeLessThan(wildMonsterPayloadGuids().length + volcanoPayloadGuids().length);
    expect(started.length).toBeGreaterThan(0);
  });

  test('failed Result.ok=false is not cached as a warm hit', async () => {
    let n = 0;
    const loader = createAssetPreloader({
      loader: {
        parseGuid: (guid) => ({ ok: true as const, value: guid }),
        async loadByGuid() {
          n += 1;
          return n === 1 ? { ok: false } : { ok: true };
        },
      },
    });
    await loader.whenClassSelected('sorceress');
    await loader.whenClassSelected('sorceress');
    expect(n).toBeGreaterThan(heroPayloadGuids('sorceress').length);
  });
});

describe('bootCoverLabel', () => {
  test('skips 营地 once camp has settled or payload is already ready', () => {
    const tracker = new LoadTracker()
      .register('camp', 1, 32)
      .register('hero', 2)
      .register('veyra', 2)
      .register('monsters-wild', 2)
      .register('ready', 1);
    expect(bootCoverLabel(tracker)).toBe('营地');
    expect(bootCoverLabel(tracker, { campAssetsReady: true })).toBe('角色');
    tracker.completePhase('camp');
    expect(bootCoverLabel(tracker)).toBe('角色');
    tracker.completePhase('hero');
    tracker.completePhase('veyra');
    expect(bootCoverLabel(tracker)).toBe('怪物');
    tracker.completePhase('monsters-wild');
    expect(bootCoverLabel(tracker)).toBe('渲染准备');
  });
});

describe('loadResultOk', () => {
  test('treats missing ok as success and ok:false as failure', () => {
    expect(loadResultOk(undefined)).toBe(true);
    expect(loadResultOk({ ok: true })).toBe(true);
    expect(loadResultOk({ ok: false })).toBe(false);
  });
});
