// Foot dust + sprint trail — N6. Reuses the smoke sheet (L2: no new
// EmitterKind). Quieter than dodge puff (count 6, size 0.35→0.75): walk is
// 1–2 ash motes at the feet; Shift adds a second short wake puff.

import type { EffectDef } from '../effect-def';

/** Cadence for foot-dust emits (~8 Hz). */
export const MOVE_DUST_HZ = 8;
export const MOVE_DUST_PERIOD_S = 1 / MOVE_DUST_HZ;
/** Ignore sub-walk drift / wall-slide jitter (m/s, after collision slide). */
export const MOVE_DUST_MIN_SPEED = 0.4;
/** Campfire sits at the origin — skip dust inside this radius while in camp. */
export const CAMPFIRE_SKIP_RADIUS = 2.2;

export const movementDef: EffectDef = {
  emitters: [
    {
      id: 'puff', kind: 'sprite', color: 'shadow', count: 2, speed: 0.28,
      sprite: {
        sheet: 'smoke', fps: 6, loop: true,
        blend: 'premult', billboard: 'spherical',
        size: 0.22, endSize: 0.45, fadeOutFrac: 0.55, gy: 0.55, life: 0.4,
      },
    },
    {
      id: 'trail', kind: 'sprite', color: 'shadow', count: 2, speed: 0.9,
      sprite: {
        sheet: 'smoke', fps: 6, loop: true,
        blend: 'premult', billboard: 'spherical',
        size: 0.26, endSize: 0.55, fadeOutFrac: 0.45, gy: 0.85, life: 0.55,
      },
    },
  ],
  behaviors: [],
  trails: [],
  subEmitters: [],
  // 2 emitters · 2+2 = 4 particles — well under the 16 ceiling
  budget: { maxEmitters: 2, maxParticles: 8, maxTrails: 0 },
};

export interface MoveDustGate {
  readonly dt: number;
  readonly acc: number;
  readonly groundSpeed: number;
  readonly sprint: boolean;
  readonly paused: boolean;
  readonly dead: boolean;
  readonly dodgeOwnsMove: boolean;
  readonly inCamp: boolean;
  readonly px: number;
  readonly pz: number;
}

export interface MoveDustDecision {
  readonly acc: number;
  readonly walk: boolean;
  readonly sprintTrail: boolean;
}

/**
 * Cadence + gates for N6 foot dust. Call once per locomotion tick after
 * `groundSpeed` is measured (post collision-slide). Failed gates reset the
 * accumulator so leaving campfire / ending a roll cannot dump a catch-up burst.
 */
export function shouldEmitMoveDust(g: MoveDustGate): MoveDustDecision {
  const nearCampfire = g.inCamp && Math.hypot(g.px, g.pz) < CAMPFIRE_SKIP_RADIUS;
  const gatedOff =
    g.paused
    || g.dead
    || g.dodgeOwnsMove
    || g.groundSpeed < MOVE_DUST_MIN_SPEED
    || nearCampfire;
  if (gatedOff) {
    return { acc: 0, walk: false, sprintTrail: false };
  }

  let acc = g.acc + g.dt;
  if (acc < MOVE_DUST_PERIOD_S) {
    return { acc, walk: false, sprintTrail: false };
  }
  acc -= MOVE_DUST_PERIOD_S;
  // One emit per call — a hitch must not fire several puffs in one frame.
  if (acc >= MOVE_DUST_PERIOD_S) acc = 0;
  return {
    acc,
    walk: true,
    sprintTrail: g.sprint,
  };
}
