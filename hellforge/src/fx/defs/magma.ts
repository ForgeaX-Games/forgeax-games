// Magma Bolt — PR8 T3 four-layer rebuild on sprite primitives.
//
//   body     — persistent flame wrap + glow core following the projectile
//              (FxSystem.flightBody('magma'); not in this def — attached, not played)
//   trail    — per-projectile flame drip (FxSystem.flightTrailPuff; L4 single trail)
//   impact   — flipbook flash + additive glow core + spark streaks + smoke puffs
//   residue  — ground scorch decal (SpriteDef.decal route, ~3s erosion fade)
//
// `cast` stays the geometric pop (small cast cue). hellfire/hellfire-burst are
// the Hellfire Catalyst passive-trigger feedback (T7): sprite flipbook flash +
// spark burst. Their ids and the onDeath wiring are frozen — the skills.ts
// crit-explosion beat slices them by id.

import type { EffectDef } from '../effect-def';

export const magmaDef: EffectDef = {
  emitters: [
    { id: 'cast', kind: 'pop', color: 'fire', count: 1, size: 0.22 },
    // Impact layer.
    {
      id: 'impact', kind: 'sprite', color: 'fire', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 1.25,
      },
    },
    {
      id: 'impact-burst', kind: 'sprite', color: 'fire', count: 14, speed: 4.2,
      sprite: {
        sheet: 'spark', blend: 'additive', billboard: 'spherical',
        size: 0.34, fadeOutFrac: 0.35,
      },
    },
    {
      id: 'impact-glow', kind: 'sprite', color: 'fire', count: 1,
      sprite: {
        sheet: 'glow', blend: 'additive', billboard: 'spherical',
        size: 1.5, endSize: 0.5, fadeOutFrac: 0.3,
      },
    },
    {
      id: 'impact-smoke', kind: 'sprite', color: 'fire', count: 6, speed: 1.1,
      sprite: {
        sheet: 'smoke', fps: 6, loop: true,
        blend: 'premult', billboard: 'spherical',
        size: 0.55, endSize: 1.05, fadeOutFrac: 0.45,
      },
    },
    // Residue layer — flat scorch decal; emitter life covers the 3s particle
    // so the executor lease does not reap it early (DEFAULT_LIFE.sprite = 1).
    {
      id: 'impact-scorch', kind: 'sprite', color: 'fire', count: 1, life: 3.4,
      sprite: {
        sheet: 'scorch', blend: 'premult', billboard: 'none',
        size: 1.3, decal: true, life: 3.0, fadeOutFrac: 0.55,
      },
    },
    // Hellfire Catalyst crit explosion (T7) — bigger than a normal impact:
    // flipbook flash core + 20 spark streaks, same sheets as the impact layer.
    {
      id: 'hellfire', kind: 'sprite', color: 'fire', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 1.6,
      },
    },
    {
      id: 'hellfire-burst', kind: 'sprite', color: 'fire', count: 20, speed: 4.5,
      sprite: {
        sheet: 'spark', blend: 'additive', billboard: 'spherical',
        size: 0.38, fadeOutFrac: 0.35,
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
    {
      id: 'hellfire-burst-on-death',
      parentEmitterId: 'hellfire',
      trigger: 'onDeath',
      childEmitterId: 'hellfire-burst',
    },
  ],
  // 8 emitters · 1+1+14+1+6+1+1+20 = 45 particles (last two = hellfire pair, T7)
  budget: { maxEmitters: 8, maxParticles: 56, maxTrails: 0 },
};
