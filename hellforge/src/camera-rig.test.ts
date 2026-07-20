import { describe, expect, test } from 'bun:test';
import {
  ARPG_DISTANCE_MAX,
  ARPG_DISTANCE_MIN,
  ARPG_PRESETS,
  CAMERA_MODE_BLEND_MS,
  CAMERA_MODE_BLEND_S,
  DEFAULT_ARPG_PRESET,
  aimOnGround,
  cameraBlendWeight,
  cameraForward,
  cameraQuat,
  createArpgCamera,
  degToRad,
  eyeFromOrbit,
  lerpCameraRig,
  snapCameraFocus,
  updateArpgCamera,
  updateShowcaseCamera,
  worldToScreen,
  type CameraRigInput,
  type CameraRigState,
} from './camera-rig';

function step(
  state: CameraRigState,
  target: readonly [number, number, number],
  dt: number,
  zoomDelta = 0,
  shakeImpulse: readonly [number, number, number] = [0, 0, 0],
): CameraRigState {
  const input: CameraRigInput = { target, dt, zoomDelta, shakeImpulse };
  return updateArpgCamera(state, input, DEFAULT_ARPG_PRESET);
}

describe('degToRad / presets', () => {
  test('presets use degToRad at definition', () => {
    expect(ARPG_PRESETS['fov48-distance12-yaw30'].verticalFovRad).toBeCloseTo(degToRad(48), 8);
    expect(ARPG_PRESETS['fov48-distance12-yaw30'].yawRad).toBeCloseTo(degToRad(30), 8);
    expect(ARPG_PRESETS['fov48-distance12-yaw30'].distance).toBe(12);

    expect(ARPG_PRESETS['fov50-distance12-yaw37'].verticalFovRad).toBeCloseTo(degToRad(50), 8);
    expect(ARPG_PRESETS['fov50-distance12-yaw37'].yawRad).toBeCloseTo(degToRad(37), 8);

    expect(ARPG_PRESETS['fov55-distance12-yaw45'].verticalFovRad).toBeCloseTo(degToRad(55), 8);
    expect(ARPG_PRESETS['fov55-distance12-yaw45'].yawRad).toBeCloseTo(degToRad(45), 8);

    expect(DEFAULT_ARPG_PRESET.id).toBe('fov50-distance12-yaw37');
  });
});

describe('updateArpgCamera follow damping', () => {
  test('60×1/60 and 30×1/30 reach near-equal focus (frame-rate independent)', () => {
    const start = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    const target = [10, 0, -4] as const;

    let a = start;
    for (let i = 0; i < 60; i++) a = step(a, target, 1 / 60);

    let b = start;
    for (let i = 0; i < 30; i++) b = step(b, target, 1 / 30);

    expect(a.focus[0]).toBeCloseTo(b.focus[0]!, 4);
    expect(a.focus[1]).toBeCloseTo(b.focus[1]!, 4);
    expect(a.focus[2]).toBeCloseTo(b.focus[2]!, 4);
    expect(a.eye[0]).toBeCloseTo(b.eye[0]!, 3);
    expect(a.eye[1]).toBeCloseTo(b.eye[1]!, 3);
    expect(a.eye[2]).toBeCloseTo(b.eye[2]!, 3);
  });

  test('focus approaches target without overshooting on a long settle', () => {
    let s = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    const target = [5, 0, 5] as const;
    for (let i = 0; i < 120; i++) s = step(s, target, 1 / 60);
    expect(s.focus[0]).toBeCloseTo(5, 2);
    expect(s.focus[2]).toBeCloseTo(5, 2);
  });
});

describe('updateArpgCamera zoom', () => {
  test('wheel zooms distance within 10–14 m without changing pitch', () => {
    const start = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    expect(start.distance).toBe(12);
    const pitch = start.pitch;

    let zoomedOut = step(start, [0, 0, 0], 0, 5);
    expect(zoomedOut.distance).toBe(ARPG_DISTANCE_MAX);
    expect(zoomedOut.pitch).toBe(pitch);

    let zoomedIn = step(start, [0, 0, 0], 0, -5);
    expect(zoomedIn.distance).toBe(ARPG_DISTANCE_MIN);
    expect(zoomedIn.pitch).toBe(pitch);
  });
});

describe('updateArpgCamera shake', () => {
  test('impulse decays without re-randomizing each frame', () => {
    const start = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    let s = step(start, [0, 0, 0], 1 / 60, 0, [0.2, 0.1, -0.15]);
    const firstShake = [...s.shake] as [number, number, number];
    expect(Math.hypot(...firstShake)).toBeGreaterThan(0.05);

    s = step(s, [0, 0, 0], 1 / 60, 0, [0, 0, 0]);
    // Same direction, smaller magnitude (no new random offset).
    expect(Math.sign(s.shake[0]!)).toBe(Math.sign(firstShake[0]!));
    expect(Math.hypot(s.shake[0]!, s.shake[1]!, s.shake[2]!)).toBeLessThan(
      Math.hypot(...firstShake),
    );

    for (let i = 0; i < 90; i++) s = step(s, [0, 0, 0], 1 / 60);
    expect(s.shake[0]).toBe(0);
    expect(s.shake[1]).toBe(0);
    expect(s.shake[2]).toBe(0);
  });
});

describe('projection helpers', () => {
  test('eye lies along -forward from focus at distance', () => {
    const preset = DEFAULT_ARPG_PRESET;
    const focus = [1, 0, 2] as const;
    const eye = eyeFromOrbit(focus, preset.yawRad, preset.pitchRad, preset.distance);
    const fwd = cameraForward(preset.yawRad, preset.pitchRad);
    const dx = focus[0] - eye[0]!;
    const dy = focus[1] - eye[1]!;
    const dz = focus[2] - eye[2]!;
    const len = Math.hypot(dx, dy, dz);
    expect(len).toBeCloseTo(preset.distance, 6);
    expect(dx / len).toBeCloseTo(fwd[0]!, 6);
    expect(dy / len).toBeCloseTo(fwd[1]!, 6);
    expect(dz / len).toBeCloseTo(fwd[2]!, 6);
  });

  test('worldToScreen and aimOnGround share CameraRigState FOV', () => {
    const s = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    const screen = worldToScreen(s, 0, 0, 0, 16 / 9, 1920, 1080);
    expect(screen).not.toBeNull();
    expect(screen!.x).toBeGreaterThan(0);
    expect(screen!.x).toBeLessThan(1920);

    const hit = aimOnGround(s, 960, 540, 16 / 9, 1920, 1080);
    expect(hit).not.toBeNull();

    const q = cameraQuat(s.yaw, s.pitch);
    expect(Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!)).toBeCloseTo(1, 5);
  });

  test('snapCameraFocus jumps without damping', () => {
    let s = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    s = step(s, [0, 0, 0], 1 / 60);
    s = snapCameraFocus(s, [40, 0, 40]);
    expect(s.focus[0]).toBe(40);
    expect(s.focus[2]).toBe(40);
  });
});

describe('showcase camera', () => {
  test('mode is showcase with closer arm and combat FOV not used', () => {
    const arpg = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    const show = updateShowcaseCamera(arpg, {
      target: [0, 0, 0],
      dt: 1 / 60,
      zoomDelta: 0,
      shakeImpulse: [0, 0, 0],
    }, 0);
    expect(show.mode).toBe('showcase');
    expect(show.distance).toBeLessThan(arpg.distance);
    expect(show.verticalFovRad).not.toBe(arpg.verticalFovRad);
  });

  test('explicit orbit deltas change yaw/pitch; no edge-screen input', () => {
    let s = updateShowcaseCamera(createArpgCamera([0, 0, 0]), {
      target: [0, 0, 0],
      dt: 0,
      zoomDelta: 0,
      shakeImpulse: [0, 0, 0],
    }, 0.5);
    const yaw0 = s.yaw;
    const pitch0 = s.pitch;
    s = updateShowcaseCamera(s, {
      target: [0, 0, 0],
      dt: 1 / 60,
      zoomDelta: 0,
      shakeImpulse: [0, 0, 0],
      orbitDeltaYaw: 0.2,
      orbitDeltaPitch: -0.1,
    });
    expect(s.yaw).toBeCloseTo(yaw0 + 0.2, 5);
    expect(s.pitch).toBeLessThan(pitch0);
  });

  test('blend weight reaches 1 inside 350–500 ms window', () => {
    expect(cameraBlendWeight(0, CAMERA_MODE_BLEND_S)).toBe(0);
    expect(cameraBlendWeight(CAMERA_MODE_BLEND_S, CAMERA_MODE_BLEND_S)).toBe(1);
    expect(CAMERA_MODE_BLEND_MS).toBeGreaterThanOrEqual(350);
    expect(CAMERA_MODE_BLEND_MS).toBeLessThanOrEqual(500);
    const mid = cameraBlendWeight(CAMERA_MODE_BLEND_S * 0.5);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  test('lerpCameraRig interpolates FOV and arm length', () => {
    const a = createArpgCamera([0, 0, 0]);
    const b = updateShowcaseCamera(a, {
      target: [0, 0, 0],
      dt: 0,
      zoomDelta: 0,
      shakeImpulse: [0, 0, 0],
    }, 0);
    const m = lerpCameraRig(a, b, 0.5, 'showcase');
    expect(m.verticalFovRad).toBeCloseTo((a.verticalFovRad + b.verticalFovRad) / 2, 5);
    expect(m.distance).toBeCloseTo((a.distance + b.distance) / 2, 5);
    expect(m.mode).toBe('showcase');
  });
});
