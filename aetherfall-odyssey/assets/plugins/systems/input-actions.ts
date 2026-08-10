import { Update } from '@forgeax/engine-ecs';
import type { InputSnapshot } from '@forgeax/engine-input';
import { inState } from '@forgeax/engine-state';
import type { GameplayAudio } from '../gameplay-audio';
import type { CustomProjectileMesh } from '../custom-projectile-mesh';
import { GameState } from '../gameplay-state';
import { applyAssetLabAction, type AssetLabActionContext, type AssetLabActionResult } from '../asset-lab-actions';

export type InputActionsSystemContext = AssetLabActionContext & {
  readonly readInput: () => InputSnapshot;
  readonly gameplayAudio: GameplayAudio | undefined;
  readonly customProjectile: CustomProjectileMesh | undefined;
  readonly toggleCustomProjectileMesh: (state: CustomProjectileMesh) => void;
  readonly onAssetLabResult?: (result: AssetLabActionResult) => void;
};

/** Maps the frozen InputSnapshot to named feature/plugin actions. */
export function installInputActionsSystem(ctx: InputActionsSystemContext): void {
  ctx.world.addSystem(Update, {
    name: 'game-input-actions',
    runIf: inState(GameState, 'Play'),
    queries: [],
    fn: () => {
      const snap = ctx.readInput();
      ctx.gameplayAudio?.setMusicPlaying(true);
      ctx.gameplayAudio?.rearm();
      if (ctx.customProjectile !== undefined && snap.action('meshUv').justPressed()) ctx.toggleCustomProjectileMesh(ctx.customProjectile);
      const applyAssetLab = (action: Parameters<typeof applyAssetLabAction>[1]): void => {
        ctx.onAssetLabResult?.(applyAssetLabAction(ctx, action));
      };
      if (snap.action('jpegTexture').justPressed()) applyAssetLab('jpeg-texture');
      if (snap.action('videoTexture').justPressed()) applyAssetLab('video-texture');
      if (snap.action('targetProfile').justPressed()) applyAssetLab('target-profile');
      if (snap.action('spriteAtlas').justPressed()) applyAssetLab('sprite-atlas');
      if (snap.action('fontSource').justPressed()) applyAssetLab('font-source');
    },
  }).unwrap();
}
