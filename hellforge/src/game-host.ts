import type { GameHost } from '@forgeax/engine/app';
import type { Renderer } from '@forgeax/engine/render';

/** The plugin owns every non-ECS listener, UI node and pending async owner. */
export type HellforgeHost = GameHost & {
  registerCleanup(dispose: () => void): void;
};

/** Hellforge's DOM HUD and direct renderer controls require a presentation host. */
export function requireBrowserCanvas(canvas: GameHost['canvas']): HTMLCanvasElement {
  if (typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Hellforge requires a main-thread HTML canvas host; worker-only hosts are not supported.');
  }
  return canvas;
}

export function requireGameRenderer(renderer: GameHost['renderer']): Renderer {
  if (!renderer) throw new Error('Hellforge requires the presentation host renderer.');
  return renderer;
}
