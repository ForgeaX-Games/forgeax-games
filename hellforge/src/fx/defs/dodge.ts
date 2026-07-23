// Dodge roll — PR2a gap (no particles today). Single modest shadow puff (L7: ≤1 / ≤80).

import type { EffectDef } from '../effect-def';

export const dodgeDef: EffectDef = {
  emitters: [
    { id: 'puff', kind: 'rise', color: 'shadow', count: 12, spread: 0.4 },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // L7: ≤1 emitter / ≤80 particles
  budget: { maxEmitters: 1, maxParticles: 80, maxTrails: 0 },
};
