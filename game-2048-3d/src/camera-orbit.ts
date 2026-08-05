import { quat } from '@forgeax/engine-math';

// The template keeps the canonical camera-orbit contract, but aims it at the
// moving player instead of a static origin.  The radius is intentionally
// stable so a first-time user can see spherical camera motion independently
// from player movement.
export const ORBIT_RADIUS = Math.sqrt(75);
export const ORBIT_INITIAL_YAW = Math.PI / 4;
export const ORBIT_INITIAL_PITCH = Math.asin(1 / Math.sqrt(3));
export const ORBIT_PITCH_LIMIT = Math.PI / 2 - 0.01;

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

export function orbitRadius(pos: readonly [number, number, number], target: readonly [number, number, number]): number {
  return Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
}
