import { Instances } from '@forgeax/engine/render';
import { Name } from '@forgeax/engine/scene';
import type { EntityHandle, World } from '@forgeax/engine/ecs';
import batches from '../assets/scenes/slagdeep.instances.json';

/** Bind authored matrices once; World owns Instances and the renderer extracts them. */
export function installBakedInstances(world: World): () => void {
  const boundEntities: EntityHandle[] = [];
  const remaining = new Map(Object.entries(batches));
  const namedEntities = Array.from(world.query({ with: [Name] }).unwrap(), (row) => row.entity);
  try {
    for (const entity of namedEntities) {
      const name = world.get(entity, Name).unwrap().value;
      const transforms = remaining.get(name);
      if (!transforms) continue;
      world.addComponent(entity, { component: Instances, data: { transforms: new Float32Array(transforms) } }).unwrap();
      boundEntities.push(entity);
      remaining.delete(name);
    }
  } catch (error) {
    removeInstanceComponents(world, boundEntities);
    throw error;
  }
  if (remaining.size) {
    removeInstanceComponents(world, boundEntities);
    throw new Error('Missing dungeon instance batches: ' + [...remaining.keys()].join(', '));
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    removeInstanceComponents(world, boundEntities);
  };
}

function removeInstanceComponents(world: World, entities: readonly EntityHandle[]): void {
  for (const entity of entities) {
    if (world.hasComponent(entity, Instances)) world.removeComponent(entity, Instances).unwrap();
  }
}
