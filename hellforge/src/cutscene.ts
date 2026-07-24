// Cutscene timeline — PURE logic (no DOM, no engine). A script is flat data:
// fade ramps, letterbox toggles, caption windows, camera keyframes. The
// sampler evaluates it at time t and returns everything a presenter needs.
// DOM chrome lives in cutscene-ui.ts; camera application + input gating live
// in main.ts (UiLayerManager 'cutscene' panel blocks world input).
//
// Design notes (UI-CUTSCENE-UPGRADE-PLAN.md Phase B):
//  • Camera keyframes blend with camera-rig.lerpCameraRig (shortest-yaw path).
//  • Weights are smoothstepped — same ease as the arpg⇄showcase blend.
//  • Camp intro / zone covers assume a safe space. Finisher Hero Shot does NOT
//    — main.ts gates freeze/invuln via cinematic-policy L1 (den) while the seam
//    owns the world channel (see hero-shot-seam.ts). Damage authority never
//    waits on the shot.

import {
  cameraBlendWeight,
  lerpCameraRig,
  snapCameraFocus,
  type CameraRigState,
} from './camera-rig';

/** Finisher Hero Shot cutscene id — L1 den policy in cinematic-policy.ts. */
export const FINISHER_HERO_SHOT_ID = 'finisher-hero-shot';
/** Hard cap from PR2a L5/L6 (≤1.2 s). */
export const FINISHER_HERO_SHOT_MAX_S = 1.2;
/** Authored runtime — keep under the hard cap with a small skip/ease tail. */
export const FINISHER_HERO_SHOT_DURATION_S = 1.15;

/**
 * PR4a L4 Option A — additive finisher face CU (after Hero Shot).
 * Den-safe L1 policy; skippable; best-effort face/eyes readability.
 */
export const FINISHER_FACE_CU_ID = 'finisher-face-cu';
/** Soft wall-clock cap for the CU sting (Hero Shot remains ≤1.2 s). */
export const FINISHER_FACE_CU_MAX_S = 0.9;
/** Authored CU runtime — short push to face/eyes. */
export const FINISHER_FACE_CU_DURATION_S = 0.75;
/**
 * Fallback focus height above player root when no eye bone is resolved.
 * Prefer live `headfront`/`Head` world pos from player-eye-focus.ts at runtime.
 */
export const FINISHER_FACE_CU_FALLBACK_Y = 1.95;

export interface CutsceneCaption {
  readonly text: string;
  readonly sub?: string;
}

export interface FadeRamp {
  /** Seconds from script start. */
  readonly at: number;
  /** Target cover opacity 0..1. */
  readonly to: number;
  readonly dur: number;
}

export interface LetterboxToggle {
  readonly at: number;
  readonly on: boolean;
}

export interface CaptionWindow extends CutsceneCaption {
  readonly at: number;
  readonly dur: number;
}

export interface CameraKey {
  readonly at: number;
  /** Blend duration from the previous pose to this one. */
  readonly dur: number;
  readonly pose: CameraRigState;
}

export interface CutsceneScript {
  readonly id: string;
  readonly skippable: boolean;
  /** Total runtime in seconds; sampler reports done at t >= duration. */
  readonly duration: number;
  /** Cover opacity before the first fade ramp (default 0). */
  readonly initialFade?: number;
  /** Camera pose before the first keyframe (usually the live rig snapshot). */
  readonly initialCamera: CameraRigState;
  readonly fades?: readonly FadeRamp[];
  readonly letterbox?: readonly LetterboxToggle[];
  readonly captions?: readonly CaptionWindow[];
  readonly cameraKeys?: readonly CameraKey[];
}

export interface CutsceneFrame {
  /** Cover opacity 0..1 for this instant. */
  readonly fade: number;
  /** Letterbox target openness 0..1 (UI eases the bars itself). */
  readonly letterbox: number;
  readonly caption: CutsceneCaption | null;
  readonly camera: CameraRigState;
  readonly done: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Evaluate a script at t seconds. Deterministic — safe to unit test. */
export function sampleCutscene(script: CutsceneScript, t: number): CutsceneFrame {
  // ── fade: latest ramp wins; ramps hold their target until the next one ──
  let fade = script.initialFade ?? 0;
  for (const ramp of script.fades ?? []) {
    if (t < ramp.at) break;
    const u = clamp01((t - ramp.at) / Math.max(1e-6, ramp.dur));
    fade = fade + (ramp.to - fade) * cameraBlendWeight(u, 1);
  }

  // ── letterbox: latest toggle decides ────────────────────────────────────
  let letterbox = 0;
  for (const lb of script.letterbox ?? []) {
    if (t < lb.at) break;
    letterbox = lb.on ? 1 : 0;
  }

  // ── caption: the single window containing t ─────────────────────────────
  let caption: CutsceneCaption | null = null;
  for (const c of script.captions ?? []) {
    if (t >= c.at && t < c.at + c.dur) {
      caption = { text: c.text, sub: c.sub };
      break;
    }
  }

  // ── camera: active keyframe blends previous→pose; otherwise hold ────────
  let camera = script.initialCamera;
  let prev = script.initialCamera;
  for (const key of script.cameraKeys ?? []) {
    if (t < key.at) break;
    const u = clamp01((t - key.at) / Math.max(1e-6, key.dur));
    camera = lerpCameraRig(prev, key.pose, cameraBlendWeight(u, 1), key.pose.mode);
    if (u >= 1) prev = key.pose;
  }

  return { fade, letterbox, caption, camera, done: t >= script.duration };
}

export type FinisherHeroShotInput = {
  /** Commit-time AOE center (gameplay authority; presentation only reads it). */
  readonly targetXZ: readonly [number, number];
  readonly playerXZ: readonly [number, number];
  /** Live rig snapshot at commit — becomes initialCamera. */
  readonly camera: CameraRigState;
};

/**
 * Finisher Hero Shot — special-case wall-clock cutscene (PR2a L6/T5).
 * Modest push-in + letterbox; skippable; no long captions. Duration ≤ 1.2 s.
 */
export function buildFinisherHeroShot(input: FinisherHeroShotInput): CutsceneScript {
  const duration = FINISHER_HERO_SHOT_DURATION_S;
  const midFocus: readonly [number, number, number] = [
    (input.playerXZ[0] + input.targetXZ[0]) * 0.5,
    0,
    (input.playerXZ[1] + input.targetXZ[1]) * 0.5,
  ];
  const targetFocus: readonly [number, number, number] = [
    input.targetXZ[0],
    0,
    input.targetXZ[1],
  ];
  const cleared: CameraRigState = { ...input.camera, shake: [0, 0, 0] };
  const initialCamera = snapCameraFocus(cleared, midFocus);
  const pushDist = Math.max(8, cleared.distance * 0.72);
  const pushIn = snapCameraFocus({ ...cleared, distance: pushDist }, targetFocus);
  return {
    id: FINISHER_HERO_SHOT_ID,
    skippable: true,
    duration,
    initialFade: 0,
    initialCamera,
    cameraKeys: [{ at: 0, dur: duration * 0.85, pose: pushIn }],
    letterbox: [
      { at: 0, on: true },
      { at: Math.max(0, duration - 0.18), on: false },
    ],
  };
}

export type FinisherFaceCuInput = {
  readonly playerXZ: readonly [number, number];
  /** Live rig snapshot — becomes initialCamera (mode/fov reused; yaw is replaced). */
  readonly camera: CameraRigState;
  /**
   * Player facing on XZ (same basis as main.ts `faceX`/`faceZ` / mesh yaw).
   * Camera sits in front of this direction looking back at the head — ARPG
   * behind-the-back yaw must NOT be reused or the CU frames the spine.
   */
  readonly faceXZ: readonly [number, number];
  /**
   * Eye look-at world position (prefer live headfront/Head bone via
   * player-eye-focus). When omitted or null, uses FINISHER_FACE_CU_FALLBACK_Y.
   */
  readonly headWorld?: readonly [number, number, number] | null;
};

/**
 * Yaw that places the orbit camera in front of `faceXZ`, looking at the face.
 * Matches mesh yaw basis `atan2(faceX, faceZ)` so forward = -face on XZ.
 */
export function faceCuOrbitYaw(faceXZ: readonly [number, number]): number {
  const fx = faceXZ[0] ?? 0;
  const fz = faceXZ[1] ?? -1;
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) return Math.atan2(0, -1); // default face −Z
  return Math.atan2(fx / len, fz / len);
}

/**
 * Finisher face CU — PR4a L4 Option A.
 * Plays after Hero Shot (main.ts queues it). Skippable; same Escape/Stop
 * restore paths as other owner beats. Does not replace the Hero Shot push-in.
 */
export function buildFinisherFaceCu(input: FinisherFaceCuInput): CutsceneScript {
  const duration = FINISHER_FACE_CU_DURATION_S;
  const cleared: CameraRigState = { ...input.camera, shake: [0, 0, 0] };
  const head: readonly [number, number, number] = input.headWorld
    ?? [input.playerXZ[0], FINISHER_FACE_CU_FALLBACK_Y, input.playerXZ[1]];
  // Front-on: ignore ARPG/Hero-Shot behind yaw — that was framing the back.
  const yaw = faceCuOrbitYaw(input.faceXZ);
  const start = snapCameraFocus(
    {
      ...cleared,
      yaw,
      // Near-level pitch — downward tilt with a low focus reads as chest CU.
      pitch: -0.02,
      distance: 1.35,
      verticalFovRad: Math.min(cleared.verticalFovRad, 0.72),
    },
    head,
  );
  const cu = snapCameraFocus(
    {
      ...start,
      yaw,
      // Extreme face CU — fill frame with eyes/forehead.
      distance: 0.78,
      pitch: 0.04,
      verticalFovRad: 0.48,
    },
    head,
  );
  return {
    id: FINISHER_FACE_CU_ID,
    skippable: true,
    duration,
    initialFade: 0,
    initialCamera: start,
    cameraKeys: [{ at: 0, dur: duration * 0.8, pose: cu }],
    letterbox: [
      { at: 0, on: true },
      { at: Math.max(0, duration - 0.12), on: false },
    ],
  };
}
