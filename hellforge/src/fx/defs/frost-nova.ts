// Frost Nova — PR9 active. Full-ring frostImpact-family burst composed from
// Frost Fang emitters at larger scale (L2 locked example). No new EmitterKind.

import type { EffectDef, EmitterDef } from '../effect-def';
import { frostDef } from './frost';

function pickScaled(id: string, sizeMul: number, countMul = 1): EmitterDef {
  const e = frostDef.emitters.find((x) => x.id === id);
  if (!e) throw new Error(`frost-nova: missing frost emitter '${id}'`);
  const sprite = e.sprite
    ? {
        ...e.sprite,
        size: (e.sprite.size ?? 1) * sizeMul,
        endSize: e.sprite.endSize !== undefined
          ? e.sprite.endSize * sizeMul
          : undefined,
      }
    : undefined;
  return {
    ...e,
    count: Math.max(1, Math.round(e.count * countMul)),
    size: e.size !== undefined ? e.size * sizeMul : undefined,
    sprite,
  };
}

const emitters = [
  pickScaled('impact', 2.2),
  pickScaled('impact-burst', 2.0, 1.5),
  pickScaled('shatter-burst', 1.8, 1.25),
  pickScaled('shatter-pop', 2.0),
];
let particles = 0;
for (const e of emitters) particles += e.count;

export const frostNovaDef: EffectDef = {
  emitters,
  behaviors: [],
  trails: [],
  subEmitters: [],
  budget: { maxEmitters: emitters.length, maxParticles: particles, maxTrails: 0 },
};
