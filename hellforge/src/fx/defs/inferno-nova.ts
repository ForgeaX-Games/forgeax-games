// Inferno Nova finisher — damage beat pop+burst+rise (PR2a L7: ≤3 emitters).
// Commit pop / telegraph quad / Hero Shot light pulse → customStep placeholder.
// damage-rise spread = FINISHER_RADIUS_M (4) * 0.35 — call site plays rise at y=0.2.

import type { EffectDef } from '../effect-def';

export const infernoNovaDef: EffectDef = {
  emitters: [
    { id: 'damage-pop', kind: 'pop', color: 'fire', count: 1, size: 1.1 },
    { id: 'damage-burst', kind: 'burst', color: 'fire', count: 10, speed: 4.2 },
    { id: 'damage-rise', kind: 'rise', color: 'fire', count: 6, spread: 1.4 },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // L7: ≤3 emitters / ≤400 particles · live sum 1+10+6 = 17
  budget: { maxEmitters: 3, maxParticles: 400, maxTrails: 0 },
  customStep: 'inferno-nova-commit-telegraph-hero-shot',
};
