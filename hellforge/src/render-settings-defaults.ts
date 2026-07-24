/**
 * Hellforge render-settings defaults + L3 CSS disposition (no engine imports —
 * safe for bun unit tests in the games leaf).
 */

export type RenderSettingsDefaults = {
  tonemap: 'aces' | 'agx' | 'neutral' | 'cineon' | 'reinhard' | 'linear';
  exposure: number;
  whitePoint: number;
  antialias: 'none' | 'fxaa' | 'msaa';
  bloom: boolean;
  bloomThreshold: number;
  bloomIntensity: number;
  bloomBlurRadius: number;
  sunMul: number;
  ambientMul: number;
  fireMul: number;
  fillMul: number;
  atmoTemp: number;
  vignette: number;
  haze: number;
  particleDensity: number;
  particleStyle: 'auto' | 'ash' | 'snow' | 'off';
  renderScale: number;
  fpsCap: number;
  bgmVolume: number;
  sfxVolume: number;
};

/**
 * PR2c T4 grade table (SSOT for plan §5.4 / §7 T4).
 *
 * | Knob              | Value  | Notes |
 * |-------------------|--------|-------|
 * | tonemap           | aces   | L4 keep — AgX A/B BLOCKED (no Play/screenshots on this stack); do not flip without evidence |
 * | exposure          | 0.42   | F10 base; per-area × `exposureMulForArea` (den 1.0 / camp 1.05 / wild 1.18) |
 * | whitePoint        | 4.5    | Belfast HDR crush — sky not blown white |
 * | bloom             | true   | |
 * | bloomThreshold    | 1.20   | Above frost-fang custom-shader `ampSafe` ≤1.05; catches fire-bolt peaks (~1.1–1.3) + fixture ei≥2 |
 * | bloomIntensity    | 0.65   | Fire / fixture emissives read without skin midtone wash |
 * | bloomBlurRadius   | 4.0    | Soft halo — engine bloom-blur.wgsl clamps to 4.0 |
 *
 * Bloom vs VFX: frost-fang *custom shaders* clamp `ampSafe` ≤~1.05 (stay out of
 * the bright pass). Frost impact/shatter EffectDef uses shared `ice` standard
 * mat at emissiveIntensity 1.4 — those particles can cross 1.20. Fire-bolt /
 * den flame emissives cross the threshold. `portalMaterial()` is defined but
 * has no rendered call site under hellforge/src — do not treat portal bloom as
 * gameplay-proven. Skin under den/camp pools stays below threshold.
 */
export const RENDER_SETTINGS_DEFAULTS: RenderSettingsDefaults = {
  tonemap: 'aces',
  exposure: 0.42,
  whitePoint: 4.5,
  antialias: 'fxaa',
  bloom: true,
  bloomThreshold: 1.20,
  bloomIntensity: 0.65,
  bloomBlurRadius: 4.0,
  sunMul: 0.55,
  ambientMul: 0.42,
  fireMul: 1.4,
  fillMul: 0.70,
  atmoTemp: 0.50,
  vignette: 0.65,
  haze: 0.70,
  particleDensity: 1.15,
  particleStyle: 'auto',
  renderScale: 1,
  fpsCap: 0,
  bgmVolume: 0.22,
  sfxVolume: 1,
};

/** L3: CSS atmosphere overlays are not mounted once the HDR pass owns the look. */
export const ATMOSPHERE_CSS_OVERLAYS_ENABLED = false;
