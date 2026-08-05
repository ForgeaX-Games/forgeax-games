import type { EntityHandle } from '@forgeax/engine-ecs';
import { defineComponent } from '@forgeax/engine-ecs';

const pointsByEntity = new Map<EntityHandle, number>();

function registerTarget(entity: EntityHandle, value: { points: number }): void {
  pointsByEntity.set(entity, value.points);
}

function unregisterTarget(entity: EntityHandle): void {
  pointsByEntity.delete(entity);
}

/** Transient gameplay marker whose hooks keep the scoring index in sync. */
export const ScoringTarget = defineComponent(
  'GameDefaultScoringTarget',
  { points: 'u32' },
  {
    onAdd: registerTarget,
    onInsert: registerTarget,
    onDiscard: unregisterTarget,
    onRemove: unregisterTarget,
    transient: true,
  },
);

export function resetScoringTargets(): void {
  pointsByEntity.clear();
}

export function scoringPoints(entity: EntityHandle): number | undefined {
  return pointsByEntity.get(entity);
}
