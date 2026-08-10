import type { BootstrapContext } from '@forgeax/engine-app';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { AnimatedMaterialTarget } from './animated-target-material';
import { createAnimatedMaterialTarget } from './animated-target-material';
import { createScoringTargetQuery, ScoringTarget, type ScoringTargetQuery } from './scoring-target';
import { ChargeShot, HitFlash, FreeCameraMotion, GameplayInput, PlayerMotion, ProjectilePolicy, TargetPresentation } from './components/gameplay';
import {
  attachScenePhysics, expandLoadedScene, loadedFromHost, loadScene, PLAYER_Y, setupPlayerRoot,
  spawnGroundCollider, type LoadedScene,
} from './scene-runtime';
import { requireAuthoredScene } from './scene-load-policy';

export type GameplaySceneAssembly = {
  readonly loaded: LoadedScene | null;
  readonly player: EntityHandle | undefined;
  readonly initX: number;
  readonly initZ: number;
  readonly animatedMaterial: AnimatedMaterialTarget | undefined;
  readonly targetQuery: ScoringTargetQuery;
};

/** Load the authored scene, attach gameplay ECS components, and expose only the assembly facts. */
export async function assembleGameplayScene(world: World, host: BootstrapContext | undefined): Promise<GameplaySceneAssembly> {
  let loaded: LoadedScene | null = host ? loadedFromHost(world, host) : null;
  if (loaded && host?.assets && host.defaultScene) loaded = await expandLoadedScene(host.assets, host.defaultScene, loaded);
  if (!loaded) {
    try { loaded = host?.assets === undefined ? await loadScene({ world }) : await loadScene({ world, assets: host.assets }); }
    catch (error) { console.warn('[game] scene asset unavailable:', error); }
  }
  loaded = requireAuthoredScene(loaded);
  spawnGroundCollider({ world });

  let player: EntityHandle | undefined;
  let initX = 0;
  let initZ = 0;
  let animatedMaterial: AnimatedMaterialTarget | undefined;
  const targetQuery = createScoringTargetQuery();
  {
    const physics = attachScenePhysics({ world }, loaded);
    for (const [slot, prop] of physics.props.entries()) {
      world.addComponent(prop.e, {
        component: TargetPresentation,
        data: { authoredMaterials: [...prop.materials], clearcoat: prop.clearcoat === true ? 1 : 0 },
      });
      world.addComponent(prop.e, { component: HitFlash, data: {} });
      world.set(prop.e, ScoringTarget, { slot });
    }
    if (physics.animatedMaterial) animatedMaterial = createAnimatedMaterialTarget(world, physics.animatedMaterial, 52);
    const playerNode = loaded.nodes.find((node) => (node.components.Name as { value?: string } | undefined)?.value === 'Player');
    if (playerNode) {
      const transform = (playerNode.components.Transform ?? {}) as { pos?: number[] };
      initX = transform.pos?.[0] ?? 0;
      initZ = transform.pos?.[2] ?? 0;
      player = loaded.mapping.get(playerNode.localId);
      if (player !== undefined) {
        setupPlayerRoot({ world }, player);
        world.addComponent(player, { component: PlayerMotion, data: { jumpY: PLAYER_Y, freeY: PLAYER_Y } });
        world.addComponent(player, { component: GameplayInput, data: {} });
        world.addComponent(player, { component: ChargeShot, data: {} });
        world.addComponent(player, { component: FreeCameraMotion, data: {} });
        world.addComponent(player, { component: ProjectilePolicy, data: {} });
      }
    }
  }
  return { loaded, player, initX, initZ, animatedMaterial, targetQuery };
}
