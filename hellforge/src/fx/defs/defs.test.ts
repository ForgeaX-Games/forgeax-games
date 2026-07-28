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
  test('registry has the eleven combat ids', () => {
    expect(IDS.sort()).toEqual(
      [
        'arc', 'blink', 'death-dissolve', 'death-dissolve-boss',
        'dodge', 'frost', 'hit-arc', 'hit-fire', 'hit-frost',
        'inferno-nova', 'magma',
      ].sort(),
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

  test('death-dissolve respects PR8 T7 feedback-layer ceilings', () => {
    const def = COMBAT_EFFECT_DEFS['death-dissolve'];
    expect(def.budget.maxEmitters).toBeLessThanOrEqual(3);
    expect(def.budget.maxParticles).toBeLessThanOrEqual(28);
    expect(def.budget.maxTrails).toBe(0);
    expect(def.emitters.length).toBeLessThanOrEqual(3);
    expect(particleSum(def)).toBeLessThanOrEqual(28);
    // Boss variant shares the layer — its ceiling scales with the ×1.6 counts.
    const boss = COMBAT_EFFECT_DEFS['death-dissolve-boss'];
    expect(boss.budget.maxParticles).toBeLessThanOrEqual(40);
    expect(particleSum(boss)).toBeLessThanOrEqual(40);
    // All emitters are sprite-kind (skinned GLB corpses can't shader-erode).
    for (const e of def.emitters) expect(e.kind).toBe('sprite');
  });

  test('death-dissolve-boss scales counts ×1.6 and flash size', () => {
    const base = COMBAT_EFFECT_DEFS['death-dissolve'];
    const boss = COMBAT_EFFECT_DEFS['death-dissolve-boss'];
    expect(boss.emitters.map((e) => e.id)).toEqual(base.emitters.map((e) => e.id));
    const byId = (def: typeof base, id: string) =>
      def.emitters.find((e) => e.id === id)!;
    expect(byId(boss, 'dissolve-wisps').count).toBe(16);
    expect(byId(boss, 'dissolve-embers').count).toBe(22);
    expect(byId(boss, 'dissolve-flash').sprite!.size).toBe(2.2);
    expect(byId(base, 'dissolve-flash').sprite!.size).toBe(1.4);
    expect(particleSum(boss)).toBeLessThanOrEqual(boss.budget.maxParticles);
  });

  test('combatBeat death-dissolve slices the full beat as simultaneous roots', () => {
    const beat = combatBeat(
      'death-dissolve',
      ['dissolve-flash', 'dissolve-wisps', 'dissolve-embers'],
    );
    expect(beat.emitters.map((e) => e.id)).toEqual(
      ['dissolve-flash', 'dissolve-wisps', 'dissolve-embers'],
    );
    expect(beat.subEmitters).toEqual([]);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
    // Same emitter ids slice from the boss def (kill() picks the registry id).
    const bossBeat = combatBeat(
      'death-dissolve-boss',
      ['dissolve-flash', 'dissolve-wisps', 'dissolve-embers'],
    );
    expect(bossBeat.emitters).toHaveLength(3);
    expect(validateEffectDef(bossBeat)).toEqual({ ok: true });
  });

  test('combatBeat slices emitters as simultaneous roots (no catalog subs)', () => {
    const beat = combatBeat('magma', ['impact', 'impact-burst']);
    expect(beat.emitters.map((e) => e.id)).toEqual(['impact', 'impact-burst']);
    expect(beat.subEmitters).toEqual([]);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
  });

  test('magma impact + residue layers ride sprite primitives (PR8 T3)', () => {
    const def = COMBAT_EFFECT_DEFS.magma;
    const byId = (id: string) => def.emitters.find((e) => e.id === id)!;
    // Impact layer — flipbook flash / sparks / glow / smoke are all sprites.
    for (const id of ['impact', 'impact-burst', 'impact-glow', 'impact-smoke']) {
      expect(byId(id).kind).toBe('sprite');
    }
    expect(byId('impact').sprite!.sheet).toBe('impact');
    expect(byId('impact-burst').sprite!.sheet).toBe('spark');
    // Residue layer — flat ground decal whose emitter life covers the particle.
    const scorch = byId('impact-scorch');
    expect(scorch.sprite!.decal).toBe(true);
    expect(scorch.sprite!.billboard).toBe('none');
    expect(scorch.life!).toBeGreaterThan(scorch.sprite!.life!);
    // The full impact beat slices as simultaneous roots and validates.
    const beat = combatBeat('magma', [
      'impact', 'impact-burst', 'impact-glow', 'impact-smoke', 'impact-scorch',
    ]);
    expect(beat.emitters).toHaveLength(5);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
    // L4 — per-effect particle demand stays well under the 64 ceiling.
    expect(particleSum(def)).toBeLessThanOrEqual(64);
  });

  test('frost impact + residue layers ride sprite primitives (PR8 T4)', () => {
    const def = COMBAT_EFFECT_DEFS.frost;
    const byId = (id: string) => def.emitters.find((e) => e.id === id)!;
    for (const id of ['impact', 'impact-burst', 'impact-glow', 'shatter-burst', 'shatter-pop', 'shard-hit']) {
      expect(byId(id).kind).toBe('sprite');
    }
    expect(byId('impact-burst').sprite!.sheet).toBe('shard');
    expect(byId('shatter-burst').sprite!.sheet).toBe('shard');
    const residue = byId('impact-residue');
    expect(residue.sprite!.decal).toBe(true);
    expect(residue.life!).toBeGreaterThan(residue.sprite!.life!);
    // The frostImpact wrapper beat slices the four impact-layer ids.
    const beat = combatBeat('frost', ['impact', 'impact-burst', 'impact-glow', 'impact-residue']);
    expect(beat.emitters).toHaveLength(4);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
    expect(particleSum(def)).toBeLessThanOrEqual(64);
  });

  test('element hit feedbacks are element-differentiated sprites (PR8 T7)', () => {
    const fire = COMBAT_EFFECT_DEFS['hit-fire'].emitters[0]!;
    const frost = COMBAT_EFFECT_DEFS['hit-frost'].emitters[0]!;
    const arc = COMBAT_EFFECT_DEFS['hit-arc'].emitters[0]!;
    expect(fire.sprite!.sheet).toBe('spark');
    expect(frost.sprite!.sheet).toBe('shard');
    expect(arc.sprite!.sheet).toBe('bolt');
    // Distinct palettes so a side-by-side clip reads three elements (§5.4).
    expect(new Set([fire.color, frost.color, arc.color]).size).toBe(3);
    // Single-emitter feedback beats slice whole + validate.
    for (const id of ['hit-fire', 'hit-frost', 'hit-arc'] as const) {
      const def = COMBAT_EFFECT_DEFS[id];
      const beat = combatBeat(id, [def.emitters[0]!.id]);
      expect(validateEffectDef(beat)).toEqual({ ok: true });
    }
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
    // blink.depart / dodge.puff were reshaped to sprite wisps in PR8 T5 —
    // their sprite shapes are asserted in arc-blink-dodge.test.ts.
    // inferno-nova.damage-rise flipped to a buoyant sprite emitter in PR8 T6 —
    // asserted in inferno-nova.test.ts. frost.cast-rise is the last geometric rise.
    const rises = [
      COMBAT_EFFECT_DEFS.frost.emitters.find((e) => e.id === 'cast-rise'),
    ];
    for (const e of rises) {
      expect(e).toBeDefined();
      expect(e!.kind).toBe('rise');
      expect(e!.spread).toBeGreaterThan(0);
      expect(e!.speed).toBeUndefined();
    }
    expect(COMBAT_EFFECT_DEFS.magma.emitters.find((e) => e.id === 'cast')!.size).toBe(0.22);
  });
});
