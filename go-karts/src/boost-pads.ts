import type { KartController, KartPose } from './kart-controller';

const BOOST_PAD_T = [0.07, 0.15, 0.24, 0.4, 0.5, 0.65, 0.8, 0.9] as const;
const TRIGGER_RADIUS = 2.7;
const RETRIGGER_SECONDS = 1.1;

interface BoostPadState {
  x: number;
  z: number;
  cooldown: number;
}

export interface BoostPads {
  /** Returns world position of a pad that just fired, or null. */
  update(dt: number, pose: KartPose): { x: number; y: number; z: number } | null;
  reset(): void;
}

/** Runtime trigger layer for the baked yellow track boost pads. */
export function createBoostPads(kart: KartController): BoostPads {
  const pads: BoostPadState[] = BOOST_PAD_T.map((t) => {
    const p = kart.track.pointAt(t);
    return { x: p.x, z: p.z, cooldown: 0 };
  });

  return {
    update(dt, pose) {
      for (const pad of pads) {
        pad.cooldown = Math.max(0, pad.cooldown - dt);
        if (pad.cooldown > 0) continue;
        const dx = pose.x - pad.x;
        const dz = pose.z - pad.z;
        if (dx * dx + dz * dz > TRIGGER_RADIUS * TRIGGER_RADIUS) continue;
        pad.cooldown = RETRIGGER_SECONDS;
        kart.applyBoost(1.35, 13);
        return { x: pad.x, y: pose.y, z: pad.z };
      }
      return null;
    },
    reset() {
      for (const pad of pads) pad.cooldown = 0;
    },
  };
}
