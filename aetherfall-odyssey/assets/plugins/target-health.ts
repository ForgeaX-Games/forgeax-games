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
import { scoringTargetEntities, type ScoringTargetQuery } from './scoring-target';

const INITIAL_HEALTH = 100;
const HEALTH_REGEN_PER_SECOND = 2;
export const GAME_DEFAULT_TARGET_HEALTH_WITNESS = '__forgeaxGameDefaultTargetHealthWitness';

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

type TargetHealthWitnessState = {
  contiguousSupported: boolean;
  contiguousCalls: number;
  rows: number;
  lengthsEqual: boolean;
  totalCurrent: number;
  totalMax: number;
  damageEvents: number;
};

export function installTargetHealth(world: World, targetQuery: ScoringTargetQuery): TargetHealthHandle {
  for (const entity of scoringTargetEntities(world, targetQuery)) {
    world.addComponent(entity, { component: TargetHealth, data: { current: INITIAL_HEALTH, max: INITIAL_HEALTH } });
  }

  world.insertResource<TargetHealthWitnessState>(GAME_DEFAULT_TARGET_HEALTH_WITNESS, {
    contiguousSupported: false,
    contiguousCalls: 0,
    rows: 0,
    lengthsEqual: true,
    totalCurrent: 0,
    totalMax: scoringTargetEntities(world, targetQuery).length * INITIAL_HEALTH,
    damageEvents: 0,
  });
  const state = world.getResource<TargetHealthWitnessState>(GAME_DEFAULT_TARGET_HEALTH_WITNESS);

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
    for (const entity of scoringTargetEntities(world, targetQuery)) world.set(entity, TargetHealth, { current: INITIAL_HEALTH, max: INITIAL_HEALTH });
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
