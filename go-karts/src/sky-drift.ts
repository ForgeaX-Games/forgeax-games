/**
 * Slow cloud drift so the sky reads alive instead of a flat painted dome.
 */
import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { LoadedScene } from './scene';

interface Cloud {
  entity: EntityHandle;
  x0: number;
  y0: number;
  z0: number;
  ampX: number;
  ampZ: number;
  speed: number;
  phase: number;
}

export interface SkyDrift {
  update(dt: number): void;
}

export function createSkyDrift(world: World, scene: LoadedScene): SkyDrift {
  const clouds: Cloud[] = [];
  for (const node of scene.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value;
    if (!name?.startsWith('Cloud_')) continue;
    const entity = scene.mapping.get(node.localId);
    if (entity === undefined) continue;
    const tf = node.components.Transform as { pos?: number[] } | undefined;
    const x0 = tf?.pos?.[0] ?? 0;
    const y0 = tf?.pos?.[1] ?? 60;
    const z0 = tf?.pos?.[2] ?? 0;
    const i = clouds.length;
    clouds.push({
      entity,
      x0,
      y0,
      z0,
      ampX: 6 + (i % 3) * 2,
      ampZ: 5 + (i % 4) * 1.5,
      speed: 0.04 + (i % 5) * 0.012,
      phase: i * 0.9,
    });
  }

  let elapsed = 0;

  return {
    update(dt) {
      elapsed += Math.min(0.05, Math.max(0, dt));
      for (const c of clouds) {
        const cur = world.get(c.entity, Transform);
        if (!cur.ok) continue;
        const x = c.x0 + Math.sin(elapsed * c.speed + c.phase) * c.ampX;
        const z = c.z0 + Math.cos(elapsed * c.speed * 0.85 + c.phase) * c.ampZ;
        const y = c.y0 + Math.sin(elapsed * c.speed * 0.5 + c.phase) * 1.2;
        world.set(c.entity, Transform, {
          ...cur.value,
          pos: [x, y, z],
        });
      }
    },
  };
}
