import { describe, expect, it } from 'vitest';
import { buildActorMergedMesh } from '../../assets/lib/model-kit.ts';
import { SPROUTED_POTATO_RECIPE } from '../../assets/lib/actors/sprouted-potato.ts';

describe('M2 sprouted potato recipe', () => {
  it('has three differently angled sprouts and symmetrical floating limbs', () => {
    const stalks = SPROUTED_POTATO_RECIPE.body.filter((part) => part.id.startsWith('sprout-stalk'));
    expect(stalks).toHaveLength(3);
    expect(new Set(stalks.map((part) => part.rotation?.join(','))).size).toBe(3);
    const [handL, handR, footL, footR] = SPROUTED_POTATO_RECIPE.limbs;
    expect(handL?.anchor[0]).toBeCloseTo(-(handR?.anchor[0] ?? 0), 6);
    expect(footL?.anchor[0]).toBeCloseTo(-(footR?.anchor[0] ?? 0), 6);
  });

  it('uses the merged mesh route with valid body, sprout, and eye slots', () => {
    const mesh = buildActorMergedMesh(SPROUTED_POTATO_RECIPE);
    expect(mesh.submeshes.length).toBeGreaterThan(0);
    expect(mesh.materialSlots.length).toBe(3);
    expect(SPROUTED_POTATO_RECIPE.body.every((part) => part.materialSlot >= 0 && part.materialSlot < 3)).toBe(true);
    expect(SPROUTED_POTATO_RECIPE.limbs.every((limb) => limb.parts.every((part) => part.materialSlot === 0))).toBe(true);
  });
});
