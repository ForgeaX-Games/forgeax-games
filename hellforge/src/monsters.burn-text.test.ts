// N5 Scorch float-text cadence — presentation only.
//
// Magma CD is 0.45s; burn text interval is 0.5s. Refreshing applyBurn MUST
// not reset the cadence, or the keep-burning loop never shows a number.
// Engine mocks: same SIDE-EFFECT import as monsters.boss.test.ts.

import { describe, expect, mock, test } from 'bun:test';

import '../tools/engine-test-mocks';

mock.module('@forgeax/engine/pack/guid', () => ({
  AssetGuid: {
    parse: (dash: string) =>
      /^[0-9a-f-]{36}$/i.test(dash)
        ? { ok: true as const, value: dash }
        : { ok: false as const, error: new Error('bad guid') },
  },
}));

const { MonsterManager, BURN_TEXT_INTERVAL_SEC } = await import('./monsters');

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
    internSharedRef(_kind: string, value: unknown) { return value ?? {}; },
    allocSharedRef(_kind: string, value: unknown) { return value ?? {}; },
  };
}

function makeFx() {
  let nextHandle = 1;
  return {
    novaTelegraph() {
      return { ring: nextHandle++, fill: nextHandle++, center: nextHandle++ };
    },
    moveNovaTelegraph() {},
    releaseNovaTelegraph() {},
    novaShockRing() {},
    novaScorch() {},
    burst() {},
    playEffect() {},
    flightBody() { return { primary: nextHandle++, glow: nextHandle++ }; },
    moveFlightBody() {},
    releaseFlightBody() {},
    flightTrailPuff() {},
    gibs() {},
    syncSlowStatus() {},
    endSlowStatus() {},
  };
}

function makeEvents() {
  return {
    playerHits: [] as Array<{ damage: number; source: string }>,
    deaths: [] as unknown[],
    burnTicks: [] as number[],
    onPlayerHit(damage: number, source: string) { this.playerHits.push({ damage, source }); },
    onDeath(m: unknown) { this.deaths.push(m); },
    onBurnTick(_m: unknown, damage: number) { this.burnTicks.push(damage); },
  };
}

function quietSpawn(mgr: InstanceType<typeof MonsterManager>) {
  const orig = console.error;
  console.error = () => {};
  try {
    return mgr.spawn('imp', 0, 0, 'den')!;
  } finally {
    console.error = orig;
  }
}

const FAR = 100;
const SAFE = true;
const WALKABLE = () => true;
/** Magma base CD in skill-resolver BASE — must stay below the float-text interval. */
const MAGMA_CD_SEC = 0.45;
const DT = 1 / 60;

function step(
  mgr: InstanceType<typeof MonsterManager>,
  seconds: number,
): void {
  let left = seconds;
  while (left > 1e-9) {
    const dt = Math.min(DT, left);
    mgr.tick(dt, FAR, FAR, SAFE, WALKABLE);
    left -= dt;
  }
}

describe('N5 burn float-text cadence', () => {
  test('magma CD is shorter than the burn-text interval (the starve case)', () => {
    expect(MAGMA_CD_SEC).toBeLessThan(BURN_TEXT_INTERVAL_SEC);
  });

  test('refreshing Scorch before 0.5s still emits ticks (keep-burning loop)', () => {
    const world = makeWorld();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, makeFx() as never, events);
    const m = quietSpawn(mgr);
    mgr.applyBurn(m, 10, 2);

    let elapsed = 0;
    let nextRefresh = MAGMA_CD_SEC;
    while (elapsed < 1.2) {
      mgr.tick(DT, FAR, FAR, SAFE, WALKABLE);
      elapsed += DT;
      if (elapsed + 1e-9 >= nextRefresh) {
        mgr.applyBurn(m, 10, 2);
        nextRefresh += MAGMA_CD_SEC;
      }
    }

    expect(events.burnTicks.length).toBeGreaterThanOrEqual(2);
    for (const n of events.burnTicks) expect(n).toBeGreaterThanOrEqual(1);
  });

  test('kill flushes leftover accum even before the first interval', () => {
    const world = makeWorld();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, makeFx() as never, events);
    const m = quietSpawn(mgr);
    mgr.applyBurn(m, 10, 2);
    step(mgr, 0.3);
    expect(events.burnTicks).toEqual([]);
    mgr.damage(m, 999);
    expect(events.deaths).toHaveLength(1);
    expect(events.burnTicks.length).toBe(1);
    expect(events.burnTicks[0]!).toBeGreaterThanOrEqual(1);
  });

  test('sub-1 rounded remainder is held, not shown as 0', () => {
    const world = makeWorld();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, makeFx() as never, events);
    const m = quietSpawn(mgr);
    // 0.7 dps → first 0.5s accum ~0.35 rounds to 0 (must not show "0");
    // by ~1.0s accum ~0.7 rounds to 1. Extra 0.15s covers 1/60 float drift.
    mgr.applyBurn(m, 1.4, 2);
    step(mgr, BURN_TEXT_INTERVAL_SEC - 0.05);
    expect(events.burnTicks).toEqual([]);
    step(mgr, BURN_TEXT_INTERVAL_SEC + 0.15);
    expect(events.burnTicks).toEqual([1]);
  });
});
