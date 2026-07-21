// Cutscene timeline — PURE logic (no DOM, no engine). A script is flat data:
// fade ramps, letterbox toggles, caption windows, camera keyframes. The
// sampler evaluates it at time t and returns everything a presenter needs.
// DOM chrome lives in cutscene-ui.ts; camera application + input gating live
// in main.ts (UiLayerManager 'cutscene' panel blocks world input).
//
// Design notes (UI-CUTSCENE-UPGRADE-PLAN.md Phase B):
//  • Camera keyframes blend with camera-rig.lerpCameraRig (shortest-yaw path).
//  • Weights are smoothstepped — same ease as the arpg⇄showcase blend.
//  • Nothing here pauses the world; scripts are built for safe spaces (camp)
//    or instantaneous covers (zone travel uses ui-transition.zoneCard).

import { cameraBlendWeight, lerpCameraRig, type CameraRigState } from './camera-rig';

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
