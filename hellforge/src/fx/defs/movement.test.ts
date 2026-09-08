import { describe, expect, test } from 'bun:test';
import { validateEffectDef } from '../effect-def';
import { COMBAT_EFFECT_DEFS, movementBeat, movementDef } from './index';
import {
  CAMPFIRE_SKIP_RADIUS,
  MOVE_DUST_MIN_SPEED,
  MOVE_DUST_PERIOD_S,
  shouldEmitMoveDust,
  type MoveDustGate,
} from './movement';

function particleSum(def: typeof movementDef): number {
  let n = 0;
  for (const e of def.emitters) n += e.count;
  return n;
}

const byId = (id: string) => movementDef.emitters.find((e) => e.id === id)!;

function gate(over: Partial<MoveDustGate> = {}): MoveDustGate {
  return {
    dt: MOVE_DUST_PERIOD_S,
    acc: 0,
    groundSpeed: 3.4,
    sprint: false,
    paused: false,
    dead: false,
    dodgeOwnsMove: false,
    inCamp: false,
    px: 5,
    pz: 5,
    ...over,
  };
}

describe('movementDef (N6 foot dust)', () => {
  test('passes validateEffectDef', () => {
    expect(validateEffectDef(movementDef)).toEqual({ ok: true });
  });

  test('particle sum stays within declared budget', () => {
    expect(movementDef.emitters.length).toBeLessThanOrEqual(movementDef.budget.maxEmitters);
    expect(particleSum(movementDef)).toBeLessThanOrEqual(movementDef.budget.maxParticles);
    expect(movementDef.trails.length).toBeLessThanOrEqual(movementDef.budget.maxTrails);
  });

  test('walk emitter count ≤ 2, sprint trail count ≤ 2', () => {
    expect(byId('puff').count).toBeLessThanOrEqual(2);
    expect(byId('trail').count).toBeLessThanOrEqual(2);
  });

  test('budget maxParticles is small (≤ 16)', () => {
    expect(movementDef.budget.maxParticles).toBeLessThanOrEqual(16);
  });

  test('does not appear in COMBAT_EFFECT_DEFS keys', () => {
    expect(Object.keys(COMBAT_EFFECT_DEFS)).not.toContain('movement');
    for (const def of Object.values(COMBAT_EFFECT_DEFS)) {
      expect(def).not.toBe(movementDef);
    }
  });

  test('ash smoke sprites, quieter than a dodge roll', () => {
    for (const e of movementDef.emitters) {
      expect(e.kind).toBe('sprite');
      expect(e.color).toBe('shadow');
      expect(e.sprite!.sheet).toBe('smoke');
      expect(e.sprite!.blend).toBe('premult');
      expect(e.sprite!.gy!).toBeGreaterThan(0);
    }
    const puff = byId('puff');
    const trail = byId('trail');
    expect(puff.sprite!.size).toBe(0.22);
    expect(puff.sprite!.endSize).toBe(0.45);
    expect(trail.speed!).toBeGreaterThan(puff.speed!);
    expect(trail.sprite!.life!).toBeGreaterThan(puff.sprite!.life!);
    expect(particleSum(movementDef)).toBeLessThan(6);
  });

  test('movementBeat slices puff / trail as simultaneous roots', () => {
    const walk = movementBeat(['puff']);
    expect(walk.emitters.map((e) => e.id)).toEqual(['puff']);
    expect(walk.subEmitters).toEqual([]);
    expect(validateEffectDef(walk)).toEqual({ ok: true });
    const sprint = movementBeat(['puff', 'trail']);
    expect(sprint.emitters.map((e) => e.id)).toEqual(['puff', 'trail']);
    expect(validateEffectDef(sprint)).toEqual({ ok: true });
  });
});

describe('shouldEmitMoveDust', () => {
  test('standing still → false', () => {
    const d = shouldEmitMoveDust(gate({ groundSpeed: 0, sprint: true }));
    expect(d.walk).toBe(false);
    expect(d.sprintTrail).toBe(false);
    expect(d.acc).toBe(0);
  });

  test('speed below ~0.4 m/s → false', () => {
    const justUnder = shouldEmitMoveDust(gate({ groundSpeed: MOVE_DUST_MIN_SPEED - 1e-4 }));
    expect(justUnder.walk).toBe(false);
    const atGate = shouldEmitMoveDust(gate({ groundSpeed: MOVE_DUST_MIN_SPEED }));
    expect(atGate.walk).toBe(true);
  });

  test('8Hz spacing', () => {
    const moving = gate({ dt: 0.1, acc: 0, groundSpeed: 3.4 });
    const first = shouldEmitMoveDust(moving);
    expect(first.walk).toBe(false);
    expect(first.acc).toBeCloseTo(0.1);
    const second = shouldEmitMoveDust(gate({ dt: 0.03, acc: first.acc, groundSpeed: 3.4 }));
    expect(second.walk).toBe(true);
    const tooSoon = shouldEmitMoveDust(gate({ dt: MOVE_DUST_PERIOD_S - 1e-4, acc: 0 }));
    expect(tooSoon.walk).toBe(false);
    const onBeat = shouldEmitMoveDust(gate({ dt: MOVE_DUST_PERIOD_S, acc: 0 }));
    expect(onBeat.walk).toBe(true);
  });

  test('campfire skip (in camp AND hypot < 2.2)', () => {
    const onFire = shouldEmitMoveDust(gate({
      inCamp: true, px: 0, pz: 0, groundSpeed: 3.4,
    }));
    expect(onFire.walk).toBe(false);
    const inside = shouldEmitMoveDust(gate({
      inCamp: true, px: CAMPFIRE_SKIP_RADIUS - 0.05, pz: 0, groundSpeed: 3.4,
    }));
    expect(inside.walk).toBe(false);
    const campEdge = shouldEmitMoveDust(gate({
      inCamp: true, px: 3, pz: 0, groundSpeed: 3.4,
    }));
    expect(campEdge.walk).toBe(true);
    const wildOrigin = shouldEmitMoveDust(gate({
      inCamp: false, px: 0, pz: 0, groundSpeed: 3.4,
    }));
    expect(wildOrigin.walk).toBe(true);
  });

  test('dodge skip', () => {
    const d = shouldEmitMoveDust(gate({ dodgeOwnsMove: true, groundSpeed: 5.4, sprint: true }));
    expect(d.walk).toBe(false);
    expect(d.sprintTrail).toBe(false);
  });

  test('sprint trail only with sprint flag AND moving', () => {
    const walk = shouldEmitMoveDust(gate({ sprint: false, groundSpeed: 3.4 }));
    expect(walk.walk).toBe(true);
    expect(walk.sprintTrail).toBe(false);
    const sprint = shouldEmitMoveDust(gate({ sprint: true, groundSpeed: 5.4 }));
    expect(sprint.walk).toBe(true);
    expect(sprint.sprintTrail).toBe(true);
    const sprintStill = shouldEmitMoveDust(gate({ sprint: true, groundSpeed: 0 }));
    expect(sprintStill.sprintTrail).toBe(false);
  });

  test('paused and dead reset acc and do not emit', () => {
    expect(shouldEmitMoveDust(gate({ paused: true, acc: 0.1 })).walk).toBe(false);
    expect(shouldEmitMoveDust(gate({ paused: true, acc: 0.1 })).acc).toBe(0);
    expect(shouldEmitMoveDust(gate({ dead: true, acc: 0.1 })).walk).toBe(false);
    expect(shouldEmitMoveDust(gate({ dead: true, acc: 0.1 })).acc).toBe(0);
  });

  test('hitch dt emits at most once and does not leave catch-up acc', () => {
    const d = shouldEmitMoveDust(gate({ dt: 1.0, acc: 0, groundSpeed: 3.4 }));
    expect(d.walk).toBe(true);
    expect(d.acc).toBe(0);
  });
});
