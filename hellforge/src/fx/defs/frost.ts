// Frost Fang — PR8 T4 frost-kit rebuild on sprite primitives.
//
//   body     — persistent shard + glow core following the projectile
//              (FxSystem.flightBody('frost'); not in this def — attached, not played)
//   trail    — per-projectile shard drip (FxSystem.flightTrailPuff; L4 single trail)
//   impact   — flipbook flash + shard burst + glow core + frost residue decal
//   shatter  — Shatter passive fragments ride the same shard primitive (T7)
//
// Slow-status disc is reskinned on the decal primitive in FxSystem.syncSlowStatus
// (T4) — it is a per-monster marker, not a def emitter (customStep retired).
// `cast`/`cast-rise` stay geometric (small cue, out of the four-layer scope).

import type { EffectDef } from '../effect-def';

export const frostDef: EffectDef = {
  emitters: [
    { id: 'cast', kind: 'pop', color: 'ice', count: 1, size: 0.28 },
    { id: 'cast-rise', kind: 'rise', color: 'ice', count: 3, spread: 0.35 },
    // Impact layer.
    {
      id: 'impact', kind: 'sprite', color: 'ice', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 1.0,
      },
    },
    {
      id: 'impact-burst', kind: 'sprite', color: 'ice', count: 12, speed: 2.6,
      sprite: {
        sheet: 'shard', fps: 8, loop: false,
        blend: 'additive', billboard: 'spherical',
        size: 0.3, fadeOutFrac: 0.35,
      },
    },
    {
      id: 'impact-glow', kind: 'sprite', color: 'ice', count: 1,
      sprite: {
        sheet: 'glow', blend: 'additive', billboard: 'spherical',
        size: 1.1, endSize: 0.4, fadeOutFrac: 0.3,
      },
    },
    // Frost residue — premult ice-tinted ground decal (T4 ground layer).
    {
      id: 'impact-residue', kind: 'sprite', color: 'ice', count: 1, life: 3.2,
      sprite: {
        sheet: 'scorch', blend: 'premult', billboard: 'none',
        size: 1.1, decal: true, life: 2.8, fadeOutFrac: 0.55,
      },
    },
    // Shatter fragments (passive trigger feedback — T7 rides this layer).
    {
      id: 'shatter-burst', kind: 'sprite', color: 'ice', count: 16, speed: 3.4,
      sprite: {
        sheet: 'shard', fps: 10, loop: false,
        blend: 'additive', billboard: 'spherical',
        size: 0.34, fadeOutFrac: 0.3,
      },
    },
    {
      id: 'shatter-pop', kind: 'sprite', color: 'ice', count: 1,
      sprite: {
        sheet: 'impact', fps: 24, loop: false,
        blend: 'additive', billboard: 'spherical', size: 0.9,
      },
    },
    {
      id: 'shard-hit', kind: 'sprite', color: 'ice', count: 1, speed: 1.2,
      sprite: {
        sheet: 'shard', fps: 8, loop: false,
        blend: 'additive', billboard: 'spherical', size: 0.3,
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
  // 9 emitters · 1+3+1+12+1+1+16+1+1 = 37 particles
  budget: { maxEmitters: 9, maxParticles: 52, maxTrails: 0 },
};
