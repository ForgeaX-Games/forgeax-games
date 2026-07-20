import { describe, expect, test } from 'bun:test';
import { FxLifecycleTracker } from './fx-lifecycle';
import { resolveSkill, shatterShardCount } from './skill-resolver';

describe('FxLifecycleTracker', () => {
  test('slow markers begin/end with status keys and expire by clock', () => {
    const t = new FxLifecycleTracker();
    t.beginSlow('m-1', 10);
    t.beginSlow('m-2', 12);
    expect(t.snapshot().slowMarkers).toBe(2);
    expect(t.hasSlow('m-1')).toBe(true);

    // Refresh extends, never shortens.
    t.beginSlow('m-1', 9);
    expect(t.slowUntil('m-1')).toBe(10);
    t.beginSlow('m-1', 14);
    expect(t.slowUntil('m-1')).toBe(14);

    expect(t.endSlow('m-2')).toBe(true);
    expect(t.hasSlow('m-2')).toBe(false);

    const expired = t.expireSlows(14);
    expect(expired).toEqual(['m-1']);
    expect(t.snapshot().slowMarkers).toBe(0);
  });

  test('clearAll resets projectiles, particles, and slows (cleanup seam)', () => {
    const t = new FxLifecycleTracker();
    t.setProjectiles(3);
    t.setParticles(12);
    t.beginSlow('m-9', 99);
    t.clearAll();
    expect(t.snapshot()).toEqual({
      projectiles: 0,
      particles: 0,
      slowMarkers: 0,
      effects: 0,
    });
  });

  test('effects sum tracks active projectile + particle + slow counts', () => {
    const t = new FxLifecycleTracker();
    t.setProjectiles(2);
    t.setParticles(5);
    t.beginSlow('a', 1);
    t.beginSlow('b', 1);
    expect(t.snapshot().effects).toBe(9);
  });
});

describe('Shatter VFX gate (resolver authority)', () => {
  test('shatterShardCount is 0 until Shatter is learned', () => {
    const base = resolveSkill('frost', { skillRanks: { 'frost-fang': 2 } });
    expect(shatterShardCount(base)).toBe(0);

    const withShatter = resolveSkill('frost', {
      skillRanks: { 'frost-fang': 2, 'piercing-ice': 1, shatter: 2 },
    });
    expect(shatterShardCount(withShatter)).toBe(3);
  });
});
