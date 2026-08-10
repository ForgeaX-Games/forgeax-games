import {
  createQueryState,
  defineComponent,
  Entity,
  queryRun,
  type EntityHandle,
  type World,
} from '@forgeax/engine-ecs';
import { quat } from '@forgeax/engine-math';
import { Transform } from '@forgeax/engine-scene';

/** A gameplay-owned motion contract: rotations belong to the entity, not the renderer. */
export const Rotatable = defineComponent('GameDefaultRotatable', {
  speed: { type: 'f32', default: 0.3 },
});

const TAU = Math.PI * 2;
const Y_AXIS = [0, 1, 0] as const;

/** Advance rotating target transforms during Play; reset restores their initial quaternions. */
export function stepRotatingTargets(world: World, dt: number): void {
  const state = createQueryState({ with: [Transform, Rotatable, Entity] });
  const targets: EntityHandle[] = [];
  queryRun(state, world, (bundle) => {
    const entities = bundle.Entity.self;
    for (let i = 0; i < entities.length; i++) {
      targets.push((entities[i] ?? 0) as EntityHandle);
    }
  });
  for (const handle of targets) {
    const current = world.get(handle, Transform);
    const rotating = world.get(handle, Rotatable);
    if (!current.ok || !rotating.ok) continue;
    const angle = rotating.value.speed * TAU * dt;
    const next = quat.rotateAxis(quat.create(), current.value.quat, Y_AXIS, angle);
    world.set(handle, Transform, {
      quat: [next[0] ?? 0, next[1] ?? 0, next[2] ?? 0, next[3] ?? 1],
    });
  }
}
