import type { BootstrapContext } from '@forgeax/engine-app';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { CharacterController } from '@forgeax/engine-physics';
import { Camera } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import type { MaterialAsset, Handle } from '@forgeax/engine-runtime';
import type { GameplayStateHandle } from './gameplay-state';
import type { GameplayChangeDetectionHandle } from './change-detection';
import type { TargetHealthHandle } from './target-health';
import type { TargetDisablingHandle } from './target-disabling';
import type { VisibilityLoopHandle } from './visibility-loop';
import type { DepthOfFieldHandle } from './depth-of-field';
import type { ChromaticAberrationHandle } from './chromatic-aberration';
import type { CustomProjectileMesh } from './custom-projectile-mesh';
import { toggleCustomProjectileMesh } from './custom-projectile-mesh';
import type { MeshHandleSwap } from './mesh-handle-swap';
import { toggleMeshHandleSwap } from './mesh-handle-swap';
import type { FbxMeshSwap } from './fbx-mesh-swap';
import { toggleFbxMeshSwap } from './fbx-mesh-swap';
import type { GltfMeshSwap } from './gltf-mesh-swap';
import { setGltfMeshSwapVariant } from './gltf-mesh-swap';
import type { JpegTextureSwap } from './jpeg-texture-swap';
import { jpegTextureSnapshot } from './jpeg-texture-swap';
import type { VideoTexturePanel } from './video-texture-panel';
import type { FbxSkinnedTarget } from './fbx-skinned-target';
import type { WorldScoreTextHandle } from './world-score-text';
import type { MultiWorldOverlay } from './multi-world-overlay';
import type { AnimatedMaterialTarget } from './animated-target-material';
import type { ScoringTargetQuery } from './scoring-target';
import type { MatHandle } from './scene-runtime';
import type { ProjectileVisual } from './components/gameplay';
import { HitFlash, PlayerMotion, TargetPresentation } from './components/gameplay';
import { GAME_DEFAULT_COMMAND_COUNTERS } from './resources/gameplay';
import { installRenderEvidence } from './render-evidence';

type GameplayRenderEvidenceArgs = {
  readonly host: BootstrapContext | undefined;
  readonly world: World;
  readonly root: EntityHandle;
  readonly camera: EntityHandle;
  readonly player: EntityHandle | undefined;
  readonly initX: number;
  readonly initZ: number;
  readonly targetQuery: ScoringTargetQuery;
  readonly targetEntities: () => readonly EntityHandle[];
  readonly triggerFlash: () => void;
  readonly triggerScore: () => void;
  readonly flashMaterial: Handle<'MaterialAsset', 'shared'>;
  readonly settingsState: { bloom: boolean };
  readonly depthOfField: DepthOfFieldHandle;
  readonly chromaticAberration: ChromaticAberrationHandle;
  readonly getMode: () => 'topdown' | 'orbit' | 'fps' | 'pan';
  readonly setMode: (mode: 'topdown' | 'orbit' | 'fps' | 'pan') => void;
  readonly animatedMaterial: AnimatedMaterialTarget | undefined;
  readonly multiMaterial: () => {
    readonly available: boolean;
    readonly materialCount: number;
    readonly submeshCount: number;
    readonly topologies: readonly string[];
    readonly slotsAligned: boolean;
  };
  readonly multiWorldOverlay: MultiWorldOverlay | undefined;
  readonly customProjectile: CustomProjectileMesh | undefined;
  readonly getProjectileVisual: () => ProjectileVisual;
  readonly setProjectileVisual: (visual: ProjectileVisual) => void;
  readonly meshHandleSwap: MeshHandleSwap | undefined;
  readonly fbxMeshSwap: FbxMeshSwap | undefined;
  readonly gltfMeshSwap: GltfMeshSwap | undefined;
  readonly jpegTextureSwap: JpegTextureSwap | undefined;
  readonly videoTexturePanel: VideoTexturePanel | undefined;
  readonly toggleJpegTexture: () => void;
  readonly fbxSkinnedTarget: FbxSkinnedTarget | undefined;
  readonly targetHealth: TargetHealthHandle;
  readonly targetDisabling: TargetDisablingHandle;
  readonly visibilityLoop: VisibilityLoopHandle;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly isFlashed: (entity: EntityHandle) => boolean;
  readonly reset: () => void;
  readonly state: GameplayStateHandle;
  readonly changeDetection: GameplayChangeDetectionHandle;
  readonly input: () => import('@forgeax/engine-input').InputSnapshot;
};

/** Connect the Play render-evidence capability without putting its schema in bootstrap. */
export function installGameplayRenderEvidence(args: GameplayRenderEvidenceArgs): void {
  const projectile = args.customProjectile;
  installRenderEvidence({
    world: args.world,
    renderer: args.host?.renderer,
    targetQuery: args.targetQuery,
    triggerFlash: args.triggerFlash,
    triggerScore: args.triggerScore,
    hitFlashBlendEnabled: () => {
      const material = args.world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(args.flashMaterial);
      return material.ok && material.value.passes?.[0]?.renderState?.blend !== undefined;
    },
    bloomEnabled: () => args.settingsState.bloom,
    toggleBloom: () => { args.settingsState.bloom = !args.settingsState.bloom; },
    depthOfField: args.depthOfField,
    chromaticAberration: args.chromaticAberration,
    viewMode: args.getMode,
    setViewMode: args.setMode,
    cameraRadius: () => {
      const transform = args.world.get(args.camera, Transform);
      const playerTransform = args.player === undefined ? undefined : args.world.get(args.player, Transform);
      const playerMotion = args.player === undefined ? undefined : args.world.get(args.player, PlayerMotion);
      const playerPose = playerTransform?.ok === true ? playerTransform.value : undefined;
      const motion = playerMotion?.ok === true ? playerMotion.value : undefined;
      if (!transform.ok || args.getMode() !== 'orbit' || playerPose === undefined || motion === undefined) return Number.NaN;
      return Math.hypot((transform.value.pos[0] ?? 0) - (playerPose.pos[0] ?? args.initX), (transform.value.pos[1] ?? 0) - ((motion.jumpY ?? 0) + 0.8), (transform.value.pos[2] ?? 0) - (playerPose.pos[2] ?? args.initZ));
    },
    cameraPosition: () => {
      const transform = args.world.get(args.camera, Transform);
      return transform.ok ? [transform.value.pos[0] ?? 0, transform.value.pos[1] ?? 0, transform.value.pos[2] ?? 0] : null;
    },
    cameraProjection: () => {
      const data = args.world.get(args.camera, Camera);
      return data.ok && data.value.projection === 1 ? 'orthographic' : 'perspective';
    },
    cameraPerspectiveFov: () => {
      const data = args.world.get(args.camera, Camera);
      return data.ok && data.value.projection === 0 ? data.value.fov : Number.NaN;
    },
    cameraOrthoHalfHeight: () => {
      const data = args.world.get(args.camera, Camera);
      return data.ok && data.value.projection === 1 ? data.value.top : Number.NaN;
    },
    ...(args.animatedMaterial === undefined ? {} : { animatedMaterial: args.animatedMaterial }),
    clearcoatMaterial: () => {
      const target = args.targetEntities().find((candidate) => {
        const presentation = args.world.get(candidate, TargetPresentation);
        return presentation.ok && presentation.value.clearcoat !== 0;
      });
      if (target === undefined) return null;
      const presentation = args.world.get(target, TargetPresentation);
      const material = args.world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(presentation.ok ? (presentation.value.authoredMaterials[0] ?? (0 as MatHandle)) : (0 as MatHandle));
      if (!material.ok) return null;
      const values = material.value.values as Record<string, unknown> | undefined;
      const strength = Number(values?.clearcoat ?? 0);
      const roughness = Number(values?.clearcoatRoughness ?? 0);
      return { enabled: strength > 0, strength, roughness };
    },
    deferredCommands: () => args.world.getResource(GAME_DEFAULT_COMMAND_COUNTERS),
    multiMaterial: args.multiMaterial,
    ...(args.multiWorldOverlay === undefined ? {} : { multiWorld: args.multiWorldOverlay.snapshot }),
    ...(projectile === undefined ? {} : {
      customProjectileMesh: () => ({
        available: true,
        representation: args.getProjectileVisual(),
        uvMode: projectile.uvMode,
        toggles: projectile.toggles,
        textureSource: projectile.textureSource,
        textureFormat: projectile.textureFormat,
      }),
      toggleCustomProjectileMesh: () => toggleCustomProjectileMesh(projectile),
      toggleProjectileVisual: () => {
        const visual = args.getProjectileVisual();
        args.setProjectileVisual(visual === 'mesh' ? 'sprite' : visual === 'sprite' ? 'sprite-lit' : 'mesh');
      },
    }),
    ...(args.meshHandleSwap === undefined ? {} : {
      meshHandleSwap: () => ({ active: args.meshHandleSwap!.active, swaps: args.meshHandleSwap!.swaps }),
      toggleMeshHandleSwap: () => toggleMeshHandleSwap(args.world, args.meshHandleSwap!),
    }),
    ...(args.fbxMeshSwap === undefined ? {} : {
      fbxMeshSwap: () => ({ active: args.fbxMeshSwap!.active, swaps: args.fbxMeshSwap!.swaps }),
      toggleFbxMeshSwap: () => toggleFbxMeshSwap(args.world, args.fbxMeshSwap!),
    }),
    ...(args.gltfMeshSwap?.glb === undefined ? {} : {
      glbMeshSwap: () => ({ active: args.gltfMeshSwap!.active === 'glb' ? 'glb' : 'original', swaps: args.gltfMeshSwap!.swaps }),
      toggleGlbMeshSwap: () => setGltfMeshSwapVariant(args.world, args.gltfMeshSwap!, args.gltfMeshSwap!.active === 'glb' ? 'original' : 'glb'),
    }),
    ...(args.gltfMeshSwap?.gltf === undefined ? {} : {
      gltfMeshSwap: () => ({ active: args.gltfMeshSwap!.active === 'gltf' ? 'gltf' : 'original', swaps: args.gltfMeshSwap!.swaps }),
      toggleGltfMeshSwap: () => setGltfMeshSwapVariant(args.world, args.gltfMeshSwap!, args.gltfMeshSwap!.active === 'gltf' ? 'original' : 'gltf'),
    }),
    ...(args.jpegTextureSwap === undefined ? {} : {
      jpegTexture: () => jpegTextureSnapshot(args.jpegTextureSwap!),
      toggleJpegTexture: args.toggleJpegTexture,
    }),
    ...(args.fbxSkinnedTarget === undefined ? {} : { fbxSkinnedTarget: args.fbxSkinnedTarget.snapshot }),
    characterController: () => {
      const controller = args.world.get(args.root, CharacterController);
      const transform = args.world.get(args.root, Transform);
      return {
        grounded: controller.ok && controller.value.grounded === true,
        position: [transform.ok ? (transform.value.pos[0] ?? 0) : 0, transform.ok ? (transform.value.pos[1] ?? 0) : 0, transform.ok ? (transform.value.pos[2] ?? 0) : 0],
      };
    },
    targetHealth: () => args.targetHealth.snapshot(),
    targetDisabling: () => args.targetDisabling.snapshot(),
    visibility: () => args.visibilityLoop.snapshot(args.host?.renderer),
    ...(args.worldScoreText === undefined ? {} : { worldScoreText: args.worldScoreText.snapshot }),
    isFlashed: (entity) => {
      const flash = args.world.get(entity, HitFlash);
      return flash.ok && flash.value.remaining > 0;
    },
    reset: args.reset,
    ...(args.state === undefined ? {} : { state: args.state }),
    ...(args.changeDetection === undefined ? {} : { changeDetection: args.changeDetection }),
    input: args.input,
    ...(args.host?.registerCleanup === undefined ? {} : { registerCleanup: args.host.registerCleanup }),
  });
}
