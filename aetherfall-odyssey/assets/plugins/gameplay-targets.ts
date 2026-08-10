import type { BootstrapContext } from '@forgeax/engine-app';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { PhysicsWorld } from '@forgeax/engine-physics';
import { installAssetContentEvidence } from './asset-content-evidence';
import { createFbxMeshSwap, resetFbxMeshSwap, type FbxMeshSwap } from './fbx-mesh-swap';
import { createFbxSkinnedTarget, type FbxSkinnedTarget } from './fbx-skinned-target';
import { createGltfMeshSwap, resetGltfMeshSwap, type GltfMeshSwap } from './gltf-mesh-swap';
import { createJpegTextureSwap, resetJpegTextureSwap, type JpegTextureSwap } from './jpeg-texture-swap';
import { createMeshHandleSwap, resetMeshHandleSwap, type MeshHandleSwap } from './mesh-handle-swap';
import { createTargetProfileLoop, targetProfileSnapshot, toggleTargetProfile, type TargetProfileLoop } from './target-profile-loop';
import { targetProfileLoader } from './target-profile-loader';
import { createVideoTexturePanel, type VideoTexturePanel } from './video-texture-panel';
import { installTargetDisabling, type TargetDisablingHandle } from './target-disabling';
import { installTargetHealth, TargetHealth, type TargetHealthHandle } from './target-health';
import { installVisibilityLoop, type VisibilityLoopHandle } from './visibility-loop';
import { firstScoringTarget, scoringTargetEntities } from './scoring-target';
import { assembleGameplayScene, type GameplaySceneAssembly } from './gameplay-scene';

export type GameplayTargetFeatures = GameplaySceneAssembly & {
  readonly targetEntities: () => EntityHandle[];
  readonly primaryTarget: () => EntityHandle | undefined;
  readonly targetHealth: TargetHealthHandle;
  readonly targetDisabling: TargetDisablingHandle;
  readonly visibilityLoop: VisibilityLoopHandle;
  readonly meshHandleSwap: MeshHandleSwap | undefined;
  readonly fbxMeshSwap: FbxMeshSwap | undefined;
  readonly gltfMeshSwap: GltfMeshSwap | undefined;
  readonly jpegTextureSwap: JpegTextureSwap | undefined;
  readonly videoTexturePanel: VideoTexturePanel | undefined;
  readonly targetProfile: TargetProfileLoop | undefined;
  readonly toggleProfile: () => ReturnType<typeof targetProfileSnapshot>;
  readonly fbxSkinnedTarget: FbxSkinnedTarget | undefined;
  readonly damageTarget: (entity: EntityHandle, points: number) => void;
};

export type GameplayTargetOptions = {
  /** Load comparison-only mesh/FBX/glTF/skin owners for an explicit evidence run. */
  readonly comparisonEvidenceMode?: boolean;
};

/** Assemble the target roster and the guided asset loops around it. */
export async function createGameplayTargetFeatures(
  world: World,
  host: BootstrapContext | undefined,
  options: GameplayTargetOptions = {},
): Promise<GameplayTargetFeatures> {
  const scene = await assembleGameplayScene(world, host);
  const targetEntities = (): EntityHandle[] => scoringTargetEntities(world, scene.targetQuery);
  const primaryTarget = (): EntityHandle | undefined => firstScoringTarget(world, scene.targetQuery);
  const targetHealth = installTargetHealth(world, scene.targetQuery);
  const targetDisabling = installTargetDisabling(world, scene.targetQuery);
  const visibilityLoop = installVisibilityLoop(world, scene.targetQuery);
  // Mesh/FBX/glTF owners are comparison-only. Instantiating the imported FBX
  // during normal exploration binds its legacy clip before matching targets
  // exist, producing dozens of warnings for an invisible, unused companion.
  const comparisonEvidenceMode = options.comparisonEvidenceMode === true;
  const meshHandleSwap = comparisonEvidenceMode ? createMeshHandleSwap(world, primaryTarget()) : undefined;
  const fbxMeshSwap = comparisonEvidenceMode ? await createFbxMeshSwap(world, host?.assets, primaryTarget()) : undefined;
  const gltfMeshSwap = comparisonEvidenceMode ? await createGltfMeshSwap(world, host?.assets, primaryTarget()) : undefined;
  const jpegTextureSwap = comparisonEvidenceMode
    ? await createJpegTextureSwap(world, host?.assets, primaryTarget())
    : undefined;
  const videoTexturePanel = comparisonEvidenceMode
    ? await createVideoTexturePanel(world, host?.assets, primaryTarget())
    : undefined;
  host?.registerCleanup?.(() => videoTexturePanel?.dispose());

  if (comparisonEvidenceMode) host?.assets?.loaders.register(targetProfileLoader());
  const targetProfile = comparisonEvidenceMode
    ? await createTargetProfileLoop(world, host?.assets, primaryTarget())
    : undefined;
  const toggleProfile = (): ReturnType<typeof targetProfileSnapshot> => {
    if (targetProfile === undefined) return targetProfileSnapshot(undefined);
    if (targetProfile.active === 'original') {
      resetMeshHandleSwap(world, meshHandleSwap);
      resetFbxMeshSwap(world, fbxMeshSwap);
      resetGltfMeshSwap(world, gltfMeshSwap);
      resetJpegTextureSwap(world, jpegTextureSwap);
    }
    toggleTargetProfile(world, targetProfile);
    return targetProfileSnapshot(targetProfile);
  };
  const physics = world.hasResource('PhysicsWorld') ? world.getResource<PhysicsWorld>('PhysicsWorld') : undefined;
  const fbxSkinnedTarget = comparisonEvidenceMode
    ? await createFbxSkinnedTarget({ world, assets: host?.assets, ...(physics === undefined ? {} : { physics }) })
    : undefined;
  host?.registerCleanup?.(() => fbxSkinnedTarget?.dispose());

  const skylightEntity = scene.loaded?.nodes
    .find((node) => (node.components.Name as { value?: string } | undefined)?.value === 'Skylight')
    ?.localId;
  const assetEvidenceBase = {
    assets: host?.assets,
    renderer: host?.renderer,
    world,
    skylight: skylightEntity === undefined ? undefined : scene.loaded?.mapping.get(skylightEntity),
  };
  const assetEvidenceArgs = host?.registerCleanup === undefined
    ? assetEvidenceBase
    : { ...assetEvidenceBase, registerCleanup: host.registerCleanup };
  if (comparisonEvidenceMode) installAssetContentEvidence(assetEvidenceArgs);

  const damageTarget = (entity: EntityHandle, points: number): void => {
    targetHealth.damage(entity, points);
    const health = world.get(entity, TargetHealth);
    if (health.ok && health.value.current <= 0) targetDisabling.disable(entity);
  };

  return {
    ...scene,
    targetEntities,
    primaryTarget,
    targetHealth,
    targetDisabling,
    visibilityLoop,
    meshHandleSwap,
    fbxMeshSwap,
    gltfMeshSwap,
    jpegTextureSwap,
    videoTexturePanel,
    targetProfile,
    toggleProfile,
    fbxSkinnedTarget,
    damageTarget,
  };
}
