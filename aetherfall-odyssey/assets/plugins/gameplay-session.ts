import { Transform } from "@forgeax/engine-scene";
import {
  Entity,
  Time,
  Update,
  createQueryState,
  queryRun,
  type EntityHandle,
  type World,
} from "@forgeax/engine-ecs";
import type { BootstrapContext } from "@forgeax/engine-app";
import type { AssetRegistry } from "@forgeax/engine-assets-runtime";
import { AssetGuid } from "@forgeax/engine-pack/guid";
import type { PhysicsWorld } from "@forgeax/engine-physics";
import {
  createExplorationInputDeviceTracker,
  installGameplayInput,
} from "./gameplay-input";
import { installGameplayLifecycle } from "./gameplay-lifecycle";
import {
  HIT_SFX_GUID,
  MUSIC_GUID,
  installGameplayAudio,
} from "./gameplay-audio";
import { installAudioEvidence } from "./audio-evidence";
import {
  installGameplayState,
  type GameplayStateHandle,
} from "./gameplay-state";
import { installDebugAxes, type DebugAxesHandle } from "./debug-axes";
import {
  GAME_DEFAULT_FONT_GUID,
  GAME_DEFAULT_TTF_FONT_GUID,
  createWorldScoreText,
  type WorldScoreTextHandle,
} from "./world-score-text";
import { createVfxHitLoop, type VfxHitLoop } from "./vfx-hit-loop";
import {
  installMultiWorldOverlay,
  type MultiWorldOverlay,
} from "./multi-world-overlay";
import { targetProfilePoints } from "./target-profile-loop";
import { scoringPoints } from "./scoring-target";
import { createScorePopup } from "./score-popup";
import {
  createProjectilePresentation,
  type ProjectilePresentation,
} from "./projectile-presentation";
import { createGameplayReset } from "./gameplay-reset";
import {
  installGameplayChangeDetection,
  type GameplayChangeDetectionHandle,
} from "./change-detection";
import { Projectile, ResetPose } from "./components/gameplay";
import {
  GAME_DEFAULT_MATERIAL_ELAPSED_ORIGIN,
  installDefaultGameplayConfig,
  installGameplayCommandCounters,
} from "./resources/gameplay";
import { installGameplayInputMap } from "./resources/input";
import { PLAYER_Y } from "./scene-runtime";
import { type GameplayTargetFeatures } from "./gameplay-targets";
import {
  createCameraController,
  type CameraController,
} from "./camera-controller";
import { installAudioSettingsSystem } from "./systems/audio-settings";
import { installTargetStatusSystem } from "./target-status";
import { createHitStreak, type HitStreakHandle } from "./hit-streak";
import {
  createExplorationControlsTimer,
  explorationLockedFeedback,
} from "./exploration-hud";
import {
  explorationWorldFeedbackSignature,
  installExplorationSystem,
  type ExplorationSystemHandle,
} from "./exploration-system";
import {
  installGameplayInputInjection,
  type GameplayInputInjection,
} from "./gameplay-input-injection";
import {
  FOX_CLIP_GUIDS,
  FOX_SCENE_GUID,
  createFoxPlayer,
  type FoxPlayerHandle,
} from "./fox-player";
import {
  createProceduralWorld,
  type ProceduralWorldHandle,
} from "./procedural-world";
import { requirePlayerMovementPhysics } from "./systems/player-movement";
import {
  HERO_OBSERVATORY_SCENE_GUID,
  createHeroObservatory,
  type HeroObservatoryHandle,
} from "./hero-observatory";
import {
  GOTHIC_SENTINEL_SCENE_GUID,
  THRESHOLD_DOOR_SCENE_GUID,
  createThresholdMonument,
  type ThresholdMonumentHandle,
} from "./threshold-monument";
import {
  ROCK_FACE_SCENE_GUID,
  createRockFaceFraming,
  type RockFaceFramingHandle,
} from "./rock-face-framing";
import {
  installTraversalBoundary,
  type TraversalBoundaryHandle,
} from "./traversal-boundary";
import {
  createAetherfallLightingRig,
  type AetherfallLightingRigHandle,
} from "./lighting-rig";
import { GAME_DEFAULT_SPRITE_ATLAS_GUID } from "./sprite-atlas-loop";
import {
  isResidualCleanupError,
  isResidualCleanupOwner,
  type ResidualCleanupOwner,
} from "./world-installation-lifecycle";

const GAMEPLAY_SESSION_CORE_PREFETCH_GUIDS = [
  FOX_SCENE_GUID,
  FOX_CLIP_GUIDS.idle,
  FOX_CLIP_GUIDS.walk,
  FOX_CLIP_GUIDS.gallop,
  HERO_OBSERVATORY_SCENE_GUID,
  THRESHOLD_DOOR_SCENE_GUID,
  GOTHIC_SENTINEL_SCENE_GUID,
  ROCK_FACE_SCENE_GUID,
  HIT_SFX_GUID,
  MUSIC_GUID,
] as const;

const GAMEPLAY_SESSION_COMPARISON_PREFETCH_GUIDS = [
  GAME_DEFAULT_FONT_GUID,
  GAME_DEFAULT_TTF_FONT_GUID,
  GAME_DEFAULT_SPRITE_ATLAS_GUID,
] as const;

export type GameplaySessionPrefetchResult = {
  readonly guid: string;
  readonly status: "fulfilled" | "rejected";
};

export type GameplaySessionPrefetch = {
  readonly started: readonly string[];
  readonly settled: Promise<readonly GameplaySessionPrefetchResult[]>;
};

type GameplaySessionWorldHandle = { readonly dispose: () => void };

export type GameplaySessionWorldConstructors = {
  readonly fox: () => Promise<FoxPlayerHandle | undefined>;
  readonly procedural: () => Promise<ProceduralWorldHandle | undefined>;
  readonly hero: () => Promise<HeroObservatoryHandle | undefined>;
  readonly threshold: () => Promise<ThresholdMonumentHandle | undefined>;
  readonly rock: () => Promise<RockFaceFramingHandle | undefined>;
};

export type GameplaySessionWorldInstallationResult = {
  readonly foxPlayer: FoxPlayerHandle | undefined;
  readonly proceduralWorld: ProceduralWorldHandle | undefined;
  readonly heroObservatory: HeroObservatoryHandle | undefined;
  readonly thresholdMonument: ThresholdMonumentHandle | undefined;
  readonly rockFaceFraming: RockFaceFramingHandle | undefined;
};

export type GameplaySessionWorldInstallation = {
  readonly settled: Promise<GameplaySessionWorldInstallationResult>;
  readonly dispose: () => void;
};

/**
 * Install the World-mutating presentation stage in a deterministic order.
 * Stop is synchronous: an in-flight constructor may settle, but its handle is
 * immediately retired and no later constructor is invoked.
 */
export function startGameplaySessionWorldInstallation(
  constructors: GameplaySessionWorldConstructors,
): GameplaySessionWorldInstallation {
  const owned: GameplaySessionWorldHandle[] = [];
  let stopped = false;

  const retire = (handle: GameplaySessionWorldHandle): void => {
    const index = owned.indexOf(handle);
    if (index >= 0) owned.splice(index, 1);
  };

  const adoptResidual = (owner: ResidualCleanupOwner): void => {
    if (!owned.includes(owner)) owned.push(owner);
  };

  const retryResidual = (owner: ResidualCleanupOwner): readonly unknown[] => {
    const completedErrors: unknown[] = [];
    try {
      owner.dispose();
    } catch (error) {
      if (owner.hasPending()) throw error;
      completedErrors.push(error);
    }
    if (owner.hasPending())
      throw new Error(
        `[aetherfall] ${owner.label} cleanup returned with residual ownership`,
      );
    retire(owner);
    return completedErrors;
  };

  const disposeOwned = (): void => {
    const errors: unknown[] = [];
    for (let index = owned.length - 1; index >= 0; index--) {
      const handle = owned[index];
      if (handle === undefined) continue;
      try {
        handle.dispose();
        if (isResidualCleanupOwner(handle) && handle.hasPending()) {
          errors.push(
            new Error(
              `[aetherfall] ${handle.label} cleanup returned with residual ownership`,
            ),
          );
          continue;
        }
        owned.splice(index, 1);
      } catch (error) {
        if (isResidualCleanupOwner(handle) && !handle.hasPending())
          owned.splice(index, 1);
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(errors, "Gameplay session world cleanup failed");
  };

  const dispose = (): void => {
    stopped = true;
    disposeOwned();
  };

  const install = async <Handle extends GameplaySessionWorldHandle>(
    constructor: () => Promise<Handle | undefined>,
    optionalLabel?: string,
  ): Promise<Handle | undefined> => {
    if (stopped) return undefined;
    let handle: Handle | undefined;
    try {
      handle = await constructor();
    } catch (error) {
      if (isResidualCleanupError(error)) {
        const owner = error.residualCleanup;
        adoptResidual(owner);
        let completedErrors: readonly unknown[];
        try {
          completedErrors = retryResidual(owner);
        } catch (retryError) {
          throw new AggregateError(
            [error, retryError],
            `Gameplay session could not retire ${owner.label} residual ownership`,
          );
        }
        if (stopped) {
          const report =
            completedErrors.length === 0
              ? error
              : new AggregateError(
                  [error, ...completedErrors],
                  `${owner.label} residual cleanup completed after Stop with reported errors`,
                );
          console.error(
            `[aetherfall] ${owner.label} installer failed after Stop; residual cleanup completed`,
            report,
          );
          return undefined;
        }
        if (optionalLabel !== undefined) {
          console.error(
            `[aetherfall] optional ${optionalLabel} failed without blocking gameplay after residual cleanup completed: ${error.message}`,
          );
          for (const completedError of completedErrors)
            console.error(
              `[aetherfall] ${owner.label} cleanup completed but reported: ${completedError instanceof Error ? completedError.message : String(completedError)}`,
            );
          return undefined;
        }
        if (completedErrors.length > 0)
          throw new AggregateError(
            [error, ...completedErrors],
            `Gameplay session retired ${owner.label} with reported cleanup errors`,
          );
        throw error;
      }
      if (stopped) return undefined;
      if (optionalLabel !== undefined) {
        console.error(
          `[aetherfall] optional ${optionalLabel} failed without blocking gameplay: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
      throw error;
    }
    if (handle === undefined) return undefined;
    owned.push(handle);
    if (stopped) {
      disposeOwned();
      return undefined;
    }
    return handle;
  };

  const settled =
    (async (): Promise<GameplaySessionWorldInstallationResult> => {
      try {
        const foxPlayer = await install(constructors.fox);
        const proceduralWorld = await install(constructors.procedural);
        const heroObservatory = await install(constructors.hero);
        const thresholdMonument = await install(
          constructors.threshold,
          "threshold monument",
        );
        const rockFaceFraming = await install(
          constructors.rock,
          "Rock Face framing",
        );
        return {
          foxPlayer,
          proceduralWorld,
          heroObservatory,
          thresholdMonument,
          rockFaceFraming,
        };
      } catch (error) {
        try {
          dispose();
        } catch (cleanupError) {
          const cleanupErrors =
            cleanupError instanceof AggregateError
              ? cleanupError.errors
              : [cleanupError];
          const installationErrors =
            error instanceof AggregateError &&
            !isResidualCleanupError(error)
              ? error.errors
              : [error];
          throw new AggregateError(
            [...installationErrors, ...cleanupErrors],
            "Gameplay session world installation and rollback failed",
          );
        }
        throw error;
      }
    })();

  return { settled, dispose };
}

/** Start cache-only reads; every World-mutating constructor stays serial. */
export function startGameplaySessionPrefetch(
  assets: AssetRegistry | undefined,
  comparisonEvidenceMode: boolean,
): GameplaySessionPrefetch {
  if (assets === undefined)
    return { started: [], settled: Promise.resolve([]) };
  const candidates = comparisonEvidenceMode
    ? [
        ...GAMEPLAY_SESSION_CORE_PREFETCH_GUIDS,
        ...GAMEPLAY_SESSION_COMPARISON_PREFETCH_GUIDS,
      ]
    : [...GAMEPLAY_SESSION_CORE_PREFETCH_GUIDS];
  const loads = candidates.flatMap((guidText) => {
    const guid = AssetGuid.parse(guidText);
    if (!guid.ok) return [];
    try {
      return [{ guid: guidText, load: assets.loadByGuid(guid.value) }];
    } catch (error) {
      return [{ guid: guidText, load: Promise.reject(error) }];
    }
  });
  return {
    started: loads.map(({ guid }) => guid),
    settled: Promise.allSettled(loads.map(({ load }) => load)).then((results) =>
      results.map((result, index) => ({
        guid: loads[index]!.guid,
        status: result.status,
      })),
    ),
  };
}

export type GameplaySession = {
  readonly cameraController: CameraController;
  readonly projectilePresentation: ProjectilePresentation;
  readonly vfxHitLoop: VfxHitLoop;
  readonly multiWorldOverlay: MultiWorldOverlay | undefined;
  readonly worldScoreText: WorldScoreTextHandle | undefined;
  readonly changeDetection: GameplayChangeDetectionHandle;
  readonly triggerScore: () => { readonly points: number | null };
  readonly spawnPopup: (
    text: string,
    worldX: number,
    worldY: number,
    worldZ: number,
  ) => void;
  readonly readInput: ReturnType<typeof installGameplayInputMap>;
  readonly projectileEntities: () => EntityHandle[];
  readonly physics: PhysicsWorld | undefined;
  readonly debugAxes: DebugAxesHandle;
  readonly gameplayAudio:
    Awaited<ReturnType<typeof installGameplayAudio>> | undefined;
  readonly resetGameplay: () => void;
  readonly gameplayState: GameplayStateHandle;
  readonly hitStreak: HitStreakHandle | undefined;
  readonly exploration: ExplorationSystemHandle;
  readonly inputInjection: GameplayInputInjection;
  readonly foxPlayer: FoxPlayerHandle | undefined;
  readonly proceduralWorld: ProceduralWorldHandle | undefined;
  readonly heroObservatory: HeroObservatoryHandle | undefined;
  readonly thresholdMonument: ThresholdMonumentHandle | undefined;
  readonly rockFaceFraming: RockFaceFramingHandle | undefined;
  readonly traversalBoundary: TraversalBoundaryHandle;
  readonly lightingRig: AetherfallLightingRigHandle | undefined;
};

function requireAuthoredEntity(
  targets: GameplayTargetFeatures,
  name: string,
): EntityHandle {
  const node = targets.loaded?.nodes.find(
    (candidate) =>
      (candidate.components.Name as { value?: string } | undefined)?.value ===
      name,
  );
  const entity =
    node === undefined ? undefined : targets.loaded?.mapping.get(node.localId);
  if (entity === undefined)
    throw new Error(
      `[aetherfall] required authored entity is missing: ${name}`,
    );
  return entity;
}

/** Build the one gameplay session that systems consume; no feature state stays in bootstrap. */
export async function createGameplaySession(
  world: World,
  host: BootstrapContext | undefined,
  canvas: HTMLCanvasElement,
  targets: GameplayTargetFeatures,
  options: { readonly comparisonEvidenceMode: boolean },
): Promise<GameplaySession> {
  const physics = world.hasResource("PhysicsWorld")
    ? world.getResource<PhysicsWorld>("PhysicsWorld")
    : undefined;
  if (targets.player !== undefined) requirePlayerMovementPhysics(physics);
  world.insertResource(GAME_DEFAULT_MATERIAL_ELAPSED_ORIGIN, 0);
  startGameplaySessionPrefetch(host?.assets, options.comparisonEvidenceMode);
  const cameraController = await createCameraController({
    world,
    canvas,
    host,
    loaded: targets.loaded,
    player: targets.player,
    initX: targets.initX,
    initZ: targets.initZ,
  });
  const {
    camera,
    topQuaternion,
    hud,
    settingsState,
    depthOfField,
    chromaticAberration,
    getMode,
    setMode,
  } = cameraController;
  const lightingRig = createAetherfallLightingRig({
    world,
    loaded: targets.loaded,
    camera,
  });
  host?.registerCleanup?.(() => lightingRig?.dispose());
  const vfxTarget = targets.primaryTarget();
  const vfxHitLoop = await createVfxHitLoop({
    world,
    ...(host?.assets ? { assets: host.assets } : {}),
    ...(host?.renderer ? { renderer: host.renderer } : {}),
    ...(vfxTarget === undefined ? {} : { target: vfxTarget }),
    camera,
  });
  host?.registerCleanup?.(() => vfxHitLoop.dispose());
  const multiWorldOverlay =
    !options.comparisonEvidenceMode || host?.app === undefined
      ? undefined
      : installMultiWorldOverlay(host.app, host.registerCleanup);
  const worldScoreText = options.comparisonEvidenceMode
    ? await createWorldScoreText(world, host?.assets)
    : undefined;
  host?.registerCleanup?.(() => worldScoreText?.dispose());
  const changeDetection = installGameplayChangeDetection({
    world,
    targetQuery: targets.targetQuery,
    hud,
  });
  const hitStreak = createHitStreak(world, targets.player, hud);
  installTargetStatusSystem({
    world,
    hud,
    primaryTarget: targets.primaryTarget,
    targetProfile: targets.targetProfile,
  });
  const triggerScore = (): { readonly points: number | null } => {
    const target = targets.primaryTarget();
    if (target === undefined) return { points: null };
    const basePoints = scoringPoints(world, target);
    if (basePoints === undefined) return { points: null };
    const points = targetProfilePoints(targets.targetProfile, basePoints);
    changeDetection.recordHit(target, points);
    targets.damageTarget(target, points);
    const transform = world.get(target, Transform);
    if (transform.ok)
      worldScoreText?.show("+" + points, [
        transform.value.pos[0] ?? 0,
        (transform.value.pos[1] ?? 0) + 1.7,
        transform.value.pos[2] ?? 0,
      ]);
    return { points };
  };

  const spawnPopup = createScorePopup({
    world,
    camera,
    canvas,
    hud,
    worldScoreText,
  });
  const inputInjection = installGameplayInputInjection(world);
  host?.registerCleanup?.(() => inputInjection.clear());
  const readInput = installGameplayInputMap(world);
  if (targets.player === undefined)
    throw new Error("[aetherfall] authored Player is required");
  const worldInstallation = startGameplaySessionWorldInstallation({
    fox: () =>
      createFoxPlayer({
        world,
        host,
        player: targets.player!,
        readInput,
      }),
    procedural: () =>
      createProceduralWorld({
        world,
        host,
        loaded: targets.loaded,
      }),
    hero: () => createHeroObservatory({ world, host }),
    threshold: () => createThresholdMonument({ world, host }),
    rock: () => createRockFaceFraming({ world, host }),
  });
  host?.registerCleanup?.(worldInstallation.dispose);
  const {
    foxPlayer,
    proceduralWorld,
    heroObservatory,
    thresholdMonument,
    rockFaceFraming,
  } = await worldInstallation.settled;
  const exploration = installExplorationSystem({
    world,
    player: targets.player,
    readInput,
    temples: {
      "memory-temple-1": {
        entity: requireAuthoredEntity(targets, "MemoryShrine_A"),
        interactionRadius: 2.8,
      },
      "memory-temple-2": {
        entity: requireAuthoredEntity(targets, "MemoryShrine_B"),
        interactionRadius: 2.8,
      },
      "memory-temple-3": {
        entity: requireAuthoredEntity(targets, "MemoryShrine_C"),
        interactionRadius: 2.8,
      },
    },
    beacon: {
      entity: requireAuthoredEntity(targets, "LastLightBeacon"),
      interactionRadius: 3.5,
    },
    sanctuary: {
      entity: requireAuthoredEntity(targets, "SanctuaryReturn"),
      interactionRadius: 3.5,
    },
  });
  const inputDeviceTracker = createExplorationInputDeviceTracker();
  let traversalBoundary: TraversalBoundaryHandle | undefined;
  let explorationHudSignature = "";
  let worldFeedbackSignature = "";
  const controlsTimer = createExplorationControlsTimer();
  const updateExplorationHud = (): void => {
    controlsTimer.advance(world.getResource(Time).delta);
    const snapshot = exploration.snapshot();
    const nearestActionable = exploration.nearestActionable();
    const nearestLocked = exploration.nearestLocked();
    const nearestObjective = exploration.nearestObjective();
    const lastOutcome = exploration.lastOutcome();
    const inputDevice = inputDeviceTracker.update(readInput());
    const lockedFeedback = explorationLockedFeedback(
      lastOutcome,
      nearestLocked?.targetId,
    );
    const interaction =
      nearestActionable === undefined
        ? lockedFeedback
        : nearestActionable.targetId === "last-light-beacon"
          ? "Restore the Last Light"
          : nearestActionable.targetId === "sanctuary"
            ? "Return to sanctuary"
            : "Attune memory shrine";
    const showControls = controlsTimer.visible();
    const recoverySnapshot = traversalBoundary?.snapshot();
    const feedbackSignature = explorationWorldFeedbackSignature(snapshot);
    if (feedbackSignature !== worldFeedbackSignature) {
      worldFeedbackSignature = feedbackSignature;
      proceduralWorld?.setExplorationSnapshot(snapshot);
    }
    const objectiveDistance =
      nearestObjective === undefined
        ? null
        : Math.ceil(nearestObjective.distance);
    const signature = JSON.stringify({
      snapshot,
      interaction,
      nearestObjectiveId: nearestObjective?.targetId ?? null,
      objectiveDistance,
      objectiveHeading: nearestObjective?.heading ?? null,
      showControls,
      recovered: recoverySnapshot?.recovered ?? false,
      recoveries: recoverySnapshot?.recoveries ?? 0,
      inputDevice,
    });
    if (signature === explorationHudSignature) return;
    explorationHudSignature = signature;
    const phase =
      snapshot.phase === "beacon-unlocked"
        ? "beacon-ready"
        : snapshot.phase === "complete"
          ? "complete"
          : "exploring";
    const objectiveBase =
      snapshot.phase === "exploring"
        ? "Recover three lost memories"
        : snapshot.phase === "beacon-unlocked"
          ? "Restore the Last Light beacon"
          : snapshot.phase === "returning"
            ? "Return to the sanctuary overlook"
            : "The Last Light burns again";
    const objectiveLabel =
      nearestObjective?.targetId === "memory-temple-1"
        ? "Azure Shrine"
        : nearestObjective?.targetId === "memory-temple-2"
          ? "Crimson Shrine"
          : nearestObjective?.targetId === "memory-temple-3"
            ? "Ember Shrine"
            : nearestObjective?.targetId === "last-light-beacon"
              ? "Last Light"
              : nearestObjective?.targetId === "sanctuary"
                ? "Sanctuary"
                : null;
    const objective =
      objectiveLabel === null || nearestObjective === undefined
        ? objectiveBase
        : `${objectiveBase} · ${objectiveLabel} ${objectiveDistance}m`;
    cameraController.explorationHud.setSnapshot({
      objective,
      completed: snapshot.activatedTempleIds.length,
      total: 3,
      landmark:
        snapshot.phase === "exploring"
          ? "Memory Shrines"
          : snapshot.phase === "beacon-unlocked"
            ? "Last Light Observatory"
            : "Sanctuary Overlook",
      heading: nearestObjective?.heading ?? "N",
      interaction,
      phase,
      showControls,
      recovered: recoverySnapshot?.recovered ?? false,
      recoveries: recoverySnapshot?.recoveries ?? 0,
      inputDevice,
    });
  };
  updateExplorationHud();
  world
    .addSystem(Update, {
      name: "aetherfall-exploration-hud",
      queries: [],
      after: ["aetherfall-exploration-interaction"],
      before: ["propagateTransforms"],
      fn: updateExplorationHud,
    })
    .unwrap();
  if (targets.player !== undefined) {
    installGameplayInput({
      world,
      player: targets.player,
      camera,
      canvas,
      hud,
      readInput,
      getMode,
      getPlayerPosition: () => {
        const transform = world.get(targets.player!, Transform);
        return {
          x: transform.ok ? (transform.value.pos[0] ?? 0) : 0,
          z: transform.ok ? (transform.value.pos[2] ?? 0) : 0,
        };
      },
    });
  }

  const projectilePresentation = await createProjectilePresentation({
    world,
    host,
    player: targets.player,
    primaryTarget: targets.primaryTarget,
    targetEntities: targets.targetEntities,
    meshHandleSwap: targets.meshHandleSwap,
    fbxMeshSwap: targets.fbxMeshSwap,
    gltfMeshSwap: targets.gltfMeshSwap,
    jpegTextureSwap: targets.jpegTextureSwap,
    chromaticAberration,
    comparisonEvidenceMode: options.comparisonEvidenceMode,
  });
  host?.registerCleanup?.(() => projectilePresentation.dispose());
  installDefaultGameplayConfig(world, {
    playerY: PLAYER_Y,
    topQuaternion,
    bulletRadius: projectilePresentation.bulletRadius,
    bulletHalfHeight: projectilePresentation.bulletHalfHeight,
  });

  const projectileQuery = createQueryState({
    with: [Projectile, Transform, Entity],
  });
  const projectileEntities = (): EntityHandle[] => {
    const entities: EntityHandle[] = [];
    queryRun(projectileQuery, world, (bundle) => {
      for (let index = 0; index < bundle.Entity.self.length; index++) {
        const entity = bundle.Entity.self[index];
        if (entity !== undefined) entities.push(entity as EntityHandle);
      }
    });
    return entities;
  };
  installGameplayCommandCounters(world);
  for (const entity of targets.targetEntities()) {
    const transform = world.get(entity, Transform);
    if (!transform.ok) continue;
    world.addComponent(entity, {
      component: ResetPose,
      data: {
        posX: transform.value.pos[0] ?? 0,
        posY: transform.value.pos[1] ?? 0,
        posZ: transform.value.pos[2] ?? 0,
        quatX: transform.value.quat[0] ?? 0,
        quatY: transform.value.quat[1] ?? 0,
        quatZ: transform.value.quat[2] ?? 0,
        quatW: transform.value.quat[3] ?? 1,
        scaleX: transform.value.scale[0] ?? 1,
        scaleY: transform.value.scale[1] ?? 1,
        scaleZ: transform.value.scale[2] ?? 1,
      },
    });
  }
  const installedTraversalBoundary = installTraversalBoundary({
    world,
    player: targets.player,
    physics,
    initialPosition: [targets.initX, PLAYER_Y, targets.initZ],
    getMode,
  });
  traversalBoundary = installedTraversalBoundary;
  host?.registerCleanup?.(() => installedTraversalBoundary.dispose());
  const debugAxes = installDebugAxes({
    world,
    camera,
    targetQuery: targets.targetQuery,
    debugDraw: host?.app?.debugDraw,
    ...(host?.registerCleanup ? { registerCleanup: host.registerCleanup } : {}),
  });
  const gameplayAudio =
    targets.player === undefined
      ? undefined
      : await installGameplayAudio(world, targets.player, host?.assets);
  host?.registerCleanup?.(() => gameplayAudio?.dispose());
  installAudioEvidence({
    world,
    gameplayAudio,
    ...(host?.registerCleanup ? { registerCleanup: host.registerCleanup } : {}),
  });
  installAudioSettingsSystem(world, settingsState, gameplayAudio);
  const resetGameplay = createGameplayReset({
    world,
    debugAxes,
    projectileEntities,
    targetEntities: targets.targetEntities,
    spriteAtlasLoop: projectilePresentation.spriteAtlasLoop,
    materialsForCurrentMesh: projectilePresentation.materialsForCurrentMesh,
    physics,
    player: targets.player,
    camera,
    initX: targets.initX,
    initZ: targets.initZ,
    playerY: PLAYER_Y,
    targetDisabling: targets.targetDisabling,
    visibilityLoop: targets.visibilityLoop,
    targetHealth: targets.targetHealth,
    hitStreak,
    changeDetection,
    depthOfField,
    chromaticAberration,
    worldScoreText,
    videoTexturePanel: targets.videoTexturePanel,
    customProjectile: projectilePresentation.customProjectile,
    meshHandleSwap: targets.meshHandleSwap,
    fbxMeshSwap: targets.fbxMeshSwap,
    gltfMeshSwap: targets.gltfMeshSwap,
    jpegTextureSwap: targets.jpegTextureSwap,
    targetProfile: targets.targetProfile,
    fbxSkinnedTarget: targets.fbxSkinnedTarget,
    settingsState,
    setMode,
    multiWorldOverlay,
    gameplayAudio,
    materialElapsedOriginKey: GAME_DEFAULT_MATERIAL_ELAPSED_ORIGIN,
    animatedMaterial: targets.animatedMaterial,
    vfxHitLoop,
    setProjectileVisual: projectilePresentation.setProjectileVisual,
    resetMission: () => {
      exploration.reset();
      installedTraversalBoundary.reset();
      controlsTimer.reset();
      explorationHudSignature = "";
      updateExplorationHud();
      cameraController.hud.setTargetProfileActive(false, 0);
      cameraController.hud.setAssetLabStatus(
        "Asset Lab reset · authored RedBox baseline",
        "restored",
      );
    },
  });
  const gameplayState = installGameplayState({ world, reset: resetGameplay });
  installGameplayLifecycle({
    world,
    readInput,
    requestReset: gameplayState.requestReset,
  });

  return {
    cameraController,
    projectilePresentation,
    vfxHitLoop,
    multiWorldOverlay,
    worldScoreText,
    changeDetection,
    triggerScore,
    spawnPopup,
    readInput,
    projectileEntities,
    physics,
    debugAxes,
    gameplayAudio,
    resetGameplay,
    gameplayState,
    hitStreak,
    exploration,
    inputInjection,
    foxPlayer,
    proceduralWorld,
    heroObservatory,
    thresholdMonument,
    rockFaceFraming,
    traversalBoundary: installedTraversalBoundary,
    lightingRig,
  };
}
