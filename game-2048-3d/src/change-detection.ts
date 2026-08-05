import { Entity, Update, defineComponent, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { HudHandle } from './hud';

export const GAME_DEFAULT_SCORE_RESOURCE = 'gameDefaultScore';

const TargetHitState = defineComponent(
  'GameDefaultTargetHitState',
  { hits: 'u32' },
  { transient: true },
);

export interface GameplayChangeDetectionWitness {
  addedTargets: number;
  changedTargets: number;
  resourceChanges: number;
  score: number;
}

export interface GameplayChangeDetectionHandle {
  recordHit(entity: EntityHandle, points: number): void;
  reset(): void;
  snapshot(): GameplayChangeDetectionWitness;
}

type ScoreResource = { value: number };

/** Compose ECS change detection with the existing target-range hit lifecycle. */
export function installGameplayChangeDetection(args: {
  world: World;
  targets: readonly EntityHandle[];
  hud: HudHandle;
}): GameplayChangeDetectionHandle {
  const { world, targets, hud } = args;
  const witness: GameplayChangeDetectionWitness = {
    addedTargets: 0,
    changedTargets: 0,
    resourceChanges: 0,
    score: 0,
  };
  world.insertResource<ScoreResource>(GAME_DEFAULT_SCORE_RESOURCE, { value: 0 });
  let lastResourceChangeTick = -1;

  world.addSystem(Update, {
    name: 'game-score-added-targets',
    queries: [{ with: [TargetHitState, Entity], added: [TargetHitState] }],
    fn: (_world, queryResults) => {
      for (const bundle of queryResults[0] ?? []) witness.addedTargets += bundle.Entity.self.length;
    },
  }).unwrap();
  world.addSystem(Update, {
    name: 'game-score-changed-targets',
    queries: [{ with: [TargetHitState, Entity], changed: [TargetHitState] }],
    fn: (_world, queryResults) => {
      for (const bundle of queryResults[0] ?? []) witness.changedTargets += bundle.Entity.self.length;
    },
  }).unwrap();
  world.addSystem(Update, {
    name: 'game-score-resource-probe',
    queries: [],
    fn: (_world) => {
      const ticks = _world.getResourceChange(GAME_DEFAULT_SCORE_RESOURCE);
      if (ticks !== undefined && ticks.changed > lastResourceChangeTick) {
        lastResourceChangeTick = ticks.changed;
        const score = _world.getResource<ScoreResource>(GAME_DEFAULT_SCORE_RESOURCE).value;
        witness.resourceChanges += 1;
        witness.score = score;
        hud.setScore(score);
      }
    },
  }).unwrap();
  for (const entity of targets) world.addComponent(entity, { component: TargetHitState, data: { hits: 0 } }).unwrap();

  return {
    recordHit(entity, points) {
      const current = world.get(entity, TargetHitState).unwrap();
      world.set(entity, TargetHitState, { hits: current.hits + 1 }).unwrap();
      const score = world.getResource<ScoreResource>(GAME_DEFAULT_SCORE_RESOURCE).value;
      world.insertResource(GAME_DEFAULT_SCORE_RESOURCE, { value: score + points });
    },
    reset() {
      for (const entity of targets) world.set(entity, TargetHitState, { hits: 0 }).unwrap();
      world.insertResource(GAME_DEFAULT_SCORE_RESOURCE, { value: 0 });
      witness.score = 0;
      hud.setScore(0);
    },
    snapshot() {
      return { ...witness };
    },
  };
}
