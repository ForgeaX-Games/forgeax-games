import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { InputSnapshot } from '@forgeax/engine-input';
import type { Handle } from '@forgeax/engine-runtime';
import type { PhysicsWorld } from '@forgeax/engine-physics';
import type { HudHandle, ViewMode } from '../hud';
import type { GameplayAudio } from '../gameplay-audio';
import type { GameplayChangeDetectionHandle } from '../change-detection';
import type { ChromaticAberrationHandle } from '../chromatic-aberration';
import type { CustomProjectileMesh } from '../custom-projectile-mesh';
import type { FbxMeshSwap } from '../fbx-mesh-swap';
import type { FbxSkinnedTarget } from '../fbx-skinned-target';
import type { GltfMeshSwap } from '../gltf-mesh-swap';
import type { JpegTextureSwap } from '../jpeg-texture-swap';
import type { MeshHandleSwap } from '../mesh-handle-swap';
import type { SpriteAtlasLoop } from '../sprite-atlas-loop';
import type { TargetProfileLoop, TargetProfileSnapshot } from '../target-profile-loop';
import type { VideoTexturePanel } from '../video-texture-panel';
import type { VfxHitLoop } from '../vfx-hit-loop';
import type { WorldScoreTextHandle } from '../world-score-text';
import type { ScoringTargetQuery } from '../scoring-target';
import type { MatHandle } from '../scene-runtime';
import type { ProjectileVisual } from '../components/gameplay';
import type { AssetLabActionResult } from '../asset-lab-actions';
import type { HitStreakHandle } from '../hit-streak';
import { installHitStreakSystem } from '../hit-streak';
import { installInputActionsSystem } from './input-actions';
import { installCameraInputSystem } from './camera-input';
import { installPlayerMovementSystem } from './player-movement';
import { installChargeShotSystem } from './charge-shot';
import { installProjectileSimulationSystem } from './projectile-simulation';
import { installTargetFeedbackSystem } from './target-feedback';
import { installCameraFollowSystem } from './camera-follow';

export type GameplaySystemsContext = {
  readonly world: World;
  readonly root: EntityHandle;
  readonly camera: EntityHandle;
  readonly readInput: () => InputSnapshot;
  readonly getMode: () => ViewMode;
  readonly hud: HudHandle;
  readonly gameplayAudio: GameplayAudio | undefined;
  readonly customProjectile: CustomProjectileMesh | undefined;
  readonly getProjectileVisual: () => ProjectileVisual;
  readonly setProjectileVisual: (visual: ProjectileVisual) => void;
  readonly meshHandleSwap: MeshHandleSwap | undefined;
  readonly fbxMeshSwap: FbxMeshSwap | undefined;
  readonly gltfMeshSwap: GltfMeshSwap | undefined;
  readonly jpegTextureSwap: JpegTextureSwap | undefined;
  readonly videoTexturePanel: VideoTexturePanel | undefined;
  readonly fbxSkinnedTarget: FbxSkinnedTarget | undefined;
  readonly targetProfile: TargetProfileLoop | undefined;
  readonly readScore: () => number;
  readonly toggleProfile: () => TargetProfileSnapshot;
  readonly onAssetLabResult?: (result: AssetLabActionResult) => void;
  readonly spriteAtlasLoop: SpriteAtlasLoop | undefined;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly vfxHitLoop: VfxHitLoop;
  readonly toggleCustomProjectileMesh: (state: CustomProjectileMesh) => void;
  readonly resetMeshHandleSwap: (state: MeshHandleSwap | undefined) => void;
  readonly resetFbxMeshSwap: (state: FbxMeshSwap | undefined) => void;
  readonly resetGltfMeshSwap: (state: GltfMeshSwap | undefined) => void;
  readonly resetJpegTextureSwap: (state: JpegTextureSwap | undefined) => void;
  readonly toggleJpegTextureSwap: (state: JpegTextureSwap) => void;
  readonly targetQuery: ScoringTargetQuery;
  readonly projectileEntities: () => readonly EntityHandle[];
  readonly recordCommand: (kind: 'spawned' | 'despawned') => void;
  readonly damageTarget: (entity: EntityHandle, points: number) => void;
  readonly spawnPopup: (text: string, x: number, y: number, z: number) => void;
  readonly triggerFlash: (entity?: EntityHandle) => void;
  readonly materialsForCurrentMesh: (entity: EntityHandle, flashing: boolean) => readonly MatHandle[];
  readonly changeDetection: GameplayChangeDetectionHandle;
  readonly chromaticAberration: ChromaticAberrationHandle;
  readonly physics: PhysicsWorld | undefined;
  readonly projectileMesh: Handle<'MeshAsset', 'shared'>;
  readonly projectileMaterial: Handle<'MaterialAsset', 'shared'>;
  readonly handleQuad: Handle<'MeshAsset', 'shared'>;
  readonly setPerspectiveFov: (fov: number) => void;
  readonly applyPanCamera: () => void;
  readonly hitStreak: HitStreakHandle | undefined;
};

/** Register the gameplay systems after bootstrap has assembled their asset plugins. */
export function installGameplaySystems(ctx: GameplaySystemsContext): void {
  installInputActionsSystem({
    world: ctx.world,
    readInput: ctx.readInput,
    gameplayAudio: ctx.gameplayAudio,
    customProjectile: ctx.customProjectile,
    setProjectileVisual: ctx.setProjectileVisual,
    meshHandleSwap: ctx.meshHandleSwap,
    fbxMeshSwap: ctx.fbxMeshSwap,
    gltfMeshSwap: ctx.gltfMeshSwap,
    jpegTextureSwap: ctx.jpegTextureSwap,
    videoTexturePanel: ctx.videoTexturePanel,
    fbxSkinnedTarget: ctx.fbxSkinnedTarget,
    targetProfile: ctx.targetProfile,
    readScore: ctx.readScore,
    toggleProfile: ctx.toggleProfile,
    ...(ctx.onAssetLabResult ? { onAssetLabResult: ctx.onAssetLabResult } : {}),
    spriteAtlasLoop: ctx.spriteAtlasLoop,
    worldScoreText: ctx.worldScoreText,
    toggleCustomProjectileMesh: ctx.toggleCustomProjectileMesh,
  });
  installCameraInputSystem({
    world: ctx.world,
    player: ctx.root,
    camera: ctx.camera,
    readInput: ctx.readInput,
    getMode: ctx.getMode,
    setPerspectiveFov: ctx.setPerspectiveFov,
  });
  installPlayerMovementSystem({
    world: ctx.world,
    root: ctx.root,
    readInput: ctx.readInput,
    getMode: ctx.getMode,
    physics: ctx.physics,
  });
  installChargeShotSystem({
    world: ctx.world,
    root: ctx.root,
    readInput: ctx.readInput,
    hud: ctx.hud,
    vfxHitLoop: ctx.vfxHitLoop,
  });
  if (ctx.hitStreak !== undefined) {
    installHitStreakSystem({ world: ctx.world, player: ctx.root, hud: ctx.hud });
  }
  installProjectileSimulationSystem({
    world: ctx.world,
    root: ctx.root,
    readInput: ctx.readInput,
    getMode: ctx.getMode,
    getProjectileVisual: ctx.getProjectileVisual,
    customProjectile: ctx.customProjectile,
    spriteAtlasLoop: ctx.spriteAtlasLoop,
    projectileMesh: ctx.projectileMesh,
    projectileMaterial: ctx.projectileMaterial,
    handleQuad: ctx.handleQuad,
    projectileEntities: ctx.projectileEntities,
    onSpawn: () => ctx.recordCommand('spawned'),
    onDespawn: () => ctx.recordCommand('despawned'),
  });
  installTargetFeedbackSystem({
    world: ctx.world,
    targetQuery: ctx.targetQuery,
    projectileEntities: ctx.projectileEntities,
    targetProfile: ctx.targetProfile,
    onProfileHit: () => ctx.hud.setTargetProfileActive(ctx.targetProfile?.active === 'profile', ctx.targetProfile?.precisionHits ?? 0),
    spriteAtlasLoop: ctx.spriteAtlasLoop,
    onAtlasHit: () => ctx.onAssetLabResult?.({ text: 'PNG atlas projectile active · animated hit confirmed · 4 frames', state: 'active' }),
    worldScoreText: ctx.worldScoreText,
    onFontScore: () => ctx.onAssetLabResult?.({ text: 'TTF score text active · imported glyph metrics on scored hit', state: 'active' }),
    onVideoHit: () => {
      if (ctx.videoTexturePanel?.reactToHit() === true) {
        ctx.onAssetLabResult?.({ text: 'WebM target panel active · hit context replayed', state: 'active' });
      }
    },
    onFbxHit: (entity) => {
      if (ctx.fbxSkinnedTarget?.reactToHit(entity) === true) {
        ctx.onAssetLabResult?.({ text: 'FBX target companion active · animated hit confirmed', state: 'active' });
      }
    },
    changeDetection: ctx.changeDetection,
    damageTarget: ctx.damageTarget,
    spawnPopup: ctx.spawnPopup,
    gameplayAudio: ctx.gameplayAudio,
    vfxHitLoop: ctx.vfxHitLoop,
    triggerFlash: ctx.triggerFlash,
    materialsForCurrentMesh: ctx.materialsForCurrentMesh,
    chromaticAberration: ctx.chromaticAberration,
    hitStreak: ctx.hitStreak,
  });
  installCameraFollowSystem({
    world: ctx.world,
    player: ctx.root,
    camera: ctx.camera,
    getMode: ctx.getMode,
    applyPanCamera: ctx.applyPanCamera,
    worldScoreText: ctx.worldScoreText,
    videoTexturePanel: ctx.videoTexturePanel,
  });
}
