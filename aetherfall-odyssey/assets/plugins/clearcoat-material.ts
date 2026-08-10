import type { World } from '@forgeax/engine-ecs';
import type { Handle, MaterialAsset } from '@forgeax/engine-runtime';

export const CLEARCOAT_STRENGTH = 0.85;
export const CLEARCOAT_ROUGHNESS = 0.12;

export type MaterialHandle = Handle<'MaterialAsset', 'shared'>;

/** Clone an authored PBR material so gameplay owns the optional clearcoat layer. */
export function withClearcoat(material: MaterialAsset): MaterialAsset | undefined {
  if (!material.passes?.some((pass) => pass.program.module === 'forgeax::default-standard-pbr')) return undefined;
  return {
    ...material,
    values: {
      ...material.values,
      clearcoat: CLEARCOAT_STRENGTH,
      clearcoatRoughness: CLEARCOAT_ROUGHNESS,
    },
  };
}

/** Make a private material handle without mutating the scene asset's shared payload. */
export function cloneWithClearcoat(world: World, source: MaterialHandle): MaterialHandle | undefined {
  const resolved = world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(source);
  if (!resolved.ok) return undefined;
  const material = withClearcoat(resolved.value);
  return material === undefined ? undefined : world.allocSharedRef('MaterialAsset', material);
}
