import type { EffectDef } from '../effect-def';
import { arcDef } from './arc';
import { blinkDef } from './blink';
import { dischargeDef } from './discharge';
import { dodgeDef } from './dodge';
import {
  bossDeathDissolveDef,
  deathDissolveDef,
  hitArcDef,
  hitFireDef,
  hitFrostDef,
} from './feedback';
import { flameBurstDef } from './flame-burst';
import { frostDef } from './frost';
import { frostNovaDef } from './frost-nova';
import { infernoNovaDef } from './inferno-nova';
import { magmaDef } from './magma';

/** Combat EffectDef registry (PR2b T3). Call sites play beats via `combatBeat` / full def. */
export const COMBAT_EFFECT_DEFS = {
  magma: magmaDef,
  frost: frostDef,
  arc: arcDef,
  blink: blinkDef,
  'inferno-nova': infernoNovaDef,
  'flame-burst': flameBurstDef,
  'frost-nova': frostNovaDef,
  discharge: dischargeDef,
  dodge: dodgeDef,
  'death-dissolve': deathDissolveDef,
  'death-dissolve-boss': bossDeathDissolveDef,
  'hit-fire': hitFireDef,
  'hit-frost': hitFrostDef,
  'hit-arc': hitArcDef,
} as const satisfies Record<string, EffectDef>;

export type CombatEffectId = keyof typeof COMBAT_EFFECT_DEFS;

/**
 * Slice named emitters from a combat def into a playable EffectDef.
 * Listed emitters spawn as simultaneous roots (legacy pop+burst same-frame parity);
 * catalog `subEmitters` are omitted so onDeath sequencing does not delay bursts.
 */
export function combatBeat(
  id: CombatEffectId,
  emitterIds: readonly string[],
): EffectDef {
  const base = COMBAT_EFFECT_DEFS[id];
  const want = new Set(emitterIds);
  const emitters = base.emitters.filter((e) => want.has(e.id));
  let particles = 0;
  for (const e of emitters) particles += e.count;
  return {
    emitters,
    behaviors: [],
    trails: [],
    subEmitters: [],
    budget: {
      maxEmitters: Math.max(emitters.length, 1),
      maxParticles: Math.max(particles, 1),
      maxTrails: 0,
    },
  };
}

export {
  arcDef,
  blinkDef,
  bossDeathDissolveDef,
  deathDissolveDef,
  dischargeDef,
  dodgeDef,
  flameBurstDef,
  frostDef,
  frostNovaDef,
  hitArcDef,
  hitFireDef,
  hitFrostDef,
  infernoNovaDef,
  magmaDef,
};
