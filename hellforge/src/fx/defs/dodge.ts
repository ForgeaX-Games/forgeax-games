// Dodge roll — PR8 T5 sprite rebuild: shadow smoke wisp (L7: ≤1 emitter / ≤80).
// Played at roll start (main.ts tryStartDodge site) and dripped mid-roll
// (tickDodge movement marks) — keep the count low, the beat replays per roll.

import type { EffectDef } from '../effect-def';

export const dodgeDef: EffectDef = {
  emitters: [
    {
      id: 'puff', kind: 'sprite', color: 'shadow', count: 6, speed: 0.7,
      sprite: {
        sheet: 'smoke', fps: 6, loop: true,
        blend: 'premult', billboard: 'spherical',
        size: 0.35, endSize: 0.75, fadeOutFrac: 0.5, gy: 0.8,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // L7: ≤1 emitter / ≤80 particles · 1 emitter · 6 particles
  budget: { maxEmitters: 1, maxParticles: 80, maxTrails: 0 },
};
