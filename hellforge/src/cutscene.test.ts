// Cutscene timeline sampler — pure-logic contract tests (no DOM).

import { describe, expect, test } from 'bun:test';
import { degToRad, type CameraRigState } from './camera-rig';
import {
  buildFinisherHeroShot,
  FINISHER_HERO_SHOT_ID,
  FINISHER_HERO_SHOT_MAX_S,
  sampleCutscene,
  type CutsceneScript,
} from './cutscene';

function rig(distance: number, yaw = 0): CameraRigState {
  return {
    mode: 'arpg',
    focus: [0, 0, 0],
    eye: [0, distance, distance],
    yaw,
    pitch: -degToRad(52),
    distance,
    verticalFovRad: degToRad(45),
    shake: [0, 0, 0],
  };
}

function script(overrides: Partial<CutsceneScript> = {}): CutsceneScript {
  return {
    id: 'test',
    skippable: true,
    duration: 4,
    initialCamera: rig(20),
    fades: [
      { at: 0, to: 1, dur: 0.5 },
      { at: 3, to: 0, dur: 1 },
    ],
    letterbox: [
      { at: 0, on: true },
      { at: 3.5, on: false },
    ],
    captions: [
      { at: 0.5, dur: 2, text: '余烬哨站', sub: 'Cinderwatch' },
      { at: 2.8, dur: 0.6, text: '进发' },
    ],
    cameraKeys: [
      { at: 0, dur: 2, pose: rig(10) },
      { at: 2, dur: 2, pose: rig(10, Math.PI / 2) },
    ],
    ...overrides,
  };
}

describe('sampleCutscene', () => {
  test('fade ramps from initialFade toward targets and holds', () => {
    const s = script();
    expect(sampleCutscene(s, 0).fade).toBe(0); // ramp just started
    const mid = sampleCutscene(s, 0.25).fade;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(sampleCutscene(s, 0.6).fade).toBe(1); // ramp completed → hold
    expect(sampleCutscene(s, 2.9).fade).toBe(1); // still held before fade-out
    expect(sampleCutscene(s, 4).fade).toBe(0); // fade-out finished
  });

  test('initialFade is honored before the first ramp', () => {
    const s = script({ initialFade: 1, fades: [{ at: 1, to: 0, dur: 1 }] });
    expect(sampleCutscene(s, 0).fade).toBe(1);
    expect(sampleCutscene(s, 0.5).fade).toBe(1);
    expect(sampleCutscene(s, 2).fade).toBe(0);
  });

  test('letterbox follows the latest toggle', () => {
    const s = script();
    expect(sampleCutscene(s, 0).letterbox).toBe(1);
    expect(sampleCutscene(s, 3.4).letterbox).toBe(1);
    expect(sampleCutscene(s, 3.6).letterbox).toBe(0);
  });

  test('caption windows are exclusive and closed on the right', () => {
    const s = script();
    expect(sampleCutscene(s, 0.4).caption).toBeNull();
    expect(sampleCutscene(s, 0.5).caption?.text).toBe('余烬哨站');
    expect(sampleCutscene(s, 2.49).caption?.text).toBe('余烬哨站');
    expect(sampleCutscene(s, 2.5).caption).toBeNull(); // window is [at, at+dur)
    expect(sampleCutscene(s, 3).caption?.text).toBe('进发');
    expect(sampleCutscene(s, 3.5).caption).toBeNull();
  });

  test('camera blends between keyframes then holds the last pose', () => {
    const s = script();
    expect(sampleCutscene(s, 0).camera.distance).toBe(20); // starts at initial
    const t1 = sampleCutscene(s, 1).camera.distance;
    expect(t1).toBeGreaterThan(10);
    expect(t1).toBeLessThan(20);
    expect(sampleCutscene(s, 2).camera.distance).toBe(10); // first key landed
    const yawMid = sampleCutscene(s, 3).camera.yaw;
    expect(yawMid).toBeGreaterThan(0);
    expect(yawMid).toBeLessThan(Math.PI / 2);
    expect(sampleCutscene(s, 4).camera.yaw).toBeCloseTo(Math.PI / 2, 5);
  });

  test('no camera keys → camera holds initialCamera', () => {
    const s = script({ cameraKeys: [] });
    expect(sampleCutscene(s, 2).camera.distance).toBe(20);
  });

  test('done flips at duration', () => {
    const s = script();
    expect(sampleCutscene(s, 3.999).done).toBe(false);
    expect(sampleCutscene(s, 4).done).toBe(true);
  });
});

describe('buildFinisherHeroShot (PR2a T5)', () => {
  test('builds a skippable ≤1.2 s script aimed at commit-time target XZ', () => {
    const camera = rig(12);
    const shot = buildFinisherHeroShot({
      targetXZ: [4, -2],
      playerXZ: [0, 0],
      camera,
    });
    expect(shot.id).toBe(FINISHER_HERO_SHOT_ID);
    expect(shot.skippable).toBe(true);
    expect(shot.duration).toBeLessThanOrEqual(FINISHER_HERO_SHOT_MAX_S);
    expect(shot.duration).toBeGreaterThan(0);
    expect(sampleCutscene(shot, shot.duration).done).toBe(true);
    // Modest push-in: end distance ≤ start.
    const startDist = sampleCutscene(shot, 0).camera.distance;
    const endDist = sampleCutscene(shot, shot.duration).camera.distance;
    expect(endDist).toBeLessThanOrEqual(startDist);
    // Focus drifts toward the target (not stuck on the player origin).
    const endFocus = sampleCutscene(shot, shot.duration).camera.focus;
    expect(endFocus[0]).toBeCloseTo(4, 1);
    expect(endFocus[2]).toBeCloseTo(-2, 1);
  });
});
