// Slaglord boss rework + hostile-bolt VFX + MonsterEvents hooks.
//
// Covers: boss AoE slam telegraph lifecycle (mark → release at contact,
// dodgeable vs the marked ground), 3-bolt fan volley, boss mobility during
// the ranged wind-up (no full-clip root), sprite flight bodies instead of
// the raw orange sphere, and the onAggro/onAttack event latches.
//
// Engine mocks come from the shared registry as a SIDE-EFFECT import (never
// elided, process-global — see tools/engine-test-mocks.ts header). The
// engine-pack/guid subpath must be mocked locally (same caveat as
// monsters.load-visuals.test.ts).

import { describe, expect, mock, test } from 'bun:test';

import '../tools/engine-test-mocks';

mock.module('@forgeax/engine-pack/guid', () => ({
  AssetGuid: {
    parse: (dash: string) =>
      /^[0-9a-f-]{36}$/i.test(dash)
        ? { ok: true as const, value: dash }
        : { ok: false as const, error: new Error('bad guid') },
  },
}));

const { MonsterManager, MONSTERS } = await import('./monsters');

type Comp = { component: unknown; data: unknown };

function makeWorld() {
  let nextId = 1;
  let spawnCalls = 0;
  const live = new Map<number, Map<unknown, unknown>>();
  return {
    get spawnCalls() { return spawnCalls; },
    spawn(...comps: Comp[]) {
      spawnCalls += 1;
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

/** Recording FxSystem stub — every MonsterManager touchpoint. */
function makeFx() {
  let nextHandle = 1;
  const fx = {
    telegraphs: [] as Array<{ x: number; z: number; radius: number; vfx: unknown }>,
    releasedTelegraphs: [] as unknown[],
    shockRings: [] as Array<{ x: number; z: number; radius: number }>,
    scorches: [] as Array<{ x: number; z: number; radius: number }>,
    bursts: [] as Array<{ x: number; y: number; z: number; color: string }>,
    effects: [] as Array<{ def: unknown; x: number; y: number; z: number }>,
    flightBodies: [] as Array<{ style: string; x: number; y: number; z: number; vfx: unknown }>,
    movedBodies: [] as unknown[],
    releasedBodies: [] as unknown[],
    trailPuffs: [] as Array<{ style: string; x: number }>,
    gibsCalls: [] as unknown[][],
    novaTelegraph(x: number, z: number, radius: number) {
      const vfx = { ring: nextHandle++, fill: nextHandle++, center: nextHandle++ };
      this.telegraphs.push({ x, z, radius, vfx });
      return vfx;
    },
    moveNovaTelegraph(_vfx: unknown, _x: number, _z: number) {},
    releaseNovaTelegraph(vfx: unknown) { this.releasedTelegraphs.push(vfx); },
    novaShockRing(x: number, z: number, radius: number) { this.shockRings.push({ x, z, radius }); },
    novaScorch(x: number, z: number, radius: number) { this.scorches.push({ x, z, radius }); },
    burst(x: number, y: number, z: number, color: string) { this.bursts.push({ x, y, z, color }); },
    playEffect(def: unknown, x: number, y: number, z: number) { this.effects.push({ def, x, y, z }); },
    flightBody(style: string, x: number, y: number, z: number) {
      const vfx = { primary: nextHandle++, glow: nextHandle++ };
      this.flightBodies.push({ style, x, y, z, vfx });
      return vfx;
    },
    moveFlightBody(vfx: unknown, _x: number, _y: number, _z: number) { this.movedBodies.push(vfx); },
    releaseFlightBody(vfx: unknown) { this.releasedBodies.push(vfx); },
    flightTrailPuff(style: string, x: number, _y: number, _z: number) { this.trailPuffs.push({ style, x }); },
    gibs(...args: unknown[]) { this.gibsCalls.push(args); },
    syncSlowStatus() {},
    endSlowStatus() {},
  };
  return fx;
}

function makeEvents() {
  const events = {
    playerHits: [] as Array<{ damage: number; source: string }>,
    deaths: [] as unknown[],
    aggros: [] as string[],
    attacks: [] as string[],
    onPlayerHit(damage: number, source: string) { this.playerHits.push({ damage, source }); },
    onDeath(m: unknown) { this.deaths.push(m); },
    onAggro(m: { kind: string }) { this.aggros.push(m.kind); },
    onAttack(m: { kind: string }) { this.attacks.push(m.kind); },
  };
  return events;
}

/** spawn() without a GLB load fires the sequencing guard — silence it. */
function quietSpawn(mgr: InstanceType<typeof MonsterManager>, kind: 'imp' | 'flamecaller' | 'slaglord', x: number, z: number) {
  const orig = console.error;
  console.error = () => {};
  try {
    return mgr.spawn(kind, x, z, 'den')!;
  } finally {
    console.error = orig;
  }
}

/** Structural view of the manager's private bolt list (test-only). */
interface BoltView { x: number; z: number; dx: number; dz: number; speed: number; source: string; style: string }
function boltsOf(mgr: InstanceType<typeof MonsterManager>): BoltView[] {
  return (mgr as unknown as { bolts: BoltView[] }).bolts;
}

const WALKABLE = () => true;

describe('Slaglord def tuning', () => {
  test('speed 2.4 / ranged cooldown 6.0 / xp 300', () => {
    const def = MONSTERS.slaglord;
    expect(def.speed).toBe(2.4);
    expect(def.ranged!.cooldown).toBe(6.0);
    expect(def.xp).toBe(300);
  });
});

describe('boss AoE slam', () => {
  test('telegraph marks the player ground at wind-up; released at contact; in-radius hit lands', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'slaglord', 0, 0);
    m.attackCd = 0;
    m.rangedCd = 99;

    // Player in melee reach (attackRange 2.3) → wind-up starts, ground marked.
    mgr.tick(0.1, 1.5, 0, false, WALKABLE);
    expect(fx.telegraphs).toHaveLength(1);
    expect(fx.telegraphs[0]!.x).toBeCloseTo(1.5, 5);
    expect(fx.telegraphs[0]!.z).toBeCloseTo(0, 5);
    expect(fx.telegraphs[0]!.radius).toBeCloseTo(2.5, 5);
    expect(events.attacks).toEqual(['slaglord']);
    expect(m.strikeAt).toBeGreaterThan(mgr.clock());

    // No damage during the wind-up; strike resolves ~1.1 s later.
    mgr.tick(1.15, 1.5, 0, false, WALKABLE);
    expect(fx.releasedTelegraphs).toEqual([fx.telegraphs[0]!.vfx]);
    expect(events.playerHits).toEqual([{ damage: 14, source: 'slaglord' }]);
    expect(fx.shockRings).toHaveLength(1);
    expect(fx.shockRings[0]!.radius).toBeCloseTo(2.5, 5);
    expect(fx.scorches).toHaveLength(1);
    expect(m.slam).toBeNull();
  });

  test('slam is dodgeable: stepping out of the marked ring avoids the hit', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'slaglord', 0, 0);
    m.attackCd = 0;
    m.rangedCd = 99;

    mgr.tick(0.1, 1.5, 0, false, WALKABLE);
    expect(fx.telegraphs).toHaveLength(1);

    // Player escapes the marked ring before the contact frame (slam centre
    // stays where it was marked at (1.5, 0); player now 4.5 m away).
    mgr.tick(1.15, 6, 0, false, WALKABLE);
    expect(events.playerHits).toHaveLength(0);
    // Telegraph still released exactly once; ground FX still plays.
    expect(fx.releasedTelegraphs).toEqual([fx.telegraphs[0]!.vfx]);
    expect(fx.shockRings).toHaveLength(1);
    expect(fx.scorches).toHaveLength(1);
  });

  test('dying mid wind-up releases the pending telegraph', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'slaglord', 0, 0);
    m.attackCd = 0;
    m.rangedCd = 99;
    mgr.tick(0.1, 1.5, 0, false, WALKABLE);
    expect(fx.telegraphs).toHaveLength(1);

    mgr.damage(m, 99999);
    expect(fx.releasedTelegraphs).toEqual([fx.telegraphs[0]!.vfx]);
  });
});

describe('boss ranged volley', () => {
  test('3-bolt fan at ±15° with slag flight bodies; no ECS bolt entities', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'slaglord', 0, 0);
    m.attackCd = 0;
    m.rangedCd = 0;

    // Player at 8 m: beyond melee (2.3), inside bolt range (13).
    mgr.tick(0.01, 8, 0, false, WALKABLE);
    expect(events.attacks).toEqual(['slaglord']);
    expect(boltsOf(mgr)).toHaveLength(0); // still winding up

    const spawnsBefore = world.spawnCalls;
    mgr.tick(0.25, 8, 0, false, WALKABLE); // wind-up (0.2 s) elapses → loose
    const bolts = boltsOf(mgr);
    expect(bolts).toHaveLength(3);
    expect(world.spawnCalls).toBe(spawnsBefore); // sprite bodies, not meshes

    // Fan: middle bolt straight at the player, outer two rotated ±15°.
    const angles = bolts.map((b) => Math.atan2(b.dz, b.dx)).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-Math.PI / 12, 3);
    expect(angles[1]).toBeCloseTo(0, 3);
    expect(angles[2]).toBeCloseTo(Math.PI / 12, 3);
    for (const b of bolts) {
      expect(b.source).toBe('slaglord');
      expect(b.style).toBe('slag');
    }
    expect(fx.flightBodies.map((f) => f.style)).toEqual(['slag', 'slag', 'slag']);
  });

  test('boss keeps chasing through the ranged wind-up (no full-clip root)', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const boss = quietSpawn(mgr, 'slaglord', 0, 0);
    boss.attackCd = 99;
    boss.rangedCd = 99;
    // Simulate a cast clip in flight + a pending ranged strike.
    boss.clipUntil = performance.now() + 5000;
    boss.strikeAt = mgr.clock() + 1;
    boss.strikeRanged = true;

    const x0 = boss.x;
    mgr.tick(0.1, 8, 0, false, WALKABLE);
    expect(boss.x).toBeGreaterThan(x0); // rooted would freeze him in place
  });

  test('non-boss monsters ARE still rooted by a one-shot clip (control)', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'flamecaller', 0, 0);
    m.attackCd = 99;
    m.rangedCd = 99;
    m.clipUntil = performance.now() + 5000;
    m.strikeAt = mgr.clock() + 1;
    m.strikeRanged = true;

    mgr.tick(0.1, 8, 0, false, WALKABLE);
    expect(m.x).toBe(0); // busy → no stepping
  });
});

describe('hostile bolt VFX + attribution', () => {
  test('flamecaller bolt: magma flight body + trail puffs; impact beat + release', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'flamecaller', 0, 0);
    m.attackCd = 0;
    m.rangedCd = 0;

    mgr.tick(0.01, 8, 0, false, WALKABLE); // initiate cast
    mgr.tick(0.25, 8, 0, false, WALKABLE); // loose (0.2 s wind-up)
    expect(fx.flightBodies.map((f) => f.style)).toEqual(['magma']);

    // Fly until impact (bolt speed 9 over ~7.5 m; player stays put).
    for (let i = 0; i < 12 && events.playerHits.length === 0; i++) {
      mgr.tick(0.1, 8, 0, false, WALKABLE);
    }
    expect(events.playerHits).toEqual([{ damage: 9, source: 'flamecaller' }]);
    expect(fx.trailPuffs.length).toBeGreaterThan(0);
    expect(fx.trailPuffs.every((t) => t.style === 'magma')).toBe(true);
    // Impact: fire burst + hit-fire combat beat, flight body released once.
    expect(fx.bursts.some((b) => b.color === 'fire')).toBe(true);
    expect(fx.effects).toHaveLength(1);
    expect(fx.releasedBodies).toEqual([fx.flightBodies[0]!.vfx]);
    expect(boltsOf(mgr)).toHaveLength(0);
  });
});

describe('MonsterEvents hooks', () => {
  test('onAggro fires once per idle→aggro latch, re-arms after the player leaves', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'imp', 0, 0);
    m.attackCd = 99;
    m.rangedCd = 99;

    mgr.tick(0.05, 5, 0, false, WALKABLE); // inside aggroRange 11
    mgr.tick(0.05, 5, 0, false, WALKABLE);
    expect(events.aggros).toEqual(['imp']); // latched, not per-frame

    mgr.tick(0.05, 14, 0, false, WALKABLE); // beyond 11 × 1.2 hysteresis
    mgr.tick(0.05, 5, 0, false, WALKABLE);
    expect(events.aggros).toEqual(['imp', 'imp']); // re-armed, fired again
  });

  test('onAggro does not fire while the player is safe', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    quietSpawn(mgr, 'imp', 0, 0);
    mgr.tick(0.05, 5, 0, true, WALKABLE);
    expect(events.aggros).toHaveLength(0);
  });

  test('onAttack fires at melee wind-up initiation (not on impact)', () => {
    const world = makeWorld();
    const fx = makeFx();
    const events = makeEvents();
    const mgr = new MonsterManager(world as never, fx as never, events);
    const m = quietSpawn(mgr, 'imp', 0, 0);
    m.attackCd = 0;

    mgr.tick(0.05, 0.8, 0, false, WALKABLE); // inside attackRange 1.0
    expect(events.attacks).toEqual(['imp']);
    expect(events.playerHits).toHaveLength(0); // wind-up, not impact
    expect(m.strikeAt).toBeGreaterThan(mgr.clock());
  });
});
