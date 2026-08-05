import {
  Entity,
  Time,
  Update,
  World,
  createQueryState,
  defineComponent,
  queryRunContiguous,
  type EntityHandle,
} from '@forgeax/engine-ecs';

const INITIAL_HEALTH = 100;
const HEALTH_REGEN_PER_SECOND = 2;

export const TargetHealth = defineComponent('GameDefaultTargetHealth', {
  current: 'f32',
  max: 'f32',
});

const targetHealthQuery = createQueryState<
  readonly [typeof TargetHealth, typeof Entity],
  readonly []
>({ with: [TargetHealth, Entity] });

export type TargetHealthWitness = {
  readonly contiguousSupported: boolean;
  readonly contiguousCalls: number;
  readonly rows: number;
  readonly lengthsEqual: boolean;
  readonly totalCurrent: number;
  readonly totalMax: number;
  readonly damageEvents: number;
};

export type TargetHealthHandle = {
  readonly damage: (entity: EntityHandle, points: number) => void;
  readonly reset: () => void;
  readonly snapshot: () => TargetHealthWitness;
};

export function installTargetHealth(world: World, targets: readonly EntityHandle[]): TargetHealthHandle {
  for (const entity of targets) {
    world.addComponent(entity, { component: TargetHealth, data: { current: INITIAL_HEALTH, max: INITIAL_HEALTH } });
  }

  const state = {
    contiguousSupported: false,
    contiguousCalls: 0,
    rows: 0,
    lengthsEqual: true,
    totalCurrent: 0,
    totalMax: targets.length * INITIAL_HEALTH,
    damageEvents: 0,
  };

  world.addSystem(Update, {
    name: 'game-target-health-contiguous',
    queries: [],
    fn: () => {
      const dt = world.getResource(Time).delta;
      state.rows = 0;
      state.totalCurrent = 0;
      state.lengthsEqual = true;
      state.contiguousSupported = queryRunContiguous(targetHealthQuery, world, (bundle) => {
        state.contiguousCalls += 1;
        const current = bundle.GameDefaultTargetHealth.current;
        const max = bundle.GameDefaultTargetHealth.max;
        const entities = bundle.Entity.self;
        state.rows += entities.length;
        state.lengthsEqual = state.lengthsEqual && current.length === max.length && current.length === entities.length;
        for (let index = 0; index < entities.length; index++) {
          const next = Math.min(max[index] ?? INITIAL_HEALTH, (current[index] ?? INITIAL_HEALTH) + HEALTH_REGEN_PER_SECOND * dt);
          current[index] = next;
          state.totalCurrent += next;
        }
      });
    },
  }).unwrap();

  const damage = (entity: EntityHandle, points: number): void => {
    const health = world.get(entity, TargetHealth);
    if (!health.ok) return;
    world.set(entity, TargetHealth, { current: Math.max(0, health.value.current - points * 0.5) });
    state.damageEvents += 1;
  };

  const reset = (): void => {
    for (const entity of targets) world.set(entity, TargetHealth, { current: INITIAL_HEALTH, max: INITIAL_HEALTH });
  };

  return {
    damage,
    reset,
    snapshot: () => ({
      contiguousSupported: state.contiguousSupported,
      contiguousCalls: state.contiguousCalls,
      rows: state.rows,
      lengthsEqual: state.lengthsEqual,
      totalCurrent: state.totalCurrent,
      totalMax: state.totalMax,
      damageEvents: state.damageEvents,
    }),
  };
}
