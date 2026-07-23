// Phase Step — depart/arrive shadow rise motes (main.ts tryBlink).

import type { EffectDef } from '../effect-def';

export const blinkDef: EffectDef = {
  emitters: [
    { id: 'depart', kind: 'rise', color: 'shadow', count: 8, spread: 0.5 },
    { id: 'arrive', kind: 'rise', color: 'shadow', count: 8, spread: 0.5 },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // 2 emitters · 8+8 = 16 particles
  budget: { maxEmitters: 2, maxParticles: 24, maxTrails: 0 },
};
