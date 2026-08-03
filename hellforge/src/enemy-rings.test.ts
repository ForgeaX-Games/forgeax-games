// N4 G2-A — enemy under-ring pool: cap, acquire/follow/release lifecycle,
// exhaustion behaviour, per-kind spec sanity. Pure logic — no engine/GPU.

import { describe, expect, test } from 'bun:test';
import {
  MAX_ENEMY_RINGS,
  ENEMY_RING_SPECS,
  createEnemyRings,
  type EnemyRingDecalSurface,
  type EnemyRings,
} from './enemy-rings';
import type { SpriteSpawnOpts } from './fx/sprite';

const KINDS = ['imp', 'ashwalker', 'charred', 'flamecaller', 'slaglord'] as const;

/** Recording persistent-decal surface (mirrors FxSystem.persistentDecalSurface). */
function makeSurface() {
  let next = 1;
  const live = new Set<number>();
  const spawns: Array<{ h: number; x: number; z: number; opts: SpriteSpawnOpts }> = [];
  const moves: Array<{ h: number; x: number; z: number }> = [];
  const releases: number[] = [];
  let failSpawns = false;
  const surface: EnemyRingDecalSurface = {
    spawnPersistentDecal(x, _y, z, opts) {
      if (failSpawns) return 0;
      const h = next++;
      live.add(h);
      spawns.push({ h, x, z, opts });
      return h;
    },
    move(h, x, _y, z) {
      moves.push({ h, x, z });
    },
    release(h) {
      live.delete(h);
      releases.push(h);
    },
  };
  return { surface, live, spawns, moves, releases, setFailSpawns: (v: boolean) => { failSpawns = v; } };
}

describe('N4 G2-A enemy under-rings', () => {
  test('per-kind spec table is complete and readable', () => {
    for (const kind of KINDS) {
      const spec = ENEMY_RING_SPECS[kind];
      expect(spec).toBeDefined();
      expect(spec.radius).toBeGreaterThan(0);
      // Ring stroke sits at 0.39·size (enemy_marker / nova convention) — size sane.
      expect(spec.radius / 0.39).toBeGreaterThan(0.5);
      // Pale violet glow: B hottest channel, R secondary, not warm orange.
      expect(spec.tint[2]).toBeGreaterThan(spec.tint[0]);
      expect(spec.tint[2]).toBeGreaterThan(1.2);
      expect(spec.tint[2]).toBeLessThan(2.0);
      expect(spec.tint[0]).toBeGreaterThan(0.5);
      expect(spec.tint[0]).toBeLessThan(1.2);
      expect(spec.tint[1]).toBeGreaterThan(0.3);
      expect(spec.tint[1]).toBeLessThan(spec.tint[0]);
      expect(spec.tint[3]).toBe(1);
      // Tight under-feet marker — not a soft arena blob.
      expect(spec.radius).toBeLessThanOrEqual(1.25);
    }
    // Boss ring is the biggest (readability at 3.5 m scale).
    expect(ENEMY_RING_SPECS.slaglord.radius).toBeGreaterThan(
      Math.max(...KINDS.filter((k) => k !== 'slaglord').map((k) => ENEMY_RING_SPECS[k]!.radius)),
    );
  });

  test('acquire spawns a persistent additive ring decal at the monster', () => {
    const { surface, spawns } = makeSurface();
    const rings: EnemyRings = createEnemyRings(surface);

    const h = rings.acquire('imp', 3, -4)!;
    expect(h).toBeGreaterThan(0);
    expect(rings.activeCount).toBe(1);
    expect(spawns).toHaveLength(1);
    const d = spawns[0]!;
    expect(d.h).toBe(h);
    expect(d.x).toBe(3);
    expect(d.z).toBe(-4);
    expect(d.opts.sheet).toBe('enemy_marker');
    expect(d.opts.blend).toBe('additive');
    expect(d.opts.loop).toBe(true);
    expect(d.opts.pulse).toBe('breath');
    expect(d.opts.size).toBeCloseTo(ENEMY_RING_SPECS.imp.radius / 0.39, 6);
    expect(d.opts.tint).toEqual(ENEMY_RING_SPECS.imp.tint);
    expect(d.opts.pos?.[0]).toBe(3);
    expect(d.opts.pos?.[2]).toBe(-4);
  });

  test('follow keeps the ring under a moving monster (knockback included)', () => {
    const { surface, moves } = makeSurface();
    const rings = createEnemyRings(surface);

    const h = rings.acquire('ashwalker', 0, 0)!;
    rings.follow(h, 1.25, 2.5);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({ h, x: 1.25, z: 2.5 });
    rings.follow(h, 1.25 + 0.05, 2.5 + 0.05);
    expect(moves).toHaveLength(2);
    expect(moves[1]!.x).toBeCloseTo(1.3, 6);
  });

  test('follow / release on unknown handles are silent no-ops', () => {
    const { surface, moves, releases } = makeSurface();
    const rings = createEnemyRings(surface);

    rings.follow(999, 1, 1);
    rings.release(999);
    expect(moves).toHaveLength(0);
    expect(releases).toHaveLength(0);
    expect(rings.activeCount).toBe(0);
  });

  test('release is exactly-once: live ring frees, second release is a no-op', () => {
    const { surface, live, releases } = makeSurface();
    const rings = createEnemyRings(surface);

    const h = rings.acquire('charred', 0, 0)!;
    expect(live.has(h)).toBe(true);
    rings.release(h);
    expect(live.has(h)).toBe(false);
    expect(releases).toEqual([h]);
    expect(rings.activeCount).toBe(0);

    rings.release(h);
    expect(releases).toEqual([h]);
    expect(rings.activeCount).toBe(0);
  });

  test('pool exhaustion: extra acquires skip silently, slots free up on release', () => {
    const { surface, spawns, releases } = makeSurface();
    const rings = createEnemyRings(surface);

    const held: number[] = [];
    for (let i = 0; i < MAX_ENEMY_RINGS; i++) {
      const h = rings.acquire('imp', i, 0);
      expect(h).toBeGreaterThan(0);
      held.push(h!);
    }
    expect(rings.activeCount).toBe(MAX_ENEMY_RINGS);
    expect(spawns).toHaveLength(MAX_ENEMY_RINGS);

    // Pool full → silent skip, no crash, nothing stolen.
    const extra = rings.acquire('slaglord', 99, 99);
    expect(extra).toBeNull();
    expect(rings.activeCount).toBe(MAX_ENEMY_RINGS);
    expect(spawns).toHaveLength(MAX_ENEMY_RINGS);

    // One slot frees → next acquire lands again.
    rings.release(held[0]!);
    expect(rings.activeCount).toBe(MAX_ENEMY_RINGS - 1);
    const again = rings.acquire('flamecaller', 50, 50);
    expect(again).toBeGreaterThan(0);
    expect(again).not.toBe(held[0]);
    expect(rings.activeCount).toBe(MAX_ENEMY_RINGS);
    expect(spawns).toHaveLength(MAX_ENEMY_RINGS + 1);

    // Drain: every release frees exactly once (the early one + the 24 held).
    for (const h of [held.slice(1), again!].flat()) rings.release(h as number);
    expect(releases).toHaveLength(MAX_ENEMY_RINGS + 1);
    expect(rings.activeCount).toBe(0);
  });

  test('spawn failure (Edit mode / registry off) returns null without counting', () => {
    const { surface, setFailSpawns } = makeSurface();
    const rings = createEnemyRings(surface);

    setFailSpawns(true);
    expect(rings.acquire('imp', 0, 0)).toBeNull();
    expect(rings.activeCount).toBe(0);

    setFailSpawns(false);
    expect(rings.acquire('imp', 0, 0)).toBeGreaterThan(0);
    expect(rings.activeCount).toBe(1);
  });
});
