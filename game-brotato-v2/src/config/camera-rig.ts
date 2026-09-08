import { ARENA } from './arena.ts';

export const VIEW = {
  /** 地面可视区域最大边长的硬约束。 */
  maxExtent: 25,
  fov: (50 * Math.PI) / 180,
  tilt: (22 * Math.PI) / 180,
  deadZoneRatio: 0.35,
  followLambda: 6,
} as const;

export const CAMERA_RIG_RESOURCE_KEY = 'BrotatoV2CameraRig' as const;

export interface CameraRig {
  readonly distance: number;
  readonly height: number;
  readonly backOffset: number;
  readonly visibleWidth: number;
  readonly visibleDepth: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  /** Conservative ground half-extents at the camera's near (screen-bottom) edge. */
  readonly nearHalfWidth: number;
  readonly nearHalfDepth: number;
  readonly clampX: number;
  readonly clampZ: number;
  readonly deadZoneX: number;
  readonly deadZoneZ: number;
  readonly gainX: number;
  readonly gainZ: number;
}

function positiveAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

/** Invert the perspective projection so the ground footprint never exceeds 25×25. */
export function computeCameraRig(aspect: number): CameraRig {
  const safeAspect = positiveAspect(aspect);
  const halfFov = VIEW.fov / 2;
  const tiltCos = Math.cos(VIEW.tilt);
  const groundScale = 2 * Math.tan(halfFov);
  const distance = VIEW.maxExtent / (groundScale * Math.max(safeAspect, 1 / tiltCos));
  const halfWidth = distance * Math.tan(halfFov) * safeAspect;
  const halfDepth = distance * Math.tan(halfFov) / tiltCos;
  // A tilted perspective camera does not see a symmetric ground rectangle:
  // the near edge is compressed toward the camera. Follow bounds must use the
  // actual screen-bottom footprint, otherwise the player can outrun the
  // camera into the bottom edge while the nominal dead zone is still active.
  const verticalTangent = Math.tan(halfFov);
  const sinTilt = Math.sin(VIEW.tilt);
  const nearRayY = -tiltCos - verticalTangent * sinTilt;
  const nearRayZ = -sinTilt + verticalTangent * tiltCos;
  const nearRayDistance = distance * tiltCos / Math.max(Number.EPSILON, -nearRayY);
  const nearHalfWidth = nearRayDistance * verticalTangent * safeAspect;
  const nearHalfDepth = Math.max(0, nearRayDistance * nearRayZ);
  const visibleWidth = halfWidth * 2;
  const visibleDepth = halfDepth * 2;
  const clampX = Math.max(0, ARENA.wallOffset - nearHalfWidth);
  const clampZ = Math.max(0, ARENA.wallOffset - nearHalfDepth);
  const deadZoneX = nearHalfWidth * VIEW.deadZoneRatio;
  const deadZoneZ = nearHalfDepth * VIEW.deadZoneRatio;
  const gainX = clampX / Math.max(Number.EPSILON, ARENA.limit - deadZoneX);
  const gainZ = clampZ / Math.max(Number.EPSILON, ARENA.limit - deadZoneZ);

  return {
    distance,
    height: distance * tiltCos,
    backOffset: distance * Math.sin(VIEW.tilt),
    visibleWidth,
    visibleDepth,
    halfWidth,
    halfDepth,
    nearHalfWidth,
    nearHalfDepth,
    clampX,
    clampZ,
    deadZoneX,
    deadZoneZ,
    gainX,
    gainZ,
  };
}

/** Derive the bounded camera-center offset from one player coordinate. */
export function desiredCameraOffset(position: number, deadZone: number, gain: number, clamp: number): number {
  const overshoot = Math.max(0, Math.abs(position) - deadZone);
  return Math.max(-clamp, Math.min(clamp, Math.sign(position) * overshoot * gain));
}

/**
 * Keep a player inside a conservative ground-plane half-extent after the
 * smoothed follow step. This only catches up when smoothing would let the
 * player cross the near edge; ordinary motion remains soft.
 */
export function constrainCameraCenter(center: number, playerPosition: number, halfExtent: number): number {
  return Math.max(playerPosition - halfExtent, Math.min(playerPosition + halfExtent, center));
}
