import { describe, expect, test } from 'bun:test';
import { validateEffectDef } from '../effect-def';
import { COMBAT_EFFECT_DEFS, combatBeat } from './index';

// PR8 T6 — inferno-nova finisher structural assertions (style of defs.test.ts).
const def = COMBAT_EFFECT_DEFS['inferno-nova'];
const byId = (id: string) => def.emitters.find((e) => e.id === id)!;

function particleSum(): number {
  let n = 0;
  for (const e of def.emitters) n += e.count;
  return n;
}

describe('inferno-nova def (PR8 T6)', () => {
  test('passes validateEffectDef', () => {
    expect(validateEffectDef(def)).toEqual({ ok: true });
  });

  test('keeps the FROZEN three-emitter contract (PR2a L7)', () => {
    expect(def.emitters.map((e) => e.id)).toEqual([
      'damage-pop', 'damage-burst', 'damage-rise',
    ]);
    expect(def.emitters.length).toBeLessThanOrEqual(3);
    expect(particleSum()).toBeLessThanOrEqual(400);
    expect(def.budget.maxEmitters).toBeLessThanOrEqual(3);
    expect(def.budget.maxParticles).toBeLessThanOrEqual(400);
    // L4 default ceiling: the finisher stays tasteful (tens, not hundreds).
    expect(particleSum()).toBeLessThanOrEqual(64);
  });

  test('damage-pop is the big impact flipbook flash', () => {
    const pop = byId('damage-pop');
    expect(pop.kind).toBe('sprite');
    expect(pop.sprite!.sheet).toBe('impact');
    expect(pop.sprite!.loop).toBe(false);
    expect(pop.sprite!.blend).toBe('additive');
    expect(pop.count).toBe(1);
    // The finisher punch — the loudest flash in the game (2.0–2.6 band).
    expect(pop.sprite!.size!).toBeGreaterThanOrEqual(2.0);
    expect(pop.sprite!.size!).toBeLessThanOrEqual(2.6);
  });

  test('damage-burst is a hot spark burst', () => {
    const burst = byId('damage-burst');
    expect(burst.kind).toBe('sprite');
    expect(burst.sprite!.sheet).toBe('spark');
    expect(burst.sprite!.blend).toBe('additive');
    expect(burst.speed).toBeGreaterThan(0);
  });

  test('damage-rise is the buoyant ember aftermath (T6 sprite flip)', () => {
    const rise = byId('damage-rise');
    expect(rise.kind).toBe('sprite');
    expect(rise.sprite!.sheet).toBe('spark');
    // Buoyant — positive gy floats the embers up; particle life covered by emitter life.
    expect(rise.sprite!.gy!).toBeGreaterThan(0);
    expect(rise.life!).toBeGreaterThan(rise.sprite!.life!);
  });

  test('call-site beat slices validate', () => {
    // skills.ts #applyFinisherDamageAt: pop+burst at y=1.0, rise at y=0.2.
    const stamp = combatBeat('inferno-nova', ['damage-pop', 'damage-burst']);
    expect(stamp.emitters.map((e) => e.id)).toEqual(['damage-pop', 'damage-burst']);
    expect(stamp.subEmitters).toEqual([]);
    expect(validateEffectDef(stamp)).toEqual({ ok: true });
    const rise = combatBeat('inferno-nova', ['damage-rise']);
    expect(rise.emitters).toHaveLength(1);
    expect(validateEffectDef(rise)).toEqual({ ok: true });
  });
});
