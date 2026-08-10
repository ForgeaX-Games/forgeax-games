import {
  defineComponent,
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
  const query = world.query({ read: [Transform, Rotatable] }).unwrap();
  for (const row of query) {
    const current = row.get(Transform);
    const rotating = row.get(Rotatable);
    const angle = rotating.speed * TAU * dt;
    const next = quat.rotateAxis(quat.create(), current.quat, Y_AXIS, angle);
    world.set(row.entity, Transform, {
      quat: [next[0] ?? 0, next[1] ?? 0, next[2] ?? 0, next[3] ?? 1],
    });
  }
}
