import { describe, expect, it } from 'vitest';
import {
  AETHERFALL_FOG_CONFIG,
  ATMOSPHERIC_FOG_PARAM_BYTES,
  packAtmosphericFogParams,
} from '../assets/plugins/atmospheric-fog-params';

describe('Aetherfall atmospheric depth fog', () => {
  it('packs a bounded eight-float public post-process payload', () => {
    const packed = packAtmosphericFogParams(AETHERFALL_FOG_CONFIG);
    const values = new Float32Array(packed.buffer, packed.byteOffset, packed.byteLength / 4);
    expect(packed.byteLength).toBe(ATMOSPHERIC_FOG_PARAM_BYTES);
    expect([...values]).toEqual([
      0.10000000149011612,
      200,
      0.03200000151991844,
      5.5,
      0.1899999976158142,
      0.25,
      0.3199999928474426,
      0.7200000286102295,
    ]);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it('clamps invalid physical ranges before upload', () => {
    const values = new Float32Array(packAtmosphericFogParams({
      nearClip: 0,
      farClip: 0,
      density: -1,
      startDistance: -4,
      color: [-1, 0.2, -3],
      maxOpacity: 2,
    }).buffer);
    expect(values[0]).toBeGreaterThan(0);
    expect(values[1]).toBeGreaterThan(values[0]!);
    expect(values[2]).toBe(0);
    expect(values[3]).toBe(0);
    expect(values[4]).toBe(0);
    expect(values[6]).toBe(0);
    expect(values[7]).toBe(1);
  });
});
