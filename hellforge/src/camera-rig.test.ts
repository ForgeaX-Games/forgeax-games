import { describe, expect, test } from 'bun:test';
import { createObstacleCameraProbe, type ProbeBlocker } from './camera-probe';
import {
  ARPG_ARM_SKIN,
  ARPG_DISTANCE_MAX,
  ARPG_DISTANCE_MIN,
  ARPG_PROBE_DISTANCE_MIN,
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

    // Zoom-in contracts immediately (desired shrinks below previous).
    let zoomedIn = step(start, [0, 0, 0], 0, -5);
    expect(zoomedIn.distance).toBe(ARPG_DISTANCE_MIN);
    expect(zoomedIn.pitch).toBe(pitch);

    // Zoom-out updates desired then recovers with damp (no outward snap).
    const desiredOut = ARPG_DISTANCE_MAX;
    let zoomedOut = updateArpgCamera(start, {
      target: [0, 0, 0],
      dt: 1 / 60,
      zoomDelta: 5,
      shakeImpulse: [0, 0, 0],
      desiredDistance: start.distance,
    }, DEFAULT_ARPG_PRESET);
    expect(zoomedOut.distance).toBeGreaterThan(start.distance);
    expect(zoomedOut.distance).toBeLessThan(desiredOut);
    expect(zoomedOut.pitch).toBe(pitch);
    for (let i = 0; i < 90; i++) {
      zoomedOut = updateArpgCamera(zoomedOut, {
        target: [0, 0, 0],
        dt: 1 / 60,
        zoomDelta: 0,
        shakeImpulse: [0, 0, 0],
        desiredDistance: desiredOut,
      }, DEFAULT_ARPG_PRESET);
    }
    expect(zoomedOut.distance).toBeCloseTo(desiredOut, 1);
  });
});

describe('updateArpgCamera obstacle probe', () => {
  test('contracts to the probe distance in one ARPG step when blocked', () => {
    const start = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    const blocker: ProbeBlocker = {
      type: 'aabb',
      min: [1.8, 2.4],
      max: [2.7, 3.5],
      probeHeight: 8,
      probePad: 0,
    };
    const probe = createObstacleCameraProbe([blocker]);
    const focus = start.focus;
    const idealEye = eyeFromOrbit(
      focus,
      DEFAULT_ARPG_PRESET.yawRad,
      DEFAULT_ARPG_PRESET.pitchRad,
      start.distance,
    );
    const raw = probe.maxDistance(focus, idealEye, ARPG_ARM_SKIN);
    const expected = Math.max(ARPG_PROBE_DISTANCE_MIN, Math.min(start.distance, raw));

    const blocked = updateArpgCamera(start, {
      target: [0, 0, 0],
      dt: 1 / 60,
      zoomDelta: 0,
      shakeImpulse: [0, 0, 0],
      desiredDistance: start.distance,
      probe,
    }, DEFAULT_ARPG_PRESET);

    expect(raw).toBeLessThan(ARPG_DISTANCE_MIN);
    expect(blocked.distance).toBeCloseTo(expected, 5);
    expect(blocked.distance).toBeGreaterThanOrEqual(ARPG_PROBE_DISTANCE_MIN);
    expect(blocked.distance).toBeLessThan(start.distance);
    expect(Math.hypot(
      blocked.eye[0]! - blocked.focus[0]!,
      blocked.eye[1]! - blocked.focus[1]!,
      blocked.eye[2]! - blocked.focus[2]!,
    )).toBeCloseTo(blocked.distance, 5);
  });

  test('never contracts below the playable ARPG probe floor', () => {
    const start = createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET);
    // Huge blocker that would resolve to ~skin distance without a floor.
    const blocker: ProbeBlocker = {
      type: 'aabb',
      min: [-2, -2],
      max: [8, 8],
      probeHeight: 12,
      probePad: 0,
    };
    const probe = createObstacleCameraProbe([blocker]);
    const blocked = updateArpgCamera(start, {
      target: [0, 0, 0],
      dt: 1 / 60,
      zoomDelta: 0,
      shakeImpulse: [0, 0, 0],
      desiredDistance: start.distance,
      probe,
    }, DEFAULT_ARPG_PRESET);
    expect(blocked.distance).toBe(ARPG_PROBE_DISTANCE_MIN);
  });

  test('recovers smoothly toward desired ARPG distance when the probe is free', () => {
    const contracted: CameraRigState = {
      ...createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET),
      distance: ARPG_PROBE_DISTANCE_MIN,
      eye: eyeFromOrbit(
        [0, 0, 0],
        DEFAULT_ARPG_PRESET.yawRad,
        DEFAULT_ARPG_PRESET.pitchRad,
        ARPG_PROBE_DISTANCE_MIN,
      ),
    };
    const probe = createObstacleCameraProbe([]);

    const free = updateArpgCamera(contracted, {
      target: [0, 0, 0],
      dt: 1 / 60,
      zoomDelta: 0,
      shakeImpulse: [0, 0, 0],
      desiredDistance: DEFAULT_ARPG_PRESET.distance,
      probe,
    }, DEFAULT_ARPG_PRESET);

    expect(free.distance).toBeGreaterThan(contracted.distance);
    expect(free.distance).toBeLessThan(ARPG_DISTANCE_MIN);
    expect(free.distance).toBeLessThan(DEFAULT_ARPG_PRESET.distance);
  });

  test('contracted + clear probe + nonzero zoomDelta does not jump to full desired', () => {
    const contracted: CameraRigState = {
      ...createArpgCamera([0, 0, 0], DEFAULT_ARPG_PRESET),
      distance: ARPG_PROBE_DISTANCE_MIN,
      eye: eyeFromOrbit(
        [0, 0, 0],
        DEFAULT_ARPG_PRESET.yawRad,
        DEFAULT_ARPG_PRESET.pitchRad,
        ARPG_PROBE_DISTANCE_MIN,
      ),
    };
    const probe = createObstacleCameraProbe([]);
    const desiredDistance = DEFAULT_ARPG_PRESET.distance;
    const zoomDelta = 0.5;

    const frame = updateArpgCamera(contracted, {
      target: [0, 0, 0],
      dt: 1 / 60,
      zoomDelta,
      shakeImpulse: [0, 0, 0],
      desiredDistance,
      probe,
    }, DEFAULT_ARPG_PRESET);

    const fullDesired = Math.min(ARPG_DISTANCE_MAX, desiredDistance + zoomDelta);
    expect(frame.distance).toBeGreaterThan(contracted.distance);
    expect(frame.distance).toBeLessThan(fullDesired);
    expect(frame.distance).toBeLessThan(ARPG_DISTANCE_MIN);
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
