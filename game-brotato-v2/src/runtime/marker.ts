import type { CommandBuffer, EntityHandle } from '@forgeax/engine-ecs';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { SPAWN_MARKER_RECIPE } from '../../assets/lib/markers/spawn-marker.ts';
import { SPAWN } from '../config/spawn.ts';
import { SpawnMarker } from '../ecs/components.ts';
import type { CombatAssets } from './combat-assets.ts';
import { spawnEnemyDeferred } from './enemy.ts';

/** Queue one red warning marker; its lifetime includes the deliberate batch stagger. */
export function spawnMarkerDeferred(
  commands: CommandBuffer,
  assets: CombatAssets,
  x: number,
  z: number,
  ttl: number,
): EntityHandle {
  return commands.spawn(
    {
      component: Transform,
      data: {
        pos: [x, SPAWN_MARKER_RECIPE.groundOffset, z],
        scale: [1, 1, 1],
        quat: [0, 0, 0, 1],
      },
    },
    { component: MeshFilter, data: { assetHandle: assets.spawnMarkerMesh } },
    { component: MeshRenderer, data: { materials: [assets.spawnMarkerMaterial] } },
    {
      component: SpawnMarker,
      data: {
        ttl,
        total: Math.max(0, ttl),
        blinkPhase: 0,
        enemyKind: 0,
      },
    },
  );
}

/**
 * Atomically hand a marker off to an enemy. The transform supplied by the
 * marker query is the source of truth after its one-second visible lifetime.
 */
export function hatchMarker(
  commands: CommandBuffer,
  marker: EntityHandle,
  transform: { readonly pos: ArrayLike<number> },
  assets: CombatAssets,
  playerX: number,
  playerZ: number,
  hopClock: number,
): EntityHandle {
  const x = transform.pos[0] ?? 0;
  const z = transform.pos[2] ?? 0;
  const yaw = Math.atan2(playerX - x, playerZ - z);
  commands.despawn(marker);
  return spawnEnemyDeferred(commands, assets, x, z, yaw, hopClock);
}
