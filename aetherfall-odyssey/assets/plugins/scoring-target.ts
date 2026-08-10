import {
  defineComponent,
  Disabled,
  type EntityHandle,
  type World,
} from '@forgeax/engine-ecs';
import { Name } from '@forgeax/engine-scene';

const PRIMARY_TARGET_NAME = 'RedBox';

/** Transient gameplay marker whose hooks keep the scoring index in sync. */
export const ScoringTarget = defineComponent(
  'GameDefaultScoringTarget',
  { points: 'u32', slot: { type: 'u32', default: 0 } },
  { transient: true },
);

/** The target roster is an ECS query, never a second bootstrap-owned array. */
export function createScoringTargetQuery() {
  return {
    active: { with: [ScoringTarget] as const },
    disabled: { with: [ScoringTarget, Disabled] as const },
  };
}

export type ScoringTargetQuery = ReturnType<typeof createScoringTargetQuery>;

export function scoringTargetEntities(world: World, query: ScoringTargetQuery): EntityHandle[] {
  const entities: EntityHandle[] = [];
  for (const row of world.query(query.active).unwrap()) entities.push(row.entity);
  for (const row of world.query(query.disabled).unwrap()) entities.push(row.entity);
  return entities;
}

export function activeScoringTargetEntities(world: World, query: ScoringTargetQuery): EntityHandle[] {
  const entities: EntityHandle[] = [];
  for (const row of world.query(query.active).unwrap()) entities.push(row.entity);
  return entities;
}

export function firstScoringTarget(world: World, query: ScoringTargetQuery): EntityHandle | undefined {
  let fallback: EntityHandle | undefined;
  let primary: EntityHandle | undefined;
  for (const row of world.query(query.active).unwrap()) {
    const handle = row.entity;
    fallback ??= handle;
    const name = world.get(handle, Name);
    if (name.ok && name.value.value === PRIMARY_TARGET_NAME) primary = handle;
  }
  return primary ?? fallback;
}

/** Read the ECS-owned score contract; no parallel entity→points index is needed. */
export function scoringPoints(world: World, entity: EntityHandle): number | undefined {
  const target = world.get(entity, ScoringTarget);
  return target.ok ? target.value.points : undefined;
}
