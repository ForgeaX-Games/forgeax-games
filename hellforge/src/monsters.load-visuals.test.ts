// PR11 T3/T5 — MonsterManager.loadVisualsFor: parallel kind/clip loading,
// per-kind failure isolation, zoned split, and the spawn() sequencing guard
// ("no spawn may consult a bank whose load was never requested").

import { describe, expect, mock, test } from 'bun:test';

const AnimationPlayer = Symbol('AnimationPlayer');
const ChildOf = Symbol('ChildOf');
const Transform = Symbol('Transform');
const Materials = { standard: (data: unknown) => data };
const MeshFilter = Symbol('MeshFilter');
const MeshRenderer = Symbol('MeshRenderer');
const SceneInstance = Symbol('SceneInstance');
const Skin = Symbol('Skin');

mock.module('@forgeax/engine-animation', () => ({ AnimationPlayer }));
mock.module('@forgeax/engine-scene', () => ({ ChildOf, Transform }));
mock.module('@forgeax/engine-render', () => ({ Materials, MeshFilter, MeshRenderer, SceneInstance }));
mock.module('@forgeax/engine-skinning', () => ({ Skin }));
mock.module('@forgeax/engine-runtime', () => ({
  quat: { eulerY: () => [0, 0, 0, 1], create: () => [0, 0, 0, 1], fromAxisAngle: () => undefined, multiply: () => undefined },
}));
mock.module('@forgeax/engine-assets-runtime', () => ({ HANDLE_CUBE: 1, HANDLE_SPHERE: 2 }));
mock.module('@forgeax/engine-pack/guid', () => ({
  AssetGuid: {
    parse: (dash: string) =>
      /^[0-9a-f-]{36}$/i.test(dash)
        ? { ok: true as const, value: dash }
        : { ok: false as const, error: new Error('bad guid') },
  },
}));

const { MonsterManager, WILD_MONSTER_KINDS, DEN_MONSTER_KINDS } = await import('./monsters');

type Comp = { component: unknown; data: unknown };

function makeWorld() {
  let nextId = 1;
  const live = new Map<number, Map<unknown, unknown>>();
  return {
    spawn(...comps: Comp[]) {
      const id = nextId++;
      const m = new Map<unknown, unknown>();
      for (const c of comps) m.set(c.component, c.data);
      live.set(id, m);
      return { ok: true as const, value: id, unwrap: () => id };
    },
    despawn(e: number) { live.delete(e); },
    get(e: number, component: unknown) {
      const m = live.get(e);
      if (!m || !m.has(component)) return { ok: false as const };
      return { ok: true as const, value: m.get(component) };
    },
    set(e: number, component: unknown, data: unknown) {
      const m = live.get(e);
      if (m) m.set(component, { ...(m.get(component) as object ?? {}), ...(data as object) });
    },
    addComponent(e: number, entry: Comp) { live.get(e)?.set(entry.component, entry.data); },
    removeComponent(e: number, component: unknown) { live.get(e)?.delete(component); },
    allocSharedRef(_kind: string, value: unknown) { return value ?? {}; },
  };
}

const events = { onPlayerHit: () => {}, onDeath: () => {} };

/** Assets whose loadByGuid tracks peak concurrency; failSceneFor fails one scene guid. */
function makeAssets(opts: { failSceneFor?: string; delayMs?: number } = {}) {
  let inFlight = 0;
  let maxInFlight = 0;
  let instantiateCalls = 0;
  const assets = {
    loadByGuid: async (guid: unknown) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 1));
      inFlight -= 1;
      if (opts.failSceneFor !== undefined && guid === opts.failSceneFor) {
        return { ok: false as const, error: { code: 'missing' } };
      }
      return { ok: true as const, value: { duration: 0.5 } };
    },
    instantiate: () => {
      instantiateCalls += 1;
      return { ok: true as const, value: 9999 };
    },
    get maxInFlight() { return maxInFlight; },
    get instantiateCalls() { return instantiateCalls; },
  };
  return assets;
}

// imp's scene guid (stable constant in monsters.ts GLB_VISUALS).
const IMP_SCENE = '019f23d5-2dc8-7884-915f-af72d70bf346';

describe('loadVisualsFor (PR11 T3/T5)', () => {
  test('loads all kinds in parallel; onItem fires 6× per kind (scene + 5 clips)', async () => {
    const world = makeWorld();
    const assets = makeAssets();
    const mgr = new MonsterManager(world as never, {} as never, events);
    let items = 0;
    const allKinds = [...WILD_MONSTER_KINDS, ...DEN_MONSTER_KINDS];
    const loaded = await mgr.loadVisualsFor(allKinds, assets as never, () => { items += 1; });
    expect(loaded).toHaveLength(allKinds.length);
    for (const k of allKinds) expect(loaded).toContain(k);
    expect(items).toBe(allKinds.length * 6);
    // Parallelism: a serial loader peaks at 1 in-flight load; parallel peaks far higher.
    expect(assets.maxInFlight).toBeGreaterThan(1);
  });

  test('zoned split: loading only WILD kinds leaves DEN kinds unloaded', async () => {
    const world = makeWorld();
    const assets = makeAssets();
    const mgr = new MonsterManager(world as never, {} as never, events);
    const loaded = await mgr.loadVisualsFor(WILD_MONSTER_KINDS, assets as never);
    expect(loaded).toHaveLength(WILD_MONSTER_KINDS.length);
    for (const k of DEN_MONSTER_KINDS) expect(loaded).not.toContain(k);
  });

  test('failure isolation: one kind failing leaves the others loaded', async () => {
    const world = makeWorld();
    const assets = makeAssets({ failSceneFor: IMP_SCENE });
    const mgr = new MonsterManager(world as never, {} as never, events);
    let items = 0;
    const allKinds = [...WILD_MONSTER_KINDS, ...DEN_MONSTER_KINDS];
    const loaded = await mgr.loadVisualsFor(allKinds, assets as never, () => { items += 1; });
    expect(loaded).not.toContain('imp');
    expect(loaded).toHaveLength(allKinds.length - 1);
    // Every kind still settles all 6 loads (failed scene included) → honest progress.
    expect(items).toBe(allKinds.length * 6);
  });
});

describe('spawn() bank/sequencing guard (PR11 T5)', () => {
  function captureError() {
    const orig = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
    return { errors, restore: () => { console.error = orig; } };
  }

  test('spawn of an attempted-but-failed kind uses parts fallback WITHOUT sequencing error', async () => {
    const world = makeWorld();
    const assets = makeAssets({ failSceneFor: IMP_SCENE });
    const mgr = new MonsterManager(world as never, {} as never, events);
    await mgr.loadVisualsFor(['imp'], assets as never); // attempted, failed
    const cap = captureError();
    const m = mgr.spawn('imp', 0, 0, 'wild');
    cap.restore();
    expect(m).not.toBeNull();
    expect(m!.skinEnt).toBeNull();          // parts fallback
    expect(m!.parts.length).toBeGreaterThan(0);
    expect(assets.instantiateCalls).toBe(0); // no GLB instantiate for a failed bank
    expect(cap.errors).toHaveLength(0);      // attempted → not a sequencing bug
  });

  test('spawn of a NEVER-requested kind fires the loud sequencing guard', async () => {
    const world = makeWorld();
    const assets = makeAssets();
    const mgr = new MonsterManager(world as never, {} as never, events);
    // no loadVisualsFor call at all → imp never attempted
    const cap = captureError();
    const m = mgr.spawn('imp', 0, 0, 'wild');
    cap.restore();
    expect(m).not.toBeNull();
    expect(m!.skinEnt).toBeNull();
    expect(cap.errors.length).toBeGreaterThan(0);
    expect(cap.errors[0]).toContain('sequencing bug');
  });

  test('spawn of a loaded kind takes the GLB path (instantiate consulted)', async () => {
    const world = makeWorld();
    const assets = makeAssets();
    const mgr = new MonsterManager(world as never, {} as never, events);
    await mgr.loadVisualsFor(['imp'], assets as never);
    const cap = captureError();
    mgr.spawn('imp', 0, 0, 'wild');
    cap.restore();
    expect(assets.instantiateCalls).toBe(1); // GLB instantiate, not parts
    expect(cap.errors).toHaveLength(0);
  });
});
