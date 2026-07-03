// MarsCraft RTS camera — ported from the Three.js `web/engine/CameraController.ts`
// (`update` + `_updateCameraPosition` + the SC2 spherical model) to a forgeax ECS
// system that drives the camera entity's `Transform` each frame from an InputState.
//
// ── What the source does (faithfully preserved) ──────────────────────────────
// The source camera is a SC2-style 2.5D rig: a FOCUS POINT on the ground, a fixed
// PITCH (looking down), a YAW (locked to 0 by default), and a DISTANCE. The actual
// camera position is the spherical offset of (yaw,pitch,distance) from the focus,
// and the camera looks AT the focus. Per frame:
//   1. pan the focus in the ground plane from keys + edge-scroll (speed scales
//      with distance — "远处平移更快"), then clamp to map bounds;
//   2. accumulate wheel into target distance, clamp to [minHeight,maxHeight];
//   3. smooth yaw/pitch/distance toward their targets (inertia);
//   4. rebuild camera position from the spherical model.
// Middle-drag pans the focus when rotation is locked (grab-the-map), or rotates
// yaw/pitch when unlocked. Bounds, smoothing factors and speeds match the source.
//
// ── forgeax mapping ──────────────────────────────────────────────────────────
// THREE used `camera.position.set(...) + camera.lookAt(focus)`. forgeax `Transform`
// is position + quaternion, no lookAt. The orientation that looks at the focus from
// a (yaw,pitch) spherical offset is exactly R = Ry(yaw) · Rx(pitch) applied to the
// default -Z-looking camera — so we compose the quat directly (no mat4→quat round-
// trip). With yaw=0, pitch=DEFAULT_PITCH this reproduces the inline default the
// scaffold spawned (pitch quat about X, posY≈34/posZ≈26 at mid-zoom).
//
// dt comes from the engine 'Time' resource (inserted by the frame-loop before
// world.update()). The system declares `resources:['Time']` per the cheatsheet.

import { Transform, quat } from '@forgeax/engine-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { InputState } from '../input';

/** SC2-style pitch (look down). Matches the scaffold's inline default (-0.92 rad). */
const DEFAULT_PITCH = -0.92;

export interface RtsCameraOptions {
  /** Map width (world units, X span). Bounds default to ±width/2. */
  mapWidth?: number;
  /** Map height (world units, Z span). Bounds default to ±height/2. */
  mapHeight?: number;
  /** Pan speed (world units/sec) at mid-zoom (source panSpeed=30). */
  panSpeed?: number;
  /** Wheel zoom step factor (source zoomSpeed=5). */
  zoomSpeed?: number;
  /** Nearest distance to focus (source minHeight=15). */
  minDistance?: number;
  /** Farthest distance to focus (source maxHeight=50). */
  maxDistance?: number;
  /** Edge-scroll pan speed (world units/sec, source edgeScrollSpeed=25). */
  edgeScrollSpeed?: number;
  /** Middle-drag rotate sensitivity (rad/px, source rotateSpeed=0.005). */
  rotateSpeed?: number;
  /** Distance smoothing factor 0..1 (source zoomSmooth=0.15). */
  zoomSmooth?: number;
  /** Yaw/pitch smoothing factor 0..1 (source panSmooth=0.2). */
  panSmooth?: number;
  /** Lock camera angle (SC2 default true): middle-drag pans instead of rotating. */
  rotationLocked?: boolean;
  /** Initial focus X (defaults to map center 0). */
  focusX?: number;
  /** Initial focus Z (defaults to map center 0). */
  focusZ?: number;
  /** Fixed pitch when locked (radians, look-down negative). */
  pitch?: number;
}

interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const DEFAULTS = {
  panSpeed: 30,
  zoomSpeed: 5,
  minDistance: 15,
  maxDistance: 50,
  edgeScrollSpeed: 25,
  rotateSpeed: 0.005,
  zoomSmooth: 0.15,
  panSmooth: 0.2,
  rotationLocked: true,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Compose camera orientation Ry(yaw) · Rx(pitch) into `out`. */
function orientFromYawPitch(out: ReturnType<typeof quat.create>, yaw: number, pitch: number): void {
  const qy = quat.create();
  const qx = quat.create();
  quat.fromAxisAngle(qy, [0, 1, 0], yaw);
  quat.fromAxisAngle(qx, [1, 0, 0], pitch);
  // Hamilton product yaw ∘ pitch (yaw applied after pitch in world space).
  quat.multiply(out, qy, qx);
}

/**
 * Register the RTS camera system. It reads `input` each frame and writes the
 * camera entity's `Transform`. Returns a small handle exposing the live target
 * state (focus / distance / yaw) so later milestones (Home jump, minimap click)
 * can drive the camera without re-reading the Transform.
 */
export function installRtsCamera(
  world: World,
  cameraEntity: EntityHandle,
  input: InputState,
  opts: RtsCameraOptions = {},
) {
  const panSpeed = opts.panSpeed ?? DEFAULTS.panSpeed;
  const zoomSpeed = opts.zoomSpeed ?? DEFAULTS.zoomSpeed;
  const minDistance = opts.minDistance ?? DEFAULTS.minDistance;
  const maxDistance = opts.maxDistance ?? DEFAULTS.maxDistance;
  const edgeScrollSpeed = opts.edgeScrollSpeed ?? DEFAULTS.edgeScrollSpeed;
  const rotateSpeed = opts.rotateSpeed ?? DEFAULTS.rotateSpeed;
  const zoomSmooth = opts.zoomSmooth ?? DEFAULTS.zoomSmooth;
  const panSmooth = opts.panSmooth ?? DEFAULTS.panSmooth;
  const fixedPitch = opts.pitch ?? DEFAULT_PITCH;

  const bounds: CameraBounds = {
    minX: opts.mapWidth != null ? -opts.mapWidth / 2 : -100,
    maxX: opts.mapWidth != null ? opts.mapWidth / 2 : 100,
    minZ: opts.mapHeight != null ? -opts.mapHeight / 2 : -100,
    maxZ: opts.mapHeight != null ? opts.mapHeight / 2 : 100,
  };

  // ── live target/current state (source `_focusPoint/_target*/_current*`) ──
  const focus = { x: opts.focusX ?? 0, y: 0, z: opts.focusZ ?? 0 };
  // Mid-zoom default ≈ maxDistance*0.6 (source constructor) → ~30, the scaffold's
  // posY≈34/posZ≈26 framing falls out of the spherical model at this distance.
  let targetDistance = clamp(maxDistance * 0.6, minDistance, maxDistance);
  let currentDistance = targetDistance;
  let targetYaw = 0;
  let currentYaw = 0;
  let targetPitch = fixedPitch;
  let currentPitch = fixedPitch;
  const state = {
    rotationLocked: opts.rotationLocked ?? DEFAULTS.rotationLocked,
    homeX: null as number | null,
    homeZ: null as number | null,
  };

  const writeTransform = () => {
    // Spherical → cartesian (source `_updateCameraPosition`). `-pitch` because
    // pitch is negative (looking down): sin(-pitch)=horizontal radius factor,
    // cos(-pitch)=vertical lift.
    const sp = Math.sin(-currentPitch);
    const cp = Math.cos(-currentPitch);
    const px = focus.x + currentDistance * sp * Math.sin(currentYaw);
    const py = focus.y + currentDistance * cp;
    const pz = focus.z + currentDistance * sp * Math.cos(currentYaw);

    const q = quat.create();
    orientFromYawPitch(q, currentYaw, currentPitch);
    world.set(cameraEntity, Transform, {
      posX: px, posY: py, posZ: pz,
      quatX: q[0] ?? 0, quatY: q[1] ?? 0, quatZ: q[2] ?? 0, quatW: q[3] ?? 1,
    });
  };

  // Place the camera at the initial framing immediately (before frame 1).
  writeTransform();

  world.addSystem({
    name: 'rts-camera',
    queries: [],
    resources: ['Time'],
    fn: () => {
      const dt = world.getResource<{ dt: number }>('Time').dt;
      if (!(dt > 0)) { /* paused frame — still allow drag/zoom drains below */ }

      // ── 1. pan direction in the ground plane (source `_forward/_right`) ──
      // forward = where the camera faces projected onto XZ; right = its right.
      const fwdX = -Math.sin(currentYaw);
      const fwdZ = -Math.cos(currentYaw);
      const rightX = Math.cos(currentYaw);
      const rightZ = -Math.sin(currentYaw);

      let panX = 0; // strafe (right)
      let panZ = 0; // forward

      // Keyboard pan: arrows (WASD reserved for game commands, like the source).
      if (input.keys.has('ArrowUp') || input.keys.has('KeyW')) panZ += 1;
      if (input.keys.has('ArrowDown') || input.keys.has('KeyS')) panZ -= 1;
      if (input.keys.has('ArrowLeft') || input.keys.has('KeyA')) panX -= 1;
      if (input.keys.has('ArrowRight') || input.keys.has('KeyD')) panX += 1;

      // Edge-scroll (source converts edgeScrollSpeed→pan units via /panSpeed so the
      // distance-scaled `speed` below applies uniformly).
      const edgeUnit = edgeScrollSpeed / panSpeed;
      if (input.edgeLeft) panX -= edgeUnit;
      if (input.edgeRight) panX += edgeUnit;
      if (input.edgeUp) panZ += edgeUnit;
      if (input.edgeDown) panZ -= edgeUnit;

      // Apply pan to focus — speed scales with distance ("远处平移更快").
      const speed = panSpeed * (dt > 0 ? dt : 0) * (currentDistance / 30);
      focus.x += (fwdX * panZ + rightX * panX) * speed;
      focus.z += (fwdZ * panZ + rightZ * panX) * speed;

      // ── middle-drag (source `_onMouseMove` middle path) ──
      const drag = input.consumeMiddleDrag();
      if (drag.dx !== 0 || drag.dy !== 0) {
        if (state.rotationLocked) {
          // Grab-the-map pan; sensitivity scales with distance (source /800).
          const panScale = currentDistance / 800;
          focus.x -= drag.dx * panScale;
          focus.z -= drag.dy * panScale;
        } else {
          targetYaw += drag.dx * rotateSpeed;
          targetPitch += drag.dy * rotateSpeed;
          targetPitch = clamp(targetPitch, -Math.PI / 2.2, -0.15);
        }
      }

      // Bounds clamp on the focus.
      focus.x = clamp(focus.x, bounds.minX, bounds.maxX);
      focus.z = clamp(focus.z, bounds.minZ, bounds.maxZ);

      // ── 2. wheel zoom (source `_zoomDelta` → targetDistance) ──
      const wheel = input.consumeWheel();
      if (wheel !== 0) {
        // Zoom-in (wheel up, positive) reduces distance; scales with distance.
        targetDistance -= wheel * zoomSpeed * (targetDistance / 30);
        targetDistance = clamp(targetDistance, minDistance, maxDistance);
      }

      // ── 3. smoothing / inertia (source lerp by panSmooth/zoomSmooth) ──
      currentYaw += (targetYaw - currentYaw) * panSmooth;
      currentPitch += (targetPitch - currentPitch) * panSmooth;
      currentDistance += (targetDistance - currentDistance) * zoomSmooth;

      // Pitch clamp: locked → fixed; unlocked → ranged (source).
      if (state.rotationLocked) {
        currentPitch = fixedPitch;
        targetPitch = fixedPitch;
      } else {
        currentPitch = clamp(currentPitch, -Math.PI / 2.2, -0.15);
      }

      // ── 4. write the camera Transform ──
      writeTransform();
    },
  });

  // ── imperative handle (source jumpTo / setHomePosition / setters) ──
  return {
    /** Jump the focus to a world XZ (source `jumpTo`). */
    jumpTo(x: number, z: number) { focus.x = clamp(x, bounds.minX, bounds.maxX); focus.z = clamp(z, bounds.minZ, bounds.maxZ); },
    /** Set the Home-key target (e.g. spawn/base) (source `setHomePosition`). */
    setHome(x: number, z: number) { state.homeX = x; state.homeZ = z; },
    /** Jump to the stored home position, if any. */
    goHome() { if (state.homeX != null && state.homeZ != null) this.jumpTo(state.homeX, state.homeZ); },
    /** Set zoom distance directly (clamped) (source `set distance`). */
    setDistance(d: number) { targetDistance = clamp(d, minDistance, maxDistance); currentDistance = targetDistance; },
    /** Set yaw directly (source `set yaw`). */
    setYaw(y: number) { targetYaw = y; currentYaw = y; },
    /** Toggle rotation lock (source `set rotationLocked`). */
    setRotationLocked(v: boolean) {
      state.rotationLocked = v;
      if (v) { targetYaw = 0; currentYaw = 0; targetPitch = fixedPitch; currentPitch = fixedPitch; }
    },
    /** Read-only live state (focus / distance / yaw) for HUD / minimap. */
    get focusX() { return focus.x; },
    get focusZ() { return focus.z; },
    get distance() { return currentDistance; },
    get yaw() { return currentYaw; },
  };
}
