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
  slowT?: number;
}

export interface AiRacers {
  update(dt: number, elapsed: number, playerProgress: number): void;
  /** Total race distance in laps (same units as session.playerProgress). */
  getProgresses(): { id: string; progress: number }[];
  getPositions(): { id: string; x: number; y: number; z: number }[];
  applySlow(id: string, duration: number): void;
  slowInRadius(x: number, z: number, radius: number, duration: number): number;
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

  const position = (ai: AiRacer) => {
    const frac = ((ai.progress % 1) + 1) % 1;
    const p = track.pointAt(frac);
    const side = track.sideAt(frac);
    const lat = Math.max(-5.5, Math.min(5.5, ai.lateral));
    return {
      x: p.x + side.x * lat,
      y: p.y,
      z: p.z + side.z * lat,
    };
  };

  const place = (ai: AiRacer): void => {
    const frac = ((ai.progress % 1) + 1) % 1;
    const tan = track.tangentAt(frac);
    const pos = position(ai);
    const heading = Math.atan2(tan.x, tan.z);
    const yaw = plusZHeadingToNegZYaw(heading);
    world.set(ai.entity, Transform, {
      pos: [pos.x, pos.y, pos.z],
      quat: yawQuatArr(yaw),
    });
  };

  for (const ai of racers) place(ai);

  return {
    update(dt: number, elapsed: number, playerProgress: number): void {
      for (const ai of racers) {
        let sp = ai.baseSpeed * (1 + Math.sin(elapsed * 0.7 + ai.phase) * 0.06);
        ai.slowT = Math.max(0, (ai.slowT ?? 0) - dt);
        const slowed = ai.slowT > 0;
        if (slowed) sp *= 0.35;
        if (ai.progress < playerProgress - 0.18) sp *= 1.18;
        else if (ai.progress > playerProgress + 0.22) sp *= 0.88;
        ai.progress += (sp * dt) / track.length;
        ai.lateral =
          (ai.phase % 2 === 0 ? -1 : 1) * (2.0 + Math.sin(elapsed * 0.5 + ai.phase) * 2.0);
        if (slowed) ai.lateral += Math.sin(elapsed * 18 + ai.phase) * 1.4;
        place(ai);
      }
    },
    getProgresses: () => racers.map((ai) => ({ id: ai.name, progress: ai.progress })),
    getPositions: () => racers.map((ai) => ({ id: ai.name, ...position(ai) })),
    applySlow(id: string, duration: number) {
      const ai = racers.find((r) => r.name === id);
      if (ai) ai.slowT = Math.max(ai.slowT ?? 0, Math.max(0, duration));
    },
    slowInRadius(x: number, z: number, radius: number, duration: number) {
      let hit = 0;
      const radiusSq = radius * radius;
      for (const ai of racers) {
        const p = position(ai);
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz > radiusSq) continue;
        ai.slowT = Math.max(ai.slowT ?? 0, Math.max(0, duration));
        hit++;
      }
      return hit;
    },
  };
}
