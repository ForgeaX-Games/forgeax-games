import { FixedTime, FixedUpdate, type World } from '@forgeax/engine-ecs';
import { Camera } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { Player, PlayerMotion, Enemy, SpawnMarker, Dying } from '../ecs/components.ts';
import { CAMERA_RIG_RESOURCE_KEY, type CameraRig } from '../config/camera-rig.ts';
import { SPAWN } from '../config/spawn.ts';
import { samplePlacement } from '../spawn/placement.ts';
import { createRng } from '../spawn/rng.ts';
import {
  DIRECTOR_STATE_KEY,
  createDirectorState,
  stepDirector,
  type SpawnBatch,
  type DirectorState,
} from '../spawn/director.ts';
import { COMBAT_STATE_KEY, type CombatState } from './combat-system.ts';
import { STRESS_STATE_KEY } from '../stress/state.ts';
import type { StressState } from './stress-system.ts';
import type { CombatAssets } from '../runtime/combat-assets.ts';
import { hatchMarker, spawnMarkerDeferred } from '../runtime/marker.ts';
import { DEBUG_CLOCK_KEY, type DebugClockState } from '../runtime/debug-clock.ts';

export const SPAWN_SYSTEM_NAME = 'brotato-v2/spawn';
export const SPAWN_CONTROL_KEY = 'BrotatoV2SpawnControl';

export interface SpawnControl {
  burstRequested: number;
  clearRequested: boolean;
}

function viewFromCamera(world: World, cameraTransform: { readonly pos: ArrayLike<number> }): PlacementView {
  const rig = world.hasResource(CAMERA_RIG_RESOURCE_KEY)
    ? world.getResource<CameraRig>(CAMERA_RIG_RESOURCE_KEY)
    : undefined;
  const halfWidth = rig?.halfWidth ?? 12.5;
  const halfDepth = rig?.halfDepth ?? 12.5;
  const centerX = cameraTransform.pos[0] ?? 0;
  const centerZ = cameraTransform.pos[2] ?? 0;
  return {
    minX: centerX - halfWidth,
    maxX: centerX + halfWidth,
    minZ: centerZ - halfDepth,
    maxZ: centerZ + halfDepth,
  };
}

interface PlacementView {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function countPlacementRelaxation(state: DirectorState, level: number): void {
  if (level === 1) state.relax1 += 1;
  else if (level === 2) state.relax2 += 1;
  else if (level === 3) state.relax3 += 1;
  else if (level >= 4) state.fallback += 1;
}

export function installSpawnSystem(world: World, assets: CombatAssets): () => void {
  const director = world.hasResource(DIRECTOR_STATE_KEY)
    ? world.getResource<DirectorState>(DIRECTOR_STATE_KEY)
    : createDirectorState();
  const control: SpawnControl = world.hasResource(SPAWN_CONTROL_KEY)
    ? world.getResource<SpawnControl>(SPAWN_CONTROL_KEY)
    : { burstRequested: 0, clearRequested: false };
  world.insertResource(DIRECTOR_STATE_KEY, director);
  world.insertResource(SPAWN_CONTROL_KEY, control);
  world
    .addSystem(FixedUpdate, {
      name: SPAWN_SYSTEM_NAME,
      after: ['brotato-v2/player-movement'],
      queries: [
        { read: [Transform, PlayerMotion], with: [Player] },
        { read: [Transform], with: [Camera] },
        { read: [Transform, Enemy], without: [Dying] },
        { write: [Transform, SpawnMarker] },
      ],
      fn: (world, [players, cameras, enemies, markers], commands) => {
        const clock = world.hasResource(DEBUG_CLOCK_KEY)
          ? world.getResource<DebugClockState>(DEBUG_CLOCK_KEY)
          : undefined;
        if (clock !== undefined && !clock.fixedActive) return;
        const stress = world.hasResource(STRESS_STATE_KEY)
          ? world.getResource<StressState>(STRESS_STATE_KEY)
          : undefined;
        if (stress?.active) return;
        const combat = world.getResource<CombatState>(COMBAT_STATE_KEY);
        if (combat.resetRequested) {
          control.burstRequested = 0;
          control.clearRequested = false;
          return;
        }
        if (combat.phase !== 'playing') {
          director.frozen = true;
          return;
        }
        if (director.frozen) return;
        const playerRow = [...players][0];
        if (playerRow === undefined) return;
        const playerTransform = playerRow.get(Transform);
        const playerMotion = playerRow.get(PlayerMotion);
        const cameraRow = [...cameras][0];
        const cameraTransform = cameraRow?.get(Transform);
        const playerX = playerTransform.pos[0] ?? 0;
        const playerZ = playerTransform.pos[2] ?? 0;
        const playerFacing = playerMotion.facing;
        const view = cameraTransform === undefined
          ? { minX: playerX - 12.5, maxX: playerX + 12.5, minZ: playerZ - 12.5, maxZ: playerZ + 12.5 }
          : viewFromCamera(world, cameraTransform);

        const enemyXs: number[] = [];
        const enemyZs: number[] = [];
        for (const row of enemies) {
          if (row.get(Enemy).active <= 0) continue;
          const transform = row.get(Transform);
          enemyXs.push(transform.pos[0] ?? 0);
          enemyZs.push(transform.pos[2] ?? 0);
        }
        const markerXs: number[] = [];
        const markerZs: number[] = [];
        for (const row of markers) {
          const transform = row.mut(Transform);
          markerXs.push(transform.pos[0] ?? 0);
          markerZs.push(transform.pos[2] ?? 0);
        }
        if (control.clearRequested) {
          const allEnemies = world.query({ read: [Transform], with: [Enemy] });
          if (allEnemies.ok) for (const row of allEnemies.value) commands.despawn(row.entity);
          for (const row of markers) commands.despawn(row.entity);
          enemyXs.length = 0;
          enemyZs.length = 0;
          markerXs.length = 0;
          markerZs.length = 0;
          control.clearRequested = false;
          return;
        }
        const queueBatch = (batch: SpawnBatch): void => {
          const available = Math.max(0, SPAWN.cap.onScreen - enemyXs.length - markerXs.length);
          const count = Math.min(batch.count, available);
          const rng = createRng(director.rngState);
          let anchor: { x: number; z: number } | null = null;
          for (let index = 0; index < count; index += 1) {
            const result = samplePlacement(
              rng,
              {
                playerX,
                playerZ,
                playerFacing,
                view,
                markerXs,
                markerZs,
                enemyXs,
                enemyZs,
              },
              batch.pattern,
              anchor,
            );
            director.rngState = rng.state;
            countPlacementRelaxation(director, result.relaxLevel);
            markerXs.push(result.x);
            markerZs.push(result.z);
            if (batch.pattern === 'group' && anchor === null) anchor = { x: result.x, z: result.z };
            spawnMarkerDeferred(
              commands,
              assets,
              result.x,
              result.z,
              SPAWN.marker.leadSec + index * batch.intraStaggerSec,
            );
          }
        };
        if (control.burstRequested > 0) {
          const burstCount = Math.min(
            SPAWN.cap.onScreen,
            Math.max(1, Math.floor(control.burstRequested)),
          );
          queueBatch({
            enemy: 'sprouted-potato',
            count: burstCount,
            pattern: 'scattered',
            intraStaggerSec: SPAWN.batch.intraStaggerSec,
          });
          control.burstRequested = 0;
        }
        const pending = markerXs.length;
        const batches = stepDirector(director, world.getResource(FixedTime).delta, enemyXs.length, pending);
        combat.elapsed = director.elapsed;
        for (const batch of batches) queueBatch(batch);

        const delta = Math.max(0, world.getResource(FixedTime).delta);
        for (const row of markers) {
          const transform = row.mut(Transform);
          const marker = row.mut(SpawnMarker);
          marker.ttl -= delta;
          if (marker.ttl > 0) continue;
          hatchMarker(
            commands,
            row.entity,
            transform,
            assets,
            playerX,
            playerZ,
            director.batchSeq * 0.37,
          );
        }
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(FixedUpdate, SPAWN_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
    world.removeResource(DIRECTOR_STATE_KEY);
    world.removeResource(SPAWN_CONTROL_KEY);
  };
}
