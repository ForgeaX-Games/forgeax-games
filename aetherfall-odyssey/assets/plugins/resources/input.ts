import { createInputSnapshot, INPUT_MAP_KEY, INPUT_SNAPSHOT_RESOURCE_KEY, type ActionConfig, type InputSnapshot } from '@forgeax/engine-input';
import type { World } from '@forgeax/engine-ecs';

export const GAMEPAD_LOOK_DEADZONE = 0.22;
/** W3C Standard Gamepad index 10: left stick pressed (L3). */
export const STANDARD_GAMEPAD_SPRINT_BUTTON = 10;

/** The one authored input contract consumed by the game systems. */
export const GAME_DEFAULT_INPUT_MAP: readonly ActionConfig[] = [
  { action: 'moveForward', bindings: [{ type: 'key', key: 'w' }, { type: 'key', key: 'W' }, { type: 'gamepadAxis', axis: 1, sign: -1 }] },
  { action: 'moveBack', bindings: [{ type: 'key', key: 's' }, { type: 'key', key: 'S' }, { type: 'gamepadAxis', axis: 1, sign: 1 }] },
  { action: 'moveLeft', bindings: [{ type: 'key', key: 'a' }, { type: 'key', key: 'A' }, { type: 'gamepadAxis', axis: 0, sign: -1 }] },
  { action: 'moveRight', bindings: [{ type: 'key', key: 'd' }, { type: 'key', key: 'D' }, { type: 'gamepadAxis', axis: 0, sign: 1 }] },
  { action: 'lookLeft', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 2, sign: -1 }] },
  { action: 'lookRight', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 2, sign: 1 }] },
  { action: 'lookUp', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 3, sign: -1 }] },
  { action: 'lookDown', deadzone: GAMEPAD_LOOK_DEADZONE, bindings: [{ type: 'gamepadAxis', axis: 3, sign: 1 }] },
  { action: 'jump', bindings: [{ type: 'key', key: ' ' }, { type: 'gamepadButton', button: 0 }] },
  { action: 'shoot', bindings: [{ type: 'key', key: 'f' }, { type: 'key', key: 'F' }, { type: 'gamepadButton', button: 7 }] },
  { action: 'charge', bindings: [{ type: 'key', key: 'c' }, { type: 'key', key: 'C' }, { type: 'gamepadButton', button: 6 }] },
  { action: 'meshUv', bindings: [{ type: 'key', key: 'g' }, { type: 'key', key: 'G' }, { type: 'gamepadButton', button: 3 }] },
  { action: 'jpegTexture', bindings: [{ type: 'key', key: 'l' }, { type: 'key', key: 'L' }] },
  { action: 'videoTexture', bindings: [{ type: 'key', key: 'm' }, { type: 'key', key: 'M' }] },
  { action: 'targetProfile', bindings: [{ type: 'key', key: 'p' }, { type: 'key', key: 'P' }] },
  { action: 'spriteAtlas', bindings: [{ type: 'key', key: 'n' }, { type: 'key', key: 'N' }] },
  { action: 'fontSource', bindings: [{ type: 'key', key: 'y' }, { type: 'key', key: 'Y' }] },
  { action: 'interact', bindings: [{ type: 'key', key: 'e' }, { type: 'key', key: 'E' }, { type: 'gamepadButton', button: 2 }] },
  { action: 'freeUp', bindings: [{ type: 'key', key: 'e' }] },
  { action: 'freeDown', bindings: [{ type: 'key', key: 'q' }] },
  // Standard Gamepad button 10 is the left-stick press (L3), paired with
  // left-stick movement so sprint remains a one-hand locomotion gesture.
  { action: 'freeRun', bindings: [{ type: 'key', key: 'Shift' }, { type: 'gamepadButton', button: STANDARD_GAMEPAD_SPRINT_BUTTON }] },
  { action: 'reset', bindings: [{ type: 'key', key: 'r' }, { type: 'key', key: 'R' }, { type: 'gamepadButton', button: 1 }] },
  { action: 'arrowUp', bindings: [{ type: 'key', key: 'ArrowUp' }] },
  { action: 'arrowDown', bindings: [{ type: 'key', key: 'ArrowDown' }] },
  { action: 'arrowLeft', bindings: [{ type: 'key', key: 'ArrowLeft' }] },
  { action: 'arrowRight', bindings: [{ type: 'key', key: 'ArrowRight' }] },
];

/** Install the authored action map and expose a frame-zero-safe snapshot reader. */
export function installGameplayInputMap(world: World): () => InputSnapshot {
  world.insertResource(INPUT_MAP_KEY, GAME_DEFAULT_INPUT_MAP);
  const empty = createInputSnapshot();
  return () => world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
    ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
    : empty;
}
