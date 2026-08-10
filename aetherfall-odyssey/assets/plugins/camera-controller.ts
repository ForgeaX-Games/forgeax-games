import { AudioListener } from "@forgeax/engine-audio";
import type { BootstrapContext } from "@forgeax/engine-app";
import {
  Entity,
  Time,
  Update,
  createQueryState,
  queryRun,
  type EntityHandle,
  type World,
} from "@forgeax/engine-ecs";
import {
  ANTIALIAS_FXAA,
  BLOOM_ENABLED,
  Camera,
  perspective,
  TONEMAP_ACES_FILMIC,
} from "@forgeax/engine-render";
import { quat } from "@forgeax/engine-runtime";
import { AssetGuid } from "@forgeax/engine-pack/guid";
import type { PhysicsWorld } from "@forgeax/engine-physics";
import { Transform } from "@forgeax/engine-scene";
import type { UiAsset, UiResult } from "@forgeax/engine-ui";
import { installHud, HUD_UI_GUID, type HudHandle, type ViewMode } from "./hud";
import {
  createGameSettingsState,
  mountSettings,
  SETTINGS_UI_GUID,
  type GameSettingsState,
  type SettingsHandle,
} from "./settings";
import {
  GameplayInput,
  CameraRig,
  PlayerBodyPart,
  PlayerMotion,
} from "./components/gameplay";
import {
  installDepthOfField,
  DEPTH_OF_FIELD_ID,
  type DepthOfFieldHandle,
} from "./depth-of-field";
import { ATMOSPHERIC_FOG_ID, installAtmosphericFog } from "./atmospheric-fog";
import {
  installChromaticAberration,
  CHROMATIC_ABERRATION_ID,
  type ChromaticAberrationHandle,
} from "./chromatic-aberration";
import { installRenderSettingsSystems } from "./systems/render-settings";
import type { LoadedScene } from "./scene-runtime";
import { PERSPECTIVE_FOV_INITIAL } from "./camera-zoom";
import {
  EXPLORATION_HUD_UI_GUID,
  installExplorationHud,
  type ExplorationHudHandle,
} from "./exploration-hud";
import {
  aetherfallOrbitPose,
  type OrbitStrategy,
} from "./camera-orbit";

export const TOP_DOWN_Y = 13;
export const TOP_DOWN_OFFSET_Z = 9;
export const CAMERA_FOLLOW = 8;
export const PAN_HALF_HEIGHT_INITIAL = 8;
export const PAN_HALF_HEIGHT_MIN = 3;
export const PAN_HALF_HEIGHT_MAX = 14;
export const PAN_SPEED = 8;
export const EYE_HEIGHT = 0.55;
export const ORBIT_COLLISION_RELEASE_RESPONSE = 8;
export const ORBIT_COLLISION_RELEASE_EPSILON = 0.02;
export const ORBIT_COLLISION_STABILIZER_SYSTEM_NAME =
  "aetherfall-orbit-collision-stabilizer";

type Vec3 = readonly [number, number, number];

export type OrbitCollisionStabilizer = {
  readonly step: (desiredOffset: Vec3, deltaSeconds: number) => Vec3;
  readonly reset: () => void;
};

/**
 * Keep collision contraction conservative while damping only radial release.
 * Direction remains immediate, so look input and authored yaw are not delayed.
 */
export function createOrbitCollisionStabilizer(): OrbitCollisionStabilizer {
  let offset: Vec3 | undefined;
  return {
    step(desiredOffset, deltaSeconds) {
      const desiredRadius = Math.hypot(
        desiredOffset[0],
        desiredOffset[1],
        desiredOffset[2],
      );
      if (!Number.isFinite(desiredRadius) || desiredRadius <= 1e-6)
        return offset ?? [0, 0, 0];
      if (offset === undefined) {
        offset = [...desiredOffset];
        return offset;
      }
      const currentRadius = Math.hypot(...offset);
      if (desiredRadius < currentRadius) {
        // Never leave the camera beyond a newly detected obstruction.
        offset = [...desiredOffset];
        return offset;
      }
      const vectorDelta = Math.hypot(
        desiredOffset[0] - offset[0],
        desiredOffset[1] - offset[1],
        desiredOffset[2] - offset[2],
      );
      if (
        desiredRadius > currentRadius + ORBIT_COLLISION_RELEASE_EPSILON ||
        vectorDelta > ORBIT_COLLISION_RELEASE_EPSILON
      ) {
        const dt = Number.isFinite(deltaSeconds)
          ? Math.max(0, Math.min(0.25, deltaSeconds))
          : 0;
        const amount = 1 - Math.exp(-ORBIT_COLLISION_RELEASE_RESPONSE * dt);
        offset = [
          offset[0] + (desiredOffset[0] - offset[0]) * amount,
          offset[1] + (desiredOffset[1] - offset[1]) * amount,
          offset[2] + (desiredOffset[2] - offset[2]) * amount,
        ];
      }
      return offset;
    },
    reset() {
      offset = undefined;
    },
  };
}

export type StabilizedOrbitPose = {
  readonly target: Vec3;
  readonly pos: Vec3;
  readonly quat: readonly [number, number, number, number];
};

export type OrbitCollisionStabilizerSystemHandle = {
  readonly reset: () => void;
  readonly snapshot: () => StabilizedOrbitPose | undefined;
  readonly dispose: () => void;
};

function finiteVec3(value: Vec3): boolean {
  return value.every(Number.isFinite);
}

/** Install target-centred Orbit pose stabilization after the raw follow solve. */
export function installOrbitCollisionStabilizerSystem(args: {
  readonly world: World;
  readonly camera: EntityHandle;
  readonly player: EntityHandle;
  readonly getMode: () => ViewMode;
}): OrbitCollisionStabilizerSystemHandle {
  let focusOffset: Vec3 | undefined;
  let cameraOffset: Vec3 | undefined;
  let previousDesiredStrategy: OrbitStrategy | undefined;
  let previousDesiredFocusOffset: Vec3 | undefined;
  let previousDesiredRadius: number | undefined;
  let lastSnapshot: StabilizedOrbitPose | undefined;
  let installed = false;
  const reset = (): void => {
    focusOffset = undefined;
    cameraOffset = undefined;
    previousDesiredStrategy = undefined;
    previousDesiredFocusOffset = undefined;
    previousDesiredRadius = undefined;
    lastSnapshot = undefined;
  };
  const step = (
    anchor: Vec3,
    desiredTarget: Vec3,
    desiredPos: Vec3,
    desiredStrategy: OrbitStrategy,
    deltaSeconds: number,
  ): StabilizedOrbitPose | undefined => {
    if (!finiteVec3(anchor) || !finiteVec3(desiredTarget) || !finiteVec3(desiredPos))
      return lastSnapshot;
    const nextFocusOffset: Vec3 = [
      desiredTarget[0] - anchor[0],
      desiredTarget[1] - anchor[1],
      desiredTarget[2] - anchor[2],
    ];
    const nextCameraOffset: Vec3 = [
      desiredPos[0] - desiredTarget[0],
      desiredPos[1] - desiredTarget[1],
      desiredPos[2] - desiredTarget[2],
    ];
    const desiredRadius = Math.hypot(...nextCameraOffset);
    if (!Number.isFinite(desiredRadius) || desiredRadius <= 1e-6)
      return lastSnapshot;

    if (focusOffset === undefined || cameraOffset === undefined) {
      focusOffset = nextFocusOffset;
      cameraOffset = nextCameraOffset;
    } else {
      const strategyChanged =
        previousDesiredStrategy !== undefined &&
        desiredStrategy !== previousDesiredStrategy;
      const focusCompositionChanged =
        previousDesiredFocusOffset !== undefined &&
        Math.hypot(
          nextFocusOffset[0] - previousDesiredFocusOffset[0],
          nextFocusOffset[1] - previousDesiredFocusOffset[1],
          nextFocusOffset[2] - previousDesiredFocusOffset[2],
        ) > ORBIT_COLLISION_RELEASE_EPSILON;
      const obstructionContracted =
        !strategyChanged &&
        !focusCompositionChanged &&
        previousDesiredRadius !== undefined &&
        desiredRadius < previousDesiredRadius;
      if (obstructionContracted) {
        // A newly closer obstruction within one composition is a safety event.
        focusOffset = nextFocusOffset;
        cameraOffset = nextCameraOffset;
      } else {
        const dt = Number.isFinite(deltaSeconds)
          ? Math.max(0, Math.min(0.25, deltaSeconds))
          : 0;
        const amount = 1 - Math.exp(-ORBIT_COLLISION_RELEASE_RESPONSE * dt);
        focusOffset = [
          focusOffset[0] + (nextFocusOffset[0] - focusOffset[0]) * amount,
          focusOffset[1] + (nextFocusOffset[1] - focusOffset[1]) * amount,
          focusOffset[2] + (nextFocusOffset[2] - focusOffset[2]) * amount,
        ];
        cameraOffset = [
          cameraOffset[0] + (nextCameraOffset[0] - cameraOffset[0]) * amount,
          cameraOffset[1] + (nextCameraOffset[1] - cameraOffset[1]) * amount,
          cameraOffset[2] + (nextCameraOffset[2] - cameraOffset[2]) * amount,
        ];
      }
    }
    previousDesiredStrategy = desiredStrategy;
    previousDesiredFocusOffset = nextFocusOffset;
    previousDesiredRadius = desiredRadius;
    const target: Vec3 = [
      anchor[0] + focusOffset[0],
      anchor[1] + focusOffset[1],
      anchor[2] + focusOffset[2],
    ];
    const pos: Vec3 = [
      target[0] + cameraOffset[0],
      target[1] + cameraOffset[1],
      target[2] + cameraOffset[2],
    ];
    const rotation = quat.fromLookAt(quat.create(), pos, target, [0, 1, 0]);
    lastSnapshot = {
      target,
      pos,
      quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
    };
    return lastSnapshot;
  };

  args.world.addSystem(Update, {
    name: ORBIT_COLLISION_STABILIZER_SYSTEM_NAME,
    after: ["game-camera-follow"],
    before: ["propagateTransforms"],
    queries: [],
    fn: () => {
      if (args.getMode() !== "orbit") {
        reset();
        return;
      }
      const playerTransform = args.world.get(args.player, Transform);
      const playerMotion = args.world.get(args.player, PlayerMotion);
      const input = args.world.get(args.player, GameplayInput);
      if (!playerTransform.ok || !playerMotion.ok || !input.ok) return;
      const anchor: Vec3 = [
        playerTransform.value.pos[0] ?? 0,
        playerMotion.value.jumpY,
        playerTransform.value.pos[2] ?? 0,
      ];
      const physics = args.world.hasResource("PhysicsWorld")
        ? args.world.getResource<PhysicsWorld>("PhysicsWorld")
        : undefined;
      const desired = aetherfallOrbitPose({
        playerX: anchor[0],
        playerY: anchor[1],
        playerZ: anchor[2],
        lookYaw: Number.isFinite(input.value.lookYaw)
          ? input.value.lookYaw
          : 0,
        lookPitch: Number.isFinite(input.value.lookPitch)
          ? input.value.lookPitch
          : 0,
        ...(physics === undefined ? {} : { physics }),
        playerEntity: args.player,
      });
      const stable = step(
        anchor,
        desired.target,
        desired.pos,
        desired.strategy,
        args.world.getResource(Time).delta,
      );
      if (stable === undefined) return;
      args.world.set(args.camera, Transform, { pos: stable.pos, quat: stable.quat });
    },
  }).unwrap();
  installed = true;

  return {
    reset,
    snapshot: () => lastSnapshot,
    dispose: () => {
      if (!installed) return;
      args.world.removeSystem(Update, ORBIT_COLLISION_STABILIZER_SYSTEM_NAME).unwrap();
      installed = false;
      reset();
    },
  };
}

export type CameraController = {
  readonly camera: EntityHandle;
  readonly topQuaternion: readonly [number, number, number, number];
  readonly hud: HudHandle;
  readonly explorationHud: ExplorationHudHandle;
  readonly settingsState: GameSettingsState;
  readonly settings: SettingsHandle;
  readonly depthOfField: DepthOfFieldHandle;
  readonly chromaticAberration: ChromaticAberrationHandle;
  readonly getMode: () => ViewMode;
  readonly setMode: (mode: ViewMode) => void;
  readonly applyPanCamera: () => void;
};

type CameraControllerArgs = {
  readonly world: World;
  readonly canvas: HTMLCanvasElement;
  readonly host: BootstrapContext | undefined;
  readonly loaded: LoadedScene | null;
  readonly player: EntityHandle | undefined;
  readonly initX: number;
  readonly initZ: number;
};

async function loadUiAsset(
  host: BootstrapContext | undefined,
  guidText: string,
): Promise<UiResult<UiAsset>> {
  const fail = (message: string): UiResult<UiAsset> => ({
    ok: false,
    error: {
      code: "invalid-asset",
      expected: "a loadable UiAsset from the configured pack",
      hint: "Check the UI GUID and dev pack transport.",
      detail: { message, asset: guidText },
    },
  });
  if (host?.assets === undefined) return fail("Asset registry is unavailable");
  const guid = AssetGuid.parse(guidText);
  if (!guid.ok) return fail(`Invalid UI GUID: ${guidText}`);
  const loaded = await host.assets.loadByGuid<UiAsset>(guid.value);
  if (loaded.ok) return loaded;
  return fail(`${loaded.error.code}: ${loaded.error.hint}`);
}

function cameraModeIndex(value: ViewMode): number {
  return value === "topdown"
    ? 0
    : value === "orbit"
      ? 1
      : value === "fps"
        ? 2
        : 3;
}

function cameraModeValue(value: number): ViewMode {
  return value === 1
    ? "orbit"
    : value === 2
      ? "fps"
      : value === 3
        ? "pan"
        : "topdown";
}

/** Assemble the camera owner and its screen-space presentation boundary. */
export async function createCameraController(
  args: CameraControllerArgs,
): Promise<CameraController> {
  const { world, canvas, host, loaded, player, initX, initZ } = args;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const aspect = canvas.width / canvas.height || 1;
  const topPitch = -Math.atan2(TOP_DOWN_Y, TOP_DOWN_OFFSET_Z);
  const topQ = quat.create();
  quat.fromAxisAngle(topQ, [1, 0, 0], topPitch);
  const topQuaternion: readonly [number, number, number, number] = [
    topQ[0]!,
    topQ[1]!,
    topQ[2]!,
    topQ[3]!,
  ];
  const camera = world
    .spawn(
      {
        component: Transform,
        data: {
          pos: [initX, TOP_DOWN_Y, initZ + TOP_DOWN_OFFSET_Z],
          quat: topQuaternion,
        },
      },
      {
        component: Camera,
        data: {
          ...perspective({
            fov: PERSPECTIVE_FOV_INITIAL,
            aspect,
            near: 0.1,
            far: 200,
          }),
          exposure: 0.8,
          tonemap: TONEMAP_ACES_FILMIC,
          bloom: BLOOM_ENABLED,
          antialias: ANTIALIAS_FXAA,
          clearColor: [0.11, 0.17, 0.21, 1],
        },
      },
      {
        component: CameraRig,
        data: {
          followX: initX,
          followZ: initZ + TOP_DOWN_OFFSET_Z,
          panX: initX,
          panZ: initZ + TOP_DOWN_OFFSET_Z,
          panHalfHeight: PAN_HALF_HEIGHT_INITIAL,
          perspectiveFov: PERSPECTIVE_FOV_INITIAL,
        },
      },
      { component: AudioListener, data: {} },
    )
    .unwrap();

  const bodyPartQuery = createQueryState({
    with: [PlayerBodyPart, Transform, Entity],
  });
  if (loaded) {
    for (const node of loaded.nodes) {
      const name = (node.components.Name as { value?: string } | undefined)
        ?.value;
      if (name === undefined || !name.startsWith("Player") || name === "Player")
        continue;
      const entity = loaded.mapping.get(node.localId);
      if (entity === undefined) continue;
      const transform = world.get(entity, Transform);
      world.addComponent(entity, {
        component: PlayerBodyPart,
        data: {
          baseScaleX: transform.ok ? (transform.value.scale[0] ?? 1) : 1,
          baseScaleY: transform.ok ? (transform.value.scale[1] ?? 1) : 1,
          baseScaleZ: transform.ok ? (transform.value.scale[2] ?? 1) : 1,
        },
      });
    }
  }
  const setPlayerVisible = (visible: boolean): void => {
    queryRun(bodyPartQuery, world, (bundle) => {
      for (let index = 0; index < bundle.Entity.self.length; index += 1) {
        const entity = bundle.Entity.self[index] as EntityHandle | undefined;
        if (entity === undefined) continue;
        const part = world.get(entity, PlayerBodyPart);
        if (!part.ok) continue;
        const scale: [number, number, number] = visible
          ? [
              part.value.baseScaleX,
              part.value.baseScaleY,
              part.value.baseScaleZ,
            ]
          : [0, 0, 0];
        world.set(entity, Transform, { scale });
      }
    });
  };

  const [hudLoad, settingsLoad, explorationHudLoad] = await Promise.all([
    loadUiAsset(host, HUD_UI_GUID),
    loadUiAsset(host, SETTINGS_UI_GUID),
    loadUiAsset(host, EXPLORATION_HUD_UI_GUID),
  ]);
  const hudAsset = hudLoad.ok ? hudLoad.value : null;
  const settingsAsset = settingsLoad.ok ? settingsLoad.value : null;
  const explorationHudAsset = explorationHudLoad.ok
    ? explorationHudLoad.value
    : null;
  if (!hudLoad.ok)
    console.error(
      `[game] HUD UI load failed (${hudLoad.error.code}): ${hudLoad.error.detail.message}`,
    );
  if (!settingsLoad.ok)
    console.error(
      `[game] settings UI load failed (${settingsLoad.error.code}): ${settingsLoad.error.detail.message}`,
    );
  if (!explorationHudLoad.ok)
    console.error(
      `[aetherfall] exploration HUD load failed (${explorationHudLoad.error.code}): ${explorationHudLoad.error.detail.message}`,
    );
  const uiHost = host?.uiRoot ?? canvas.parentElement ?? undefined;
  const settingsState = createGameSettingsState();
  let settings: SettingsHandle = {
    instance: null,
    state: settingsState,
    open() {},
    close() {},
    dispose() {},
  };
  let setMode: (mode: ViewMode) => void = () => {};
  const nextMode = (): ViewMode => {
    const rig = world.get(camera, CameraRig);
    const current = rig.ok ? cameraModeValue(rig.value.mode) : "topdown";
    return cameraModeValue((cameraModeIndex(current) + 1) % 4);
  };
  const hud = installHud({
    asset: hudAsset,
    initialMode: "topdown",
    onToggle: () => setMode(nextMode()),
    onSettings: () => settings.open(),
    ...(uiHost ? { host: uiHost } : {}),
    hidden: true,
    ...(hudLoad.ok ? {} : { error: hudLoad.error }),
  });
  host?.registerCleanup?.(() => hud.dispose());
  const explorationHud: ExplorationHudHandle =
    uiHost === undefined
      ? {
          error: explorationHudLoad.ok ? undefined : explorationHudLoad.error,
          settingsTrigger: null,
          setSnapshot() {},
          setHighContrast() {},
          dispose() {},
        }
      : installExplorationHud({
          asset: explorationHudAsset,
          root: uiHost,
          initialHighContrast: settingsState.highContrast,
          onSettings: () => settings.open(),
          ...(explorationHudLoad.ok ? {} : { error: explorationHudLoad.error }),
        });
  host?.registerCleanup?.(() => explorationHud.dispose());

  world.insertResource("gameDefaultSettings", settingsState);
  if (uiHost) {
    settings = mountSettings(
      settingsAsset,
      uiHost,
      settingsState,
      explorationHud.settingsTrigger ?? canvas,
      settingsLoad.ok ? undefined : settingsLoad.error,
      (state) => explorationHud.setHighContrast(state.highContrast),
    );
  }
  const depthOfField = installDepthOfField(
    world,
    host?.renderer,
    settingsState.depthOfField,
  );
  if (!depthOfField.installed && depthOfField.error)
    console.warn(`[game] depth-of-field unavailable: ${depthOfField.error}`);
  const atmosphericFog = installAtmosphericFog(world, host?.renderer, [
    DEPTH_OF_FIELD_ID,
    ATMOSPHERIC_FOG_ID,
  ]);
  if (!atmosphericFog.installed && atmosphericFog.error)
    console.warn(`[game] atmospheric fog unavailable: ${atmosphericFog.error}`);
  const chromaticAberration = installChromaticAberration(
    world,
    host?.renderer,
    [DEPTH_OF_FIELD_ID, ATMOSPHERIC_FOG_ID, CHROMATIC_ABERRATION_ID],
  );
  if (!chromaticAberration.installed && chromaticAberration.error)
    console.warn(
      `[game] chromatic aberration unavailable: ${chromaticAberration.error}`,
    );
  installRenderSettingsSystems({
    world,
    camera,
    settings: settingsState,
    depthOfField,
  });
  host?.registerCleanup?.(() => settings.dispose());

  const cameraState = {
    get mode(): ViewMode {
      const rig = world.get(camera, CameraRig);
      return rig.ok ? cameraModeValue(rig.value.mode) : "topdown";
    },
    set mode(value: ViewMode) {
      world.set(camera, CameraRig, { mode: cameraModeIndex(value) });
    },
  };
  const orbitCollision =
    player === undefined
      ? undefined
      : installOrbitCollisionStabilizerSystem({
          world,
          camera,
          player,
          getMode: () => cameraState.mode,
        });
  host?.registerCleanup?.(() => orbitCollision?.dispose());
  const applyPanCamera = (): void => {
    const rig = world.get(camera, CameraRig);
    if (!rig.ok) return;
    const halfWidth = rig.value.panHalfHeight * aspect;
    world.set(camera, Camera, {
      projection: 1,
      left: -halfWidth,
      right: halfWidth,
      bottom: -rig.value.panHalfHeight,
      top: rig.value.panHalfHeight,
      near: 0.1,
      far: 200,
    });
    world.set(camera, Transform, {
      pos: [rig.value.panX, TOP_DOWN_Y, rig.value.panZ],
      quat: topQuaternion,
    });
  };
  const restorePerspectiveCamera = (): void => {
    const rig = world.get(camera, CameraRig);
    world.set(camera, Camera, {
      projection: 0,
      fov: rig.ok ? rig.value.perspectiveFov : PERSPECTIVE_FOV_INITIAL,
      aspect,
      near: 0.1,
      far: 200,
    });
  };
  setMode = (mode: ViewMode): void => {
    if (mode !== cameraState.mode) {
      orbitCollision?.reset();
      if (player !== undefined)
        world.set(player, GameplayInput, { lookYaw: 0, lookPitch: 0 });
    }
    cameraState.mode = mode;
    if (mode === "pan") {
      world.set(camera, CameraRig, {
        panX: initX,
        panZ: initZ + TOP_DOWN_OFFSET_Z,
        panHalfHeight: PAN_HALF_HEIGHT_INITIAL,
      });
      applyPanCamera();
    } else {
      restorePerspectiveCamera();
    }
    hud.setMode(mode);
    setPlayerVisible(mode !== "fps");
    canvas.style.cursor = mode === "fps" ? "crosshair" : "";
    host?.setPointerLockAllowed?.(mode === "fps" || mode === "orbit");
  };
  setMode("orbit");

  hud.setMode(cameraState.mode);

  return {
    camera,
    topQuaternion,
    hud,
    explorationHud,
    settingsState,
    settings,
    depthOfField,
    chromaticAberration,
    getMode: () => cameraState.mode,
    setMode,
    applyPanCamera,
  };
}
