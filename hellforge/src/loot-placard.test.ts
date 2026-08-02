import { describe, expect, test } from 'bun:test';
import { equipmentPlacardScale } from './loot-placard';

describe('equipmentPlacardScale (N2)', () => {
  test('is a thin upright card, not a tall skinny pillar', () => {
    const rare = equipmentPlacardScale('rare');
    expect(rare.sy).toBeLessThan(1);
    expect(rare.sy / rare.sx).toBeLessThan(2.5);
    expect(rare.sz).toBeLessThan(rare.sx);
    expect(rare.sy).toBeLessThan(1.0);
  });

  test('legendary is larger but still placard-shaped', () => {
    const leg = equipmentPlacardScale('legendary');
    const rare = equipmentPlacardScale('rare');
    expect(leg.sx).toBeGreaterThan(rare.sx);
    expect(leg.sy).toBeGreaterThan(rare.sy);
    expect(leg.sy).toBeLessThan(1.0);
  });
});
