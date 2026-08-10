import type { World } from '@forgeax/engine-ecs';
import {
  INPUT_BACKEND_KEY,
  makeCompositeBackend,
  type CompositeInputBackend,
  type InputBackend,
} from '@forgeax/engine-input';

export type GameplayKeyInjection = {
  readonly type: 'key';
  readonly key: string;
  readonly phase: 'down' | 'up';
};

export type GameplayInputInjection = {
  readonly apply: (input: unknown) => void;
  readonly clear: () => void;
};

function isCompositeBackend(value: InputBackend): value is CompositeInputBackend {
  const candidate = value as Partial<CompositeInputBackend>;
  return typeof candidate.press === 'function'
    && typeof candidate.release === 'function'
    && typeof candidate.clearInjected === 'function';
}

function requireKeyInjection(input: unknown): GameplayKeyInjection {
  if (typeof input !== 'object' || input === null) throw new Error('input must be an object');
  const value = input as Record<string, unknown>;
  if (value.type !== 'key' || typeof value.key !== 'string' || (value.phase !== 'down' && value.phase !== 'up')) {
    throw new Error('Aetherfall currently accepts typed key down/up gameplay input');
  }
  return { type: 'key', key: value.key, phase: value.phase };
}

/**
 * Layer AI key transitions over the browser backend without replacing human
 * input. The frame-start scanner continues to consume the same World resource.
 */
export function installGameplayInputInjection(world: World): GameplayInputInjection {
  const existing = world.getResource<InputBackend>(INPUT_BACKEND_KEY);
  const backend = isCompositeBackend(existing) ? existing : makeCompositeBackend(existing);
  if (backend !== existing) world.insertResource(INPUT_BACKEND_KEY, backend);
  return {
    apply(input) {
      const transition = requireKeyInjection(input);
      if (transition.phase === 'down') backend.press(transition.key);
      else backend.release(transition.key);
    },
    clear: () => backend.clearInjected(),
  };
}
