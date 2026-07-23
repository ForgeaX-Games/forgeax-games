/**
 * Pure Hellforge camera rig — ARPG isometric combat + camp showcase.
 *
 * CameraRigState is the ONLY source for projection FOV, world↔screen,
 * aim unprojection, and Transform pose writes. The engine Camera *component*
 * is still written solely by render-settings.applyCamera, which reads
 * verticalFovRad from this state.
 */

import type { CameraProbe } from './camera-probe';

export type CameraMode = 'arpg' | 'showcase';

export interface CameraRigState {
  mode: CameraMode;
  focus: readonly [number, number, number];
  eye: readonly [number, number, number];
  yaw: number;
  pitch: number;
  distance: number;
  verticalFovRad: number;
  /** Decaying screen-shake residual (world metres). */
  shake: readonly [number, number, number];
}

export interface CameraRigInput {
  target: readonly [number, number, number];
  dt: number;
  zoomDelta: number;
  shakeImpulse: readonly [number, number, number];
  /** Explicit orbit deltas (radians) — no edge-of-screen rotate. */
  orbitDeltaYaw?: number;
  orbitDeltaPitch?: number;
  /** Desired camera arm before collision (ARPG zoom or showcase orbit). */
  desiredDistance?: number;
  /** Authored obstacle spring-arm probe; omitted = no contraction. */
  probe?: CameraProbe | null;
}

export interface ArpgCameraPreset {
  readonly id: string;
  readonly verticalFovRad: number;
  readonly distance: number;
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly followRate: number;
}

/** Mode blend duration (Spec §6.2: 350–500 ms). */
export const CAMERA_MODE_BLEND_MS = 400;
export const CAMERA_MODE_BLEND_S = CAMERA_MODE_BLEND_MS / 1000;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export const ARPG_DISTANCE_MIN = 10;
export const ARPG_DISTANCE_MAX = 14;
/** Shared downward pitch for all A/B presets (Spec §6.1: 50–55°). */
export const ARPG_PITCH_RAD = -degToRad(52);
export const ARPG_FOLLOW_RATE = 8;
/** Exponential decay rate for shake residual (1/s). */
export const SHAKE_DECAY = 7;

export const SHOWCASE_FOV_RAD = degToRad(57);
export const SHOWCASE_DISTANCE = 2.6;
export const SHOWCASE_DISTANCE_MIN = 1.0;
export const SHOWCASE_DISTANCE_MAX = 2.8;
export const SHOWCASE_PITCH_RAD = -degToRad(18);
export const SHOWCASE_PITCH_MIN = -degToRad(55);
export const SHOWCASE_PITCH_MAX = -degToRad(5);
export const SHOWCASE_FOLLOW_RATE = 10;
export const SHOWCASE_ARM_SKIN = 0.18;
/** Smooth recovery toward cleared arm length (1/s). */
export const SHOWCASE_ARM_RECOVER = 7;
/** Ray skin for ARPG spring-arm probe (metres) — not a playable floor. */
export const ARPG_ARM_SKIN = SHOWCASE_ARM_SKIN;
export const ARPG_ARM_RECOVER = SHOWCASE_ARM_RECOVER;
/**
 * Playable ARPG probe floor (metres). Probe may ask for less; we clamp here so
 * combat stay readable (feet close-up / unclickable ground is a hard fail).
 * Remaining occlusion is the fade path's job.
 */
export const ARPG_PROBE_DISTANCE_MIN = 7.5;
const SHOWCASE_FOCUS_Y = 1.35;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function makePreset(
  id: string,
  fovDeg: number,
  distance: number,
  yawDeg: number,
): ArpgCameraPreset {
  return {
    id,
    verticalFovRad: degToRad(fovDeg),
    distance,
    yawRad: degToRad(yawDeg),
    pitchRad: ARPG_PITCH_RAD,
    followRate: ARPG_FOLLOW_RATE,
  };
}

/** Three A/B candidates (Spec §6.1). Degrees → radians at definition via degToRad(). */
export const ARPG_PRESETS = {
  'fov48-distance12-yaw30': makePreset('fov48-distance12-yaw30', 48, 12, 30),
  'fov50-distance12-yaw37': makePreset('fov50-distance12-yaw37', 50, 12, 37),
  'fov55-distance12-yaw45': makePreset('fov55-distance12-yaw45', 55, 12, 45),
} as const;

/** Selected after camp/wild/den A/B — middle candidate; see PLAY_EXPERIENCE.md. */
export const DEFAULT_ARPG_PRESET = ARPG_PRESETS['fov50-distance12-yaw37'];

/** Camera forward from yaw (Y) + pitch (X), right-handed. */
export function cameraForward(
  yaw: number,
  pitch: number,
): readonly [number, number, number] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return [-cp * sy, sp, -cp * cy];
}

export function cameraRight(yaw: number): readonly [number, number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [cy, 0, -sy];
}

export function cameraUp(
  yaw: number,
  pitch: number,
): readonly [number, number, number] {
  const r = cameraRight(yaw);
  const f = cameraForward(yaw, pitch);
  return [
    r[1]! * f[2]! - r[2]! * f[1]!,
    r[2]! * f[0]! - r[0]! * f[2]!,
    r[0]! * f[1]! - r[1]! * f[0]!,
  ];
}

export function eyeFromOrbit(
  focus: readonly [number, number, number],
  yaw: number,
  pitch: number,
  distance: number,
): readonly [number, number, number] {
  const f = cameraForward(yaw, pitch);
  return [
    focus[0]! - f[0]! * distance,
    focus[1]! - f[1]! * distance,
    focus[2]! - f[2]! * distance,
  ];
}

/** Yaw-then-pitch quaternion (x,y,z,w) for Transform writes. */
export function cameraQuat(
  yaw: number,
  pitch: number,
): readonly [number, number, number, number] {
  const hy = yaw * 0.5;
  const hp = pitch * 0.5;
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sp = Math.sin(hp);
  const cp = Math.cos(hp);
  // qy * qx
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

function applyShakeToEye(
  eye: readonly [number, number, number],
  shake: readonly [number, number, number],
): readonly [number, number, number] {
  return [eye[0]! + shake[0]!, eye[1]! + shake[1]!, eye[2]! + shake[2]!];
}

function decayShake(
  previous: readonly [number, number, number],
  impulse: readonly [number, number, number],
  dt: number,
): readonly [number, number, number] {
  const damp = Math.exp(-SHAKE_DECAY * Math.max(0, dt));
  const x = (previous[0]! + impulse[0]!) * damp;
  const y = (previous[1]! + impulse[1]!) * damp;
  const z = (previous[2]! + impulse[2]!) * damp;
  if (Math.hypot(x, y, z) < 0.005) return [0, 0, 0];
  return [x, y, z];
}

function dampAxis(from: number, to: number, rate: number, dt: number): number {
  const a = 1 - Math.exp(-rate * Math.max(0, dt));
  return from + (to - from) * a;
}

export function createArpgCamera(
  focus: readonly [number, number, number],
  preset: ArpgCameraPreset = DEFAULT_ARPG_PRESET,
): CameraRigState {
  const f: readonly [number, number, number] = [focus[0]!, focus[1]!, focus[2]!];
  const eye = eyeFromOrbit(f, preset.yawRad, preset.pitchRad, preset.distance);
  return {
    mode: 'arpg',
    focus: f,
    eye,
    yaw: preset.yawRad,
    pitch: preset.pitchRad,
    distance: preset.distance,
    verticalFovRad: preset.verticalFovRad,
    shake: [0, 0, 0],
  };
}

/**
 * Frame-rate-independent ARPG follow + bounded wheel zoom + decaying shake.
 * Pitch and yaw stay fixed (preset); zoom only changes distance.
 */
export function updateArpgCamera(
  previous: CameraRigState,
  input: CameraRigInput,
  preset: ArpgCameraPreset,
): CameraRigState {
  const dt = Math.max(0, input.dt);
  const desired = clamp(
    (input.desiredDistance ?? previous.distance) + input.zoomDelta,
    ARPG_DISTANCE_MIN,
    ARPG_DISTANCE_MAX,
  );
  const focus: readonly [number, number, number] = [
    dampAxis(previous.focus[0]!, input.target[0]!, preset.followRate, dt),
    dampAxis(previous.focus[1]!, input.target[1]!, preset.followRate, dt),
    dampAxis(previous.focus[2]!, input.target[2]!, preset.followRate, dt),
  ];
  const yaw = preset.yawRad;
  const pitch = preset.pitchRad;
  const idealEye = eyeFromOrbit(focus, yaw, pitch, desired);
  let allowed = desired;
  if (input.probe) {
    allowed = input.probe.maxDistance(focus, idealEye, ARPG_ARM_SKIN);
    // May pull below zoom-min, but never below the playable ARPG floor.
    allowed = clamp(allowed, ARPG_PROBE_DISTANCE_MIN, desired);
  }

  // Zoom updates desired first (above). Probe contracts immediately;
  // outward recovery always damps — never snap out on wheel.
  let distance: number;
  if (allowed < previous.distance) {
    distance = allowed;
  } else {
    distance = dampAxis(previous.distance, allowed, ARPG_ARM_RECOVER, dt);
  }
  distance = clamp(distance, ARPG_PROBE_DISTANCE_MIN, ARPG_DISTANCE_MAX);

  const shake = decayShake(previous.shake, input.shakeImpulse, dt);
  const baseEye = eyeFromOrbit(focus, yaw, pitch, distance);
  return {
    mode: 'arpg',
    focus,
    eye: applyShakeToEye(baseEye, shake),
    yaw,
    pitch,
    distance,
    verticalFovRad: preset.verticalFovRad,
    shake,
  };
}

/**
 * Camp-only third-person showcase: RMB orbit, spring-arm probe, no combat.
 * Callers must gate skills / loot / entrance while mode === 'showcase'.
 */
export function updateShowcaseCamera(
  previous: CameraRigState,
  input: CameraRigInput,
  /** Initial yaw when entering from arpg; ignored once previous.mode is showcase. */
  facingYaw = 0,
): CameraRigState {
  const dt = Math.max(0, input.dt);
  const focus: readonly [number, number, number] = [
    dampAxis(previous.focus[0]!, input.target[0]!, SHOWCASE_FOLLOW_RATE, dt),
    dampAxis(previous.focus[1]!, input.target[1]! + SHOWCASE_FOCUS_Y, SHOWCASE_FOLLOW_RATE, dt),
    dampAxis(previous.focus[2]!, input.target[2]!, SHOWCASE_FOLLOW_RATE, dt),
  ];

  const baseYaw = previous.mode === 'showcase' ? previous.yaw : facingYaw;
  const basePitch = previous.mode === 'showcase' ? previous.pitch : SHOWCASE_PITCH_RAD;
  const yaw = baseYaw + (input.orbitDeltaYaw ?? 0);
  const pitch = clamp(
    basePitch + (input.orbitDeltaPitch ?? 0),
    SHOWCASE_PITCH_MIN,
    SHOWCASE_PITCH_MAX,
  );

  const desired = clamp(
    input.desiredDistance ?? SHOWCASE_DISTANCE,
    SHOWCASE_DISTANCE_MIN,
    SHOWCASE_DISTANCE_MAX,
  );

  const idealEye = eyeFromOrbit(focus, yaw, pitch, desired);
  let allowed = desired;
  if (input.probe) {
    allowed = input.probe.maxDistance(focus, idealEye, SHOWCASE_ARM_SKIN);
    allowed = clamp(allowed, SHOWCASE_DISTANCE_MIN * 0.5, desired);
  }

  // Contract instantly when blocked; recover smoothly when clear.
  let distance: number;
  if (allowed < previous.distance) {
    distance = allowed;
  } else {
    distance = dampAxis(previous.distance, allowed, SHOWCASE_ARM_RECOVER, dt);
  }
  distance = clamp(distance, SHOWCASE_DISTANCE_MIN * 0.5, SHOWCASE_DISTANCE_MAX);

  const shake = decayShake(previous.shake, input.shakeImpulse, dt);
  const baseEye = eyeFromOrbit(focus, yaw, pitch, distance);
  return {
    mode: 'showcase',
    focus,
    eye: applyShakeToEye(baseEye, shake),
    yaw,
    pitch,
    distance,
    verticalFovRad: SHOWCASE_FOV_RAD,
    shake,
  };
}

/** Smoothstep blend weight for arpg↔showcase transitions. */
export function cameraBlendWeight(elapsedS: number, durationS = CAMERA_MODE_BLEND_S): number {
  const u = clamp(elapsedS / Math.max(1e-6, durationS), 0, 1);
  return u * u * (3 - 2 * u);
}

export function lerpCameraRig(
  from: CameraRigState,
  to: CameraRigState,
  t: number,
  mode: CameraMode,
): CameraRigState {
  const u = clamp(t, 0, 1);
  const lerp = (a: number, b: number) => a + (b - a) * u;
  const lerp3 = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ): readonly [number, number, number] => [lerp(a[0]!, b[0]!), lerp(a[1]!, b[1]!), lerp(a[2]!, b[2]!)];
  // Shortest-path yaw lerp.
  let dy = to.yaw - from.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return {
    mode,
    focus: lerp3(from.focus, to.focus),
    eye: lerp3(from.eye, to.eye),
    yaw: from.yaw + dy * u,
    pitch: lerp(from.pitch, to.pitch),
    distance: lerp(from.distance, to.distance),
    verticalFovRad: lerp(from.verticalFovRad, to.verticalFovRad),
    shake: to.shake,
  };
}

/** Instant focus/eye snap (portals, respawn) — keeps mode/zoom/FOV. */
export function snapCameraFocus(
  previous: CameraRigState,
  focus: readonly [number, number, number],
): CameraRigState {
  const f: readonly [number, number, number] = [focus[0]!, focus[1]!, focus[2]!];
  const baseEye = eyeFromOrbit(f, previous.yaw, previous.pitch, previous.distance);
  return {
    ...previous,
    focus: f,
    eye: applyShakeToEye(baseEye, previous.shake),
  };
}

export function worldToScreen(
  state: CameraRigState,
  wx: number,
  wy: number,
  wz: number,
  aspect: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const rx = wx - state.eye[0]!;
  const ry = wy - state.eye[1]!;
  const rz = wz - state.eye[2]!;
  const rgt = cameraRight(state.yaw);
  const fwd = cameraForward(state.yaw, state.pitch);
  const up = cameraUp(state.yaw, state.pitch);
  const xc = rx * rgt[0]! + ry * rgt[1]! + rz * rgt[2]!;
  const yc = rx * up[0]! + ry * up[1]! + rz * up[2]!;
  const zc = rx * fwd[0]! + ry * fwd[1]! + rz * fwd[2]!;
  if (zc < 0.05) return null;
  const tanHalf = Math.tan(state.verticalFovRad / 2);
  const ndcX = xc / (zc * tanHalf * aspect);
  const ndcY = yc / (zc * tanHalf);
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
  };
}

/** Unproject cursor onto y=0; returns unit aim on XZ from origin, or null. */
export function aimOnGround(
  state: CameraRigState,
  mouseX: number,
  mouseY: number,
  aspect: number,
  width: number,
  height: number,
): { x: number; z: number } | null {
  const rgt = cameraRight(state.yaw);
  const fwd = cameraForward(state.yaw, state.pitch);
  const up = cameraUp(state.yaw, state.pitch);
  const tanHalf = Math.tan(state.verticalFovRad / 2);
  const ndcX = (mouseX / Math.max(1, width)) * 2 - 1;
  const ndcY = 1 - (mouseY / Math.max(1, height)) * 2;
  const dir = {
    x: fwd[0]! + rgt[0]! * ndcX * tanHalf * aspect + up[0]! * ndcY * tanHalf,
    y: fwd[1]! + rgt[1]! * ndcX * tanHalf * aspect + up[1]! * ndcY * tanHalf,
    z: fwd[2]! + rgt[2]! * ndcX * tanHalf * aspect + up[2]! * ndcY * tanHalf,
  };
  if (Math.abs(dir.y) < 1e-4) return null;
  const t = -state.eye[1]! / dir.y;
  if (t <= 0) return null;
  return {
    x: state.eye[0]! + dir.x * t,
    z: state.eye[2]! + dir.z * t,
  };
}
