// Discharge — PR9 active. Radial bolt burst reuses Arc Surge cast/impact
// emitters (L2: no new EmitterKind). Call site: combatBeat('discharge', …).

import type { EffectDef } from '../effect-def';
import { arcDef } from './arc';

function pick(ids: readonly string[]) {
  return ids.map((id) => {
    const e = arcDef.emitters.find((x) => x.id === id);
    if (!e) throw new Error(`discharge: missing arc emitter '${id}'`);
    return e;
  });
}

const emitters = pick(['cast', 'impact', 'impact-burst', 'impact-scorch']);
let particles = 0;
for (const e of emitters) particles += e.count;

export const dischargeDef: EffectDef = {
  emitters,
  behaviors: [],
  trails: [],
  subEmitters: [],
  budget: { maxEmitters: emitters.length, maxParticles: particles, maxTrails: 0 },
};
