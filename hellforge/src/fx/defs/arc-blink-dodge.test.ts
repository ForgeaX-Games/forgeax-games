import { describe, expect, test } from 'bun:test';
import { validateEffectDef } from '../effect-def';
import { COMBAT_EFFECT_DEFS, combatBeat } from './index';

function particleSum(def: (typeof COMBAT_EFFECT_DEFS)['arc']): number {
  let n = 0;
  for (const e of def.emitters) n += e.count;
  return n;
}

describe('PR8 T5 — arc / blink / dodge sprite rebuilds', () => {
  test('arc impact + residue layers ride sprite primitives', () => {
    const def = COMBAT_EFFECT_DEFS.arc;
    expect(validateEffectDef(def)).toEqual({ ok: true });
    const byId = (id: string) => def.emitters.find((e) => e.id === id)!;
    // Frozen ids survive the rebuild; cast stays the geometric cue.
    expect(byId('cast').kind).toBe('pop');
    expect(byId('impact').kind).toBe('sprite');
    expect(byId('impact-burst').kind).toBe('sprite');
    // Lightning segments ride the bolt polylines; flash is the impact flipbook.
    expect(byId('impact').sprite!.sheet).toBe('impact');
    expect(byId('impact-burst').sprite!.sheet).toBe('bolt');
    // Ground scorch residue — flat premult decal; emitter life covers particle.
    const scorch = byId('impact-scorch');
    expect(scorch.kind).toBe('sprite');
    expect(scorch.sprite!.sheet).toBe('scorch');
    expect(scorch.sprite!.decal).toBe(true);
    expect(scorch.sprite!.billboard).toBe('none');
    expect(scorch.sprite!.blend).toBe('premult');
    expect(scorch.life!).toBeGreaterThan(scorch.sprite!.life!);
    // The full impact beat slices as simultaneous roots and validates.
    const beat = combatBeat('arc', ['impact', 'impact-burst', 'impact-scorch']);
    expect(beat.emitters.map((e) => e.id)).toEqual([
      'impact', 'impact-burst', 'impact-scorch',
    ]);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
    // L4 — per-effect particle demand stays well under the 64 ceiling.
    expect(particleSum(def)).toBeLessThanOrEqual(64);
  });

  test('blink depart/arrive are shadow sprite flashes', () => {
    const def = COMBAT_EFFECT_DEFS.blink;
    expect(validateEffectDef(def)).toEqual({ ok: true });
    const byId = (id: string) => def.emitters.find((e) => e.id === id)!;
    // main.ts tryBlink plays each id as a single-emitter beat — one sprite each.
    expect(def.emitters).toHaveLength(2);
    expect(byId('depart').kind).toBe('sprite');
    expect(byId('arrive').kind).toBe('sprite');
    expect(byId('depart').sprite!.sheet).toBe('smoke');
    expect(byId('arrive').sprite!.sheet).toBe('glow');
    for (const e of def.emitters) expect(e.color).toBe('shadow');
    for (const id of ['depart', 'arrive'] as const) {
      const beat = combatBeat('blink', [id]);
      expect(beat.emitters).toHaveLength(1);
      expect(validateEffectDef(beat)).toEqual({ ok: true });
    }
    expect(particleSum(def)).toBeLessThanOrEqual(64);
  });

  test('dodge puff is a single sprite wisp within PR2a L7 ceilings', () => {
    const def = COMBAT_EFFECT_DEFS.dodge;
    expect(validateEffectDef(def)).toEqual({ ok: true });
    // Hard constraint: ≤1 emitter and ≤80 particles (def + declared budget).
    expect(def.emitters.length).toBeLessThanOrEqual(1);
    expect(particleSum(def)).toBeLessThanOrEqual(80);
    expect(def.budget.maxEmitters).toBeLessThanOrEqual(1);
    expect(def.budget.maxParticles).toBeLessThanOrEqual(80);
    const puff = def.emitters.find((e) => e.id === 'puff')!;
    expect(puff.kind).toBe('sprite');
    expect(puff.color).toBe('shadow');
    expect(puff.sprite!.sheet).toBe('smoke');
    // Roll-start / mid-roll drip beat slices whole and validates.
    const beat = combatBeat('dodge', ['puff']);
    expect(beat.emitters).toHaveLength(1);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
  });
});
