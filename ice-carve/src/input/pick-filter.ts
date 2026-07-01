import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { Entity } from '@forgeax/engine-ecs';
import { MeshRenderer } from '@forgeax/engine-runtime';

type GraphWorld = World & {
  _getGraph(): {
    archetypes: Array<{
      size: number;
      components: ReadonlyArray<{ id: number }>;
      columns: Map<number, Map<string, { view: ArrayLike<number> }>>;
    }>;
  };
};

/** Scene + workshop props default pickable; only ice blocks should receive drag picks. */
export function disablePickingExcept(world: World, keep: ReadonlySet<EntityHandle>): void {
  const graph = (world as GraphWorld)._getGraph();
  for (const arch of graph.archetypes) {
    if (!arch.size || !arch.components.some((c) => c.id === MeshRenderer.id)) continue;
    const entityView = arch.columns.get(Entity.id)?.get('self')?.view as Uint32Array | undefined;
    if (!entityView) continue;
    for (let i = 0; i < arch.size; i++) {
      const entity = entityView[i]! as EntityHandle;
      if (keep.has(entity)) continue;
      const mr = world.get(entity, MeshRenderer);
      if (!mr.ok) continue;
      if ((mr.value.pickable ?? 1) === 0) continue;
      world.set(entity, MeshRenderer, { ...mr.value, pickable: 0 });
    }
  }
}
