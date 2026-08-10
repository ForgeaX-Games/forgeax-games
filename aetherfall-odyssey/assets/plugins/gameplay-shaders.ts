import type { Renderer } from '@forgeax/engine-render';
import { HIT_FLASH_SHADER_ID, HIT_FLASH_SHADER_SOURCE } from './hit-flash-material';
import { ANIMATED_TARGET_SHADER_ID, ANIMATED_TARGET_SHADER_SOURCE } from './animated-target-material';

/** Register the template's authored shader artifacts at the renderer seam. */
export function installGameplayShaders(renderer: Renderer | undefined): void {
  if (renderer === undefined) return;
  const shaders = [
    { id: HIT_FLASH_SHADER_ID, source: HIT_FLASH_SHADER_SOURCE, paramSchema: [{ name: 'baseColor', type: 'color' }, { name: 'intensity', type: 'f32' }] },
    { id: ANIMATED_TARGET_SHADER_ID, source: ANIMATED_TARGET_SHADER_SOURCE, paramSchema: [{ name: 'baseColor', type: 'color' }, { name: 'time', type: 'f32', default: 0 }] },
  ] as const;
  for (const shader of shaders) {
    if (!renderer.shader.findMaterialArtifact(shader.id).ok) {
      renderer.shader.installMaterialArtifact(shader.id, { source: shader.source, paramSchema: shader.paramSchema });
    }
  }
}
