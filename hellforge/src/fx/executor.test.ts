import { afterEach, describe, expect, test } from 'bun:test';
import { FX_DEV_ASSERTS, setFxDevAsserts } from './budget';
import type { EffectColor, EffectDef, EmitterDef, SpriteDef } from './effect-def';
import {
  EffectExecutor,
  type EffectHandle,
  type FxSpawnLease,
  type FxSpawnPort,
} from './executor';

const originalFxDevAsserts = FX_DEV_ASSERTS;
afterEach(() => {
  setFxDevAsserts(originalFxDevAsserts);
});

type SpawnCall =
  | { kind: 'burst'; x: number; y: number; z: number; color: EffectColor; count?: number; speed?: number }
  | { kind: 'pop'; x: number; y: number; z: number; color: EffectColor; size?: number }
  | { kind: 'rise'; x: number; y: number; z: number; color: EffectColor; count?: number; spread?: number }
  | { kind: 'sprite'; x: number; y: number; z: number; color: EffectColor; count: number; speed: number | undefined; def: SpriteDef };

function makeLease(onDispose: () => void): FxSpawnLease {
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      onDispose();
    },
  };
}

function recordingPort(): FxSpawnPort & { calls: SpawnCall[]; disposeCount: number } {
  const calls: SpawnCall[] = [];
  const port = {
    calls,
    disposeCount: 0,
    burst(x: number, y: number, z: number, color: EffectColor, count?: number, speed?: number) {
      calls.push({ kind: 'burst', x, y, z, color, count, speed });
      return makeLease(() => { port.disposeCount++; });
    },
    pop(x: number, y: number, z: number, color: EffectColor, size?: number) {
      calls.push({ kind: 'pop', x, y, z, color, size });
      return makeLease(() => { port.disposeCount++; });
    },
    rise(x: number, y: number, z: number, color: EffectColor, count?: number, spread?: number) {
      calls.push({ kind: 'rise', x, y, z, color, count, spread });
      return makeLease(() => { port.disposeCount++; });
    },
    sprite(
      x: number, y: number, z: number,
      color: EffectColor, count: number, speed: number | undefined, def: SpriteDef,
    ) {
      calls.push({ kind: 'sprite', x, y, z, color, count, speed, def });
      return makeLease(() => { port.disposeCount++; });
    },
  };
  return port;
}

function def(overrides: Partial<EffectDef> & { emitters: readonly EmitterDef[] }): EffectDef {
  return {
    behaviors: [],
    trails: [],
    subEmitters: [],
    budget: { maxEmitters: 8, maxParticles: 128, maxTrails: 4 },
    ...overrides,
  };
}

describe('EffectExecutor', () => {
  test('play spawns root emitters via port; activeCount tracks instances', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const handle = ex.play(
      def({
        emitters: [
          { id: 'impact', kind: 'burst', color: 'ice', count: 5, speed: 2.5 },
          { id: 'flash', kind: 'pop', color: 'ice', count: 1, size: 0.4 },
        ],
      }),
      { x: 1, y: 2, z: 3 },
    );
    expect(handle).not.toBeNull();
    expect(ex.activeCount()).toBe(1);
    expect(port.calls).toEqual([
      { kind: 'burst', x: 1, y: 2, z: 3, color: 'ice' as EffectColor, count: 5, speed: 2.5 },
      { kind: 'pop', x: 1, y: 2, z: 3, color: 'ice' as EffectColor, size: 0.4 },
    ]);
  });

  test('rise passes spread (not speed) to the spawn port', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const handle = ex.play(
      def({
        emitters: [
          { id: 'embers', kind: 'rise', color: 'fire', count: 6, spread: 1.4 },
        ],
      }),
      { x: 0, y: 0.2, z: 0 },
    );
    expect(handle).not.toBeNull();
    expect(port.calls).toEqual([
      {
        kind: 'rise',
        x: 0,
        y: 0.2,
        z: 0,
        color: 'fire' as EffectColor,
        count: 6,
        spread: 1.4,
      },
    ]);
  });

  test('acquire/release ×10k churn → active returns to 0; no leaked handles', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const effect = def({
      emitters: [{ id: 'a', kind: 'rise', color: 'fire', count: 3, life: 0.5 }],
    });

    for (let i = 0; i < 10_000; i++) {
      const h = ex.play(effect, { x: 0, y: 0, z: 0 });
      expect(h).not.toBeNull();
      ex.release(h!);
    }

    expect(ex.activeCount()).toBe(0);
    expect(ex.stats().activeEmitters).toBe(0);
    expect(ex.stats().activeParticles).toBe(0);
    expect(ex.stats().activeTrails).toBe(0);
    // The internal slot is reusable; the opaque public token remains unique.
    const after = ex.play(effect, { x: 0, y: 0, z: 0 });
    expect(after).not.toBeNull();
    ex.release(after!);
    expect(ex.activeCount()).toBe(0);
  });

  test('sub-emitter tree fires once and leaves no orphans after 10k churn', () => {
    let spawnCount = 0;
    const noopLease = (): FxSpawnLease => makeLease(() => {});
    const ex = new EffectExecutor({
      burst() { spawnCount++; return noopLease(); },
      pop() { spawnCount++; return noopLease(); },
      rise() { spawnCount++; return noopLease(); },
      sprite() { spawnCount++; return noopLease(); },
    });
    const effect = def({
      emitters: [
        { id: 'parent', kind: 'burst', color: 'gold', count: 1, life: 0.01 },
        { id: 'spawn-child', kind: 'rise', color: 'gold', count: 1, life: 0.01 },
        { id: 'age-child', kind: 'pop', color: 'gold', count: 1, life: 0.01 },
        { id: 'death-child', kind: 'burst', color: 'gold', count: 1, life: 0.01 },
      ],
      subEmitters: [
        {
          id: 'spawn',
          parentEmitterId: 'parent',
          childEmitterId: 'spawn-child',
          trigger: 'onSpawn',
        },
        {
          id: 'age',
          parentEmitterId: 'parent',
          childEmitterId: 'age-child',
          trigger: 'atAge',
          atAge: 0.005,
        },
        {
          id: 'death',
          parentEmitterId: 'parent',
          childEmitterId: 'death-child',
          trigger: 'onDeath',
        },
      ],
      trails: [{ id: 'trail' }],
    });

    for (let i = 0; i < 10_000; i++) {
      expect(ex.play(effect, { x: 0, y: 0, z: 0 })).not.toBeNull();
      ex.tick(0.006);
      ex.tick(0.006);
      ex.tick(0.02);
    }

    expect(spawnCount).toBe(40_000);
    expect(ex.activeCount()).toBe(0);
    expect(ex.stats().activeEmitters).toBe(0);
    expect(ex.stats().activeParticles).toBe(0);
    expect(ex.stats().activeTrails).toBe(0);
    expect(ex.stats().budgetRejects).toBe(0);
  });

  test('stale handle cannot release a live instance in a recycled slot', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const effect = def({
      emitters: [{ id: 'a', kind: 'rise', color: 'fire', count: 3, life: 0.5 }],
    });

    const stale = ex.play(effect, { x: 0, y: 0, z: 0 });
    expect(stale).not.toBeNull();
    ex.releaseAll();

    const live = ex.play(effect, { x: 1, y: 0, z: 0 });
    expect(live).not.toBeNull();
    ex.release(stale!);

    expect(ex.activeCount()).toBe(1);
    expect(ex.stats().activeEmitters).toBe(1);
    expect(ex.stats().activeParticles).toBe(3);

    ex.release(live!);
    expect(ex.activeCount()).toBe(0);
  });

  test('subEmitter onDeath fires child once; release parent releases whole tree exactly once', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const handle = ex.play(
      def({
        emitters: [
          { id: 'parent', kind: 'burst', color: 'gold', count: 4, life: 0.2 },
          { id: 'child', kind: 'pop', color: 'gold', count: 1, size: 0.3, life: 0.1 },
        ],
        subEmitters: [
          {
            id: 'death-pop',
            parentEmitterId: 'parent',
            childEmitterId: 'child',
            trigger: 'onDeath',
          },
        ],
      }),
      { x: 0, y: 1, z: 0 },
    );
    expect(handle).not.toBeNull();
    // Root only — child is not a root.
    expect(port.calls.filter((c) => c.kind === 'burst')).toHaveLength(1);
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(0);

    ex.tick(0.25); // parent dies → onDeath fires child once
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(1);
    // A child born during this tick starts at age 0; it must not consume the
    // full parent-frame dt and auto-release before its owner can release it.
    expect(ex.activeCount()).toBe(1);
    expect(ex.stats().activeEmitters).toBe(1);
    expect(ex.stats().activeParticles).toBe(1);

    const beforeReleaseCalls = port.calls.length;
    const beforeDispose = port.disposeCount;
    ex.release(handle!);
    expect(ex.activeCount()).toBe(0);
    expect(ex.stats().activeEmitters).toBe(0);
    expect(ex.stats().activeParticles).toBe(0);
    // Release disposes presentation leases; no extra spawns.
    expect(port.calls.length).toBe(beforeReleaseCalls);
    expect(port.disposeCount).toBe(beforeDispose + beforeReleaseCalls);

    // Second release is a no-op (leases already disposed).
    ex.release(handle!);
    expect(ex.activeCount()).toBe(0);
    expect(port.calls.length).toBe(beforeReleaseCalls);
    expect(port.disposeCount).toBe(beforeDispose + beforeReleaseCalls);
  });

  test('release disposes every spawn lease in the ownership tree', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const handle = ex.play(
      def({
        emitters: [
          { id: 'parent', kind: 'pop', color: 'fire', count: 1, life: 0.2 },
          { id: 'child', kind: 'burst', color: 'fire', count: 3, life: 0.2 },
        ],
        subEmitters: [{
          id: 's',
          parentEmitterId: 'parent',
          childEmitterId: 'child',
          trigger: 'onSpawn',
        }],
      }),
      { x: 0, y: 0, z: 0 },
    );
    expect(handle).not.toBeNull();
    expect(port.calls.length).toBe(2); // pop + burst
    expect(port.disposeCount).toBe(0);
    ex.release(handle!);
    expect(port.disposeCount).toBe(2);
    ex.release(handle!);
    expect(port.disposeCount).toBe(2);
  });

  test('double release is safe no-op', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const h = ex.play(
      def({ emitters: [{ id: 'a', kind: 'pop', color: 'heal', count: 1 }] }),
      { x: 0, y: 0, z: 0 },
    );
    expect(h).not.toBeNull();
    ex.release(h!);
    ex.release(h!);
    ex.release(9999 as never);
    expect(ex.activeCount()).toBe(0);
  });

  test('playing a def that exceeds maxParticles rejects cleanly', () => {
    // Soft-reject path (production): asserts off → null + budgetRejects++.
    setFxDevAsserts(false);
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const h = ex.play(
      def({
        emitters: [
          { id: 'a', kind: 'burst', color: 'lightning', count: 40 },
          { id: 'b', kind: 'burst', color: 'lightning', count: 30 },
        ],
        budget: { maxEmitters: 4, maxParticles: 50, maxTrails: 2 },
      }),
      { x: 0, y: 0, z: 0 },
    );
    expect(h).toBeNull();
    expect(ex.activeCount()).toBe(0);
    expect(port.calls).toHaveLength(0);
    expect(ex.stats().budgetRejects).toBe(1);
  });

  test('budget preflight charges a child once per sub-emitter edge', () => {
    setFxDevAsserts(false);
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const h = ex.play(
      def({
        emitters: [
          { id: 'left', kind: 'burst', color: 'lightning', count: 1 },
          { id: 'right', kind: 'burst', color: 'lightning', count: 1 },
          { id: 'child', kind: 'pop', color: 'lightning', count: 4 },
        ],
        subEmitters: [
          {
            id: 'left-child',
            parentEmitterId: 'left',
            childEmitterId: 'child',
            trigger: 'onSpawn',
          },
          {
            id: 'right-child',
            parentEmitterId: 'right',
            childEmitterId: 'child',
            trigger: 'onSpawn',
          },
        ],
        // Definition sums are 3 emitters / 6 particles, but execution would
        // acquire 4 emitter instances / 10 particles.
        budget: { maxEmitters: 3, maxParticles: 6, maxTrails: 0 },
      }),
      { x: 0, y: 0, z: 0 },
    );

    expect(h).toBeNull();
    expect(ex.activeCount()).toBe(0);
    expect(port.calls).toHaveLength(0);
    expect(ex.stats().budgetRejects).toBe(1);
  });

  test('trail slots acquire/release without presentation; peaks tracked vs budget', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const h = ex.play(
      def({
        emitters: [{ id: 'a', kind: 'rise', color: 'shadow', count: 2, life: 1 }],
        trails: [{ id: 't0', width: 0.1 }, { id: 't1', life: 0.5 }],
        budget: { maxEmitters: 4, maxParticles: 64, maxTrails: 2 },
      }),
      { x: 0, y: 0, z: 0 },
    );
    expect(h).not.toBeNull();
    expect(ex.stats().activeTrails).toBe(2);
    expect(ex.stats().peakTrails).toBe(2);
    // No trail spawn API — presentation no-op.
    expect(port.calls.every((c) => c.kind !== 'custom')).toBe(true);

    ex.release(h!);
    expect(ex.stats().activeTrails).toBe(0);
  });

  test('atAge and onSpawn subEmitters fire once each', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    ex.play(
      def({
        emitters: [
          { id: 'parent', kind: 'burst', color: 'fire', count: 2, life: 1 },
          { id: 'spawnChild', kind: 'rise', color: 'fire', count: 1, life: 0.2 },
          { id: 'ageChild', kind: 'pop', color: 'fire', count: 1, life: 0.1 },
        ],
        subEmitters: [
          {
            id: 'on-spawn',
            parentEmitterId: 'parent',
            childEmitterId: 'spawnChild',
            trigger: 'onSpawn',
          },
          {
            id: 'at-age',
            parentEmitterId: 'parent',
            childEmitterId: 'ageChild',
            trigger: 'atAge',
            atAge: 0.3,
          },
        ],
      }),
      { x: 0, y: 0, z: 0 },
    );

    expect(port.calls.filter((c) => c.kind === 'burst')).toHaveLength(1);
    expect(port.calls.filter((c) => c.kind === 'rise')).toHaveLength(1); // onSpawn
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(0);

    ex.tick(0.2);
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(0);
    ex.tick(0.15); // crosses 0.3
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(1);
    ex.tick(0.5);
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(1);
  });

  test('delayed sub-emitter updates emitter and particle peaks', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    ex.play(
      def({
        emitters: [
          { id: 'parent', kind: 'burst', color: 'fire', count: 2, life: 1 },
          { id: 'child', kind: 'rise', color: 'fire', count: 5, life: 0.2 },
        ],
        subEmitters: [
          {
            id: 'at-half',
            parentEmitterId: 'parent',
            childEmitterId: 'child',
            trigger: 'atAge',
            atAge: 0.5,
          },
        ],
      }),
      { x: 0, y: 0, z: 0 },
    );

    ex.tick(0.5);
    expect(ex.stats().activeEmitters).toBe(2);
    expect(ex.stats().activeParticles).toBe(7);
    expect(ex.stats().peakEmitters).toBe(2);
    expect(ex.stats().peakParticles).toBe(7);
  });

  test('atAge zero fires once on the first positive tick', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    ex.play(
      def({
        emitters: [
          { id: 'parent', kind: 'burst', color: 'fire', count: 2, life: 1 },
          { id: 'child', kind: 'pop', color: 'fire', count: 1, life: 0.1 },
        ],
        subEmitters: [
          {
            id: 'at-zero',
            parentEmitterId: 'parent',
            childEmitterId: 'child',
            trigger: 'atAge',
            atAge: 0,
          },
        ],
      }),
      { x: 0, y: 0, z: 0 },
    );

    ex.tick(0.01);
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(1);
    ex.tick(0.01);
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(1);
  });

  test('atAge later than parent life never fires', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    ex.play(
      def({
        emitters: [
          { id: 'parent', kind: 'burst', color: 'fire', count: 2, life: 0.1 },
          { id: 'child', kind: 'pop', color: 'fire', count: 1, life: 0.1 },
        ],
        subEmitters: [
          {
            id: 'unreachable-age',
            parentEmitterId: 'parent',
            childEmitterId: 'child',
            trigger: 'atAge',
            atAge: 0.2,
          },
        ],
      }),
      { x: 0, y: 0, z: 0 },
    );

    ex.tick(1);
    expect(port.calls.filter((c) => c.kind === 'pop')).toHaveLength(0);
    expect(ex.activeCount()).toBe(0);
  });

  test('effect played during tick starts aging on the next tick', () => {
    const replacement = def({
      emitters: [
        { id: 'replacement', kind: 'rise', color: 'heal', count: 1, life: 0.1 },
      ],
    });
    let ex!: EffectExecutor;
    let replacementHandle: EffectHandle | null = null;
    const noop = (): FxSpawnLease => makeLease(() => {});
    const port: FxSpawnPort = {
      burst() { return noop(); },
      pop() {
        replacementHandle = ex.play(replacement, { x: 2, y: 0, z: 0 });
        return noop();
      },
      rise() { return noop(); },
      sprite() { return noop(); },
    };
    ex = new EffectExecutor(port);

    const trigger = ex.play(
      def({
        emitters: [
          { id: 'parent', kind: 'burst', color: 'gold', count: 1, life: 0.1 },
          { id: 'child', kind: 'pop', color: 'gold', count: 1, life: 0.1 },
        ],
        subEmitters: [
          {
            id: 'death-child',
            parentEmitterId: 'parent',
            childEmitterId: 'child',
            trigger: 'onDeath',
          },
        ],
      }),
      { x: 0, y: 0, z: 0 },
    );
    expect(trigger).not.toBeNull();

    ex.tick(0.2);
    expect(replacementHandle).not.toBeNull();
    ex.release(trigger!);
    expect(ex.activeCount()).toBe(1);

    ex.tick(0.2);
    expect(ex.activeCount()).toBe(0);
  });

  test('spawn failure rolls back the partial acquire', () => {
    const noop = (): FxSpawnLease => makeLease(() => {});
    const ex = new EffectExecutor({
      burst() {
        throw new Error('spawn failed');
      },
      pop() { return noop(); },
      rise() { return noop(); },
      sprite() { return noop(); },
    });
    const effect = def({
      emitters: [{ id: 'a', kind: 'burst', color: 'fire', count: 3 }],
      trails: [{ id: 't' }],
    });

    expect(() => ex.play(effect, { x: 0, y: 0, z: 0 })).toThrow('spawn failed');
    expect(ex.activeCount()).toBe(0);
    expect(ex.stats().activeEmitters).toBe(0);
    expect(ex.stats().activeParticles).toBe(0);
    expect(ex.stats().activeTrails).toBe(0);
  });

  test('auto-releases when all emitters in the tree are done', () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    ex.play(
      def({
        emitters: [{ id: 'a', kind: 'pop', color: 'ice', count: 1, life: 0.1 }],
      }),
      { x: 0, y: 0, z: 0 },
    );
    expect(ex.activeCount()).toBe(1);
    ex.tick(0.05);
    expect(ex.activeCount()).toBe(1);
    ex.tick(0.1);
    expect(ex.activeCount()).toBe(0);
  });

  test("case 'sprite' presents via the sprite port; release disposes its lease (PR8 T1)", () => {
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const sprite: SpriteDef = { sheet: 'flame', fps: 12, blend: 'additive', billboard: 'spherical' };
    const handle = ex.play(
      def({
        emitters: [
          { id: 'flames', kind: 'sprite', color: 'fire', count: 4, speed: 2.2, life: 0.2, sprite },
        ],
      }),
      { x: 1, y: 0.5, z: 2 },
    );
    expect(handle).not.toBeNull();
    expect(port.calls).toEqual([
      { kind: 'sprite', x: 1, y: 0.5, z: 2, color: 'fire' as EffectColor, count: 4, speed: 2.2, def: sprite },
    ]);
    expect(port.disposeCount).toBe(0);
    ex.release(handle!);
    expect(port.disposeCount).toBe(1);
    // Double release stays a safe no-op.
    ex.release(handle!);
    expect(port.disposeCount).toBe(1);
  });

  test('sprite emitter without a sprite block degrades to a no-op presentation', () => {
    // Unvalidated def — play() only budget-checks; the port must not throw.
    const port = recordingPort();
    const ex = new EffectExecutor(port);
    const handle = ex.play(
      def({
        emitters: [
          { id: 'broken', kind: 'sprite', color: 'fire', count: 1 },
        ],
      }),
      { x: 0, y: 0, z: 0 },
    );
    expect(handle).not.toBeNull();
    expect(port.calls).toHaveLength(0);
    ex.release(handle!);
  });
});
