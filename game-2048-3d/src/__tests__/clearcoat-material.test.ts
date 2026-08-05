import { describe, expect, it } from 'vitest';
import type { MaterialAsset } from '@forgeax/engine-types';
import { CLEARCOAT_ROUGHNESS, CLEARCOAT_STRENGTH, withClearcoat } from '../clearcoat-material';

describe('withClearcoat', () => {
  it('preserves authored passes and adds normalized PBR coat parameters', () => {
    const sourceValues = { baseColor: [0.8, 0.2, 0.1, 1], roughness: 0.4 };
    const source: MaterialAsset = {
      kind: 'material' as const,
      passes: [{ name: 'Forward', program: { module: 'forgeax::default-standard-pbr' } }],
      values: sourceValues,
    };
    const coated = withClearcoat(source);
    expect(coated?.passes).toBe(source.passes);
    expect(coated?.values).toEqual({
      baseColor: sourceValues.baseColor,
      roughness: 0.4,
      clearcoat: CLEARCOAT_STRENGTH,
      clearcoatRoughness: CLEARCOAT_ROUGHNESS,
    });
    expect(source.values).not.toHaveProperty('clearcoat');
  });

  it('leaves non-PBR authored materials untouched', () => {
    const source: MaterialAsset = {
      kind: 'material',
      passes: [{ name: 'Forward', program: { module: 'forgeax::default-unlit' } }],
    };
    expect(withClearcoat(source)).toBeUndefined();
  });
});
