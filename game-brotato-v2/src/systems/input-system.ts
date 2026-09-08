import { Update, type World } from '@forgeax/engine-ecs';
import {
  type ActionConfig,
  FRAME_START_SCAN_SYSTEM_NAME,
  INPUT_SNAPSHOT_RESOURCE_KEY,
  type InputSnapshot,
} from '@forgeax/engine-input';
import { Player, PlayerMotion } from '../ecs/components.ts';

export const PLAYER_INPUT_SYSTEM_NAME = 'brotato-v2/player-input';

export const PLAYER_INPUT_MAP: readonly ActionConfig[] = Object.freeze([
  {
    action: 'moveLeft',
    bindings: [
      { type: 'key', key: 'a' },
      { type: 'key', key: 'A' },
      { type: 'key', key: 'ArrowLeft' },
      { type: 'gamepadAxis', axis: 0, sign: -1 },
    ],
  },
  {
    action: 'moveRight',
    bindings: [
      { type: 'key', key: 'd' },
      { type: 'key', key: 'D' },
      { type: 'key', key: 'ArrowRight' },
      { type: 'gamepadAxis', axis: 0, sign: 1 },
    ],
  },
  {
    action: 'moveUp',
    bindings: [
      { type: 'key', key: 'w' },
      { type: 'key', key: 'W' },
      { type: 'key', key: 'ArrowUp' },
      { type: 'gamepadAxis', axis: 1, sign: -1 },
    ],
  },
  {
    action: 'moveDown',
    bindings: [
      { type: 'key', key: 's' },
      { type: 'key', key: 'S' },
      { type: 'key', key: 'ArrowDown' },
      { type: 'gamepadAxis', axis: 1, sign: 1 },
    ],
  },
]);

export function installInputSystem(world: World): () => void {
  world
    .addSystem(Update, {
      name: PLAYER_INPUT_SYSTEM_NAME,
      after: [FRAME_START_SCAN_SYSTEM_NAME],
      queries: [{ write: [PlayerMotion], with: [Player] }],
      fn: (world, [players]) => {
        const snapshot = world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
          ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
          : undefined;
        const input = snapshot?.getVector('moveLeft', 'moveRight', 'moveUp', 'moveDown') ?? { x: 0, y: 0 };
        for (const row of players) {
          const motion = row.mut(PlayerMotion);
          motion.inputX = input.x;
          motion.inputZ = input.y;
        }
      },
    })
    .unwrap();
  return () => world.removeSystem(Update, PLAYER_INPUT_SYSTEM_NAME).unwrap();
}
