import type { GameHost, GameProjectionValue, Plugin } from '@forgeax/engine-app';
import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import { INPUT_BACKEND_KEY, INPUT_MAP_KEY } from '@forgeax/engine-input';
import { uiAssetContribution, uiAssetKind } from '@forgeax/engine-ui/preview';
import type { UiAsset } from '@forgeax/engine-ui';
import { renderComponentsPlugin } from '@forgeax/engine-render';
import { scenePlugin } from '@forgeax/engine-scene';
import { Transform } from '@forgeax/engine-scene';
import { ARENA } from './config/arena.ts';
import { createDebugCommandRegistry, type DebugCommandRegistry } from './debug/command-registry.ts';
import { createDevHud, showDevHudPage, type DevHud } from './debug/dev-hud.ts';
import { DEBUG_HUD_SNAPSHOT_KEY, installDevHudSystem } from './debug/dev-hud-system.ts';
import { createStressHud, installStressHudSystem, type StressHud } from './debug/stress-hud.ts';
import { CAMERA_RIG_RESOURCE_KEY } from './config/camera-rig.ts';
import { Enemy, M1_COMPONENTS, M2_COMPONENTS, SpawnMarker } from './ecs/components.ts';
import { ASSET_IDS } from './runtime/asset-ids.ts';
import { destroyArena, instantiateArena } from './runtime/arena.ts';
import {
  DEBUG_CLOCK_KEY,
  installDebugClock,
  type DebugClockState,
} from './runtime/debug-clock.ts';
import { configureArenaCamera, spawnArenaCamera } from './runtime/camera.ts';
import { destroyTomatoPlayer, spawnTomatoPlayer } from './runtime/player.ts';
import { spawnViewCalibration, type ViewCalibrationController } from './runtime/view-calibration.ts';
import { installCameraFollowSystem } from './systems/camera-follow-system.ts';
import { installInputSystem, PLAYER_INPUT_MAP } from './systems/input-system.ts';
import { installLimbAnimationSystem } from './systems/limb-animation-system.ts';
import { installMovementSystem } from './systems/movement-system.ts';
import { installCombatSystem, COMBAT_STATE_KEY, type CombatState } from './systems/combat-system.ts';
import { installEnemyHopSystem } from './systems/enemy-hop-system.ts';
import { installDeathSystem } from './systems/death-system.ts';
import { installMarkerAnimSystem } from './systems/marker-anim-system.ts';
import { installSpawnSystem, SPAWN_CONTROL_KEY, type SpawnControl } from './systems/spawn-system.ts';
import { installSwingAnimationSystem } from './systems/swing-anim-system.ts';
import { createDamageTextLayer, installDamageTextSystem } from './systems/damage-text-system.ts';
import { createTargetLines, installTargetLinesSystem } from './debug/target-lines.ts';
import { createSpawnGizmo, installSpawnGizmoSystem, type SpawnGizmoController } from './debug/spawn-gizmo.ts';
import { loadCombatAssets, releaseCombatAssets, type CombatAssets } from './runtime/combat-assets.ts';
import { spawnWeapons, type WeaponRig } from './runtime/weapon.ts';
import { DIRECTOR_STATE_KEY, type DirectorState } from './spawn/director.ts';
import { installStressSystem, STRESS_STATE_KEY, type StressState } from './systems/stress-system.ts';

export { ARENA } from './config/arena.ts';
export { createDebugCommandRegistry } from './debug/command-registry.ts';

export const BOOTSTRAP_DEBUG_REGISTRY_KEY = 'BrotatoV2DebugCommandRegistry';

function stressSummary(state: StressState): string {
  return `[stress] ${JSON.stringify({
    duration: Number(state.elapsed.toFixed(1)),
    peakEnemies: state.peakEnemies,
    minFps: Number(state.minFps.toFixed(1)),
    collapse30: state.collapse30 ?? null,
    collapse15: state.collapse15 ?? null,
  })}`;
}

function commandRegistry(world: World): DebugCommandRegistry {
  return world.getResource<DebugCommandRegistry>(BOOTSTRAP_DEBUG_REGISTRY_KEY);
}

function createDebugClock(): DebugClockState {
  return { paused: false, hudVisible: false, fixedTicks: 0, stepRequested: false, fixedActive: true };
}

/** World bootstrap: camera, debug clock, and the extensible command registry. */
export const bootstrapPlugin: Plugin = {
  name: 'brotato-v2/bootstrap',
  inject: ['world'],
  apply(ctx) {
    const clock = createDebugClock();
    const registry = createDebugCommandRegistry();
    const registrations = [
      registry.register({
        id: 'hud.toggle',
        key: 'Tab',
        title: 'Toggle debug dashboard',
        run: () => { clock.hudVisible = !clock.hudVisible; },
      }),
      registry.register({
        id: 'time.pause',
        key: 'p',
        aliases: ['P'],
        title: 'Pause or resume fixed updates',
        run: () => { clock.paused = !clock.paused; },
      }),
      registry.register({
        id: 'time.step',
        key: '.',
        aliases: ['>'],
        title: 'Advance one fixed update while paused',
        run: () => { if (clock.paused) clock.stepRequested = true; },
      }),
    ];
    for (const registration of registrations) {
      if (!registration.ok) throw new Error(`Brotato v2 debug command registration failed: ${registration.error.hint}`);
    }
    ctx.world.insertResource(BOOTSTRAP_DEBUG_REGISTRY_KEY, registry);
    ctx.world.insertResource(DEBUG_CLOCK_KEY, clock);
    const camera = spawnArenaCamera(ctx.world);
    ctx.effect(() => {
      const removeClock = installDebugClock(ctx.world, clock);
      return () => {
        removeClock();
        void ctx.world.despawn(camera);
        registry.dispose();
        ctx.world.removeResource(BOOTSTRAP_DEBUG_REGISTRY_KEY);
        ctx.world.removeResource(DEBUG_CLOCK_KEY);
        ctx.world.removeResource(CAMERA_RIG_RESOURCE_KEY);
      };
    }, 'brotato-v2/bootstrap');
  },
};

async function loadHudAsset(assets: AssetRegistry): Promise<UiAsset | undefined> {
  const loaded = await assets.load(ASSET_IDS.uiDebugHud, uiAssetKind);
  return loaded.ok ? loaded.value : undefined;
}

function initialProjection(): GameProjectionValue {
  return {
    fps: 0,
    frameMs: 0,
    entities: 0,
    phase: 'ARENA / BOOTING',
    build: 'M1 / TOMATO + CAMERA RIG',
  };
}

function readSnapshot(world: World): GameProjectionValue {
  if (!world.hasResource(DEBUG_HUD_SNAPSHOT_KEY)) return initialProjection();
  return world.getResource<GameProjectionValue>(DEBUG_HUD_SNAPSHOT_KEY);
}

function actionNumber(args: GameProjectionValue, key: string): number | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function actionSeed(args: GameProjectionValue): number {
  const value = actionNumber(args, 'seed');
  if (value === undefined) throw new Error('seed must be a finite number');
  return Math.trunc(value) >>> 0;
}

function installDebugKeyboard(registry: DebugCommandRegistry): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!registry.dispatch(event.key)) return;
    event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

const m1ComponentsPlugin: Plugin = {
  name: 'brotato-v2/m1-components',
  inject: ['world'],
  apply(ctx) {
    const leases = M1_COMPONENTS.map((component) => ctx.world.components.register(component).unwrap());
    ctx.effect(() => () => {
      for (let index = leases.length - 1; index >= 0; index -= 1) leases[index]?.dispose();
    }, 'brotato-v2/m1-components');
  },
};

const m1SystemsPlugin: Plugin = {
  name: 'brotato-v2/m1-systems',
  inject: ['world'],
  apply(ctx) {
    ctx.world.insertResource(INPUT_MAP_KEY, PLAYER_INPUT_MAP);
    const removeInput = ctx.world.hasResource(INPUT_BACKEND_KEY)
      ? installInputSystem(ctx.world)
      : undefined;
    const removeMovement = installMovementSystem(ctx.world);
    const removeLimbs = installLimbAnimationSystem(ctx.world);
    const removeCameraFollow = installCameraFollowSystem(ctx.world);
    ctx.effect(() => () => {
      removeCameraFollow();
      removeLimbs();
      removeMovement();
      removeInput?.();
      ctx.world.removeResource(INPUT_MAP_KEY);
    }, 'brotato-v2/m1-systems');
  },
};

const m2ComponentsPlugin: Plugin = {
  name: 'brotato-v2/m2-components',
  inject: ['world'],
  apply(ctx) {
    const leases = M2_COMPONENTS.map((component) => ctx.world.components.register(component).unwrap());
    ctx.effect(() => () => {
      for (let index = leases.length - 1; index >= 0; index -= 1) leases[index]?.dispose();
    }, 'brotato-v2/m2-components');
  },
};

/** Browser-only asset/runtime contribution, separate from the host-free bootstrap. */
export const arenaPlugin: Plugin = {
  name: 'brotato-v2/arena',
  inject: ['world', 'renderer', 'gameHost'],
  async apply(ctx) {
    const host = ctx.gameHost;
    if (host === undefined) throw new Error('Brotato v2 arena activated without a GameHost');
    if (ctx.renderer === undefined) throw new Error('Brotato v2 arena activated without a renderer');
    const registry = commandRegistry(ctx.world);
    const clock = ctx.world.getResource<DebugClockState>(DEBUG_CLOCK_KEY);
    const uiDecoderLease = host.assets.installDecoder(uiAssetContribution.kind, uiAssetContribution.decoder);
    let arenaRoot: EntityHandle | undefined;
    let playerRoot: EntityHandle | undefined;
    let viewCalibration: ViewCalibrationController | undefined;
    let hud: DevHud | undefined;
    let stressHud: StressHud | undefined;
    let removeHudSystem: (() => void) | undefined;
    let removeStressHudSystem: (() => void) | undefined;
    let removeStress: (() => void) | undefined;
    let removeKeyboard: (() => void) | undefined;
    let removeProjection: (() => void) | undefined;
    let removeCalibrationCommand: (() => void) | undefined;
    let removeTargetLines: (() => void) | undefined;
    let removeDamageText: (() => void) | undefined;
    let removeCombat: (() => void) | undefined;
    let removeSpawn: (() => void) | undefined;
    let removeDeath: (() => void) | undefined;
    let removeEnemyHop: (() => void) | undefined;
    let removeMarkerAnim: (() => void) | undefined;
    let removeSwingAnimation: (() => void) | undefined;
    let removeCombatTargetCommand: (() => void) | undefined;
    let removeRestartCommand: (() => void) | undefined;
    let removeHudStatsCommand: (() => void) | undefined;
    let removeHudContentCommand: (() => void) | undefined;
    let removeHudRuntimeCommand: (() => void) | undefined;
    let removeSpawnGizmo: (() => void) | undefined;
    let removeSpawnGizmoCommand: (() => void) | undefined;
    let removeStressCommand: (() => void) | undefined;
    const projectionDisposers: Array<() => void> = [];
    let combatAssets: CombatAssets | undefined;
    let weaponRig: WeaponRig | undefined;
    let targetLines: ReturnType<typeof createTargetLines> | undefined;
    let spawnGizmo: SpawnGizmoController | undefined;
    let damageText: ReturnType<typeof createDamageTextLayer> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let disposed = false;
    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      removeProjection?.();
      for (let index = projectionDisposers.length - 1; index >= 0; index -= 1) projectionDisposers[index]?.();
      projectionDisposers.length = 0;
      removeRestartCommand?.();
      removeStressCommand?.();
      removeCombatTargetCommand?.();
      removeHudContentCommand?.();
      removeHudStatsCommand?.();
      removeHudRuntimeCommand?.();
      removeSpawnGizmoCommand?.();
      removeSpawnGizmo?.();
      removeCalibrationCommand?.();
      removeDamageText?.();
      removeStressHudSystem?.();
      removeTargetLines?.();
      removeSwingAnimation?.();
      removeMarkerAnim?.();
      removeEnemyHop?.();
      removeDeath?.();
      removeStress?.();
      removeCombat?.();
      removeSpawn?.();
      removeHudSystem?.();
      removeKeyboard?.();
      hud?.dispose();
      stressHud?.setVisible(false);
      stressHud?.dispose();
      spawnGizmo?.dispose();
      viewCalibration?.dispose();
      if (weaponRig !== undefined) {
        for (const root of weaponRig.roots) ctx.world.despawn(root);
      }
      const enemies = ctx.world.query({ read: [Transform], with: [Enemy] });
      if (enemies.ok) for (const row of enemies.value) ctx.world.despawn(row.entity);
      const markers = ctx.world.query({ read: [Transform], with: [SpawnMarker] });
      if (markers.ok) for (const row of markers.value) ctx.world.despawn(row.entity);
      if (combatAssets !== undefined) releaseCombatAssets(ctx.world, combatAssets);
      if (playerRoot !== undefined) destroyTomatoPlayer(ctx.world, playerRoot);
      if (arenaRoot !== undefined) destroyArena(ctx.world, arenaRoot);
      resizeObserver?.disconnect();
      uiDecoderLease.dispose();
    };
    try {
      configureArenaCamera(ctx.world, host.canvas);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (!disposed) configureArenaCamera(ctx.world, host.canvas);
        });
        resizeObserver.observe(host.canvas);
      }
      arenaRoot = await instantiateArena(ctx.world, host.assets);
      playerRoot = await spawnTomatoPlayer(ctx.world, host.assets);
      combatAssets = await loadCombatAssets(ctx.world, host.assets);
      weaponRig = spawnWeapons(ctx.world, playerRoot, combatAssets);
      ctx.world.insertResource(COMBAT_STATE_KEY, {
        phase: 'playing', elapsed: 0, kills: [0, 0], resetRequested: false,
      } satisfies CombatState);
      targetLines = createTargetLines(host);
      spawnGizmo = createSpawnGizmo(host);
      damageText = createDamageTextLayer(host);
      stressHud = createStressHud(host);
      removeSpawn = installSpawnSystem(ctx.world, combatAssets);
      removeStress = installStressSystem(ctx.world, combatAssets);
      removeCombat = installCombatSystem(ctx.world, playerRoot, combatAssets);
      removeDeath = installDeathSystem(ctx.world);
      removeEnemyHop = installEnemyHopSystem(ctx.world);
      removeMarkerAnim = installMarkerAnimSystem(ctx.world);
      removeSwingAnimation = installSwingAnimationSystem(ctx.world);
      removeTargetLines = installTargetLinesSystem(ctx.world, host, targetLines);
      removeSpawnGizmo = installSpawnGizmoSystem(ctx.world, host, spawnGizmo);
      const spawnGizmoRegistration = registry.register({
        id: 'spawn.gizmo',
        key: 'F8',
        aliases: ['x'],
        title: 'Toggle enemy deployment gizmo',
        run: () => { spawnGizmo?.toggle(); },
      });
      if (!spawnGizmoRegistration.ok) throw new Error(`Brotato v2 spawn gizmo command registration failed: ${spawnGizmoRegistration.error.hint}`);
      removeSpawnGizmoCommand = spawnGizmoRegistration.value.dispose;
      removeDamageText = installDamageTextSystem(ctx.world, host, damageText);
      const combatState = ctx.world.getResource<CombatState>(COMBAT_STATE_KEY);
      const stressState = ctx.world.getResource<StressState>(STRESS_STATE_KEY);
      const director = ctx.world.getResource<DirectorState>(DIRECTOR_STATE_KEY);
      const spawnControl = ctx.world.getResource<SpawnControl>(SPAWN_CONTROL_KEY);
      const targetLineRegistration = registry.register({
        id: 'combat.targetLines',
        key: 'F5',
        aliases: ['t'],
        title: 'Toggle weapon target assignment lines',
        run: () => { targetLines?.toggle(); },
      });
      if (!targetLineRegistration.ok) throw new Error(`Brotato v2 target line command registration failed: ${targetLineRegistration.error.hint}`);
      removeCombatTargetCommand = targetLineRegistration.value.dispose;
      const restartRegistration = registry.register({
        id: 'combat.restart',
        key: 'r',
        aliases: ['R'],
        title: 'Restart the combat loop',
        run: () => { combatState.resetRequested = true; },
      });
      if (!restartRegistration.ok) throw new Error(`Brotato v2 restart command registration failed: ${restartRegistration.error.hint}`);
      removeRestartCommand = restartRegistration.value.dispose;
      const stressRegistration = registry.register({
        id: 'stress.toggle',
        key: 'F4',
        aliases: ['g'],
        title: 'Toggle the ramping enemy stress test',
        run: () => {
          if (stressState.active) console.info(stressSummary(stressState));
          stressState.active = !stressState.active;
          stressHud?.setVisible(stressState.active);
        },
      });
      if (!stressRegistration.ok) throw new Error(`Brotato v2 stress command registration failed: ${stressRegistration.error.hint}`);
      removeStressCommand = stressRegistration.value.dispose;
      if (host.gameProjection !== undefined) {
        projectionDisposers.push(host.gameProjection.registerAction({
          id: 'spawn.pause',
          title: 'Pause or resume enemy deployment',
          description: 'Freeze or resume the deterministic enemy deployment schedule.',
          run: () => {
            director.frozen = !director.frozen;
            return { frozen: director.frozen };
          },
        }));
        projectionDisposers.push(host.gameProjection.registerAction({
          id: 'spawn.burst',
          title: 'Queue an enemy deployment burst',
          description: 'Queue one scattered marker batch; the normal cap and marker lifecycle still apply.',
          argsSchema: {
            type: 'object',
            required: ['count'],
            properties: { count: { type: 'number', description: 'Number of enemies to queue, from 1 to 20.' } },
          },
          run: (args) => {
            const value = actionNumber(args, 'count');
            if (value === undefined || value < 1) throw new Error('count must be a positive finite number');
            const count = Math.min(20, Math.floor(value));
            spawnControl.burstRequested += count;
            return { requested: count, pendingRequest: spawnControl.burstRequested };
          },
        }));
        projectionDisposers.push(host.gameProjection.registerAction({
          id: 'spawn.clear',
          title: 'Clear deployed enemies and markers',
          description: 'Clear live, dying, and pending deployment entities through the ECS spawn-system path.',
          run: () => {
            spawnControl.clearRequested = true;
            return { requested: true };
          },
        }));
        projectionDisposers.push(host.gameProjection.registerAction({
          id: 'spawn.seed',
          title: 'Restart with a deployment seed',
          description: 'Restart the run and reset the deterministic deployment stream to the supplied unsigned seed.',
          argsSchema: {
            type: 'object',
            required: ['seed'],
            properties: { seed: { type: 'number', description: 'Finite numeric seed.' } },
          },
          run: (args) => {
            const seed = actionSeed(args);
            combatState.resetSeed = seed;
            combatState.resetRequested = true;
            return { requested: true, seed };
          },
        }));
      }
      viewCalibration = await spawnViewCalibration(ctx.world, host.assets);
      const calibrationRegistration = registry.register({
        id: 'view.calibration',
        key: 'F9',
        aliases: ['v'],
        title: 'Toggle the 25 x 25 view calibration cross',
        run: () => { viewCalibration?.toggle(); },
      });
      if (!calibrationRegistration.ok) {
        throw new Error(`Brotato v2 view calibration command registration failed: ${calibrationRegistration.error.hint}`);
      }
      removeCalibrationCommand = calibrationRegistration.value.dispose;
      hud = createDevHud(host, await loadHudAsset(host.assets));
      const runtimeRegistration = registry.register({
        id: 'hud.runtime',
        key: 'F1',
        title: 'Show the runtime dashboard page',
        run: () => { showDevHudPage(clock, hud, 'runtime'); },
      });
      if (!runtimeRegistration.ok) throw new Error(`Brotato v2 runtime page command registration failed: ${runtimeRegistration.error.hint}`);
      removeHudRuntimeCommand = runtimeRegistration.value.dispose;
      const statsRegistration = registry.register({
        id: 'hud.stats',
        key: 'F2',
        title: 'Show the M3 stats placeholder page',
        run: () => { showDevHudPage(clock, hud, 'stats'); },
      });
      if (!statsRegistration.ok) throw new Error(`Brotato v2 stats page command registration failed: ${statsRegistration.error.hint}`);
      removeHudStatsCommand = statsRegistration.value.dispose;
      const contentRegistration = registry.register({
        id: 'hud.content',
        key: 'F3',
        title: 'Show the M2 weapon loadout page',
        run: () => { showDevHudPage(clock, hud, 'content'); },
      });
      if (!contentRegistration.ok) throw new Error(`Brotato v2 weapon page command registration failed: ${contentRegistration.error.hint}`);
      removeHudContentCommand = contentRegistration.value.dispose;
      removeHudSystem = installDevHudSystem(ctx.world, hud);
      if (stressHud !== undefined) removeStressHudSystem = installStressHudSystem(ctx.world, stressHud);
      removeKeyboard = installDebugKeyboard(registry);
      if (host.gameProjection !== undefined) {
          removeProjection = host.gameProjection.registerRead({
          id: 'brotato-v2.debug-snapshot',
          title: 'Read Brotato v2 debug snapshot',
          description: 'Read M2 combat stats, weapon assignments, player health, and camera view extent.',
          read: () => readSnapshot(ctx.world),
        });
      }
      ctx.effect(() => () => {
        cleanup();
      }, 'brotato-v2/arena');
    } catch (error) {
      cleanup();
      throw error;
    }
  },
};

const gameplay: Plugin = {
  name: 'game-brotato-v2',
  inject: ['world'],
  async apply(ctx) {
    await ctx.plugin(scenePlugin());
    await ctx.plugin(renderComponentsPlugin());
    await ctx.plugin(m1ComponentsPlugin);
    await ctx.plugin(m2ComponentsPlugin);
    await ctx.plugin(bootstrapPlugin);
    await ctx.plugin(m1SystemsPlugin);
    await ctx.plugin(arenaPlugin);
  },
};

export default gameplay;
