import {
  resolveVisibility,
  visibilityStateFromU32,
  Visibility,
  VisibilityStateValue,
  type VisibilityState,
} from '@forgeax/engine-render';
import type { EntityHandle, World } from '@forgeax/engine-ecs';

export type VisibilityLoopSnapshot = {
  readonly available: boolean;
  readonly intent: VisibilityState;
  readonly effective: 'hidden' | 'visible';
  readonly source: 'default' | 'self' | 'parent';
  readonly toggles: number;
  readonly explicitlyHidden: number;
};

export type VisibilityLoopRenderer = {
  readonly visibilityStats: { readonly explicitlyHidden: number };
};

export type VisibilityLoopHandle = {
  readonly toggle: () => void;
  readonly reset: () => void;
  readonly snapshot: (renderer?: VisibilityLoopRenderer) => VisibilityLoopSnapshot;
};

const EMPTY: VisibilityLoopSnapshot = {
  available: false,
  intent: 'inherited',
  effective: 'visible',
  source: 'default',
  toggles: 0,
  explicitlyHidden: 0,
};

/**
 * Compose render author intent with the existing target gameplay owner.
 * Visibility never removes physics, picking, scoring, or Disabled state.
 */
export function installVisibilityLoop(
  world: World,
  target: EntityHandle | undefined,
): VisibilityLoopHandle {
  if (target === undefined) {
    return { toggle() {}, reset() {}, snapshot: () => EMPTY };
  }

  const existing = world.get(target, Visibility);
  const initial: VisibilityState = existing.ok
    ? visibilityStateFromU32(existing.value.state) ?? 'inherited'
    : 'inherited';
  if (!existing.ok) {
    const added = world.addComponent(target, {
      component: Visibility,
      data: { state: VisibilityStateValue.inherited },
    });
    if (!added.ok) return { toggle() {}, reset() {}, snapshot: () => EMPTY };
  }

  let toggles = 0;
  const setState = (state: VisibilityState): void => {
    world.set(target, Visibility, { state: VisibilityStateValue[state] }).unwrap();
  };
  const toggle = (): void => {
    const current = world.get(target, Visibility);
    const intent = current.ok
      ? visibilityStateFromU32(current.value.state) ?? 'inherited'
      : 'inherited';
    setState(intent === 'hidden' ? 'visible' : 'hidden');
    toggles += 1;
  };
  const reset = (): void => {
    setState(initial);
    toggles = 0;
  };

  return {
    toggle,
    reset,
    snapshot: (renderer) => {
      const visibility = resolveVisibility(world);
      const resolved = visibility.get(target);
      const effective = visibility.effective(target);
      return {
        available: true,
        intent: resolved?.intent ?? 'inherited',
        effective,
        source: resolved?.source ?? 'default',
        toggles,
        explicitlyHidden: renderer?.visibilityStats.explicitlyHidden ?? (effective === 'hidden' ? 1 : 0),
      };
    },
  };
}
