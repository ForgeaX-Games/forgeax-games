import type { World } from '@forgeax/engine-ecs';
import { SPRITE_PREMULTIPLIED_ALPHA_BLEND } from '@forgeax/engine-render/authoring';
import type { Handle, MaterialAsset } from '@forgeax/engine-runtime';
import hitFlashShader from './hit-flash.wgsl';

export const HIT_FLASH_SHADER_ID = 'game_default::hit_flash';
export const HIT_FLASH_SHADER_SOURCE = hitFlashShader.wgsl;
export const HIT_FLASH_ALPHA = 0.72;
export type HitFlashMaterialHandle = Handle<'MaterialAsset', 'shared'>;

/** Create the cooked custom hit material and return its world-owned handle. */
export function createHitFlashMaterial(world: World): HitFlashMaterialHandle {
  return world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
    kind: 'material',
    passes: [{ name: 'Forward', program: { module: HIT_FLASH_SHADER_ID }, renderState: { ...{ blend: SPRITE_PREMULTIPLIED_ALPHA_BLEND, depthWriteEnabled: false }, tags: { LightMode: 'Forward' }, queue: 2000 } }],
    values: { baseColor: [1, 0.82, 0.15, HIT_FLASH_ALPHA], intensity: 3 },
  });
}
