import type { World } from '@forgeax/engine-ecs';
import { MeshFilter, Visibility } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import type { StreetAssets } from '../street';
import { loadModel, pose, type Model } from './models';
import { useFarEnemyLod } from './lod-policy';

/** Both variants are resident before bootstrap finishes. No runtime asset fetches. */
export async function createEnemyLod(world: World, assets: StreetAssets, high: Model, kind: string) {
  const low = await loadModel(world, assets, `${kind}-lod`, high.root);
  world.set(low.root, Transform, { pos: [0, 0, 0] }).unwrap();
  const parts = [...high.parts.values()].filter(p => world.hasComponent(p.entity, MeshFilter));
  for (const p of parts)
    if (!world.hasComponent(p.entity, Visibility))
      world.addComponent(p.entity, { component: Visibility, data: { state: 0 } }).unwrap();
  let far = false;
  let poseAt = 0;
  let switches = 0;
  return {
    update(distance: number, now: number, moving: boolean, enabled = true) {
      const next = enabled && useFarEnemyLod(far, distance);
      if (next !== far) {
        far = next;
        switches++;
        poseAt = 0;
        for (const p of parts) world.set(p.entity, Visibility, { state: far ? 1 : 0 }).unwrap();
        world.set(low.root, Visibility, { state: far ? 2 : 1 }).unwrap();
      }
      if (far && now >= poseAt) {
        poseAt = now + 1 / 15;
        const step = moving ? Math.sin(now * 5.8) * 0.21 : 0;
        pose(world, low, 'LEG_L', [0, 0, 0], [step, 0, 0]);
        pose(world, low, 'LEG_R', [0, 0, 0], [-step, 0, 0]);
      }
    },
    snapshot: () => ({ far, switches, highMeshes: parts.length, lowMeshes: 3 }),
  };
}
