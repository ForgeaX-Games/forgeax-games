import type { BootstrapContext } from '@forgeax/engine-app';
import type { World } from '@forgeax/engine-ecs';
import { installGameplayShaders } from './gameplay-shaders';
import { createGameplaySession } from './gameplay-session';
import { createGameplayTargetFeatures } from './gameplay-targets';
import { installGameplayWiring } from './gameplay-wiring';

/** Host assembly only; gameplay state and frame work live in asset plugins. */
export async function bootstrap(world: World, host?: BootstrapContext): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (canvas === null) throw new Error('game-default requires #app canvas');

  const search = typeof window === 'undefined' ? '' : window.location.search;
  const query = new URLSearchParams(search);
  const assetEvidenceMode = query.has('asset-evidence');
  const comparisonEvidenceMode = assetEvidenceMode || query.has('render-evidence');
  installGameplayShaders(host?.renderer);
  const targets = await createGameplayTargetFeatures(world, host, { comparisonEvidenceMode });
  const session = await createGameplaySession(world, host, canvas, targets, { comparisonEvidenceMode });
  installGameplayWiring({ world, host, assetEvidenceMode, targets, session });
}
