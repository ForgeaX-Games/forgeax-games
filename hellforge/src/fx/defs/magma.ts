// Magma Bolt — cast pop + impact pop/burst + hellfire-explosion pop/burst.
// Counts match skills.ts call sites (non-crit defaults). Trails empty (no ribbon yet).

import type { EffectDef } from '../effect-def';

export const magmaDef: EffectDef = {
  emitters: [
    { id: 'cast', kind: 'pop', color: 'fire', count: 1, size: 0.22 },
    { id: 'impact', kind: 'pop', color: 'fire', count: 1, size: 0.5 },
    { id: 'impact-burst', kind: 'burst', color: 'fire', count: 8, speed: 3.8 },
    { id: 'hellfire', kind: 'pop', color: 'fire', count: 1, size: 0.8 },
    { id: 'hellfire-burst', kind: 'burst', color: 'fire', count: 12, speed: 4.5 },
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
    {
      id: 'hellfire-burst-on-death',
      parentEmitterId: 'hellfire',
      trigger: 'onDeath',
      childEmitterId: 'hellfire-burst',
    },
  ],
  // 5 emitters · 1+1+8+1+12 = 23 particles
  budget: { maxEmitters: 5, maxParticles: 32, maxTrails: 0 },
};
