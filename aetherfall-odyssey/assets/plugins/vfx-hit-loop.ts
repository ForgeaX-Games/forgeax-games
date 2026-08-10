import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { mat4, quat, vec3 } from '@forgeax/engine-math';
import { Camera, type Renderer } from '@forgeax/engine-render';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { Transform } from '@forgeax/engine-scene';
import {
  loadVfxGpuEffect,
  ParticleEffectPlayer,
  VFX_GPU_RUNTIME_RESOURCE_KEY,
  type VfxGpuEffectAsset,
  type VfxGpuRuntime,
} from '@forgeax/engine-vfx';
import { createVfxRuntimeHost } from '@forgeax/engine-vfx-render';

/** GPU Pack v2 effect owned by Aetherfall's hit interaction. */
export const GAME_DEFAULT_HIT_VFX_GUID = '28db471c-e3b0-4a92-8a3e-af9d5fe7494d';
/** GPU Pack v2 effect used while the player charges the next attack. */
export const GAME_DEFAULT_CHARGE_VFX_GUID = 'b77fe5c8-c103-4878-85b2-91768cb5efc2';

/** Public renderer identity retained for the owner-projection tests. */
export const PARTICLE_RENDER_FEATURE_ID = 'forgeax.vfx-render.gpu-particles';

export function findParticleRenderFeatureOwner<
  T extends { readonly identity: string },
>(diagnostics: readonly T[]): T | undefined {
  return diagnostics.find((diagnostic) => diagnostic.identity === PARTICLE_RENDER_FEATURE_ID);
}

export type VfxHitLoopMode = 'hit' | 'charge';

export interface VfxHitLoopSnapshot {
  readonly available: boolean;
  readonly mode: VfxHitLoopMode;
  readonly playing: boolean;
  readonly seed: number;
  readonly triggers: number;
  readonly guid: string | null;
  readonly emitterCount: number;
  readonly emitterStatuses: readonly string[];
  readonly batchKinds: readonly string[];
  readonly alive: number;
  readonly bucketCount: number;
  readonly readiness: string;
  readonly errorCode: string | null;
  readonly errorHint: string | null;
}

export interface VfxHitLoop {
  readonly trigger: () => void;
  readonly beginCharge: () => void;
  readonly endCharge: () => void;
  readonly triggerCharge: () => void;
  readonly reset: () => void;
  readonly snapshot: () => VfxHitLoopSnapshot;
  readonly dispose: () => void;
}

function unavailable(errorCode: string | null, errorHint: string | null): VfxHitLoopSnapshot {
  return {
    available: false,
    mode: 'hit',
    playing: false,
    seed: 0,
    triggers: 0,
    guid: null,
    emitterCount: 0,
    emitterStatuses: [],
    batchKinds: [],
    alive: 0,
    bucketCount: 0,
    readiness: 'unavailable',
    errorCode,
    errorHint,
  };
}

function failure(error: unknown): { readonly code: string; readonly hint: string } {
  if (error !== null && typeof error === 'object') {
    const value = error as { readonly code?: unknown; readonly hint?: unknown };
    return {
      code: typeof value.code === 'string' ? value.code : 'vfx-host-failed',
      hint: typeof value.hint === 'string' ? value.hint : 'inspect the VFX host failure detail',
    };
  }
  return { code: 'vfx-host-failed', hint: String(error) };
}

function cameraSource(camera: EntityHandle) {
  return {
    read(currentWorld: World) {
      const transform = currentWorld.get(camera, Transform);
      const cameraValue = currentWorld.get(camera, Camera);
      if (!transform.ok || !cameraValue.ok) return undefined;
      const position = new Float32Array(transform.value.pos);
      const rotation = transform.value.quat;
      const right = quat.right(vec3.create(), rotation);
      const up = quat.up(vec3.create(), rotation);
      const forward = quat.forward(vec3.create(), rotation);
      const target = vec3.create();
      vec3.add(target, position, forward);
      let viewProjection: Float32Array;
      if (cameraValue.value.projection === 1) {
        const halfWidth = (cameraValue.value.right - cameraValue.value.left) * 0.5;
        const halfHeight = (cameraValue.value.top - cameraValue.value.bottom) * 0.5;
        const projection = mat4.orthographic(
          mat4.create(),
          -halfWidth,
          halfWidth,
          -halfHeight,
          halfHeight,
          cameraValue.value.near,
          cameraValue.value.far,
        );
        const view = mat4.lookAt(mat4.create(), position, target, up);
        viewProjection = mat4.multiply(mat4.create(), projection, view);
      } else {
        viewProjection = mat4.computeViewProj(
          mat4.create(),
          position,
          target,
          up,
          cameraValue.value.fov,
          cameraValue.value.aspect,
          cameraValue.value.near,
          cameraValue.value.far,
        );
      }
      return { position, right, up, viewProjection };
    },
  };
}

function noOpLoop(snapshot: VfxHitLoopSnapshot): VfxHitLoop {
  return {
    trigger: () => undefined,
    beginCharge: () => undefined,
    endCharge: () => undefined,
    triggerCharge: () => undefined,
    reset: () => undefined,
    snapshot: () => snapshot,
    dispose: () => undefined,
  };
}

/** Attach one replayable GPU effect to the scored target. */
export async function createVfxHitLoop(options: {
  readonly world: World;
  readonly assets?: AssetRegistry;
  readonly renderer?: Renderer;
  readonly target?: EntityHandle;
  readonly camera: EntityHandle;
}): Promise<VfxHitLoop> {
  const { world, assets, renderer, target, camera } = options;
  if (assets === undefined || renderer === undefined || target === undefined) {
    return noOpLoop(unavailable('host-unavailable', 'VFX needs the Preview AssetRegistry, Renderer, and a scored target.'));
  }
  const parsed = AssetGuid.parse(GAME_DEFAULT_HIT_VFX_GUID);
  if (!parsed.ok) return noOpLoop(unavailable(parsed.error.code, parsed.error.hint));
  const parsedCharge = AssetGuid.parse(GAME_DEFAULT_CHARGE_VFX_GUID);
  if (!parsedCharge.ok) return noOpLoop(unavailable(parsedCharge.error.code, parsedCharge.error.hint));

  const host = createVfxRuntimeHost({ camera: cameraSource(camera) });
  const attached = await host.attachWorld({ world, assets });
  if (!attached.ok) {
    const cause = failure(attached.error);
    return noOpLoop(unavailable(cause.code, cause.hint));
  }
  const loaded = await loadVfxGpuEffect(assets, GAME_DEFAULT_HIT_VFX_GUID);
  if (!loaded.ok) {
    const cause = failure(loaded.error);
    host.detachWorld({ world });
    return noOpLoop(unavailable(cause.code, cause.hint));
  }
  const loadedCharge = await loadVfxGpuEffect(assets, GAME_DEFAULT_CHARGE_VFX_GUID);
  if (!loadedCharge.ok) {
    const cause = failure(loadedCharge.error);
    host.detachWorld({ world });
    return noOpLoop(unavailable(cause.code, cause.hint));
  }

  const hitEffect = world.allocSharedRef('ParticleEffectAsset', loaded.value);
  const chargeEffect = world.allocSharedRef('ParticleEffectAsset', loadedCharge.value);
  const player = world.addComponent(target, {
    component: ParticleEffectPlayer,
    data: { effect: hitEffect, playing: false, seed: 0, timeScale: 1 },
  });
  if (!player.ok) {
    world.sharedRefs.release(hitEffect);
    world.sharedRefs.release(chargeEffect);
    host.detachWorld({ world });
    return noOpLoop(unavailable(player.error.code, player.error.hint));
  }
  const installed = await renderer.installRenderFeature(host.feature);
  if (!installed.ok) {
    world.removeComponent(target, ParticleEffectPlayer);
    world.sharedRefs.release(hitEffect);
    world.sharedRefs.release(chargeEffect);
    host.detachWorld({ world });
    return noOpLoop(unavailable(installed.error.code, installed.error.hint));
  }

  let seed = 0;
  let mode: VfxHitLoopMode = 'hit';
  let playing = false;
  let triggers = 0;
  let disposed = false;
  const writePlayer = (): void => {
    if (disposed) return;
    world.set(target, ParticleEffectPlayer, {
      effect: mode === 'hit' ? hitEffect : chargeEffect,
      playing,
      seed,
      timeScale: 1,
    });
  };
  const snapshot = (): VfxHitLoopSnapshot => {
    const runtime = world.hasResource(VFX_GPU_RUNTIME_RESOURCE_KEY)
      ? world.getResource<VfxGpuRuntime>(VFX_GPU_RUNTIME_RESOURCE_KEY)
      : undefined;
    const effect: VfxGpuEffectAsset = mode === 'hit' ? loaded.value : loadedCharge.value;
    const diagnostics = runtime?.diagnostics() ?? [];
    const error = diagnostics.at(-1);
    const renderers = effect.program.emitters.flatMap((emitter) =>
      emitter.renderers.map((rendererEntry) => rendererEntry.kind),
    );
    return {
      available: true,
      mode,
      playing,
      seed,
      triggers,
      guid: mode === 'hit' ? GAME_DEFAULT_HIT_VFX_GUID : GAME_DEFAULT_CHARGE_VFX_GUID,
      emitterCount: effect.program.emitters.length,
      emitterStatuses: effect.program.emitters.map(() => 'gpu'),
      batchKinds: renderers,
      alive: 0,
      bucketCount: new Set(renderers).size,
      readiness: runtime?.hasPlayer(target) === true ? 'ready' : 'warming',
      errorCode: error?.code ?? null,
      errorHint: error?.hint ?? null,
    };
  };
  return {
    trigger: () => {
      if (disposed) return;
      seed = (seed + 1) >>> 0;
      triggers += 1;
      mode = 'hit';
      playing = true;
      writePlayer();
    },
    beginCharge: () => {
      if (disposed || (mode === 'charge' && playing)) return;
      seed = (seed + 1) >>> 0;
      triggers += 1;
      mode = 'charge';
      playing = true;
      writePlayer();
    },
    endCharge: () => {
      if (disposed || mode !== 'charge') return;
      playing = false;
      writePlayer();
    },
    triggerCharge: () => {
      if (disposed || (mode === 'charge' && playing)) return;
      seed = (seed + 1) >>> 0;
      triggers += 1;
      mode = 'charge';
      playing = true;
      writePlayer();
    },
    reset: () => {
      if (disposed) return;
      seed = 0;
      triggers = 0;
      mode = 'hit';
      playing = false;
      writePlayer();
    },
    snapshot,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      playing = false;
      world.set(target, ParticleEffectPlayer, { playing: false });
      world.removeComponent(target, ParticleEffectPlayer);
      world.sharedRefs.release(hitEffect);
      world.sharedRefs.release(chargeEffect);
      host.detachWorld({ world });
    },
  };
}
