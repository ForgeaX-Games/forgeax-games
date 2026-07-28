import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { TrackCurve } from './track-data';
import { plusZHeadingToNegZYaw } from './orientation';

export interface AiRacer {
  entity: EntityHandle;
  name: string;
  baseSpeed: number;
  progress: number;
  lateral: number;
  phase: number;
}

export interface AiRacers {
  update(dt: number, elapsed: number, playerProgress: number): void;
  /** Total race distance in laps (same units as session.playerProgress). */
  getProgresses(): { id: string; progress: number }[];
}

function yawQuatArr(yaw: number): [number, number, number, number] {
  const half = yaw * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/**
 * Lightweight track-following AI (original MainScene.updateAIs / placeAI).
 * Entities named KartDuck / KartPanda (roots) are driven along the curve.
 */
export function createAiRacers(options: {
  world: World;
  track: TrackCurve;
  racers: AiRacer[];
}): AiRacers {
  const { world, track, racers } = options;

  const place = (ai: AiRacer): void => {
    const frac = ((ai.progress % 1) + 1) % 1;
    const p = track.pointAt(frac);
    const side = track.sideAt(frac);
    const tan = track.tangentAt(frac);
    const lat = Math.max(-5.5, Math.min(5.5, ai.lateral));
    const heading = Math.atan2(tan.x, tan.z);
    const yaw = plusZHeadingToNegZYaw(heading);
    world.set(ai.entity, Transform, {
      pos: [p.x + side.x * lat, p.y, p.z + side.z * lat],
      quat: yawQuatArr(yaw),
    });
  };

  for (const ai of racers) place(ai);

  return {
    update(dt: number, elapsed: number, playerProgress: number): void {
      for (const ai of racers) {
        let sp = ai.baseSpeed * (1 + Math.sin(elapsed * 0.7 + ai.phase) * 0.06);
        if (ai.progress < playerProgress - 0.18) sp *= 1.18;
        else if (ai.progress > playerProgress + 0.22) sp *= 0.88;
        ai.progress += (sp * dt) / track.length;
        ai.lateral =
          (ai.phase % 2 === 0 ? -1 : 1) * (2.0 + Math.sin(elapsed * 0.5 + ai.phase) * 2.0);
        place(ai);
      }
    },
    getProgresses: () => racers.map((ai) => ({ id: ai.name, progress: ai.progress })),
  };
}
