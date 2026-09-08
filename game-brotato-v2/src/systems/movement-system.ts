import { FixedTime, FixedUpdate, type World } from '@forgeax/engine-ecs';
import { quat } from '@forgeax/engine-math';
import { Transform } from '@forgeax/engine-scene';
import { ARENA } from '../config/arena.ts';
import { MOVEMENT, stepMovement } from '../config/movement.ts';
import { ActorAnimState, Player, PlayerMotion } from '../ecs/components.ts';
import { DEBUG_CLOCK_KEY, type DebugClockState } from '../runtime/debug-clock.ts';

export const MOVEMENT_SYSTEM_NAME = 'brotato-v2/player-movement';

export function installMovementSystem(world: World): () => void {
  world
    .addSystem(FixedUpdate, {
      name: MOVEMENT_SYSTEM_NAME,
      queries: [{ write: [Transform, PlayerMotion, ActorAnimState], with: [Player] }],
      fn: (world, [players]) => {
        if (world.hasResource(DEBUG_CLOCK_KEY) && !world.getResource<DebugClockState>(DEBUG_CLOCK_KEY).fixedActive) return;
        const dt = world.getResource(FixedTime).delta;
        for (const row of players) {
          const transform = row.mut(Transform);
          const motion = row.mut(PlayerMotion);
          const animation = row.mut(ActorAnimState);
          const next = stepMovement(
            {
              posX: transform.pos[0] ?? 0,
              posZ: transform.pos[2] ?? 0,
              velocityX: motion.velocityX,
              velocityZ: motion.velocityZ,
              facing: motion.facing,
            },
            { x: motion.inputX, z: motion.inputZ },
            dt,
            { arenaLimit: ARENA.limit },
          );
          transform.pos[0] = next.posX;
          transform.pos[2] = next.posZ;
          motion.velocityX = next.velocityX;
          motion.velocityZ = next.velocityZ;
          motion.facing = next.facing;
          animation.speed01 = Math.min(
            1,
            Math.hypot(next.velocityX, next.velocityZ) / Math.max(Number.EPSILON, MOVEMENT.maxSpeed),
          );
          const facing = quat.fromEuler(quat.create(), 0, next.facing, 0, 'XYZ');
          transform.quat[0] = facing[0] ?? 0;
          transform.quat[1] = facing[1] ?? 0;
          transform.quat[2] = facing[2] ?? 0;
          transform.quat[3] = facing[3] ?? 1;
        }
      },
    })
    .unwrap();
  return () => world.removeSystem(FixedUpdate, MOVEMENT_SYSTEM_NAME).unwrap();
}
