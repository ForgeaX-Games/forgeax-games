// Arc Surge — PR8 T5 lightning-kit rebuild on sprite primitives.
//
//   body     — persistent bolt wrap following the projectile
//              (FxSystem.flightBody('arc'); not in this def — it is attached, not played)
//   trail    — per-projectile bolt drip (FxSystem.flightTrailPuff; L4 single trail)
//   impact   — bolt polyline segments + flipbook flash
//   residue  — ground scorch decal (SpriteDef.decal route, ~2.6s erosion fade)
//
// `cast` stays the geometric pop (small cast cue). `impact`/`impact-burst`
// ids are frozen (skills.ts beat lists + hit branch).

import type { EffectDef } from '../effect-def';

export const arcDef: EffectDef = {
  emitters: [
    { id: 'cast', kind: 'pop', color: 'lightning', count: 1, size: 0.22 },
    // Impact layer.
    {
      id: 'impact', kind: 'sprite', color: 'lightning', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 1.1,
      },
    },
    {
      id: 'impact-burst', kind: 'sprite', color: 'lightning', count: 14, speed: 3.2,
      sprite: {
        sheet: 'bolt', fps: 12, loop: false,
        blend: 'additive', billboard: 'spherical',
        size: 0.55, fadeOutFrac: 0.35,
      },
    },
    // Residue layer — flat scorch decal; emitter life covers the 2.6s particle
    // so the executor lease does not reap it early (DEFAULT_LIFE.sprite = 1).
    {
      id: 'impact-scorch', kind: 'sprite', color: 'lightning', count: 1, life: 3.0,
      sprite: {
        sheet: 'scorch', blend: 'premult', billboard: 'none',
        size: 1.1, decal: true, life: 2.6, fadeOutFrac: 0.55,
      },
    },
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
  // 4 emitters · 1+1+14+1 = 17 particles
  budget: { maxEmitters: 4, maxParticles: 28, maxTrails: 0 },
};
