// Flame Burst — PR9 active. Composed from Magma Bolt impact / hellfire
// emitters (L2: no new EmitterKind). Call site: combatBeat('flame-burst', …).

import type { EffectDef } from '../effect-def';
import { magmaDef } from './magma';

function pick(ids: readonly string[]) {
  return ids.map((id) => {
    const e = magmaDef.emitters.find((x) => x.id === id);
    if (!e) throw new Error(`flame-burst: missing magma emitter '${id}'`);
    return e;
  });
}

const emitters = pick(['impact', 'impact-burst', 'hellfire', 'hellfire-burst']);
let particles = 0;
for (const e of emitters) particles += e.count;

export const flameBurstDef: EffectDef = {
  emitters,
  behaviors: [],
  trails: [],
  subEmitters: [],
  budget: { maxEmitters: emitters.length, maxParticles: particles, maxTrails: 0 },
};
