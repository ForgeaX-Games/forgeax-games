// PR4a T3 — Authored real-time narrative beats (wall-clock CutsceneScript).
// Beat ids match L1 policy table keys in cinematic-policy.ts.
// Finisher Hero Shot stays in cutscene.ts; face CU is additive there too.

import {
  snapCameraFocus,
  type CameraRigState,
} from './camera-rig';
import {
  BEAT_BOSS_DEFEAT,
  BEAT_BOSS_ENTRANCE,
  BEAT_CAMP_ARRIVAL,
  BEAT_QUEST_ACCEPTANCE,
} from './cinematic-policy';
import type { CutsceneScript } from './cutscene';

export type BeatCameraInput = {
  readonly camera: CameraRigState;
  readonly playerXZ: readonly [number, number];
};

function cleared(camera: CameraRigState): CameraRigState {
  return { ...camera, shake: [0, 0, 0] };
}

function xzFocus(
  xz: readonly [number, number],
  y = 0,
): readonly [number, number, number] {
  return [xz[0], y, xz[1]];
}

function midXZ(
  a: readonly [number, number],
  b: readonly [number, number],
): readonly [number, number] {
  return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
}

/** Camp arrival — black → wide push-in → letterbox off (migrated from main). */
export function buildCampArrivalBeat(input: BeatCameraInput): CutsceneScript {
  const base = cleared(input.camera);
  const arpg = snapCameraFocus(base, xzFocus(input.playerXZ));
  const wide = snapCameraFocus({ ...arpg, distance: 24 }, xzFocus(input.playerXZ));
  return {
    id: BEAT_CAMP_ARRIVAL,
    skippable: true,
    duration: 3.4,
    initialFade: 1,
    initialCamera: wide,
    cameraKeys: [{ at: 0, dur: 3.0, pose: arpg }],
    fades: [{ at: 0, to: 0, dur: 1.4 }],
    letterbox: [
      { at: 0, on: true },
      { at: 2.7, on: false },
    ],
    captions: [
      { at: 0.7, dur: 2.1, text: '余烬哨站', sub: 'Cinderwatch · 第一幕' },
    ],
  };
}

export type QuestAcceptanceBeatInput = BeatCameraInput & {
  /** Veyra XZ — camera eases toward her; falls back to player if omitted. */
  readonly veyraXZ?: readonly [number, number];
};

/** Quest acceptance (Veyra) — ≤3 s camera emphasis; dialogue stays typewriter. */
export function buildQuestAcceptanceBeat(
  input: QuestAcceptanceBeatInput,
): CutsceneScript {
  const duration = 2.6;
  const base = cleared(input.camera);
  const focusXZ = input.veyraXZ ?? input.playerXZ;
  const start = snapCameraFocus(base, xzFocus(input.playerXZ));
  const toward = snapCameraFocus(
    { ...base, distance: Math.max(8, base.distance * 0.82) },
    xzFocus(focusXZ, 0.6),
  );
  return {
    id: BEAT_QUEST_ACCEPTANCE,
    skippable: true,
    duration,
    initialFade: 0,
    initialCamera: start,
    cameraKeys: [{ at: 0, dur: duration * 0.75, pose: toward }],
    letterbox: [
      { at: 0, on: true },
      { at: Math.max(0, duration - 0.35), on: false },
    ],
    captions: [
      { at: 0.25, dur: 1.8, text: '委托已接', sub: '清剿熔渣深窟' },
    ],
  };
}

export type BossBeatInput = BeatCameraInput & {
  readonly bossXZ: readonly [number, number];
};

/** Boss entrance — den-safe sting as the player first enters boss range. */
export function buildBossEntranceBeat(input: BossBeatInput): CutsceneScript {
  const duration = 2.4;
  const base = cleared(input.camera);
  const mid = midXZ(input.playerXZ, input.bossXZ);
  const start = snapCameraFocus(base, xzFocus(mid));
  const reveal = snapCameraFocus(
    { ...base, distance: Math.max(14, base.distance * 1.15) },
    xzFocus(input.bossXZ, 0.8),
  );
  return {
    id: BEAT_BOSS_ENTRANCE,
    skippable: true,
    duration,
    initialFade: 0,
    initialCamera: start,
    cameraKeys: [{ at: 0, dur: duration * 0.8, pose: reveal }],
    letterbox: [
      { at: 0, on: true },
      { at: Math.max(0, duration - 0.3), on: false },
    ],
    captions: [
      { at: 0.2, dur: 1.6, text: '熔渣督军', sub: 'Slaglord' },
    ],
  };
}

/** Boss defeat sting — domain death event; independent of finisher Hero Shot. */
export function buildBossDefeatBeat(input: BossBeatInput): CutsceneScript {
  const duration = 2.2;
  const base = cleared(input.camera);
  const start = snapCameraFocus(base, xzFocus(input.bossXZ, 0.4));
  const hold = snapCameraFocus(
    { ...base, distance: Math.max(10, base.distance * 0.9) },
    xzFocus(input.bossXZ, 0.9),
  );
  return {
    id: BEAT_BOSS_DEFEAT,
    skippable: true,
    duration,
    initialFade: 0,
    initialCamera: start,
    cameraKeys: [{ at: 0, dur: duration * 0.7, pose: hold }],
    letterbox: [
      { at: 0, on: true },
      { at: Math.max(0, duration - 0.28), on: false },
    ],
    captions: [
      { at: 0.15, dur: 1.5, text: '督军已陨', sub: 'Slaglord fallen' },
    ],
  };
}
