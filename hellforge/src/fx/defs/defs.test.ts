import { describe, expect, test } from 'bun:test';
import { validateEffectDef } from '../effect-def';
import { COMBAT_EFFECT_DEFS, combatBeat, type CombatEffectId } from './index';

function particleSum(def: (typeof COMBAT_EFFECT_DEFS)[CombatEffectId]): number {
  let n = 0;
  for (const e of def.emitters) n += e.count;
  return n;
}

const IDS = Object.keys(COMBAT_EFFECT_DEFS) as CombatEffectId[];

describe('COMBAT_EFFECT_DEFS', () => {
  test('registry has the six combat ids', () => {
    expect(IDS.sort()).toEqual(
      ['arc', 'blink', 'dodge', 'frost', 'inferno-nova', 'magma'].sort(),
    );
  });

  for (const id of IDS) {
    test(`${id} passes validateEffectDef`, () => {
      const result = validateEffectDef(COMBAT_EFFECT_DEFS[id]);
      expect(result).toEqual({ ok: true });
    });

    test(`${id} stays within declared budget`, () => {
      const def = COMBAT_EFFECT_DEFS[id];
      expect(def.emitters.length).toBeLessThanOrEqual(def.budget.maxEmitters);
      expect(particleSum(def)).toBeLessThanOrEqual(def.budget.maxParticles);
      expect(def.trails.length).toBeLessThanOrEqual(def.budget.maxTrails);
    });
  }

  test('inferno-nova respects PR2a L7 finisher ceilings', () => {
    const def = COMBAT_EFFECT_DEFS['inferno-nova'];
    expect(def.budget.maxEmitters).toBeLessThanOrEqual(3);
    expect(def.budget.maxParticles).toBeLessThanOrEqual(400);
    expect(def.emitters.length).toBeLessThanOrEqual(3);
    expect(particleSum(def)).toBeLessThanOrEqual(400);
  });

  test('dodge respects PR2a L7 roll ceilings', () => {
    const def = COMBAT_EFFECT_DEFS.dodge;
    expect(def.budget.maxEmitters).toBeLessThanOrEqual(1);
    expect(def.budget.maxParticles).toBeLessThanOrEqual(80);
    expect(def.emitters.length).toBeLessThanOrEqual(1);
    expect(particleSum(def)).toBeLessThanOrEqual(80);
  });

  test('combatBeat slices emitters as simultaneous roots (no catalog subs)', () => {
    const beat = combatBeat('magma', ['impact', 'impact-burst']);
    expect(beat.emitters.map((e) => e.id)).toEqual(['impact', 'impact-burst']);
    expect(beat.subEmitters).toEqual([]);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
  });

  test('combatBeat blink depart/arrive are independent single-emitter defs', () => {
    const depart = combatBeat('blink', ['depart']);
    const arrive = combatBeat('blink', ['arrive']);
    expect(depart.emitters).toHaveLength(1);
    expect(arrive.emitters).toHaveLength(1);
    expect(depart.emitters[0]!.id).toBe('depart');
    expect(arrive.emitters[0]!.id).toBe('arrive');
  });

  test('rise emitters declare spread (FxSystem.rise 6th arg), not speed', () => {
    const rises = [
      COMBAT_EFFECT_DEFS.frost.emitters.find((e) => e.id === 'cast-rise'),
      COMBAT_EFFECT_DEFS.blink.emitters.find((e) => e.id === 'depart'),
      COMBAT_EFFECT_DEFS.dodge.emitters.find((e) => e.id === 'puff'),
      COMBAT_EFFECT_DEFS['inferno-nova'].emitters.find((e) => e.id === 'damage-rise'),
    ];
    for (const e of rises) {
      expect(e).toBeDefined();
      expect(e!.kind).toBe('rise');
      expect(e!.spread).toBeGreaterThan(0);
      expect(e!.speed).toBeUndefined();
    }
    expect(COMBAT_EFFECT_DEFS.magma.emitters.find((e) => e.id === 'cast')!.size).toBe(0.22);
    expect(
      COMBAT_EFFECT_DEFS['inferno-nova'].emitters.find((e) => e.id === 'damage-rise')!.spread,
    ).toBe(1.4);
  });
});
