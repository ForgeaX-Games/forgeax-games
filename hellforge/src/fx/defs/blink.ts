// Phase Step — PR8 T5 sprite rebuild: origin/destination flashes.
//
//   depart — shadow smoke wisp at the origin (premult, floats up)
//   arrive — shadow glow flash at the destination (additive pop)
//
// Ids are frozen and main.ts tryBlink plays each as a single-emitter beat,
// so each id is one self-contained sprite (no multi-emitter composition).
// Palette stays `shadow` (L: 影踏 reads as a darkness step, not a teleport glow).

import type { EffectDef } from '../effect-def';

export const blinkDef: EffectDef = {
  emitters: [
    {
      id: 'depart', kind: 'sprite', color: 'shadow', count: 8, speed: 0.9,
      sprite: {
        sheet: 'smoke', fps: 6, loop: true,
        blend: 'premult', billboard: 'spherical',
        size: 0.5, endSize: 0.95, fadeOutFrac: 0.45, gy: 1.4,
      },
    },
    {
      id: 'arrive', kind: 'sprite', color: 'shadow', count: 1,
      sprite: {
        sheet: 'glow', blend: 'additive', billboard: 'spherical',
        size: 0.6, endSize: 1.5, fadeOutFrac: 0.3, life: 0.55,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // 2 emitters · 8+1 = 9 particles
  budget: { maxEmitters: 2, maxParticles: 16, maxTrails: 0 },
};
