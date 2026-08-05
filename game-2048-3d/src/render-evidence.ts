import type { EntityHandle } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import type { InputSnapshot } from '@forgeax/engine-input';
import { HIT_FLASH_SHADER_ID, HIT_FLASH_SHADER_SOURCE } from './hit-flash-material';
import { ANIMATED_TARGET_SHADER_ID, ANIMATED_TARGET_SHADER_SOURCE, animatedShaderEnabled, animatedShaderTime, type AnimatedMaterialTarget } from './animated-target-material';
import type { GameplayStateHandle, GameplayStateWitness } from './gameplay-state';
import type { GameplayChangeDetectionHandle, GameplayChangeDetectionWitness } from './change-detection';
import type { TargetHealthWitness } from './target-health';
import type { TargetDisablingWitness } from './target-disabling';
import type { DepthOfFieldHandle, DepthOfFieldSnapshot } from './depth-of-field';
import type { ChromaticAberrationHandle, ChromaticAberrationSnapshot } from './chromatic-aberration';
import type { FbxSkinnedTargetSnapshot } from './fbx-skinned-target';
import type { WorldScoreTextSnapshot } from './world-score-text';
import type { MultiWorldOverlaySnapshot } from './multi-world-overlay';
import type { VisibilityLoopSnapshot } from './visibility-loop';
import type { JpegTextureSnapshot } from './jpeg-texture-swap';

export const GAME_DEFAULT_RENDER_EVIDENCE_KEY = '__forgeaxGameDefaultRenderEvidence';

export type CharacterControllerEvidence = {
  readonly grounded: boolean;
  readonly position: readonly [number, number, number];
};

export type MultiMaterialEvidence = {
  readonly available: boolean;
  readonly materialCount: number;
  readonly submeshCount: number;
  readonly topologies: readonly string[];
  readonly slotsAligned: boolean;
};

export type GameDefaultRenderEvidence = {
  readonly renderer: Renderer;
  readonly shaderId: string;
  readonly shaderSource: string;
  readonly animatedShaderId: string;
  readonly animatedShaderSource: string;
  readonly triggerFlash: () => void;
  readonly triggerScore: () => void;
  readonly hitFlashBlendEnabled: () => boolean;
  readonly bloomEnabled: () => boolean;
  readonly toggleBloom: () => void;
  readonly depthOfFieldEnabled: () => boolean;
  readonly toggleDepthOfField: () => void;
  readonly chromaticAberration: () => ChromaticAberrationSnapshot;
  readonly toggleCustomProjectileMesh?: () => void;
  readonly toggleProjectileVisual?: () => void;
  readonly toggleMeshHandleSwap?: () => void;
  readonly toggleFbxMeshSwap?: () => void;
  readonly toggleGlbMeshSwap?: () => void;
  readonly toggleGltfMeshSwap?: () => void;
  readonly toggleJpegTexture?: () => void;
  readonly gamepad: () => GamepadEvidence;
  readonly characterController?: () => CharacterControllerEvidence;
  readonly setViewMode: (mode: 'topdown' | 'orbit' | 'fps' | 'pan') => void;
  readonly reset: () => void;
  readonly state?: Pick<GameplayStateHandle, 'requestReset' | 'requestInvalid'>;
  readonly snapshot: () => {
    readonly activeFlashCount: number;
    readonly hitFlashBlendEnabled: boolean;
    readonly bloomEnabled: boolean;
    readonly depthOfField: DepthOfFieldSnapshot;
    readonly chromaticAberration: ChromaticAberrationSnapshot;
    readonly viewMode: 'topdown' | 'orbit' | 'fps' | 'pan';
    readonly cameraProjection: 'perspective' | 'orthographic';
    readonly cameraPerspectiveFov: number;
    readonly cameraOrthoHalfHeight: number;
    readonly cameraRadius: number;
    readonly cameraPosition: readonly [number, number, number] | null;
    readonly animatedShaderEnabled: boolean;
    readonly animatedShaderTime: number;
    readonly clearcoatMaterial: { readonly enabled: boolean; readonly strength: number; readonly roughness: number } | null;
    readonly deferredCommands: { readonly spawned: number; readonly despawned: number };
    readonly customProjectileMesh: {
      readonly available: boolean;
      readonly representation: 'mesh' | 'sprite' | 'sprite-lit';
      readonly uvMode: 'upper' | 'lower';
      readonly toggles: number;
      readonly textureSource: 'procedural';
      readonly textureFormat: string;
    };
    readonly meshHandleSwap: { readonly available: boolean; readonly active: 'original' | 'alternate'; readonly swaps: number };
    readonly fbxMeshSwap: { readonly available: boolean; readonly active: 'original' | 'fbx'; readonly swaps: number };
    readonly glbMeshSwap: { readonly available: boolean; readonly active: 'original' | 'glb'; readonly swaps: number };
    readonly gltfMeshSwap: { readonly available: boolean; readonly active: 'original' | 'gltf'; readonly swaps: number };
    readonly fbxSkinnedTarget: FbxSkinnedTargetSnapshot;
    readonly gamepad: GamepadEvidence;
    readonly characterController: CharacterControllerEvidence | null;
    readonly targetHealth: TargetHealthWitness;
    readonly targetDisabling: TargetDisablingWitness;
    readonly worldScoreText: WorldScoreTextSnapshot;
    readonly multiMaterial: MultiMaterialEvidence;
    readonly multiWorld: MultiWorldOverlaySnapshot;
    readonly visibility: VisibilityLoopSnapshot;
    readonly jpegTexture: JpegTextureSnapshot;
    readonly materialShaderIdentifiers: readonly string[];
    readonly state?: GameplayStateWitness;
    readonly changeDetection?: GameplayChangeDetectionWitness;
  };
};

export type GamepadEvidence = {
  readonly connected: boolean;
  readonly standardMapping: boolean;
  readonly southHeld: boolean;
  readonly southJustPressed: boolean;
  readonly southJustReleased: boolean;
  readonly rightTrigger: number;
  readonly leftStick: readonly [number, number];
};

function readGamepadEvidence(input?: () => InputSnapshot): GamepadEvidence {
  const pad = input?.().gamepad(0);
  if (pad === undefined) return { connected: false, standardMapping: false, southHeld: false, southJustPressed: false, southJustReleased: false, rightTrigger: 0, leftStick: [0, 0] };
  return {
    connected: pad.connected,
    standardMapping: pad.standardMapping,
    southHeld: pad.button(0),
    southJustPressed: pad.justPressed(0),
    southJustReleased: pad.justReleased(0),
    rightTrigger: pad.buttonValue(7),
    leftStick: [pad.axis(0), pad.axis(1)],
  };
}

type RenderEvidenceArgs = {
  readonly renderer: Renderer | undefined;
  readonly flashables: readonly { readonly e: EntityHandle }[];
  readonly triggerFlash: () => void;
  readonly triggerScore: () => void;
  readonly hitFlashBlendEnabled: () => boolean;
  readonly bloomEnabled: () => boolean;
  readonly toggleBloom: () => void;
  readonly depthOfField?: DepthOfFieldHandle;
  readonly chromaticAberration?: ChromaticAberrationHandle;
  readonly customProjectileMesh?: () => {
    readonly available: boolean;
    readonly representation: 'mesh' | 'sprite' | 'sprite-lit';
    readonly uvMode: 'upper' | 'lower';
    readonly toggles: number;
    readonly textureSource: 'procedural';
    readonly textureFormat: string;
  };
  readonly toggleCustomProjectileMesh?: () => void;
  readonly toggleProjectileVisual?: () => void;
  readonly meshHandleSwap?: () => { readonly active: 'original' | 'alternate'; readonly swaps: number };
  readonly toggleMeshHandleSwap?: () => void;
  readonly fbxMeshSwap?: () => { readonly active: 'original' | 'fbx'; readonly swaps: number };
  readonly fbxSkinnedTarget?: () => FbxSkinnedTargetSnapshot;
  readonly toggleFbxMeshSwap?: () => void;
  readonly glbMeshSwap?: () => { readonly active: 'original' | 'glb'; readonly swaps: number };
  readonly toggleGlbMeshSwap?: () => void;
  readonly gltfMeshSwap?: () => { readonly active: 'original' | 'gltf'; readonly swaps: number };
  readonly toggleGltfMeshSwap?: () => void;
  readonly jpegTexture?: () => JpegTextureSnapshot;
  readonly toggleJpegTexture?: () => void;
  readonly input?: () => InputSnapshot;
  readonly characterController?: () => CharacterControllerEvidence;
  readonly viewMode: () => 'topdown' | 'orbit' | 'fps' | 'pan';
  readonly setViewMode: (mode: 'topdown' | 'orbit' | 'fps' | 'pan') => void;
  readonly cameraProjection: () => 'perspective' | 'orthographic';
  readonly cameraPerspectiveFov: () => number;
  readonly cameraOrthoHalfHeight: () => number;
  readonly cameraRadius: () => number;
  readonly cameraPosition: () => readonly [number, number, number] | null;
  readonly animatedMaterial?: AnimatedMaterialTarget;
  readonly clearcoatMaterial?: () => { readonly enabled: boolean; readonly strength: number; readonly roughness: number } | null;
  readonly deferredCommands?: () => { readonly spawned: number; readonly despawned: number };
  readonly targetHealth?: () => TargetHealthWitness;
  readonly targetDisabling?: () => TargetDisablingWitness;
  readonly worldScoreText?: () => WorldScoreTextSnapshot;
  readonly multiMaterial?: () => MultiMaterialEvidence;
  readonly multiWorld?: () => MultiWorldOverlaySnapshot;
  readonly visibility?: () => VisibilityLoopSnapshot;
  readonly isFlashed: (entity: EntityHandle) => boolean;
  readonly reset: () => void;
  readonly state?: GameplayStateHandle;
  readonly changeDetection?: GameplayChangeDetectionHandle;
  readonly registerCleanup?: (cleanup: () => void) => void;
};

/** Install a query-gated, disposable browser witness for the render-evidence smoke. */
export function installRenderEvidence(args: RenderEvidenceArgs): void {
  if (args.renderer === undefined || typeof location === 'undefined') return;
  if (!new URLSearchParams(location.search).has('render-evidence')) return;

  const evidence: GameDefaultRenderEvidence = {
    renderer: args.renderer,
    shaderId: HIT_FLASH_SHADER_ID,
    shaderSource: HIT_FLASH_SHADER_SOURCE,
    animatedShaderId: ANIMATED_TARGET_SHADER_ID,
    animatedShaderSource: ANIMATED_TARGET_SHADER_SOURCE,
    triggerFlash: args.triggerFlash,
    triggerScore: args.triggerScore,
    hitFlashBlendEnabled: args.hitFlashBlendEnabled,
    bloomEnabled: args.bloomEnabled,
    toggleBloom: args.toggleBloom,
    depthOfFieldEnabled: () => args.depthOfField?.snapshot().enabled ?? false,
    toggleDepthOfField: () => args.depthOfField?.setEnabled(!(args.depthOfField?.snapshot().enabled ?? false)),
    chromaticAberration: () => args.chromaticAberration?.snapshot() ?? { active: false, intensity: 0, effect: 'unavailable' },
    ...(args.toggleCustomProjectileMesh ? { toggleCustomProjectileMesh: args.toggleCustomProjectileMesh } : {}),
    ...(args.toggleProjectileVisual ? { toggleProjectileVisual: args.toggleProjectileVisual } : {}),
    ...(args.toggleMeshHandleSwap ? { toggleMeshHandleSwap: args.toggleMeshHandleSwap } : {}),
    ...(args.toggleFbxMeshSwap ? { toggleFbxMeshSwap: args.toggleFbxMeshSwap } : {}),
    ...(args.toggleGlbMeshSwap ? { toggleGlbMeshSwap: args.toggleGlbMeshSwap } : {}),
    ...(args.toggleGltfMeshSwap ? { toggleGltfMeshSwap: args.toggleGltfMeshSwap } : {}),
    ...(args.toggleJpegTexture ? { toggleJpegTexture: args.toggleJpegTexture } : {}),
    gamepad: () => readGamepadEvidence(args.input),
    ...(args.characterController ? { characterController: args.characterController } : {}),
    setViewMode: args.setViewMode,
    reset: args.reset,
    ...(args.state ? { state: { requestReset: args.state.requestReset, requestInvalid: args.state.requestInvalid } } : {}),
    snapshot: () => ({
      activeFlashCount: args.flashables.filter((target) => args.isFlashed(target.e)).length,
      hitFlashBlendEnabled: args.hitFlashBlendEnabled(),
      bloomEnabled: args.bloomEnabled(),
      depthOfField: args.depthOfField?.snapshot() ?? { enabled: false, mode: 'off', focalDistance: 0, aperture: 0, effect: 'unavailable' },
      chromaticAberration: args.chromaticAberration?.snapshot() ?? { active: false, intensity: 0, effect: 'unavailable' },
      viewMode: args.viewMode(),
      cameraProjection: args.cameraProjection(),
      cameraPerspectiveFov: args.cameraPerspectiveFov(),
      cameraOrthoHalfHeight: args.cameraOrthoHalfHeight(),
      cameraRadius: args.cameraRadius(),
      cameraPosition: args.cameraPosition(),
      animatedShaderEnabled: animatedShaderEnabled(args.animatedMaterial),
      animatedShaderTime: animatedShaderTime(args.animatedMaterial),
      clearcoatMaterial: args.clearcoatMaterial?.() ?? null,
      deferredCommands: args.deferredCommands?.() ?? { spawned: 0, despawned: 0 },
      customProjectileMesh: args.customProjectileMesh?.() ?? {
        available: false,
        representation: 'mesh',
        uvMode: 'upper',
        toggles: 0,
        textureSource: 'procedural',
        textureFormat: 'rgba8unorm-srgb',
      },
      meshHandleSwap: args.meshHandleSwap?.() === undefined
        ? { available: false, active: 'original', swaps: 0 }
        : { available: true, ...args.meshHandleSwap()! },
      fbxMeshSwap: args.fbxMeshSwap?.() === undefined
        ? { available: false, active: 'original', swaps: 0 }
        : { available: true, ...args.fbxMeshSwap()! },
      glbMeshSwap: args.glbMeshSwap?.() === undefined
        ? { available: false, active: 'original', swaps: 0 }
        : { available: true, ...args.glbMeshSwap()! },
      gltfMeshSwap: args.gltfMeshSwap?.() === undefined
        ? { available: false, active: 'original', swaps: 0 }
        : { available: true, ...args.gltfMeshSwap()! },
      fbxSkinnedTarget: args.fbxSkinnedTarget?.() ?? { available: false, root: null, skinEntity: null, clipGuid: null, jointCount: 0, position: [0, 0, 0], scale: [1, 1, 1], worldMatrix: [], animationTime: 0, hitPulses: 0 },
      gamepad: readGamepadEvidence(args.input),
      characterController: args.characterController?.() ?? null,
      targetHealth: args.targetHealth?.() ?? { contiguousSupported: false, contiguousCalls: 0, rows: 0, lengthsEqual: true, totalCurrent: 0, totalMax: 0, damageEvents: 0 },
      targetDisabling: args.targetDisabling?.() ?? { activeCount: 0, disabledCount: 0, disableEvents: 0 },
      worldScoreText: args.worldScoreText?.() ?? { available: false, baked: false, active: false, text: '', age: 0, position: [0, 0, 0], fontSource: 'legacy-pack', fontGuid: null, toggles: 0 },
      multiMaterial: args.multiMaterial?.() ?? { available: false, materialCount: 0, submeshCount: 0, topologies: [], slotsAligned: false },
      multiWorld: args.multiWorld?.() ?? { enabled: false, worldCount: 1, entityCount: 0, cameraOwner: 0, resourceOwner: 0 },
      visibility: args.visibility?.() ?? {
        available: false,
        intent: 'inherited',
        effective: 'visible',
        source: 'default',
        toggles: 0,
        explicitlyHidden: 0,
      },
      jpegTexture: args.jpegTexture?.() ?? {
        available: false,
        active: 'original',
        swaps: 0,
        guid: null,
        name: null,
        kind: null,
        width: 0,
        height: 0,
        format: null,
        colorSpace: null,
      },
      materialShaderIdentifiers: [...args.renderer!.shader.materialShaderIdentifiers()],
      ...(args.state ? { state: args.state.snapshot() } : {}),
      ...(args.changeDetection ? { changeDetection: args.changeDetection.snapshot() } : {}),
    }),
  };
  const host = globalThis as unknown as Record<string, unknown>;
  host[GAME_DEFAULT_RENDER_EVIDENCE_KEY] = evidence;
  args.registerCleanup?.(() => {
    if (host[GAME_DEFAULT_RENDER_EVIDENCE_KEY] === evidence) {
      delete host[GAME_DEFAULT_RENDER_EVIDENCE_KEY];
    }
  });
}
