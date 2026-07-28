// Inferno Nova finisher — PR8 T6 rebuild on sprite primitives (PR2a L7: ≤3 emitters).
//
// Full T6 composition (windup charge → shock ring → ember aftermath + scorch):
//   windup charge — fx.novaChargePuff drips from skills.ts #tickFinisher during
//                   the windup phase; outside this def
//   shock ring    — additive ring (fx.novaShockRing) + ground scorch decal
//                   (fx.novaScorch) fired from skills.ts #applyFinisherDamageAt;
//                   outside this def because L7 caps it at 3 emitters
//   commit cue    — telegraph = fx.novaTelegraph sprite decals (danger ring +
//                   faint fill + center pulse); Hero Shot stays procedural
//   damage-pop    — big impact flipbook flash: the finisher punch (below)
//   damage-burst  — hot spark burst riding the flash (below)
//   damage-rise   — ember aftermath, buoyant sparks rising from the scar
//                   (sprite emitter, positive gy); call site plays it at y=0.2
//
// damage-rise is a buoyant sprite emitter (positive gy floats the embers up) —
// flipped from the legacy geometric rise in T6; emitter life 1.4s outlives the
// 1.2s particle life past the executor's 1.0s lease backstop.

import type { EffectDef } from '../effect-def';

export const infernoNovaDef: EffectDef = {
  emitters: [
    // Finisher punch — 16-frame impact flipbook, biggest flash in the game.
    {
      id: 'damage-pop', kind: 'sprite', color: 'fire', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 2.4,
      },
    },
    // Hot spark streaks flung off the punch.
    {
      id: 'damage-burst', kind: 'sprite', color: 'fire', count: 28, speed: 5.0,
      sprite: {
        sheet: 'spark', blend: 'additive', billboard: 'spherical',
        size: 0.42, fadeOutFrac: 0.3,
      },
    },
    // Ember aftermath — buoyant sparks rising from the scar.
    {
      id: 'damage-rise', kind: 'sprite', color: 'fire', count: 24, speed: 1.2, life: 1.4,
      sprite: {
        sheet: 'spark', blend: 'additive', billboard: 'spherical',
        size: 0.3, fadeOutFrac: 0.4, life: 1.2, gy: 3.5,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // L7: ≤3 emitters / ≤400 particles · live sum 1+28+24 = 53
  budget: { maxEmitters: 3, maxParticles: 400, maxTrails: 0 },
};
