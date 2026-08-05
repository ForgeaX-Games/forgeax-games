/**
 * ForgeaX native entry — distilled Three MainScene → ECS bootstrap.
 *
 * Static world: assets/scene.pack.json (defaultScene).
 * Dynamic: InputSnapshot + ECS Update system (kart / AI / camera / session / HUD).
 */
import { Transform } from '@forgeax/engine-scene';
import {
  ANTIALIAS_FXAA,
  BLOOM_ENABLED,
  BLOOM_DISABLED,
  Camera,
  DirectionalLight,
  PointLight,
  Skylight,
  TONEMAP_NEUTRAL,
  perspective,
} from '@forgeax/engine-render';
import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import { quat } from '@forgeax/engine-runtime';
import {
  createInputSnapshot,
  INPUT_MAP_KEY,
  INPUT_SNAPSHOT_RESOURCE_KEY,
  type ActionConfig,
  type InputSnapshot,
} from '@forgeax/engine-input';
import { createKartController } from './src/kart-controller';
import { createFollowCamera } from './src/follow-camera';
import { installKartHud } from './src/hud';
import { createAiRacers, type AiRacer } from './src/ai-racers';
import { adoptHostScene, findEntityByName, loadSceneByGuid } from './src/scene';
import { createRaceSession } from './src/race-session';
import { createCoinPickups } from './src/coin-pickups';
import { createItemBoxes } from './src/item-boxes';
import { createKartItems } from './src/item-system';
import { createBoostPads } from './src/boost-pads';
import { installKartGarage, runStartLineCountdown, type GarageSelection } from './src/garage';
import { applyGarageSelection } from './src/garage-appearance';
import { GARAGE_POSITION, loadGarageScene } from './src/garage-scene';
import { createOriginalGarageModels } from './src/original-garage-models';
import { playSceneWipe } from './src/scene-wipe';
import { createRaceVfx } from './src/race-vfx';
import { createBoostPadFx } from './src/boost-pad-fx';
import { createSkyDrift } from './src/sky-drift';

const KEY = (key: string) => ({ type: 'key', key } as const);
const INPUT_MAP: readonly ActionConfig[] = [
  { action: 'accelerate', bindings: [KEY('w'), KEY('W'), KEY('ArrowUp')] },
  { action: 'brake', bindings: [KEY('s'), KEY('S'), KEY('ArrowDown')] },
  { action: 'steerLeft', bindings: [KEY('a'), KEY('A'), KEY('ArrowLeft')] },
  { action: 'steerRight', bindings: [KEY('d'), KEY('D'), KEY('ArrowRight')] },
  { action: 'drift', bindings: [KEY('Shift')] },
  { action: 'useItem', bindings: [KEY(' ')] },
  { action: 'resetKart', bindings: [KEY('r'), KEY('R')] },
];

function setCameraLookAt(
  world: World,
  camera: EntityHandle,
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): void {
  const rotation = quat.create();
  quat.fromLookAt(rotation, position, target, [0, 1, 0]);
  const current = world.get(camera, Transform);
  if (!current.ok) return;
  world.set(camera, Transform, {
    ...current.value,
    pos: [...position],
    quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
  });
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  let loaded = adoptHostScene(world, ctx);
  if (!loaded) loaded = await loadSceneByGuid(world, ctx?.assets);
  if (!loaded) {
    console.error('[go-karts] defaultScene could not be loaded; KartBase is unavailable');
    return;
  }

  const kartEntity = findEntityByName(loaded, 'KartBase');
  if (kartEntity === undefined) {
    console.error(
      '[go-karts] KartBase not found; rebuild scene.pack.json (scripts/build-scene.mjs)',
    );
    return;
  }

  const authoredTransform = world.get(kartEntity, Transform);
  if (!authoredTransform.ok) {
    console.error('[go-karts] KartBase has no Transform:', authoredTransform.error);
    return;
  }

  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) {
    console.error('[go-karts] engine canvas #app not found');
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const aspect = canvas.width / canvas.height || 1;

  // Cartoon grade: Neutral keeps midtone chroma that ACES crush.
  const SKY_CLEAR: readonly [number, number, number, number] = [0.3, 0.66, 1.0, 1];
  const raceLook = {
    tonemap: TONEMAP_NEUTRAL,
    // Midday look: a neutral key plus real sky fill carry the lift, so exposure
    // only needs a nudge — pushing it to 1.0 bleaches albedos.
    exposure: 0.92,
    bloom: BLOOM_ENABLED,
    // Higher threshold so yellow item-box "?" paint does not bloom-strobe.
    bloomThreshold: 1.75,
    bloomIntensity: 0.3,
    bloomBlurRadius: 2.2,
    antialias: ANTIALIAS_FXAA,
    clearColor: [...SKY_CLEAR] as [number, number, number, number],
  };
  // Garage is a dark spotlight stage; keep exposure lower so the race cut
  // to bright outdoor reads as the original transition.
  const garageLook = {
    ...raceLook,
    exposure: 0.76,
    // Bloom + intersecting thin flaps/fins on box & rocket read as strobing
    // while the showroom spins. Keep bloom for the outdoor race only.
    bloom: BLOOM_DISABLED,
    clearColor: [0.05, 0.06, 0.09, 1] as [number, number, number, number],
  };
  const cameraLook = garageLook;
  const camera = world
    .spawn(
      { component: Transform, data: {} },
      {
        component: Camera,
        data: {
          ...perspective({
            // Original race chase FOV (MainScene photo/race cam = 62°).
            fov: (62 * Math.PI) / 180,
            aspect,
            near: 0.1,
            far: 500,
          }),
          ...cameraLook,
        },
      },
    )
    .unwrap();

  world.insertResource(INPUT_MAP_KEY, INPUT_MAP);
  const emptySnapshot = createInputSnapshot();
  const readInput = (): InputSnapshot =>
    world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
      ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
      : emptySnapshot;

  const kart = createKartController({ world, entity: kartEntity });
  // Original chase: pos = kart - tan*8.6 + y4.6, lookAt +tan*6 / y1.4.
  const followCamera = createFollowCamera({
    world,
    camera,
    track: kart.track,
    distance: 8.6,
    height: 4.6,
    lookAhead: 6.0,
    lookHeight: 1.4,
    positionSharpness: 7.5,
  });
  followCamera.snapTo(kart.getPose());

  const aiDefs = [
    { name: 'KartDuck', speed: 25.2, progress: 0.02, lateral: -2.8, phase: 0.4 },
    { name: 'KartPanda', speed: 26.0, progress: 0.045, lateral: 2.8, phase: 1.7 },
  ] as const;
  const aiList: AiRacer[] = [];
  for (const d of aiDefs) {
    const ent = findEntityByName(loaded, d.name);
    if (ent === undefined) {
      console.warn(`[go-karts] AI racer ${d.name} missing from scene`);
      continue;
    }
    aiList.push({
      entity: ent,
      name: d.name,
      baseSpeed: d.speed,
      progress: d.progress,
      lateral: d.lateral,
      phase: d.phase,
    });
  }
  const ais = createAiRacers({ world, track: kart.track, racers: aiList });
  const session = createRaceSession({ totalLaps: 3 });
  const coins = createCoinPickups(world, loaded);
  const boxes = createItemBoxes(world, loaded);
  const items = createKartItems({ world, scene: loaded, kart, ais });
  const boostPads = createBoostPads(kart);
  const garageScene = await loadGarageScene(world, ctx?.assets);
  const originalGarageModels = createOriginalGarageModels({
    world,
    assets: ctx?.assets,
    scene: loaded,
  });
  const garageLights: EntityHandle[] = garageScene
    ? [
        world.spawn(
          { component: Transform, data: { pos: [170, 5.4, 4.5] } },
          { component: PointLight, data: { color: [1, 0.62, 0.36], intensity: 42, range: 18 } },
        ).unwrap(),
        world.spawn(
          { component: Transform, data: { pos: [166, 3.2, 1.5] } },
          { component: PointLight, data: { color: [0.45, 0.62, 1], intensity: 18, range: 14 } },
        ).unwrap(),
        world.spawn(
          { component: Transform, data: { pos: [174, 2.5, 0] } },
          { component: PointLight, data: { color: [1, 0.4, 0.2], intensity: 16, range: 12 } },
        ).unwrap(),
      ]
    : [];
  const skylightEntity = findEntityByName(loaded, 'Skylight');
  const sunEntity = findEntityByName(loaded, 'Sun');
  // Snapshot race lighting before garage dimming. ECS get() may return a live
  // store reference; cloning avoids restoring the already-dimmed values on GO.
  const skylightResult = skylightEntity === undefined
    ? null
    : world.get(skylightEntity, Skylight);
  const sunResult = sunEntity === undefined
    ? null
    : world.get(sunEntity, DirectionalLight);
  const raceSkylightValue = skylightResult?.ok
    ? {
        ...skylightResult.value,
        color: [...skylightResult.value.color] as [number, number, number],
      }
    : null;
  const raceSunValue = sunResult?.ok
    ? {
        ...sunResult.value,
        direction: [...sunResult.value.direction] as [number, number, number],
        color: [...sunResult.value.color] as [number, number, number],
      }
    : null;
  // Midday key/fill: a near-white sun close to overhead with a proper blue sky
  // bounce, so shadows read cool-neutral instead of warm golden-hour falloff.
  if (raceSkylightValue !== null) {
    raceSkylightValue.color = [0.62, 0.76, 0.98];
    raceSkylightValue.intensity = 0.45;
  }
  if (raceSunValue !== null) {
    // A white key is far brighter per unit than the old amber one, so the
    // intensity comes down even though the scene ends up lighter.
    raceSunValue.color = [1.0, 0.97, 0.92];
    raceSunValue.intensity = 2.2;
    raceSunValue.castShadow = true;
    raceSunValue.mapSize = 2048;
    raceSunValue.shadowDistance = 180;
    raceSunValue.pcfKernelSize = 9;
    raceSunValue.depthBias = 0.002;
    raceSunValue.normalBias = 0.04;
    if ('cascadeCount' in raceSunValue) raceSunValue.cascadeCount = 4;
    if ('cascadeBlend' in raceSunValue) raceSunValue.cascadeBlend = 0.35;
    if ('splitLambda' in raceSunValue) raceSunValue.splitLambda = 0.82;
    if ('direction' in raceSunValue) {
      raceSunValue.direction = [-0.32, -0.92, -0.24];
    }
  }
  if (skylightEntity !== undefined && raceSkylightValue !== null) {
    world.set(skylightEntity, Skylight, {
      ...raceSkylightValue,
      intensity: 0.1,
    });
  }
  if (sunEntity !== undefined && raceSunValue !== null) {
    world.set(sunEntity, DirectionalLight, {
      ...raceSunValue,
      intensity: 0.25,
    });
  }

  const hud = installKartHud(ctx?.uiRoot);
  hud.setItem(null);
  hud.setVisible(false);
  const vfx = createRaceVfx(world, loaded);
  let boostPadFx: { update(dt: number): void } = { update() {} };
  let skyDrift: { update(dt: number): void } = { update() {} };
  try {
    boostPadFx = createBoostPadFx(world, loaded);
  } catch (err) {
    console.warn('[go-karts] boost-pad fx disabled:', err);
  }
  try {
    skyDrift = createSkyDrift(world, loaded);
  } catch (err) {
    console.warn('[go-karts] sky-drift disabled:', err);
  }
  let raceStarted = false;
  let awaitingCountdown = false;
  let countdownStarted = false;
  let inGarage = Boolean(garageScene);
  // Showroom yaw: start at a three-quarter angle; drag / equip impulse can spin.
  const GARAGE_YAW_REST = Math.PI - 0.3;
  let garageYaw = GARAGE_YAW_REST;
  let garageYawVel = 0;
  let garageDragging = false;
  let garageYawApplied = Number.NaN;
  let garageSelection: GarageSelection = { kart: 'classic', pet: 'dog', outfit: 'none' };
  const uiHost = ctx?.uiRoot ?? document.body;
  const isDepthFragileKart = (kart: GarageSelection['kart']): boolean =>
    kart === 'box' || kart === 'rocket';
  const showGaragePreview = (force = false): void => {
    // Box flaps/tape and rocket fins intentionally intersect the body. Rewriting
    // transforms every frame (even with vel≈0) re-sorts those faces and strobes.
    if (!force && Math.abs(garageYaw - garageYawApplied) < 1e-4) return;
    garageYawApplied = garageYaw;
    const current = world.get(kartEntity, Transform);
    if (!current.ok) return;
    world.set(kartEntity, Transform, {
      ...current.value,
      pos: [GARAGE_POSITION.x, 0.23, GARAGE_POSITION.z],
      quat: [0, Math.sin(garageYaw * 0.5), 0, Math.cos(garageYaw * 0.5)],
    });
    originalGarageModels?.updatePose({
      x: GARAGE_POSITION.x,
      y: 0.23,
      z: GARAGE_POSITION.z,
      yaw: garageYaw,
    });
  };

  // Empty root scene.pack / failed garage diorama left the camera in a near-black
  // void at GARAGE_POSITION. If the diorama is missing, fall back to the track.
  if (garageScene) {
    showGaragePreview(true);
    setCameraLookAt(
      world,
      camera,
      [GARAGE_POSITION.x, 3, GARAGE_POSITION.z + 6.4],
      [GARAGE_POSITION.x, 1.28, GARAGE_POSITION.z],
    );
    const garageCamera = world.get(camera, Camera);
    if (garageCamera.ok) {
      world.set(camera, Camera, {
        ...garageCamera.value,
        ...perspective({
          fov: (50 * Math.PI) / 180,
          aspect,
          near: 0.1,
          far: 500,
        }),
        ...garageLook,
      });
    }
  } else {
    console.warn('[go-karts] garage diorama missing — opening on track spawn');
    if (skylightEntity !== undefined && raceSkylightValue !== null) {
      world.set(skylightEntity, Skylight, raceSkylightValue);
    }
    if (sunEntity !== undefined && raceSunValue !== null) {
      world.set(sunEntity, DirectionalLight, raceSunValue);
    }
    kart.reset();
    originalGarageModels?.updatePose(kart.getPose());
    followCamera.snapTo(kart.getPose());
    const raceCamera = world.get(camera, Camera);
    if (raceCamera.ok) {
      world.set(camera, Camera, {
        ...raceCamera.value,
        ...perspective({
          fov: (70 * Math.PI) / 180,
          aspect,
          near: 0.1,
          far: 500,
        }),
        ...raceLook,
      });
    }
    hud.setVisible(true);
  }

  const enterRaceTrack = (selection: GarageSelection): void => {
    inGarage = false;
    garageDragging = false;
    garageYawVel = 0;
    applyGarageSelection(world, loaded, selection);
    originalGarageModels?.select(selection);
    originalGarageModels?.setGarageVisible(false);
    garageScene?.dispose();
    for (const light of garageLights) world.despawn(light);
    if (skylightEntity !== undefined && raceSkylightValue !== null) {
      world.set(skylightEntity, Skylight, raceSkylightValue);
    }
    if (sunEntity !== undefined && raceSunValue !== null) {
      world.set(sunEntity, DirectionalLight, raceSunValue);
    }
    kart.reset();
    originalGarageModels?.updatePose(kart.getPose());
    const raceCamera = world.get(camera, Camera);
    if (raceCamera.ok) {
      world.set(camera, Camera, {
        ...raceCamera.value,
        ...perspective({
          fov: (70 * Math.PI) / 180,
          aspect,
          near: 0.1,
          far: 500,
        }),
        ...raceLook,
      });
    }
    hud.setVisible(true);
    followCamera.beginIntro(kart.getPose());
    awaitingCountdown = true;
    countdownStarted = false;
  };

  const garage = installKartGarage({
    host: ctx?.uiRoot,
    onChange(selection) {
      garageSelection = selection;
      applyGarageSelection(world, loaded, selection);
      originalGarageModels?.select(selection);
      // Fragile karts: snap back to the stable three-quarter angle.
      if (isDepthFragileKart(selection.kart)) {
        garageYaw = GARAGE_YAW_REST;
        garageYawVel = 0;
      }
      if (inGarage) showGaragePreview(true);
    },
    onTabChange(tab) {
      originalGarageModels?.setCarouselTab(tab);
    },
    onEquipImpulse(selection) {
      // Box/rocket must not free-spin — intersecting flaps/fins strobe in ForgeaX.
      if (isDepthFragileKart(selection.kart)) {
        garageYaw = GARAGE_YAW_REST;
        garageYawVel = 0;
        showGaragePreview(true);
        return;
      }
      garageYawVel = 9;
    },
    onOrbitDrag(dx) {
      if (!inGarage) return;
      garageDragging = true;
      if (isDepthFragileKart(garageSelection.kart)) {
        // Discrete 30° steps only — continuous yaw re-triggers depth fighting.
        const step = Math.PI / 6;
        const next = garageYaw + dx * 0.012;
        const snapped = Math.round(next / step) * step;
        if (Math.abs(snapped - garageYaw) > 1e-6) {
          garageYaw = snapped;
          garageYawVel = 0;
          showGaragePreview(true);
        }
        return;
      }
      const d = dx * 0.012;
      garageYaw += d;
      garageYawVel = garageYawVel * 0.5 + d * 60 * 0.5;
      showGaragePreview(true);
    },
    onOrbitEnd() {
      garageDragging = false;
      if (isDepthFragileKart(garageSelection.kart)) {
        garageYawVel = 0;
      }
    },
    // Wipe → track + intro cam → start-line countdown → unlock controls.
    onLeaveGarage(selection) {
      playSceneWipe(uiHost, {
        onCovered: () => enterRaceTrack(selection),
      });
    },
  });
  ctx?.registerCleanup?.(() => hud.dispose());
  ctx?.registerCleanup?.(() => garage.dispose());
  ctx?.registerCleanup?.(() => originalGarageModels?.dispose());

  world.addSystem(Update, {
    name: 'go-karts-update',
    queries: [],
    resources: ['Time'],
    fn: () => {
      const dt = world.getResource(Time).delta;
      const poseIdle = kart.getPose();

      // Intro arc while waiting for countdown; VFX can already idle-puff.
      skyDrift.update(dt);
      boostPadFx.update(dt);
      if (!raceStarted) {
        if (inGarage) {
          if (!garageDragging && !isDepthFragileKart(garageSelection.kart)) {
            if (Math.abs(garageYawVel) > 1e-4) {
              garageYaw += garageYawVel * dt;
              garageYawVel *= Math.exp(-dt * 2.4);
              showGaragePreview();
            }
          }
        }
        if (awaitingCountdown) {
          const stillIntro = followCamera.updateIntro(dt, poseIdle);
          vfx.update(dt);
          vfx.updateExhaust(dt, poseIdle, false, true);
          originalGarageModels?.updatePose(poseIdle);
          if (!stillIntro && !countdownStarted) {
            countdownStarted = true;
            runStartLineCountdown(uiHost, () => {
              raceStarted = true;
              awaitingCountdown = false;
              vfx.burstAt(poseIdle.x, poseIdle.y + 0.5, poseIdle.z, 'smoke');
            });
          }
        }
        return;
      }

      const input = readInput();
      const resetPressed = input.action('resetKart').justPressed();
      const useItemPressed =
        input.action('useItem').justPressed() || hud.consumeItemUse();
      const pose = kart.update(dt, input, { driftHeld: hud.isDriftHeld() });
      originalGarageModels?.updatePose(pose);
      if (resetPressed) {
        coins.reset();
        boxes.reset();
        items.reset();
        boostPads.reset();
        vfx.reset();
        kart.setCoinCount(0);
        hud.setItem(null);
      }

      const padHit = boostPads.update(dt, pose);
      if (padHit) vfx.boostPadAt(padHit.x, padHit.y, padHit.z);

      const pickedCoins = coins.update(pose);
      if (pickedCoins > 0) hud.coinPickup(pickedCoins);
      kart.setCoinCount(coins.getCount());

      const playerProg = session.playerProgress(pose.trackT);
      ais.update(dt, session.elapsed, playerProg);
      const aiPoses = ais.getPoses();
      boxes.update(dt, [
        {
          id: 'player',
          pose,
          canReceive: !items.hasItem(),
          onReceive: (box) => {
            const item = items.obtainRandom();
            if (item) hud.setItem(item);
            vfx.burstAt(box.x, box.y, box.z, 'box');
          },
        },
        ...aiPoses.map((ai) => ({
          id: ai.id,
          pose: ai,
          canReceive: !items.hasAiItem(ai.id),
          onReceive: (box: { x: number; y: number; z: number }) => {
            items.obtainRandomForAi(ai.id);
            vfx.burstAt(box.x, box.y, box.z, 'box');
          },
        })),
      ]);

      if (useItemPressed) {
        const result = items.use(pose);
        if (result) {
          hud.setItem(items.getHeld());
          hud.showItemUsed(result);
          if (result.item === 'boost') {
            vfx.burstAt(pose.x, pose.y + 0.5, pose.z, 'spark');
          }
        }
      }

      for (const event of items.update(dt, pose)) {
        hud.showRivalItemUsed(event.racer, event, event.hitPlayer);
        if (event.item === 'boost' || event.item === 'star') {
          const rival = aiPoses.find((ai) => ai.id === event.racer);
          if (rival) vfx.burstAt(rival.x, rival.y + 0.5, rival.z, 'spark');
        }
      }
      session.update(dt, pose.trackT, ais.getProgresses());
      followCamera.update(dt, pose);
      vfx.update(dt);
      vfx.updateExhaust(dt, pose, kart.isBoosting(), true);

      hud.setSpeed(kart.getSpeedKph());
      hud.setLap(session.lap, session.totalLaps);
      hud.setRank(session.rank, 1 + aiList.length);
      hud.setTime(session.elapsed);
      hud.setCoins(coins.getCount());
      hud.setBoostActive(kart.isBoosting());
      hud.setStarActive(items.isStarActive());
      hud.setHornActive(items.isHornActive());
      hud.setPhase(session.phase);
      if (session.phase === 'waiting' && session.playerResult) {
        hud.showPersonalFinish(session.playerResult, 1 + aiList.length);
      } else if (session.phase === 'results') {
        hud.showResults(session.standings);
      }
    },
  });
}
