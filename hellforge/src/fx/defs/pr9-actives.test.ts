import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEffectDef, type EmitterKind } from '../effect-def';
import { COMBAT_EFFECT_DEFS, combatBeat } from './index';

/** L2 lock — must stay byte-identical to pre-PR9 EmitterKind union. */
const FROZEN_EMITTER_KINDS: readonly EmitterKind[] = [
  'burst', 'pop', 'rise', 'custom', 'sprite',
];

describe('PR9 active FX defs (L2 compose-only)', () => {
  test('effect-def.ts EmitterKind union has zero new kinds', () => {
    const src = readFileSync(
      join(import.meta.dir, '../effect-def.ts'),
      'utf8',
    );
    const m = src.match(/export type EmitterKind = ([^;]+);/);
    expect(m).toBeTruthy();
    const kinds = m![1]!
      .split('|')
      .map((s) => s.trim().replace(/'/g, ''));
    expect(kinds.sort()).toEqual([...FROZEN_EMITTER_KINDS].sort());
  });

  for (const id of ['flame-burst', 'frost-nova', 'discharge'] as const) {
    test(`${id} is registered and validates budget`, () => {
      const def = COMBAT_EFFECT_DEFS[id];
      expect(def).toBeDefined();
      expect(validateEffectDef(def)).toEqual({ ok: true });
      let particles = 0;
      for (const e of def.emitters) particles += e.count;
      expect(def.emitters.length).toBeLessThanOrEqual(def.budget.maxEmitters);
      expect(particles).toBeLessThanOrEqual(def.budget.maxParticles);
      // Every emitter kind must be from the frozen set (no sneaky new kinds).
      for (const e of def.emitters) {
        expect(FROZEN_EMITTER_KINDS).toContain(e.kind);
      }
    });
  }

  test('flame-burst combatBeat slices magma-family impact/hellfire', () => {
    const beat = combatBeat('flame-burst', [
      'impact', 'impact-burst', 'hellfire', 'hellfire-burst',
    ]);
    expect(beat.emitters.map((e) => e.id)).toEqual([
      'impact', 'impact-burst', 'hellfire', 'hellfire-burst',
    ]);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
  });

  test('frost-nova combatBeat is a full-ring frostImpact-family slice', () => {
    const beat = combatBeat('frost-nova', [
      'impact', 'impact-burst', 'shatter-burst', 'shatter-pop',
    ]);
    expect(beat.emitters).toHaveLength(4);
    expect(validateEffectDef(beat)).toEqual({ ok: true });
    // Full-ring scale: impact flash larger than base frost impact (1.0).
    const impact = beat.emitters.find((e) => e.id === 'impact')!;
    expect(impact.sprite!.size!).toBeGreaterThan(1.0);
  });

  test('discharge combatBeat reuses arc cast/impact ids', () => {
    const cast = combatBeat('discharge', ['cast']);
    const impact = combatBeat('discharge', ['impact', 'impact-burst', 'impact-scorch']);
    expect(cast.emitters.map((e) => e.id)).toEqual(['cast']);
    expect(impact.emitters.map((e) => e.id)).toEqual([
      'impact', 'impact-burst', 'impact-scorch',
    ]);
    expect(validateEffectDef(cast)).toEqual({ ok: true });
    expect(validateEffectDef(impact)).toEqual({ ok: true });
  });
});
