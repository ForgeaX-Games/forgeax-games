// Arc Surge — cast pop + impact pop/burst (skills.ts non-crit defaults).

import type { EffectDef } from '../effect-def';

export const arcDef: EffectDef = {
  emitters: [
    { id: 'cast', kind: 'pop', color: 'lightning', count: 1, size: 0.22 },
    { id: 'impact', kind: 'pop', color: 'lightning', count: 1, size: 0.42 },
    { id: 'impact-burst', kind: 'burst', color: 'lightning', count: 5, speed: 3.0 },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [
    {
      id: 'impact-burst-on-death',
      parentEmitterId: 'impact',
      trigger: 'onDeath',
      childEmitterId: 'impact-burst',
    },
  ],
  // 3 emitters · 1+1+5 = 7 particles
  budget: { maxEmitters: 3, maxParticles: 16, maxTrails: 0 },
};
