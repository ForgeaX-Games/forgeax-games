/** Locomotion loop clips for the hero animation contract. */
export type LocomotionClip = 'idle' | 'walk' | 'run';

/** Ground speed (m/s) at or below which the hero plays idle. */
export const LOCOMOTION_IDLE_SPEED = 0.05;

/**
 * Ground speed (m/s) at or above which the hero plays run.
 * Tuned between base SPEED (3.4) and SPRINT (5.4) so click-path / WASD walk
 * stay on walk, and Shift-sprint crosses into run.
 */
export const LOCOMOTION_RUN_SPEED = 4.2;

/**
 * Path-follow raises the run gate slightly so haste/moveMul bumps at base
 * SPEED do not flicker into run during long click paths.
 */
export const LOCOMOTION_RUN_SPEED_PATH = 4.8;

/**
 * Pick idle/walk/run from actual ground-speed magnitude — not key state.
 * `isPathDriven` only softens the walk→run threshold for click paths.
 */
export function selectLocomotionClip(
  speed: number,
  isPathDriven: boolean,
): LocomotionClip {
  if (!(speed > LOCOMOTION_IDLE_SPEED)) return 'idle';
  const runGate = isPathDriven ? LOCOMOTION_RUN_SPEED_PATH : LOCOMOTION_RUN_SPEED;
  if (speed >= runGate) return 'run';
  return 'walk';
}
