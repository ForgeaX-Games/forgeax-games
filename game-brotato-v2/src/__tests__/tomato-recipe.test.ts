import { describe, expect, it } from 'vitest';
import { TOMATO_RECIPE } from '../../assets/lib/actors/tomato.ts';

describe('Brotato v2 M1 tomato recipe', () => {
  it('keeps body materials in body, stem, and eye slots', () => {
    expect(TOMATO_RECIPE.materialSlots).toEqual(['body', 'stem', 'eye', 'sole']);
    expect(TOMATO_RECIPE.body.every((part) => part.materialSlot >= 0 && part.materialSlot <= 2)).toBe(true);
    expect(TOMATO_RECIPE.limbs.every((limb) => limb.parts.every((part) => part.materialSlot === 0 || part.materialSlot === 3))).toBe(true);
  });

  it('mirrors floating limbs and alternates their animation phase', () => {
    expect(TOMATO_RECIPE.limbs).toHaveLength(4);
    const [handL, handR, footL, footR] = TOMATO_RECIPE.limbs;
    expect(handL?.anchor[0]).toBeCloseTo(-(handR?.anchor[0] ?? 0), 6);
    expect(footL?.anchor[0]).toBeCloseTo(-(footR?.anchor[0] ?? 0), 6);
    expect((handR?.motion.phase ?? 0) - (handL?.motion.phase ?? 0)).toBeCloseTo(Math.PI, 6);
    expect((footR?.motion.phase ?? 0) - (footL?.motion.phase ?? 0)).toBeCloseTo(Math.PI, 6);
  });

  it('places the scaled foot sphere exactly on the ground through groundOffset', () => {
    const foot = TOMATO_RECIPE.limbs.find((limb) => limb.id === 'foot-l');
    const part = foot?.parts[0];
    expect(part?.shape.kind).toBe('sphere');
    if (part?.shape.kind !== 'sphere') return;
    const localBottom = (foot?.anchor[1] ?? 0) - part.shape.radius * (part.scale?.[1] ?? 1);
    expect(TOMATO_RECIPE.groundOffset).toBeCloseTo(localBottom, 6);
  });
});
