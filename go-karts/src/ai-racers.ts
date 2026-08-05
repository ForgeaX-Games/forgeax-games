import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { KartPose } from './kart-controller';
import type { TrackCurve } from './track-data';
import { plusZHeadingToNegZYaw } from './orientation';

const SPEED_VARIATION = 0.04;
const DUEL_TARGET_AMPLITUDE = 0.025;
const DUEL_TARGET_FREQUENCY = 0.16;
const CATCHUP_START_GAP = 0.01;
const CATCHUP_FULL_GAP = 0.1;
const CATCHUP_MAX_MULTIPLIER = 0.28;
const CATCHUP_MAX_BONUS = 3.5;
const LEAD_SLOW_START_GAP = 0.02;
const LEAD_SLOW_FULL_GAP = 0.07;
const LEAD_SLOW_MAX_MULTIPLIER = 0.18;
const AI_MAX_SPEED = 32;
const AI_BOOST_MAX_SPEED = 36;
const SLOWED_SPEED_MULTIPLIER = 0.55;

export interface AiRacer {
  entity: EntityHandle;
  name: string;
  baseSpeed: number;
  progress: number;
  lateral: number;
  phase: number;
  slowT?: number;
  boostT?: number;
  boostExtra?: number;
  starT?: number;
  currentSpeed?: number;
}

export interface AiRacers {
  update(dt: number, elapsed: number, playerProgress: number): void;
  /** Total race distance in laps (same units as session.playerProgress). */
  getProgresses(): { id: string; progress: number }[];
  getPositions(): { id: string; x: number; y: number; z: number }[];
  getPoses(): ({ id: string } & KartPose)[];
  applySlow(id: string, duration: number): boolean;
  slowInRadius(
    x: number,
    z: number,
    radius: number,
    duration: number,
    excludeId?: string,
  ): number;
  applyBoost(id: string, duration: number, extraSpeed?: number): void;
  applyStar(id: string, duration: number): void;
  isStarActive(id: string): boolean;
  resetItemEffects(): void;
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

  const pose = (ai: AiRacer): KartPose => {
    const frac = ((ai.progress % 1) + 1) % 1;
    const tan = track.tangentAt(frac);
    const pos = position(ai);
    const heading = Math.atan2(tan.x, tan.z);
    return {
      ...pos,
      yaw: plusZHeadingToNegZYaw(heading),
      speed: ai.currentSpeed ?? ai.baseSpeed,
      trackT: frac,
    };
  };

  const place = (ai: AiRacer): void => {
    const current = pose(ai);
    world.set(ai.entity, Transform, {
      pos: [current.x, current.y, current.z],
      quat: yawQuatArr(current.yaw),
    });
  };

  for (const ai of racers) place(ai);

  return {
    update(dt: number, elapsed: number, playerProgress: number): void {
      for (const ai of racers) {
        let sp = ai.baseSpeed * (1 + Math.sin(elapsed * 0.7 + ai.phase) * SPEED_VARIATION);
        // Each rival's desired position slowly moves from just behind the player
        // to just ahead. This creates real passes instead of a permanent chase
        // line where every AI settles behind the player.
        const targetLead =
          Math.sin(elapsed * DUEL_TARGET_FREQUENCY + ai.phase) * DUEL_TARGET_AMPLITUDE;
        const gap = playerProgress + targetLead - ai.progress;

        // Keep rivals in a visible chase band without snapping them forward.
        // Catch-up ramps continuously and stays under an explicit speed cap.
        if (gap > CATCHUP_START_GAP) {
          const catchup =
            Math.min(1, (gap - CATCHUP_START_GAP) / (CATCHUP_FULL_GAP - CATCHUP_START_GAP));
          sp = sp * (1 + catchup * CATCHUP_MAX_MULTIPLIER) + catchup * CATCHUP_MAX_BONUS;
        } else if (gap < -LEAD_SLOW_START_GAP) {
          const lead =
            Math.min(
              1,
              (-gap - LEAD_SLOW_START_GAP) / (LEAD_SLOW_FULL_GAP - LEAD_SLOW_START_GAP),
            );
          sp *= 1 - lead * LEAD_SLOW_MAX_MULTIPLIER;
        }

        ai.boostT = Math.max(0, (ai.boostT ?? 0) - dt);
        ai.starT = Math.max(0, (ai.starT ?? 0) - dt);
        if (ai.boostT > 0) sp += ai.boostExtra ?? 8;
        sp = Math.min(sp, ai.boostT > 0 ? AI_BOOST_MAX_SPEED : AI_MAX_SPEED);
        ai.slowT = Math.max(0, (ai.slowT ?? 0) - dt);
        const slowed = ai.slowT > 0;
        if (slowed) sp *= SLOWED_SPEED_MULTIPLIER;
        ai.currentSpeed = sp;
        ai.progress += (sp * dt) / track.length;
        const laneSign = ai.lateral < 0 ? -1 : 1;
        ai.lateral =
          laneSign * (2.0 + Math.sin(elapsed * 0.5 + ai.phase) * 2.0);
        if (slowed) ai.lateral += Math.sin(elapsed * 18 + ai.phase) * 1.4;
        place(ai);
      }
    },
    getProgresses: () => racers.map((ai) => ({ id: ai.name, progress: ai.progress })),
    getPositions: () => racers.map((ai) => ({ id: ai.name, ...position(ai) })),
    getPoses: () => racers.map((ai) => ({ id: ai.name, ...pose(ai) })),
    applySlow(id: string, duration: number) {
      const ai = racers.find((r) => r.name === id);
      if (!ai || (ai.starT ?? 0) > 0) return false;
      ai.slowT = Math.max(ai.slowT ?? 0, Math.max(0, duration));
      return true;
    },
    slowInRadius(x: number, z: number, radius: number, duration: number, excludeId?: string) {
      let hit = 0;
      const radiusSq = radius * radius;
      for (const ai of racers) {
        if (ai.name === excludeId || (ai.starT ?? 0) > 0) continue;
        const p = position(ai);
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz > radiusSq) continue;
        ai.slowT = Math.max(ai.slowT ?? 0, Math.max(0, duration));
        hit++;
      }
      return hit;
    },
    applyBoost(id: string, duration: number, extraSpeed = 8) {
      const ai = racers.find((r) => r.name === id);
      if (!ai) return;
      ai.boostT = Math.max(ai.boostT ?? 0, Math.max(0, duration));
      ai.boostExtra = Math.max(ai.boostExtra ?? 0, Math.max(0, extraSpeed));
    },
    applyStar(id: string, duration: number) {
      const ai = racers.find((r) => r.name === id);
      if (!ai) return;
      ai.starT = Math.max(ai.starT ?? 0, Math.max(0, duration));
      ai.slowT = 0;
    },
    isStarActive(id: string) {
      return (racers.find((r) => r.name === id)?.starT ?? 0) > 0;
    },
    resetItemEffects() {
      for (const ai of racers) {
        ai.slowT = 0;
        ai.boostT = 0;
        ai.boostExtra = 0;
        ai.starT = 0;
      }
    },
  };
}
