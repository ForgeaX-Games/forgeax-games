import { describe, expect, test } from 'bun:test';
import { validateEffectDef } from '../effect-def';
import { COMBAT_EFFECT_DEFS, combatBeat } from './index';

// PR8 T7 — Hellfire Catalyst passive-trigger feedback reskin. The skills.ts
// crit-explosion beat combatBeat('magma', ['hellfire', 'hellfire-burst']) is
// frozen: ids, counts and the onDeath wiring stay; only the primitives move
// from geometric pop/burst onto sprite sheets.

describe('magma hellfire feedback (PR8 T7)', () => {
  const def = COMBAT_EFFECT_DEFS.magma;
  const byId = (id: string) => def.emitters.find((e) => e.id === id)!;

  test('hellfire ids are preserved and ride sprite primitives', () => {
    const flash = byId('hellfire');
    const burst = byId('hellfire-burst');
    expect(flash.kind).toBe('sprite');
    expect(burst.kind).toBe('sprite');
    // Fire-tinted flipbook flash core + spark streaks (impact-layer sheets).
    expect(flash.color).toBe('fire');
    expect(burst.color).toBe('fire');
    expect(flash.sprite!.sheet).toBe('impact');
    expect(flash.sprite!.blend).toBe('additive');
    expect(burst.sprite!.sheet).toBe('spark');
    expect(burst.sprite!.blend).toBe('additive');
    expect(burst.count).toBe(20);
  });

  test('hellfire-burst-on-death sub-emitter wiring stays intact', () => {
    const sub = def.subEmitters.find((s) => s.id === 'hellfire-burst-on-death')!;
    expect(sub).toBeDefined();
    expect(sub.parentEmitterId).toBe('hellfire');
    expect(sub.trigger).toBe('onDeath');
    expect(sub.childEmitterId).toBe('hellfire-burst');
  });

  test('budget block still covers every emitter and particle', () => {
    expect(def.emitters.length).toBeLessThanOrEqual(def.budget.maxEmitters);
    let particles = 0;
    for (const e of def.emitters) particles += e.count;
    expect(particles).toBeLessThanOrEqual(def.budget.maxParticles);
    expect(validateEffectDef(def)).toEqual({ ok: true });
  });

  test('the full hellfire beat slices and validates', () => {
    const beat = combatBeat('magma', ['hellfire', 'hellfire-burst']);
    expect(beat.emitters.map((e) => e.id)).toEqual(['hellfire', 'hellfire-burst']);
    let particles = 0;
    for (const e of beat.emitters) particles += e.count;
    expect(particles).toBe(21);
    // L4 — the passive-trigger beat stays far under the 64-particle ceiling.
    expect(particles).toBeLessThanOrEqual(64);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
  });
});
