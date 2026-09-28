import { AssetGuid, definePack, definePackageId } from '@forgeax/engine/pack/source';
import { ok } from '@forgeax/engine/types';
import { mountPluginAsset, type Plugin } from '@forgeax/engine/plugin';

const GAME_PACKAGE_ID = definePackageId('f5fac9a8-0d1d-402a-9849-93eff6150767');
const PHYSICS_PACKAGE_ID = definePackageId('8ec2070b-3f8e-4586-9d49-15554b1f5476');

const physicsPlugin = AssetGuid.format(AssetGuid.derive(PHYSICS_PACKAGE_ID, 'plugin/physics'));
const hellforgePlugin = AssetGuid.format(AssetGuid.derive(GAME_PACKAGE_ID, 'plugin/hellforge'));

export const engineRoot: Plugin.Object<{ readonly children: readonly string[] }> = {
  name: 'hellforge/engine-root',
  inject: ['assets', 'pluginPrograms'],
  async apply(ctx, config) {
    for (const guid of config.children) {
      const result = await mountPluginAsset(ctx, guid);
      if (!result.ok) throw result.error;
    }
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  packageId: GAME_PACKAGE_ID,
  build: () => ok({
    'plugin/hellforge': {
      kind: 'plugin',
      module: { specifier: './plugin.ts', export: 'default' },
    },
    'plugin/engine': {
      kind: 'plugin',
      module: { specifier: './game.pack.ts', export: 'engineRoot' },
      config: {
        children: [
          { $asset: physicsPlugin },
          { $asset: hellforgePlugin },
        ],
      },
    },
  }),
});
