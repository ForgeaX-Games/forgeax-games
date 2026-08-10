import { FixedUpdate, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { inState } from '@forgeax/engine-state';
import { GameState } from '../gameplay-state';

export type FbxTargetCompanionSystemContext = {
  readonly world: World;
  readonly target: EntityHandle;
  readonly root: EntityHandle;
  readonly isActive: () => boolean;
  readonly rootQuat: readonly [number, number, number, number];
  readonly rootScale: readonly [number, number, number];
};

/** Keep an imported FBX presentation on the same ECS target as physics and scoring. */
export function installFbxTargetCompanionSystem(ctx: FbxTargetCompanionSystemContext): void {
  ctx.world.addSystem(Update, {
    name: 'game-fbx-target-companion',
    runIf: inState(GameState, 'Play'),
    after: [FixedUpdate],
    queries: [],
    fn: () => {
      if (!ctx.isActive()) return;
      const target = ctx.world.get(ctx.target, Transform);
      if (!target.ok) return;
      ctx.world.set(ctx.root, Transform, {
        pos: [target.value.pos[0] ?? 0, target.value.pos[1] ?? 0, target.value.pos[2] ?? 0],
        quat: ctx.rootQuat,
        scale: ctx.rootScale,
      });
    },
  }).unwrap();
}
