/**
 * Runtime coin collection — distance check vs player pose, hide via scale.
 */
import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { LoadedScene } from './scene';
import type { KartPose } from './kart-controller';

const PICKUP_RADIUS = 1.35;

export interface CoinPickups {
  update(pose: KartPose): number;
  reset(): void;
  getCount(): number;
}

export function createCoinPickups(world: World, scene: LoadedScene): CoinPickups {
  const coins: { entity: EntityHandle; x: number; y: number; z: number; taken: boolean }[] = [];

  for (const node of scene.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value;
    if (!name?.startsWith('Coin_')) continue;
    const entity = scene.mapping.get(node.localId);
    if (entity === undefined) continue;
    const tf = node.components.Transform as { pos?: number[] } | undefined;
    const pos = tf?.pos;
    if (!pos || pos.length < 3) continue;
    coins.push({
      entity,
      x: pos[0]!,
      y: pos[1]!,
      z: pos[2]!,
      taken: false,
    });
  }

  let got = 0;

  const setScale = (entity: EntityHandle, visible: boolean) => {
    const cur = world.get(entity, Transform);
    if (!cur.ok) return;
    world.set(entity, Transform, {
      ...cur.value,
      scale: visible ? [0.55, 0.55, 0.18] : [0, 0, 0],
    });
  };

  const reset = () => {
    got = 0;
    for (const c of coins) {
      c.taken = false;
      setScale(c.entity, true);
    }
  };

  return {
    update(pose: KartPose): number {
      let picked = 0;
      for (const c of coins) {
        if (c.taken) continue;
        const dx = pose.x - c.x;
        const dy = pose.y - c.y;
        const dz = pose.z - c.z;
        if (dx * dx + dy * dy + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
          c.taken = true;
          got += 1;
          picked += 1;
          setScale(c.entity, false);
        }
      }
      return picked;
    },
    reset,
    getCount: () => got,
  };
}
