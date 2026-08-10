import type { World } from '@forgeax/engine-ecs';
import type { FbxMeshSwap } from './fbx-mesh-swap';
import { resetFbxMeshSwap } from './fbx-mesh-swap';
import type { GltfMeshSwap } from './gltf-mesh-swap';
import { resetGltfMeshSwap } from './gltf-mesh-swap';
import type { JpegTextureSwap } from './jpeg-texture-swap';
import { toggleJpegTextureSwap } from './jpeg-texture-swap';
import type { MeshHandleSwap } from './mesh-handle-swap';
import { resetMeshHandleSwap } from './mesh-handle-swap';
import type { SpriteAtlasLoop } from './sprite-atlas-loop';
import type { TargetProfileLoop, TargetProfileSnapshot } from './target-profile-loop';
import type { VideoTexturePanel } from './video-texture-panel';
import type { WorldScoreTextHandle } from './world-score-text';
import type { FbxSkinnedTarget } from './fbx-skinned-target';
import { GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE } from './resources/gameplay';

/** The six retained format/plugin paths admitted by the guided contract. */
export type AssetLabAction =
  | 'target-profile'
  | 'jpeg-texture'
  | 'video-texture'
  | 'sprite-atlas'
  | 'font-source'
  | 'fbx-companion';

export type AssetLabActionResult = {
  readonly text: string;
  readonly state: 'unavailable' | 'active' | 'restored';
};

export type AssetLabActionContext = {
  readonly world: World;
  readonly meshHandleSwap: MeshHandleSwap | undefined;
  readonly fbxMeshSwap: FbxMeshSwap | undefined;
  readonly gltfMeshSwap: GltfMeshSwap | undefined;
  readonly jpegTextureSwap: JpegTextureSwap | undefined;
  readonly videoTexturePanel: VideoTexturePanel | undefined;
  readonly fbxSkinnedTarget: FbxSkinnedTarget | undefined;
  readonly targetProfile: TargetProfileLoop | undefined;
  readonly readScore: () => number;
  readonly toggleProfile: () => TargetProfileSnapshot;
  readonly spriteAtlasLoop: SpriteAtlasLoop | undefined;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly setProjectileVisual: (visual: 'mesh' | 'sprite' | 'sprite-lit') => void;
};

function result(name: string, state: AssetLabActionResult['state'], detail?: string): AssetLabActionResult {
  return { state, text: `${name} ${state === 'active' ? 'active' : state === 'restored' ? 'restored' : 'unavailable'}${detail ? ` · ${detail}` : ''}` };
}

function restoreFbxCompanion(ctx: AssetLabActionContext): void {
  const companion = ctx.fbxSkinnedTarget;
  if (companion?.companionActive() === true) companion.toggleCompanion();
}

/** Apply one guided action from either the frozen keyboard input or the HUD. */
export function applyAssetLabAction(ctx: AssetLabActionContext, action: AssetLabAction): AssetLabActionResult {
  switch (action) {
    case 'target-profile': {
      restoreFbxCompanion(ctx);
      if (ctx.targetProfile?.active !== 'profile' && ctx.readScore() < GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE) {
        return result('Target profile', 'unavailable', `score ${GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE} required`);
      }
      const snapshot = ctx.toggleProfile();
      if (!snapshot.available) return result('Target profile', 'unavailable');
      return result('Target profile', snapshot.active === 'profile' ? 'active' : 'restored', snapshot.title ?? 'GUID asset');
    }
    case 'jpeg-texture': {
      restoreFbxCompanion(ctx);
      const swap = ctx.jpegTextureSwap;
      if (swap === undefined) return result('JPEG target texture', 'unavailable');
      if (swap.active === 'original') {
        resetMeshHandleSwap(ctx.world, ctx.meshHandleSwap);
        resetFbxMeshSwap(ctx.world, ctx.fbxMeshSwap);
        resetGltfMeshSwap(ctx.world, ctx.gltfMeshSwap);
      }
      toggleJpegTextureSwap(ctx.world, swap);
      return result('JPEG target texture', swap.active === 'jpeg' ? 'active' : 'restored', swap.name);
    }
    case 'video-texture': {
      restoreFbxCompanion(ctx);
      const panel = ctx.videoTexturePanel;
      if (panel === undefined) return result('WebM target panel', 'unavailable');
      panel.toggle();
      return result('WebM target panel', panel.active === 'video' ? 'active' : 'restored', panel.snapshot().name ?? 'VideoAsset');
    }
    case 'sprite-atlas': {
      restoreFbxCompanion(ctx);
      const atlas = ctx.spriteAtlasLoop;
      if (atlas === undefined) return result('PNG atlas projectile', 'unavailable');
      const active = atlas.toggle();
      if (active) ctx.setProjectileVisual('sprite');
      return result('PNG atlas projectile', active ? 'active' : 'restored', active ? 'fire to confirm the four-frame hit' : 'mesh projectile');
    }
    case 'font-source': {
      restoreFbxCompanion(ctx);
      const scoreText = ctx.worldScoreText;
      if (scoreText === undefined) return result('TTF score text', 'unavailable');
      const source = scoreText.toggleFontSource();
      return result('TTF score text', source === 'ttf-plugin' ? 'active' : 'restored', source === 'ttf-plugin' ? 'imported glyph metrics on next hit' : 'legacy baked font');
    }
    case 'fbx-companion': {
      const companion = ctx.fbxSkinnedTarget;
      if (companion === undefined) return result('FBX target companion', 'unavailable', 'imported scene or animation unavailable');
      if (ctx.targetProfile?.active !== 'profile' || ctx.targetProfile.precisionHits === 0) {
        return result('FBX target companion', 'unavailable', 'complete the precision mission first');
      }
      const active = companion.toggleCompanion();
      return result(
        'FBX target companion',
        active ? 'active' : 'restored',
        active ? 'fire to replay the imported run animation' : 'authored RedBox target',
      );
    }
  }
}
