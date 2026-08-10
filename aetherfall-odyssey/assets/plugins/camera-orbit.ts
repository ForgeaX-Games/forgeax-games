import { quat, vec3 } from '@forgeax/engine-math';
import type { PhysicsWorld } from '@forgeax/engine-physics';

// The opening orbit presents the complete Fox in the lower-left, carries the
// stepping route through the centre, and places the visible shrine crystal in
// the upper-right. The lateral focus supplies a readable human-scale reference
// and removes the former dead centre without moving world-authored landmarks.
export const ORBIT_RADIUS = 8.4;
export const ORBIT_INITIAL_YAW = -0.08;
export const ORBIT_INITIAL_PITCH = 0.2;
export const ORBIT_PITCH_LIMIT = Math.PI / 2 - 0.01;
export const ORBIT_FOCUS_HEIGHT = 1.1;
export const ORBIT_FOCUS_FORWARD = -0.7;
export const ORBIT_FOCUS_LATERAL = 1.6;
export const ORBIT_COLLISION_CLEARANCE = 0.35;
export const ORBIT_PROBE_ORIGIN_OFFSET = 0.25;
export const ORBIT_MIN_RADIUS = 0.2;
export const ORBIT_SAFE_PRESENTATION_RADIUS = 4.2;
export const ORBIT_ROUTE_FOCUS_FORWARD = 0.15;

type OrbitPhysics = Pick<PhysicsWorld, 'raycast'>;

export type AetherfallOrbitPoseArgs = {
  readonly playerX: number;
  /** Ground-relative character height, including jump motion. */
  readonly playerY: number;
  readonly playerZ: number;
  readonly lookYaw: number;
  readonly lookPitch: number;
  readonly physics?: OrbitPhysics;
  readonly playerEntity?: number;
};

export type AetherfallOrbitPose = ReturnType<typeof orbitPose> & {
  readonly target: readonly [number, number, number];
  readonly radius: number;
  readonly strategy: OrbitStrategy;
};

export type OrbitStrategy = 'authored-shoulder' | 'route-centre' | 'right-shoulder' | 'left-shoulder' | 'high-route';

type OrbitCandidate = {
  readonly strategy: OrbitStrategy;
  readonly yaw: number;
  readonly pitch: number;
  readonly focusForward: number;
  readonly focusLateral: number;
};

export function orbitFocus(
  playerX: number,
  playerY: number,
  playerZ: number,
  focusForward: number = ORBIT_FOCUS_FORWARD,
  focusLateral: number = ORBIT_FOCUS_LATERAL,
): readonly [number, number, number] {
  return [playerX + focusLateral, playerY + ORBIT_FOCUS_HEIGHT, playerZ + focusForward];
}

export function orbitClippedRadius(
  hitTimeOfImpact: number | undefined,
  requestedRadius: number = ORBIT_RADIUS,
): number {
  if (hitTimeOfImpact === undefined || !Number.isFinite(hitTimeOfImpact) || hitTimeOfImpact < 0) {
    return requestedRadius;
  }
  const distance = ORBIT_PROBE_ORIGIN_OFFSET + hitTimeOfImpact - ORBIT_COLLISION_CLEARANCE;
  return Math.max(ORBIT_MIN_RADIUS, Math.min(requestedRadius, distance));
}

export function orbitPose(
  target: readonly [number, number, number],
  yaw: number,
  pitch: number,
  radius: number = ORBIT_RADIUS,
): { readonly pos: [number, number, number]; readonly quat: [number, number, number, number] } {
  const clampedPitch = Math.max(-ORBIT_PITCH_LIMIT, Math.min(ORBIT_PITCH_LIMIT, pitch));
  const cosPitch = Math.cos(clampedPitch);
  const pos: [number, number, number] = [
    target[0] + Math.sin(yaw) * cosPitch * radius,
    target[1] + Math.sin(clampedPitch) * radius,
    target[2] + Math.cos(yaw) * cosPitch * radius,
  ];
  const rotation = quat.fromLookAt(quat.create(), pos, target, [0, 1, 0]);
  return {
    pos,
    quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
  };
}

/**
 * Resolve the authored shoulder framing and pull the camera in front of the
 * first physical obstruction. If that would become a masonry close-up, probe
 * route-centre, opposite-shoulder, and elevated compositions and keep the
 * clearest result. The probe starts beyond the Fox's head volume, preventing
 * the follow target itself from consuming the only ray hit.
 */
export function aetherfallOrbitPose(args: AetherfallOrbitPoseArgs): AetherfallOrbitPose {
  const authoredYaw = ORBIT_INITIAL_YAW + args.lookYaw;
  const authoredPitch = Math.max(
    -ORBIT_PITCH_LIMIT,
    Math.min(ORBIT_PITCH_LIMIT, ORBIT_INITIAL_PITCH + args.lookPitch),
  );
  const candidates: readonly OrbitCandidate[] = [
    { strategy: 'authored-shoulder', yaw: authoredYaw, pitch: authoredPitch, focusForward: ORBIT_FOCUS_FORWARD, focusLateral: ORBIT_FOCUS_LATERAL },
    { strategy: 'route-centre', yaw: args.lookYaw, pitch: authoredPitch, focusForward: ORBIT_ROUTE_FOCUS_FORWARD, focusLateral: 0 },
    { strategy: 'right-shoulder', yaw: authoredYaw + 0.62, pitch: authoredPitch + 0.08, focusForward: ORBIT_ROUTE_FOCUS_FORWARD, focusLateral: 0 },
    { strategy: 'left-shoulder', yaw: authoredYaw - 0.62, pitch: authoredPitch + 0.08, focusForward: ORBIT_ROUTE_FOCUS_FORWARD, focusLateral: 0 },
    { strategy: 'high-route', yaw: args.lookYaw, pitch: authoredPitch + 0.48, focusForward: ORBIT_ROUTE_FOCUS_FORWARD, focusLateral: 0 },
  ];
  const solve = (candidate: OrbitCandidate): AetherfallOrbitPose => {
    const target = orbitFocus(
      args.playerX,
      args.playerY,
      args.playerZ,
      candidate.focusForward,
      candidate.focusLateral,
    );
    const pitch = Math.max(-ORBIT_PITCH_LIMIT, Math.min(ORBIT_PITCH_LIMIT, candidate.pitch));
    const direction = vec3.create(
      Math.sin(candidate.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(candidate.yaw) * Math.cos(pitch),
    );
    const origin = vec3.create(
      target[0] + direction[0]! * ORBIT_PROBE_ORIGIN_OFFSET,
      target[1] + direction[1]! * ORBIT_PROBE_ORIGIN_OFFSET,
      target[2] + direction[2]! * ORBIT_PROBE_ORIGIN_OFFSET,
    );
    const hit = args.physics?.raycast(
      origin,
      direction,
      Math.max(0, ORBIT_RADIUS - ORBIT_PROBE_ORIGIN_OFFSET),
    );
    const radius = orbitClippedRadius(
      hit !== undefined && hit.entity !== args.playerEntity ? hit.timeOfImpact : undefined,
    );
    return {
      ...orbitPose(target, candidate.yaw, pitch, radius),
      target,
      radius,
      strategy: candidate.strategy,
    };
  };

  const authored = solve(candidates[0]!);
  if (authored.radius >= ORBIT_SAFE_PRESENTATION_RADIUS || args.physics === undefined) return authored;

  let best = authored;
  for (let index = 1; index < candidates.length; index += 1) {
    const alternative = solve(candidates[index]!);
    if (alternative.radius > best.radius) best = alternative;
    if (alternative.radius === ORBIT_RADIUS) return alternative;
  }
  return best;
}

export function orbitRadius(pos: readonly [number, number, number], target: readonly [number, number, number]): number {
  return Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
}
