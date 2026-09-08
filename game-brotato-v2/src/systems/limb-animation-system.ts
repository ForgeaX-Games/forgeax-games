import { Time, Update, type World } from '@forgeax/engine-ecs';
import { ChildOf, Transform } from '@forgeax/engine-scene';
import { ActorAnimState, ActorLimbMotion, Player } from '../ecs/components.ts';

export const LIMB_ANIMATION_SYSTEM_NAME = 'brotato-v2/limb-animation';

export function installLimbAnimationSystem(world: World): () => void {
  world
    .addSystem(Update, {
      name: LIMB_ANIMATION_SYSTEM_NAME,
      queries: [
        { write: [ActorAnimState], with: [Player] },
        { write: [Transform, ActorLimbMotion], read: [ChildOf] },
      ],
      fn: (world, [actors, limbs]) => {
        const dt = Math.max(0, world.getResource(Time).delta);
        for (const row of actors) row.mut(ActorAnimState).clock += dt;
        for (const row of limbs) {
          const parent = row.get(ChildOf).parent;
          if (parent === null) continue;
          const parentState = world.get(parent, ActorAnimState);
          if (!parentState.ok) continue;
          const motion = row.mut(ActorLimbMotion);
          const transform = row.mut(Transform);
          const speed01 = Math.max(0, Math.min(1, parentState.value.speed01));
          const amplitude = motion.idleAmplitude + (motion.moveAmplitude - motion.idleAmplitude) * speed01;
          const frequency = motion.idleFrequency + (motion.moveFrequency - motion.idleFrequency) * speed01;
          const offset = amplitude * Math.sin(parentState.value.clock * frequency * Math.PI * 2 + motion.phase);
          transform.pos[0] = motion.baseX;
          transform.pos[1] = motion.baseY;
          transform.pos[2] = motion.baseZ;
          // Swing is intentionally local Z; the parent yaw carries the foot's
          // front/back motion after the actor turns.
          const axis = motion.kind === 2 ? 2 : motion.axis;
          if (axis === 0) transform.pos[0] += offset;
          else if (axis === 1) transform.pos[1] += offset;
          else transform.pos[2] += offset;
        }
      },
    })
    .unwrap();
  return () => world.removeSystem(Update, LIMB_ANIMATION_SYSTEM_NAME).unwrap();
}
