import { describe, expect, test } from 'bun:test';
import {
  validateEffectDef,
  type EffectDef,
} from './effect-def';

function minimalDef(overrides: Partial<EffectDef> = {}): EffectDef {
  return {
    emitters: [
      { id: 'impact', kind: 'burst', color: 'ice', count: 6, speed: 2.6 },
    ],
    behaviors: [],
    trails: [],
    subEmitters: [],
    budget: { maxEmitters: 4, maxParticles: 64, maxTrails: 2 },
    ...overrides,
  };
}

describe('validateEffectDef', () => {
  test('valid minimal def passes', () => {
    const result = validateEffectDef(minimalDef());
    expect(result).toEqual({ ok: true });
  });

  test('missing budget fails', () => {
    const { budget: _budget, ...noBudget } = minimalDef();
    const result = validateEffectDef(noBudget);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('budget'))).toBe(true);
    }
  });

  test('over-budget emitter count fails', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'a', kind: 'burst', color: 'fire', count: 2 },
        { id: 'b', kind: 'pop', color: 'fire', count: 1 },
        { id: 'c', kind: 'rise', color: 'fire', count: 1 },
      ],
      budget: { maxEmitters: 2, maxParticles: 64, maxTrails: 2 },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maxEmitters'))).toBe(true);
    }
  });

  test('over-budget particle sum fails', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'a', kind: 'burst', color: 'lightning', count: 40 },
        { id: 'b', kind: 'burst', color: 'lightning', count: 30 },
      ],
      budget: { maxEmitters: 4, maxParticles: 50, maxTrails: 2 },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maxParticles'))).toBe(true);
    }
  });

  test('over-budget trails fails', () => {
    const result = validateEffectDef(minimalDef({
      trails: [
        { id: 't0', width: 0.1 },
        { id: 't1', width: 0.1 },
        { id: 't2', width: 0.1 },
      ],
      budget: { maxEmitters: 4, maxParticles: 64, maxTrails: 2 },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('maxTrails'))).toBe(true);
    }
  });

  test('bad emitter shape fails', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        // missing kind / color / count
        { id: 'broken' } as unknown as EffectDef['emitters'][number],
      ],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('kind'))).toBe(true);
      expect(result.errors.some((e) => e.includes('color'))).toBe(true);
      expect(result.errors.some((e) => e.includes('count'))).toBe(true);
    }
  });

  test('subEmitter refs must point at emitter ids', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'parent', kind: 'burst', color: 'gold', count: 4 },
        { id: 'child', kind: 'pop', color: 'gold', count: 1 },
      ],
      subEmitters: [
        {
          id: 'spawn-child',
          parentEmitterId: 'parent',
          childEmitterId: 'missing-child',
          trigger: 'onDeath',
        },
      ],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('childEmitterId'))).toBe(true);
    }
  });

  test('valid subEmitter refs pass', () => {
    const result = validateEffectDef(minimalDef({
      emitters: [
        { id: 'parent', kind: 'burst', color: 'shadow', count: 4 },
        { id: 'child', kind: 'pop', color: 'shadow', count: 1, size: 0.3 },
      ],
      subEmitters: [
        {
          id: 'on-death',
          parentEmitterId: 'parent',
          childEmitterId: 'child',
          trigger: 'onDeath',
        },
        {
          id: 'at-half',
          parentEmitterId: 'parent',
          childEmitterId: 'child',
          trigger: 'atAge',
          atAge: 0.5,
        },
      ],
      customStep: 'finisherPulse',
    }));
    expect(result).toEqual({ ok: true });
  });
});

describe('validateEffectDef — sprite emitters (PR8 T1)', () => {
  function spriteDef(emitters: unknown[]): ReturnType<typeof validateEffectDef> {
    return validateEffectDef(minimalDef({
      emitters: emitters as unknown as EffectDef['emitters'],
    }));
  }

  test('valid full sprite emitter passes', () => {
    const result = spriteDef([{
      id: 'flames',
      kind: 'sprite',
      color: 'fire',
      count: 4,
      speed: 1.2,
      life: 0.9,
      sprite: {
        sheet: 'flame',
        fps: 12,
        loop: true,
        blend: 'additive',
        billboard: 'spherical',
        distort: 0.06,
        size: 0.4,
        endSize: 0.6,
        fadeOutFrac: 0.55,
      },
    }]);
    expect(result).toEqual({ ok: true });
  });

  test('valid minimal sprite emitter (sheet only) passes', () => {
    const result = spriteDef([{
      id: 'glow',
      kind: 'sprite',
      color: 'gold',
      count: 1,
      sprite: { sheet: 'glow' },
    }]);
    expect(result).toEqual({ ok: true });
  });

  test('kind sprite without a sprite block fails', () => {
    const result = spriteDef([{ id: 'broken', kind: 'sprite', color: 'fire', count: 2 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.sprite is required'))).toBe(true);
    }
  });

  test('sprite.sheet must be a non-empty string', () => {
    const result = spriteDef([{
      id: 'broken', kind: 'sprite', color: 'fire', count: 1, sprite: { sheet: '' },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.sheet'))).toBe(true);
    }
  });

  test('bad blend fails', () => {
    const result = spriteDef([{
      id: 'broken', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'glow', blend: 'screen' },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.blend'))).toBe(true);
    }
  });

  test('bad billboard fails', () => {
    const result = spriteDef([{
      id: 'broken', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'glow', billboard: 'cylindrical-ish' },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.billboard'))).toBe(true);
    }
  });

  test('negative fps fails', () => {
    const result = spriteDef([{
      id: 'broken', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'impact', fps: -12 },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.fps'))).toBe(true);
    }
  });

  test('negative numeric sprite fields fail', () => {
    for (const key of ['distort', 'size', 'endSize', 'fadeOutFrac'] as const) {
      const result = spriteDef([{
        id: 'broken', kind: 'sprite', color: 'fire', count: 1,
        sprite: { sheet: 'glow', [key]: -0.1 },
      }]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes(`.${key}`))).toBe(true);
      }
    }
  });

  test('non-boolean loop fails', () => {
    const result = spriteDef([{
      id: 'broken', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'glow', loop: 'yes' },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.loop'))).toBe(true);
    }
  });

  test('valid decal emitter passes (PR8 T3 residue route)', () => {
    const result = spriteDef([{
      id: 'scorch', kind: 'sprite', color: 'fire', count: 1, life: 3.4,
      sprite: {
        sheet: 'scorch', blend: 'premult', billboard: 'none',
        size: 1.3, decal: true, life: 3.0, fadeOutFrac: 0.55,
      },
    }]);
    expect(result).toEqual({ ok: true });
  });

  test('negative sprite life fails', () => {
    const result = spriteDef([{
      id: 'broken', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'glow', life: -1 },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.life'))).toBe(true);
    }
  });

  test('non-boolean decal fails', () => {
    const result = spriteDef([{
      id: 'broken', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'scorch', decal: 'flat' },
    }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('.decal'))).toBe(true);
    }
  });

  test('extra unknown keys in the sprite block are tolerated', () => {
    const result = spriteDef([{
      id: 'flames', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'glow', futureField: 1, another: 'x' },
    }]);
    expect(result).toEqual({ ok: true });
  });

  test('sprite block on non-sprite kinds is tolerated (ignored)', () => {
    const result = spriteDef([{
      id: 'burst', kind: 'burst', color: 'fire', count: 2,
      sprite: { sheet: 'glow' },
    }]);
    expect(result).toEqual({ ok: true });
  });

  test('unknown sheet ids are NOT rejected here (runtime registry concern)', () => {
    const result = spriteDef([{
      id: 'flames', kind: 'sprite', color: 'fire', count: 1,
      sprite: { sheet: 'cc0-pack-not-yet-registered' },
    }]);
    expect(result).toEqual({ ok: true });
  });
});
