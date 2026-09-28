import type { Plugin } from '@forgeax/engine/plugin';
import { skinningPlugin } from '@forgeax/engine/skinning';
import { renderFeaturePlugin } from '@forgeax/engine/app';
import { bootstrap } from '../main';
import { hellforgeAtmosphereFeature } from '../src/render-pipeline';

const hellforge: Plugin = {
  name: 'hellforge',
  // The execution bootstrap host intentionally exposes only portable fields.
  // Hellforge's main-realm presentation capability comes from the SDK service.
  inject: ['world', 'physics', 'gameHost', 'renderer'],
  async apply(ctx) {
    await ctx.plugin(skinningPlugin()).await();
    await ctx.plugin(renderFeaturePlugin(hellforgeAtmosphereFeature)).await();
    const host = ctx.gameHost;
    if (!host) throw new Error('Hellforge requires the App-owned GameHost');
    await ctx.effect(async () => {
      const cleanups: Array<() => void> = [];
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const cleanup of cleanups.splice(0).reverse()) {
          try { cleanup(); } catch (error) { console.error('[hellforge] cleanup', error); }
        }
      };
      try {
        await bootstrap(ctx.world, {
          ...host,
          renderer: ctx.renderer,
          registerCleanup(cleanup) {
            if (disposed) cleanup();
            else cleanups.push(cleanup);
          },
        });
        return dispose;
      } catch (error) { dispose(); throw error; }
    }, 'hellforge/gameplay');
  },
};

export default hellforge;
