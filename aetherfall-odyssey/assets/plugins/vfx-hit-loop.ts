import type { AssetRegistry } from "@forgeax/engine-assets-runtime";
import {
  FixedUpdate,
  type EntityHandle,
  type SharedHandle,
  type World,
} from "@forgeax/engine-ecs";
import { mat4, quat, vec3 } from "@forgeax/engine-math";
import { Camera, type Renderer } from "@forgeax/engine-render";
import { AssetGuid } from "@forgeax/engine-pack/guid";
import { Transform } from "@forgeax/engine-scene";
import {
  loadParticleEffect,
  PARTICLE_SIMULATION_RESOURCE_KEY,
  ParticleEffectPlayer,
  particleEffectPackLoader,
  particleSimulationPlugin,
  ParticleSimulation,
  createStockParticleCpuExecutorRegistry,
} from "@forgeax/engine-vfx";
import {
  particleRenderFeature,
  particleSceneSpaceResolver,
} from "@forgeax/engine-vfx-render";

/** Source Pack v2 effect owned by the template; the cooker emits its runtime program. */
export const GAME_DEFAULT_HIT_VFX_GUID = "28db471c-e3b0-4a92-8a3e-af9d5fe7494d";
/** A second authored effect that exercises rate scheduling and box spawning. */
export const GAME_DEFAULT_CHARGE_VFX_GUID =
  "b77fe5c8-c103-4878-85b2-91768cb5efc2";

/** The renderer owns one particle feature for every World it draws. */
export const PARTICLE_RENDER_FEATURE_ID = "forgeax.vfx-render.particles";
const PARTICLE_SIMULATION_SYSTEM_NAME = "vfx-particle-simulation";

/**
 * Find the existing particle RenderFeature owner without coupling gameplay to a
 * concrete host implementation. The Editor carrier owns this feature through
 * ParticleRuntimeHost; a standalone host may leave it absent for this game to
 * assemble locally.
 */
export function findParticleRenderFeatureOwner<
  T extends { readonly identity: string },
>(diagnostics: readonly T[]): T | undefined {
  return diagnostics.find(
    (diagnostic) => diagnostic.identity === PARTICLE_RENDER_FEATURE_ID,
  );
}

export type VfxHitLoopMode = "hit" | "charge";

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

function unavailable(
  errorCode: string | null,
  errorHint: string | null,
): VfxHitLoopSnapshot {
  return {
    available: false,
    mode: "hit",
    playing: false,
    seed: 0,
    triggers: 0,
    guid: null,
    emitterCount: 0,
    emitterStatuses: [],
    batchKinds: [],
    alive: 0,
    bucketCount: 0,
    readiness: "unavailable",
    errorCode,
    errorHint,
  };
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
        const halfWidth =
          (cameraValue.value.right - cameraValue.value.left) * 0.5;
        const halfHeight =
          (cameraValue.value.top - cameraValue.value.bottom) * 0.5;
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

function hasFixedSystem(world: World, name: string): boolean {
  return (
    world
      .inspect()
      .schedules.find((entry) => entry.schedule.name === FixedUpdate.name)
      ?.systems.some((system) => system.name === name) === true
  );
}

/**
 * Attach one replayable transient effect to the existing scored target.
 *
 * A carrier-owned ParticleRuntimeHost is reused when present. The local
 * simulation and late RenderFeature assembly remain the standalone fallback
 * for hosts that do not provide that owner.
 */
export async function createVfxHitLoop(options: {
  readonly world: World;
  readonly assets?: AssetRegistry;
  readonly renderer?: Renderer;
  readonly target?: EntityHandle;
  readonly camera: EntityHandle;
}): Promise<VfxHitLoop> {
  const { world, assets, renderer, target, camera } = options;
  if (assets === undefined || renderer === undefined || target === undefined) {
    return {
      trigger: () => undefined,
      beginCharge: () => undefined,
      endCharge: () => undefined,
      triggerCharge: () => undefined,
      reset: () => undefined,
      snapshot: () =>
        unavailable(
          "host-unavailable",
          "VFX needs the Preview AssetRegistry, Renderer, and a scored target.",
        ),
      dispose: () => undefined,
    };
  }
  const parsed = AssetGuid.parse(GAME_DEFAULT_HIT_VFX_GUID);
  if (!parsed.ok) {
    return {
      trigger: () => undefined,
      beginCharge: () => undefined,
      endCharge: () => undefined,
      triggerCharge: () => undefined,
      reset: () => undefined,
      snapshot: () => unavailable(parsed.error.code, parsed.error.hint),
      dispose: () => undefined,
    };
  }
  const parsedCharge = AssetGuid.parse(GAME_DEFAULT_CHARGE_VFX_GUID);
  if (!parsedCharge.ok) {
    return {
      trigger: () => undefined,
      beginCharge: () => undefined,
      endCharge: () => undefined,
      triggerCharge: () => undefined,
      reset: () => undefined,
      snapshot: () =>
        unavailable(parsedCharge.error.code, parsedCharge.error.hint),
      dispose: () => undefined,
    };
  }

  // Studio Play supplies ParticleRuntimeHost before game bootstrap. Its feature
  // observes every ParticleSimulation in the World, so creating another feature
  // here would collide on the one public RenderFeature identity. The host must
  // also have attached the matching simulation before a game can use that owner.
  const hostFeature = findParticleRenderFeatureOwner(
    renderer.renderFeatureDiagnostics(),
  );
  if (
    hostFeature !== undefined &&
    !world.hasResource(PARTICLE_SIMULATION_RESOURCE_KEY)
  ) {
    return {
      trigger: () => undefined,
      beginCharge: () => undefined,
      endCharge: () => undefined,
      triggerCharge: () => undefined,
      reset: () => undefined,
      snapshot: () =>
        unavailable(
          "particle-runtime-host-not-attached",
          "Renderer owns forgeax.vfx-render.particles, but its ParticleRuntimeHost has not attached this World.",
        ),
      dispose: () => undefined,
    };
  }
  if (hostFeature === undefined) {
    assets.loaders.registerPackLoader(particleEffectPackLoader);
  }
  const loaded = await loadParticleEffect(assets, GAME_DEFAULT_HIT_VFX_GUID);
  if (!loaded.ok) {
    return {
      trigger: () => undefined,
      beginCharge: () => undefined,
      endCharge: () => undefined,
      triggerCharge: () => undefined,
      reset: () => undefined,
      snapshot: () => unavailable(loaded.error.code, loaded.error.hint),
      dispose: () => undefined,
    };
  }
  const loadedCharge = await loadParticleEffect(
    assets,
    GAME_DEFAULT_CHARGE_VFX_GUID,
  );
  if (!loadedCharge.ok) {
    return {
      trigger: () => undefined,
      beginCharge: () => undefined,
      endCharge: () => undefined,
      triggerCharge: () => undefined,
      reset: () => undefined,
      snapshot: () =>
        unavailable(loadedCharge.error.code, loadedCharge.error.hint),
      dispose: () => undefined,
    };
  }

  let seed = 0;
  let mode: VfxHitLoopMode = "hit";
  let playing = false;
  let triggers = 0;
  let disposed = false;
  let cleaned = false;
  const cleanupSteps: Array<() => void> = [];
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    disposed = true;
    playing = false;
    for (let index = cleanupSteps.length - 1; index >= 0; index -= 1) {
      try {
        cleanupSteps[index]?.();
      } catch (cleanupError) {
        console.error("[aetherfall-vfx] cleanup step failed", cleanupError);
      }
    }
  };

  let hitEffect: SharedHandle<"ParticleEffectAsset">;
  let chargeEffect: SharedHandle<"ParticleEffectAsset">;
  let localFeature: ReturnType<typeof particleRenderFeature> | undefined;
  try {
    hitEffect = world.allocSharedRef("ParticleEffectAsset", loaded.value);
    cleanupSteps.push(() => world.sharedRefs.release(hitEffect).unwrap());
    chargeEffect = world.allocSharedRef(
      "ParticleEffectAsset",
      loadedCharge.value,
    );
    cleanupSteps.push(() => world.sharedRefs.release(chargeEffect).unwrap());
    const player = world.addComponent(target, {
      component: ParticleEffectPlayer,
      data: { effect: hitEffect, playing: false, seed: 0, timeScale: 1 },
    });
    if (!player.ok) {
      cleanup();
      return {
        trigger: () => undefined,
        beginCharge: () => undefined,
        endCharge: () => undefined,
        triggerCharge: () => undefined,
        reset: () => undefined,
        snapshot: () => unavailable(player.error.code, player.error.hint),
        dispose: () => undefined,
      };
    }
    cleanupSteps.push(() => {
      if (world.get(target, ParticleEffectPlayer).ok) {
        world.removeComponent(target, ParticleEffectPlayer).unwrap();
      }
    });

    if (hostFeature === undefined) {
      const hadSimulation = world.hasResource(PARTICLE_SIMULATION_RESOURCE_KEY);
      const hadSimulationSystem = hasFixedSystem(
        world,
        PARTICLE_SIMULATION_SYSTEM_NAME,
      );
      if (!hadSimulation) {
        cleanupSteps.push(() => {
          if (!world.hasResource(PARTICLE_SIMULATION_RESOURCE_KEY)) return;
          const simulation = world.getResource<ParticleSimulation>(
            PARTICLE_SIMULATION_RESOURCE_KEY,
          );
          try {
            simulation.advance(world, []);
          } finally {
            world.removeResource(PARTICLE_SIMULATION_RESOURCE_KEY);
          }
        });
      }
      if (!hadSimulationSystem) {
        cleanupSteps.push(() => {
          if (hasFixedSystem(world, PARTICLE_SIMULATION_SYSTEM_NAME)) {
            world
              .removeSystem(FixedUpdate, PARTICLE_SIMULATION_SYSTEM_NAME)
              .unwrap();
          }
        });
      }

      const simulationPlugin = particleSimulationPlugin({
        assets,
        cpuExecutors: createStockParticleCpuExecutorRegistry(),
        spaceResolver: particleSceneSpaceResolver({
          world,
          resolveJoint: () => target,
        }),
      });
      const built = await simulationPlugin.build(world);
      if (!built.ok) {
        cleanup();
        return {
          trigger: () => undefined,
          beginCharge: () => undefined,
          endCharge: () => undefined,
          triggerCharge: () => undefined,
          reset: () => undefined,
          snapshot: () => unavailable(built.error.code, built.error.hint),
          dispose: () => undefined,
        };
      }

      let localFeatureEnabled = true;
      localFeature = particleRenderFeature({
        observations: {
          read(currentWorld) {
            if (!localFeatureEnabled) return [];
            const simulation = currentWorld.getResource<ParticleSimulation>(
              PARTICLE_SIMULATION_RESOURCE_KEY,
            );
            const observation = simulation?.read(target);
            return observation === undefined ? [] : [observation];
          },
        },
        camera: cameraSource(camera),
      });
      cleanupSteps.push(() => {
        localFeatureEnabled = false;
        localFeature?.dispose?.({} as never).unwrap();
      });
      const installed = await renderer.installRenderFeature(localFeature);
      if (!installed.ok) {
        cleanup();
        return {
          trigger: () => undefined,
          beginCharge: () => undefined,
          endCharge: () => undefined,
          triggerCharge: () => undefined,
          reset: () => undefined,
          snapshot: () =>
            unavailable(installed.error.code, installed.error.hint),
          dispose: () => undefined,
        };
      }
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  const writePlayer = (): void => {
    if (disposed) return;
    world.set(target, ParticleEffectPlayer, {
      effect: mode === "hit" ? hitEffect : chargeEffect,
      playing,
      seed,
      timeScale: 1,
    });
  };
  const snapshot = (): VfxHitLoopSnapshot => {
    const observation = world
      .getResource<ParticleSimulation>(PARTICLE_SIMULATION_RESOURCE_KEY)
      ?.read(target);
    const localDiagnostics = localFeature?.diagnostics();
    const currentHostFeature =
      hostFeature === undefined
        ? undefined
        : findParticleRenderFeatureOwner(renderer.renderFeatureDiagnostics());
    const hostMissing =
      hostFeature !== undefined && currentHostFeature === undefined;
    const error = localDiagnostics?.error ?? currentHostFeature?.latestError;
    return {
      available: !hostMissing,
      mode,
      playing,
      seed,
      triggers,
      guid:
        mode === "hit"
          ? GAME_DEFAULT_HIT_VFX_GUID
          : GAME_DEFAULT_CHARGE_VFX_GUID,
      emitterCount: observation?.emitters.length ?? 0,
      emitterStatuses:
        observation?.emitters.map((emitter) => emitter.status) ?? [],
      batchKinds: observation?.batches.batches.map((batch) => batch.kind) ?? [],
      alive: observation?.telemetry.alive ?? 0,
      bucketCount:
        localDiagnostics?.bucketCount ??
        observation?.batches.batches.length ??
        0,
      readiness:
        localDiagnostics?.readiness ??
        (hostMissing ? "owner-missing" : "host-owned"),
      errorCode: hostMissing
        ? "particle-render-feature-owner-missing"
        : (error?.code ?? null),
      errorHint: hostMissing
        ? "The host-owned forgeax.vfx-render.particles feature disappeared after VFX bootstrap."
        : (error?.hint ?? null),
    };
  };
  return {
    trigger: () => {
      if (disposed) return;
      seed = (seed + 1) >>> 0;
      triggers += 1;
      mode = "hit";
      playing = true;
      writePlayer();
    },
    beginCharge: () => {
      if (disposed) return;
      if (mode === "charge" && playing) return;
      seed = (seed + 1) >>> 0;
      triggers += 1;
      mode = "charge";
      playing = true;
      writePlayer();
    },
    endCharge: () => {
      if (disposed || mode !== "charge") return;
      playing = false;
      writePlayer();
    },
    triggerCharge: () => {
      if (disposed) return;
      if (mode === "charge" && playing) return;
      seed = (seed + 1) >>> 0;
      triggers += 1;
      mode = "charge";
      playing = true;
      writePlayer();
    },
    reset: () => {
      if (disposed) return;
      seed = 0;
      triggers = 0;
      mode = "hit";
      playing = false;
      writePlayer();
    },
    snapshot,
    dispose: cleanup,
  };
}
