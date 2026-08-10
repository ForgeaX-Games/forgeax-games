import { Camera } from '@forgeax/engine-render';
import type { EntityHandle, World } from '@forgeax/engine-ecs';

export type ClearColorMode = 'sky' | 'purple';

export const CLEAR_COLOR_VALUES: Readonly<Record<ClearColorMode, readonly [number, number, number, number]>> = {
  sky: [0.4, 0.6, 1.0, 1.0],
  purple: [0.5, 0.0, 0.5, 1.0],
};

export function applyClearColor(world: World, camera: EntityHandle, mode: ClearColorMode): void {
  world.set(camera, Camera, { clearColor: [...CLEAR_COLOR_VALUES[mode]] });
}
