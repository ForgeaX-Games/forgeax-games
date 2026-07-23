// Frost Fang — cast cue, impact, shatter fragments, shard-hit pop.
// Non-crit / max-shatter (rank 3 → 4 shards → 8 burst) defaults from fx.ts.
// Slow disc stays a customStep placeholder (mesh marker, not a particle emitter).

import type { EffectDef } from '../effect-def';

export const frostDef: EffectDef = {
  emitters: [
    { id: 'cast', kind: 'pop', color: 'ice', count: 1, size: 0.28 },
    { id: 'cast-rise', kind: 'rise', color: 'ice', count: 3, spread: 0.35 },
    { id: 'impact', kind: 'pop', color: 'ice', count: 1, size: 0.42 },
    { id: 'impact-burst', kind: 'burst', color: 'ice', count: 5, speed: 2.6 },
    { id: 'shatter-burst', kind: 'burst', color: 'ice', count: 8, speed: 3.4 },
    { id: 'shatter-pop', kind: 'pop', color: 'ice', count: 1, size: 0.48 },
    { id: 'shard-hit', kind: 'pop', color: 'ice', count: 1, size: 0.28 },
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
  // 7 emitters · 1+3+1+5+8+1+1 = 20 particles
  budget: { maxEmitters: 7, maxParticles: 32, maxTrails: 0 },
  customStep: 'frost-slow-disc',
};
