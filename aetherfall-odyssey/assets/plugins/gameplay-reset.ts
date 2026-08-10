import { Camera, MeshRenderer } from '@forgeax/engine-render';
import { Time, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import type { PhysicsWorld } from '@forgeax/engine-physics';
import { vec3 } from '@forgeax/engine-math';
import type { GameSettingsState } from './settings';
import type { GameplayAudio } from './gameplay-audio';
import type { DebugAxesHandle } from './debug-axes';
import type { CustomProjectileMesh } from './custom-projectile-mesh';
import { resetCustomProjectileMesh } from './custom-projectile-mesh';
import type { MeshHandleSwap } from './mesh-handle-swap';
import { resetMeshHandleSwap } from './mesh-handle-swap';
import type { FbxMeshSwap } from './fbx-mesh-swap';
import { resetFbxMeshSwap } from './fbx-mesh-swap';
import type { GltfMeshSwap } from './gltf-mesh-swap';
import { resetGltfMeshSwap } from './gltf-mesh-swap';
import type { JpegTextureSwap } from './jpeg-texture-swap';
import { resetJpegTextureSwap } from './jpeg-texture-swap';
import type { VideoTexturePanel } from './video-texture-panel';
import type { TargetProfileLoop } from './target-profile-loop';
import { resetTargetProfile } from './target-profile-loop';
import type { FbxSkinnedTarget } from './fbx-skinned-target';
import type { WorldScoreTextHandle } from './world-score-text';
import type { VisibilityLoopHandle } from './visibility-loop';
import type { TargetHealthHandle } from './target-health';
import type { TargetDisablingHandle } from './target-disabling';
import type { DepthOfFieldHandle } from './depth-of-field';
import type { ChromaticAberrationHandle } from './chromatic-aberration';
import type { VfxHitLoop } from './vfx-hit-loop';
import type { AnimatedMaterialTarget } from './animated-target-material';
import { resetAnimatedMaterial } from './animated-target-material';
import type { MultiWorldOverlay } from './multi-world-overlay';
import type { GameplayChangeDetectionHandle } from './change-detection';
import type { HitStreakHandle } from './hit-streak';
import { ChargeShot, FreeCameraMotion, GameplayInput, HitFlash, CameraRig, PlayerMotion, ResetPose } from './components/gameplay';
import { resetGameplayCommandCounters } from './resources/gameplay';
import { PAN_HALF_HEIGHT_INITIAL, TOP_DOWN_OFFSET_Z } from './camera-controller';
import { PERSPECTIVE_FOV_INITIAL } from './camera-zoom';
import type { MatHandle } from './scene-runtime';

type ResetGameplayArgs = {
  readonly world: World;
  readonly debugAxes: DebugAxesHandle;
  readonly projectileEntities: () => readonly EntityHandle[];
  readonly targetEntities: () => readonly EntityHandle[];
  readonly spriteAtlasLoop: { readonly untrack: (entity: EntityHandle) => void; readonly reset: () => void } | undefined;
  readonly materialsForCurrentMesh: (entity: EntityHandle, flashing: boolean) => readonly MatHandle[];
  readonly physics: PhysicsWorld | undefined;
  readonly player: EntityHandle | undefined;
  readonly camera: EntityHandle;
  readonly initX: number;
  readonly initZ: number;
  readonly playerY: number;
  readonly targetDisabling: TargetDisablingHandle;
  readonly visibilityLoop: VisibilityLoopHandle;
  readonly targetHealth: TargetHealthHandle;
  readonly changeDetection: GameplayChangeDetectionHandle;
  readonly hitStreak: HitStreakHandle | undefined;
  readonly depthOfField: DepthOfFieldHandle;
  readonly chromaticAberration: ChromaticAberrationHandle;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly videoTexturePanel: VideoTexturePanel | undefined;
  readonly customProjectile: CustomProjectileMesh | undefined;
  readonly meshHandleSwap: MeshHandleSwap | undefined;
  readonly fbxMeshSwap: FbxMeshSwap | undefined;
  readonly gltfMeshSwap: GltfMeshSwap | undefined;
  readonly jpegTextureSwap: JpegTextureSwap | undefined;
  readonly targetProfile: TargetProfileLoop | undefined;
  readonly fbxSkinnedTarget: FbxSkinnedTarget | undefined;
  readonly settingsState: GameSettingsState;
  readonly setMode: (mode: 'topdown' | 'orbit' | 'fps' | 'pan') => void;
  readonly multiWorldOverlay: MultiWorldOverlay | undefined;
  readonly gameplayAudio: GameplayAudio | undefined;
  readonly materialElapsedOriginKey: string;
  readonly animatedMaterial: AnimatedMaterialTarget | undefined;
  readonly vfxHitLoop: VfxHitLoop;
  readonly setProjectileVisual: (visual: 'mesh' | 'sprite' | 'sprite-lit') => void;
  readonly resetMission: () => void;
};

/** Own the reset transaction across ECS, physics, authored asset loops, and UI witnesses. */
export function createGameplayReset(args: ResetGameplayArgs): () => void {
  return (): void => {
    args.debugAxes.reset();
    for (const entity of args.projectileEntities()) {
      args.spriteAtlasLoop?.untrack(entity);
      args.world.despawn(entity);
    }
    resetGameplayCommandCounters(args.world);
    for (const entity of args.targetEntities()) {
      const flash = args.world.get(entity, HitFlash);
      if (flash.ok && flash.value.remaining > 0) {
        args.world.set(entity, MeshRenderer, { materials: [...args.materialsForCurrentMesh(entity, false)] });
        args.world.set(entity, HitFlash, { remaining: 0 });
      }
    }
    for (const entity of args.targetEntities()) {
      const pose = args.world.get(entity, ResetPose);
      if (!pose.ok) continue;
      const pos = [pose.value.posX, pose.value.posY, pose.value.posZ] as [number, number, number];
      args.world.set(entity, Transform, {
        pos,
        quat: [pose.value.quatX, pose.value.quatY, pose.value.quatZ, pose.value.quatW],
        scale: [pose.value.scaleX, pose.value.scaleY, pose.value.scaleZ],
      });
      if (args.physics?.hasBody(entity)) args.physics.teleport(entity, vec3.create(pos[0], pos[1], pos[2]));
    }
    if (args.player !== undefined) {
      args.world.set(args.player, GameplayInput, { lookYaw: 0, lookPitch: 0, wantShoot: 0, shotDirValid: 0 });
      args.world.set(args.player, ChargeShot, { active: 0, release: 0, elapsed: 0, power: 1 });
      args.world.set(args.player, PlayerMotion, { faceX: 0, faceZ: -1, jumpY: args.playerY, freeY: args.playerY, velocityY: 0, grounded: 1, shootCooldown: 0 });
      args.world.set(args.player, FreeCameraMotion, { velocityX: 0, velocityY: 0, velocityZ: 0, walkSpeed: 3, runSpeed: 9 });
    }
    args.world.set(args.camera, CameraRig, { mode: 1, followX: args.initX, followZ: args.initZ + TOP_DOWN_OFFSET_Z, panX: args.initX, panZ: args.initZ + TOP_DOWN_OFFSET_Z, panHalfHeight: PAN_HALF_HEIGHT_INITIAL, perspectiveFov: PERSPECTIVE_FOV_INITIAL });
    args.world.set(args.camera, Camera, { fov: PERSPECTIVE_FOV_INITIAL });
    args.targetDisabling.reset();
    args.changeDetection.reset();
    args.hitStreak?.reset();
    args.visibilityLoop.reset();
    args.targetHealth.reset();
    args.depthOfField.reset();
    args.chromaticAberration.reset();
    args.worldScoreText?.reset();
    args.videoTexturePanel?.reset();
    if (args.customProjectile !== undefined) resetCustomProjectileMesh(args.customProjectile);
    resetMeshHandleSwap(args.world, args.meshHandleSwap);
    resetFbxMeshSwap(args.world, args.fbxMeshSwap);
    resetGltfMeshSwap(args.world, args.gltfMeshSwap);
    resetJpegTextureSwap(args.world, args.jpegTextureSwap);
    resetTargetProfile(args.world, args.targetProfile);
    args.resetMission();
    args.fbxSkinnedTarget?.reset();
    args.settingsState.depthOfField = false;
    args.setMode('orbit');
    args.multiWorldOverlay?.setEnabled(true);
    if (args.player !== undefined) {
      args.world.set(args.player, Transform, { pos: [args.initX, args.playerY, args.initZ], quat: [0, 0, 0, 1] });
      if (args.physics?.hasBody(args.player)) args.physics.teleport(args.player, vec3.create(args.initX, args.playerY, args.initZ));
    }
    args.gameplayAudio?.reset();
    args.world.insertResource(args.materialElapsedOriginKey, args.world.getResource(Time).elapsed);
    if (args.animatedMaterial) resetAnimatedMaterial(args.world, args.animatedMaterial);
    args.vfxHitLoop.reset();
    args.spriteAtlasLoop?.reset();
    args.setProjectileVisual('mesh');
  };
}
