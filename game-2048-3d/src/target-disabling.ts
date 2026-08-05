import {
  Disabled,
  Entity,
  World,
  createQueryState,
  defineComponent,
  queryRun,
  type EntityHandle,
} from '@forgeax/engine-ecs';

export const TargetDisabling = defineComponent('GameDefaultTargetDisabling', {});

export type TargetDisablingWitness = {
  readonly activeCount: number;
  readonly disabledCount: number;
  readonly disableEvents: number;
};

export type TargetDisablingHandle = {
  readonly disable: (entity: EntityHandle) => void;
  readonly reset: () => void;
  readonly snapshot: () => TargetDisablingWitness;
};

function count(world: World, query: ReturnType<typeof createQueryState>): number {
  let total = 0;
  queryRun(query, world, (bundle) => { total += bundle.Entity?.self?.length ?? 0; });
  return total;
}

export function installTargetDisabling(world: World, targets: readonly EntityHandle[]): TargetDisablingHandle {
  // QueryState caches matched archetype ids and therefore belongs to one
  // World. Preview may construct a staging World before the live World in the
  // same module instance; module-global queries would reuse the staging cache.
  const activeQuery = createQueryState({ with: [TargetDisabling, Entity] });
  const disabledQuery = createQueryState({ with: [TargetDisabling, Disabled, Entity] });
  const targetSet = new Set(targets);
  for (const entity of targets) world.addComponent(entity, { component: TargetDisabling, data: {} }).unwrap();
  const state = { disableEvents: 0 };

  const disable = (entity: EntityHandle): void => {
    if (!targetSet.has(entity) || world.get(entity, Disabled).ok) return;
    world.addComponent(entity, { component: Disabled, data: {} }).unwrap();
    state.disableEvents += 1;
  };

  const reset = (): void => {
    // Reset owns the original target list; mutating an archetype while iterating
    // its explicit Disabled query can invalidate the current chunk before every
    // row is visited. The query remains the read-side witness, while this stable
    // identity list makes reset deterministic.
    for (const entity of targets) {
      if (world.get(entity, Disabled).ok) {
        world.removeComponent(entity, Disabled).unwrap();
      }
    }
  };

  return {
    disable,
    reset,
    snapshot: () => ({
      activeCount: count(world, activeQuery),
      disabledCount: count(world, disabledQuery),
      disableEvents: state.disableEvents,
    }),
  };
}
