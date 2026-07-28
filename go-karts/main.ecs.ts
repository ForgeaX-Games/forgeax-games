/**
 * ForgeaX native entry — distilled Three MainScene → ECS bootstrap.
 *
 * Static world: assets/scene.pack.json (defaultScene).
 * Dynamic: InputSnapshot + registerUpdate (kart / AI / camera / session / HUD).
 */
import {
  ANTIALIAS_FXAA,
  BLOOM_ENABLED,
  Camera,
  TONEMAP_ACES_FILMIC,
  Transform,
  perspective,
} from '@forgeax/engine-runtime';
import type { World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
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

const KEY = (key: string) => ({ type: 'key', key } as const);
const INPUT_MAP: readonly ActionConfig[] = [
  { action: 'accelerate', bindings: [KEY('w'), KEY('W'), KEY('ArrowUp')] },
  { action: 'brake', bindings: [KEY('s'), KEY('S'), KEY('ArrowDown')] },
  { action: 'steerLeft', bindings: [KEY('a'), KEY('A'), KEY('ArrowLeft')] },
  { action: 'steerRight', bindings: [KEY('d'), KEY('D'), KEY('ArrowRight')] },
  { action: 'drift', bindings: [KEY('Shift')] },
  { action: 'resetKart', bindings: [KEY('r'), KEY('R')] },
];

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

  const camera = world
    .spawn(
      { component: Transform, data: {} },
      {
        component: Camera,
        data: {
          ...perspective({
            fov: (62 * Math.PI) / 180,
            aspect,
            near: 0.1,
            far: 500,
          }),
          tonemap: TONEMAP_ACES_FILMIC,
          bloom: BLOOM_ENABLED,
          antialias: ANTIALIAS_FXAA,
          clearColor: [0.55, 0.82, 1.0, 1],
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
  const followCamera = createFollowCamera({ world, camera, track: kart.track });
  followCamera.snapTo(kart.getPose());

  const aiDefs = [
    { name: 'KartDuck', speed: 15.6, progress: 0.02, lateral: -2.8, phase: 0.4 },
    { name: 'KartPanda', speed: 16.6, progress: 0.045, lateral: 2.8, phase: 1.7 },
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

  const hud = installKartHud(ctx?.uiRoot);
  ctx?.registerCleanup?.(() => hud.dispose());

  if (!ctx?.registerUpdate) {
    console.error('[go-karts] registerUpdate unavailable; driving loop not started');
    return;
  }

  ctx.registerUpdate((dt: number) => {
    const input = readInput();
    const pose = kart.update(dt, input, { driftHeld: hud.isDriftHeld() });
    const playerProg = session.playerProgress(pose.trackT);
    ais.update(dt, session.elapsed, playerProg);
    session.update(dt, pose.trackT, ais.getProgresses());
    followCamera.update(dt, pose);

    hud.setSpeed(kart.getSpeedKph());
    hud.setLap(session.lap, session.totalLaps);
    hud.setRank(session.rank, 1 + aiList.length);
    hud.setTime(session.elapsed);
    hud.setPhase(session.phase);
  });
}
