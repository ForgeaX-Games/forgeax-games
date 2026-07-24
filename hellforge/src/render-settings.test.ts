import { describe, expect, test } from 'bun:test';
import {
  ATMOSPHERE_CSS_OVERLAYS_ENABLED,
  RENDER_SETTINGS_DEFAULTS,
} from './render-settings-defaults';
import {
  ATMOSPHERE_CSS_DISPOSITION,
  ATMOSPHERE_PARAMS_BYTE_SIZE,
  ATMOSPHERE_PASS_ENABLED,
  ATMOSPHERE_PREVIEW_DIM,
  ATMOSPHERE_SHADER_ID,
  PIPELINE_ID,
  packAtmosphereParams,
} from './atmosphere-params';

describe('render-settings defaults (PR2c T1 + T4 grade)', () => {
  test('grade defaults match hellforge dark baseline', () => {
    expect(RENDER_SETTINGS_DEFAULTS.tonemap).toBe('aces');
    expect(RENDER_SETTINGS_DEFAULTS.exposure).toBe(0.42);
    expect(RENDER_SETTINGS_DEFAULTS.bloom).toBe(true);
    expect(RENDER_SETTINGS_DEFAULTS.vignette).toBe(0.65);
    expect(RENDER_SETTINGS_DEFAULTS.haze).toBe(0.70);
    expect(RENDER_SETTINGS_DEFAULTS.atmoTemp).toBe(0.50);
  });

  test('T4 locked grade table: tonemap/exposure/whitePoint/bloom', () => {
    // L4: keep ACES until AgX A/B has Play evidence (do not silently flip).
    expect(RENDER_SETTINGS_DEFAULTS.tonemap).toBe('aces');
    expect(RENDER_SETTINGS_DEFAULTS.exposure).toBe(0.42);
    expect(RENDER_SETTINGS_DEFAULTS.whitePoint).toBe(4.5);
    expect(RENDER_SETTINGS_DEFAULTS.bloom).toBe(true);
    // Threshold above frost-fang ampSafe (≤1.05); below fixture/fire peaks.
    expect(RENDER_SETTINGS_DEFAULTS.bloomThreshold).toBe(1.20);
    expect(RENDER_SETTINGS_DEFAULTS.bloomIntensity).toBe(0.65);
    expect(RENDER_SETTINGS_DEFAULTS.bloomBlurRadius).toBe(4.0);
  });

  test('L3: CSS atmosphere overlays are disabled (HDR pass owns look)', () => {
    expect(ATMOSPHERE_CSS_OVERLAYS_ENABLED).toBe(false);
    expect(ATMOSPHERE_CSS_DISPOSITION.vignette).toBe('removed');
    expect(ATMOSPHERE_CSS_DISPOSITION.haze).toBe('removed');
  });
});

describe('atmosphere pass flags + params pack', () => {
  test('pass enable flag and ids are stable', () => {
    expect(ATMOSPHERE_PASS_ENABLED).toBe(true);
    expect(PIPELINE_ID).toBe('hellforge::pipeline');
    expect(ATMOSPHERE_SHADER_ID).toBe('hellforge::atmosphere');
  });

  test('packAtmosphereParams is 16 B UBO-aligned and clamps', () => {
    const bytes = packAtmosphereParams({
      vignette: 0.65,
      haze: 0.70,
      atmoTemp: 0.50,
    });
    expect(bytes.byteLength).toBe(ATMOSPHERE_PARAMS_BYTE_SIZE);
    const f32 = new Float32Array(bytes.buffer, bytes.byteOffset, 4);
    expect(f32[0]).toBeCloseTo(0.65, 5);
    expect(f32[1]).toBeCloseTo(0.70, 5);
    expect(f32[2]).toBeCloseTo(0.50, 5);

    const clamped = packAtmosphereParams({
      vignette: 2,
      haze: -1,
      atmoTemp: 9,
    });
    const c = new Float32Array(clamped.buffer, clamped.byteOffset, 4);
    expect(c[0]).toBeCloseTo(0.8, 5);
    expect(c[1]).toBe(0);
    expect(c[2]).toBe(1);
  });

  test('CharSelect preview dim values stay below full grade', () => {
    expect(ATMOSPHERE_PREVIEW_DIM.vignette).toBeLessThan(RENDER_SETTINGS_DEFAULTS.vignette);
    expect(ATMOSPHERE_PREVIEW_DIM.haze).toBeLessThan(RENDER_SETTINGS_DEFAULTS.haze);
  });
});
