import { regionWeights, warpedField, type V3 } from './surface';
import type { PSRegion } from './terrain-plan';

export type { PSRegion } from './terrain-plan';

export function regionAt(p: V3): Record<PSRegion, number> {
  return regionWeights(p);
}

export function argmaxRegionOrOcean(p: V3): PSRegion | 'ocean' {
  if (warpedField(p) <= 0) return 'ocean';
  const weights = regionAt(p);
  let best: PSRegion = 'iceCap';
  for (const region of Object.keys(weights) as PSRegion[]) {
    if (weights[region] > weights[best]) best = region;
  }
  return best;
}
