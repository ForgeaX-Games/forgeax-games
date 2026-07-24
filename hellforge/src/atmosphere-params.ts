/** Shared atmosphere UBO packing + T1 disposition constants (no WGSL import). */

export const PIPELINE_ID = 'hellforge::pipeline';
export const ATMOSPHERE_SHADER_ID = 'hellforge::atmosphere';

/** Always-on for T1 — CSS overlays are dispositioned, not feature-flagged off. */
export const ATMOSPHERE_PASS_ENABLED = true;

/**
 * L3 disposition (plan §4): vignette CSS removed once HDR pass lands; haze CSS
 * also removed because the HDR vertical gradient replaces it (no ≤0.3 fallback).
 */
export const ATMOSPHERE_CSS_DISPOSITION = {
  vignette: 'removed',
  haze: 'removed',
} as const;

export const ATMOSPHERE_PARAMS_BYTE_SIZE = 16;

/** CharSelect readability dim (replaces old CSS opacity 0.28 / 0.22). */
export const ATMOSPHERE_PREVIEW_DIM = { vignette: 0.28, haze: 0.22 } as const;

export type AtmosphereKnobs = {
  vignette: number;
  haze: number;
  atmoTemp: number;
};

export function packAtmosphereParams(knobs: AtmosphereKnobs): Uint8Array {
  const buf = new ArrayBuffer(ATMOSPHERE_PARAMS_BYTE_SIZE);
  const f32 = new Float32Array(buf);
  f32[0] = clamp(knobs.vignette, 0, 0.8);
  f32[1] = clamp(knobs.haze, 0, 1);
  f32[2] = clamp(knobs.atmoTemp, -1, 1);
  f32[3] = 0;
  return new Uint8Array(buf);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
