import { Camera } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import type { BootstrapContext, GameProjectionValue } from '@forgeax/engine-app';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { GameplayStateHandle } from './gameplay-state';
import type { TargetHealthHandle } from './target-health';
import type { TargetDisablingHandle } from './target-disabling';
import type { VisibilityLoopHandle } from './visibility-loop';
import type { JpegTextureSwap } from './jpeg-texture-swap';
import { jpegTextureSnapshot, toggleJpegTextureSwap } from './jpeg-texture-swap';
import type { VideoTexturePanel } from './video-texture-panel';
import { spriteAtlasSnapshot, type SpriteAtlasLoop } from './sprite-atlas-loop';
import { targetProfileSnapshot, type TargetProfileLoop } from './target-profile-loop';
import type { MultiWorldOverlay } from './multi-world-overlay';
import type { WorldScoreTextHandle } from './world-score-text';
import type { FbxSkinnedTarget } from './fbx-skinned-target';
import type { VfxHitLoop } from './vfx-hit-loop';
import type { MeshHandleSwap } from './mesh-handle-swap';
import type { FbxMeshSwap } from './fbx-mesh-swap';
import type { GltfMeshSwap } from './gltf-mesh-swap';
import type { ViewMode } from './hud';
import type { HitStreakHandle } from './hit-streak';
import type { AssetLabActionResult } from './asset-lab-actions';
import type { ExplorationSystemHandle } from './exploration-system';
import type { GameplayInputInjection } from './gameplay-input-injection';

export type GameplayProjectionContext = {
  readonly host: BootstrapContext;
  readonly world: World;
  readonly camera: EntityHandle;
  readonly player: EntityHandle | undefined;
  readonly getMode: () => ViewMode;
  readonly setMode: (mode: ViewMode) => void;
  readonly gameplayState: GameplayStateHandle;
  readonly targetHealth: TargetHealthHandle;
  readonly targetDisabling: TargetDisablingHandle;
  readonly visibilityLoop: VisibilityLoopHandle;
  readonly jpegTextureSwap: JpegTextureSwap | undefined;
  readonly videoTexturePanel: VideoTexturePanel | undefined;
  readonly targetProfile: TargetProfileLoop | undefined;
  readonly applyTargetProfile: () => AssetLabActionResult;
  readonly applyFbxCompanion: () => AssetLabActionResult;
  readonly spriteAtlasLoop: SpriteAtlasLoop | undefined;
  readonly multiWorldOverlay: MultiWorldOverlay | undefined;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly fbxSkinnedTarget: FbxSkinnedTarget | undefined;
  readonly vfxHitLoop: VfxHitLoop;
  readonly triggerFlash: () => void;
  readonly triggerScore: () => { readonly points: number | null };
  readonly resetMeshHandleSwap: (state: MeshHandleSwap | undefined) => void;
  readonly meshHandleSwap: MeshHandleSwap | undefined;
  readonly fbxMeshSwap: FbxMeshSwap | undefined;
  readonly gltfMeshSwap: GltfMeshSwap | undefined;
  readonly resetFbxMeshSwap: (state: FbxMeshSwap | undefined) => void;
  readonly resetGltfMeshSwap: (state: GltfMeshSwap | undefined) => void;
  readonly setProjectileVisual: (visual: 'mesh' | 'sprite' | 'sprite-lit') => void;
  readonly visibilitySnapshot: () => ReturnType<VisibilityLoopHandle['snapshot']>;
  readonly hitStreak: HitStreakHandle | undefined;
  readonly exploration: ExplorationSystemHandle;
  readonly inputInjection: GameplayInputInjection;
};

const EMPTY_VIDEO_TEXTURE = { available: false, active: 'original', swaps: 0, hitReactions: 0, lastHitPlayhead: null, guid: null, name: null, kind: null, url: null } as const;
const EMPTY_MULTI_WORLD = { enabled: false, worldCount: 1, entityCount: 0, cameraOwner: 0, resourceOwner: 0 } as const;
const EMPTY_WORLD_SCORE_TEXT = { available: false, baked: false, active: false, text: '', age: 0, position: [0, 0, 0], fontSource: 'legacy-pack', fontGuid: null, fontSize: 0, color: [1, 1, 1, 1], toggles: 0 } as const;
const EMPTY_FBX_SKINNED_TARGET = { available: false, root: null, skinEntity: null, clipGuid: null, jointCount: 0, position: [0, 0, 0], scale: [1, 1, 1], worldMatrix: [], animationTime: 0, hitPulses: 0, companionActive: false, targetEntity: null } as const;

/** Keep the JSON boundary explicit while retaining typed snapshots internally. */
function asProjection<T>(value: T): GameProjectionValue {
  return value as unknown as GameProjectionValue;
}

/**
 * Register the optional Play inspection bridge. It owns only JSON-shaped
 * projections and actions; gameplay state remains in ECS/components/resources.
 */
export function installGameplayProjection(args: GameplayProjectionContext): void {
  const { host } = args;
  const projection = host.gameProjection;
  if (projection === undefined) return;

  const projectionDisposers = [
    projection.registerAction({
      id: 'input',
      title: 'Inject a gameplay key transition',
      description: 'Bridge Studio Gameplay key input into the shared human-plus-AI input backend.',
      run: (input) => {
        args.inputInjection.apply(input);
        return asProjection({ accepted: true });
      },
    }),
    projection.registerRead({
      id: 'game-default.snapshot',
      title: 'Read gameplay snapshot',
      description: 'Read phase, camera mode, fixed-step witness, and target lifecycle counts.',
      read: (): GameProjectionValue => {
        const cameraData = args.world.get(args.camera, Camera);
        return asProjection({
          state: args.gameplayState.snapshot(),
          viewMode: args.getMode(),
          cameraProjection: cameraData.ok && cameraData.value.projection === 1 ? 'orthographic' : 'perspective',
          targetHealth: args.targetHealth.snapshot(),
          targetDisabling: args.targetDisabling.snapshot(),
          visibility: args.visibilitySnapshot(),
          jpegTexture: jpegTextureSnapshot(args.jpegTextureSwap),
          videoTexture: args.videoTexturePanel?.snapshot() ?? EMPTY_VIDEO_TEXTURE,
          targetProfile: targetProfileSnapshot(args.targetProfile),
          spriteAtlas: spriteAtlasSnapshot(args.spriteAtlasLoop),
          multiWorld: args.multiWorldOverlay?.snapshot() ?? EMPTY_MULTI_WORLD,
          worldScoreText: args.worldScoreText?.snapshot() ?? EMPTY_WORLD_SCORE_TEXT,
          fbxSkinnedTarget: args.fbxSkinnedTarget?.snapshot() ?? EMPTY_FBX_SKINNED_TARGET,
          vfxHit: args.vfxHitLoop.snapshot(),
          hitStreak: args.hitStreak?.snapshot() ?? { hits: 0, elapsed: 0, multiplier: 1, state: 'ready' },
          exploration: args.exploration.snapshot(),
        });
      },
    }),
    projection.registerRead({
      id: 'aetherfall.exploration',
      title: 'Read Aetherfall exploration progress',
      description: 'Read the three-shrine, Last Light, and sanctuary-return progression state.',
      read: (): GameProjectionValue => {
        const playerTransform = args.player === undefined ? undefined : args.world.get(args.player, Transform);
        return asProjection({
          ...args.exploration.snapshot(),
          lastOutcome: args.exploration.lastOutcome(),
          playerPosition: playerTransform?.ok === true
            ? [
              playerTransform.value.pos[0] ?? 0,
              playerTransform.value.pos[1] ?? 0,
              playerTransform.value.pos[2] ?? 0,
            ]
            : null,
        });
      },
    }),
    projection.registerRead({
      id: 'game-default.renderer-contract',
      title: 'Read renderer contract',
      description: 'Read the public renderer health and registered material shader ids.',
      read: (): GameProjectionValue => asProjection({
        health: host.renderer?.health() ?? { reason: 'unavailable', recoverable: false },
        materialShaderIdentifiers: [...(host.renderer?.shader.materialShaderIdentifiers() ?? [])],
      }),
    }),
    projection.registerAction({
      id: 'aetherfall.interact',
      title: 'Interact with the nearest Aetherfall landmark',
      description: 'Use the same proximity and progression owner as the E input action.',
      run: () => asProjection(args.exploration.interact()),
    }),
    projection.registerAction({
      id: 'game-default.reset',
      title: 'Request gameplay reset',
      description: 'Request the typed Reset state; cleanup runs through the normal lifecycle owner.',
      run: () => {
        args.gameplayState.requestReset();
        return asProjection({ requested: true });
      },
    }),
    projection.registerAction({
      id: 'game-default.invalid-state',
      title: 'Exercise invalid state recovery',
      description: 'Send an adjacent invalid state through the public state API and return its error code.',
      run: () => asProjection({ errorCode: args.gameplayState.requestInvalid() ?? null }),
    }),
    projection.registerAction({
      id: 'game-default.trigger-hit',
      title: 'Trigger hit feedback',
      description: 'Use the same hit-flash/material/audio feedback owner as a real projectile hit.',
      run: () => {
        args.triggerFlash();
        args.vfxHitLoop.trigger();
        args.fbxSkinnedTarget?.triggerHit();
        return asProjection({ triggered: true });
      },
    }),
    projection.registerAction({
      id: 'game-default.trigger-vfx-hit',
      title: 'Replay transient VFX hit',
      description: 'Replay the Pack v2 particle effect on the existing scored target through the CPU FixedUpdate simulation and late RenderFeature.',
      run: () => {
        args.vfxHitLoop.trigger();
        return asProjection(args.vfxHitLoop.snapshot());
      },
    }),
    projection.registerAction({
      id: 'game-default.trigger-vfx-charge',
      title: 'Play VFX charge mode',
      description: 'Switch the same ParticleEffectPlayer to the second Pack v2 effect with continuous-rate and box-spawn emitters.',
      run: () => {
        args.vfxHitLoop.triggerCharge();
        return asProjection(args.vfxHitLoop.snapshot());
      },
    }),
    projection.registerAction({
      id: 'game-default.trigger-score',
      title: 'Trigger score text',
      description: 'Run one real target-score outcome so the pooled world-space GlyphText can be inspected after a font-source switch.',
      run: () => asProjection(args.triggerScore()),
    }),
    projection.registerAction({
      id: 'game-default.toggle-visibility',
      title: 'Toggle target visibility',
      description: 'Toggle author Visibility on the scored target without changing physics, picking, or Disabled lifecycle.',
      run: () => {
        args.visibilityLoop.toggle();
        return asProjection(args.visibilitySnapshot());
      },
    }),
    projection.registerAction({
      id: 'game-default.toggle-jpeg-texture',
      title: 'Toggle JPEG target texture',
      description: 'Apply or restore the GUID-loaded JPEG albedo on the scored target without changing its mesh or gameplay owners.',
      run: () => {
        if (args.jpegTextureSwap === undefined) return asProjection(jpegTextureSnapshot(undefined));
        if (args.jpegTextureSwap.active === 'original') {
          args.resetMeshHandleSwap(args.meshHandleSwap);
          args.resetFbxMeshSwap(args.fbxMeshSwap);
          args.resetGltfMeshSwap(args.gltfMeshSwap);
        }
        toggleJpegTextureSwap(args.world, args.jpegTextureSwap);
        return asProjection(jpegTextureSnapshot(args.jpegTextureSwap));
      },
    }),
    projection.registerAction({
      id: 'game-default.toggle-video-texture',
      title: 'Toggle WebM target panel',
      description: 'Toggle the licensed WebM through VideoAsset, VideoPlayer, and the host VideoElementProvider on the existing scored target.',
      run: () => {
        args.videoTexturePanel?.toggle();
        return asProjection(args.videoTexturePanel?.snapshot() ?? EMPTY_VIDEO_TEXTURE);
      },
    }),
    projection.registerAction({
      id: 'game-default.toggle-target-profile',
      title: 'Toggle target profile plugin',
      description: 'After Score 50, apply or restore the host-defined GUID target profile on the existing scored target.',
      run: () => asProjection(args.applyTargetProfile()),
    }),
    projection.registerAction({
      id: 'game-default.toggle-fbx-companion',
      title: 'Toggle FBX target companion',
      description: 'After the precision mission, replace the authored RedBox presentation with the imported humanoid scene and replay its run clip on the same scored target.',
      run: () => asProjection(args.applyFbxCompanion()),
    }),
    projection.registerAction({
      id: 'game-default.toggle-sprite-atlas',
      title: 'Toggle PNG sprite atlas',
      description: 'Toggle the GUID-loaded atlas animation on newly spawned projectiles while retaining the existing hit and physics loop.',
      run: () => {
        if (args.spriteAtlasLoop === undefined) return asProjection(spriteAtlasSnapshot(undefined));
        const enabled = args.spriteAtlasLoop.toggle();
        if (enabled) args.setProjectileVisual('sprite');
        return asProjection(spriteAtlasSnapshot(args.spriteAtlasLoop));
      },
    }),
    projection.registerAction({
      id: 'game-default.toggle-font-source',
      title: 'Toggle TTF font plugin',
      description: 'Switch the same pooled hit-score GlyphText between the legacy baked pack and the licensed TTF font importer output.',
      run: () => asProjection({ fontSource: args.worldScoreText?.toggleFontSource() ?? 'legacy-pack', ...(args.worldScoreText?.snapshot() ?? {}) }),
    }),
    projection.registerAction({
      id: 'game-default.toggle-multi-world',
      title: 'Toggle secondary world',
      description: 'Enable or disable two beacon entities rendered from a secondary World using the primary camera and lights.',
      run: () => {
        if (args.multiWorldOverlay === undefined) return asProjection({ enabled: false, available: false });
        const nextEnabled = !args.multiWorldOverlay.snapshot().enabled;
        args.multiWorldOverlay.setEnabled(nextEnabled);
        return asProjection({ enabled: nextEnabled, available: true });
      },
    }),
    projection.registerAction({
      id: 'game-default.set-view',
      title: 'Set camera view',
      description: 'Switch the existing camera owner without creating a second camera.',
      argsSchema: {
        type: 'object',
        required: ['mode'],
        properties: { mode: { type: 'string', enum: ['topdown', 'orbit', 'fps', 'pan'] } },
      },
      run: (input) => {
        const modeValue = typeof input === 'object' && input !== null && !Array.isArray(input) ? input.mode : undefined;
        if (modeValue !== 'topdown' && modeValue !== 'orbit' && modeValue !== 'fps' && modeValue !== 'pan') {
          throw new Error('mode must be one of topdown, orbit, fps, pan');
        }
        args.setMode(modeValue);
        return asProjection({ viewMode: modeValue });
      },
    }),
  ];
  host.registerCleanup?.(() => {
    for (const dispose of projectionDisposers.reverse()) dispose();
  });
}
