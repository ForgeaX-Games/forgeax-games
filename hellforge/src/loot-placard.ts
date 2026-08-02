import type { Rarity } from './items';

/** N2 equipment placard scale — thin upright card, never a tall skinny pillar. */
export function equipmentPlacardScale(rarity: Rarity): { sx: number; sy: number; sz: number; beamTall: number } {
  const legendary = rarity === 'legendary';
  return {
    sx: legendary ? 0.34 : 0.26,
    sy: legendary ? 0.48 : 0.38,
    sz: legendary ? 0.06 : 0.05,
    beamTall: legendary ? 2.4 : 1.8,
  };
}
