import { FixedTime, FixedUpdate, Update, type World } from '@forgeax/engine-ecs';
import {
  addOnEnter,
  defineState,
  getState,
  inState,
  registerStatesPlugin,
  setNextState,
  type StateErrorCode,
} from '@forgeax/engine-state';

export const GameState = defineState('GameDefaultPhase', ['Play', 'Reset'] as const);
export const GAMEPLAY_STATE_WITNESS_KEY = 'gameDefaultStateWitness';

export interface GameplayStateWitness {
  phase: 'Play' | 'Reset' | 'unknown';
  updateTicks: number;
  fixedTicks: number;
  simulationSeconds: number;
  resetTransitions: number;
  lastErrorCode?: StateErrorCode;
}

export interface GameplayStateHandle {
  requestReset(): void;
  requestInvalid(): StateErrorCode | undefined;
  snapshot(): GameplayStateWitness;
}

export interface GameplayStateContext {
  world: World;
  reset: () => void;
}

export function installGameplayState(ctx: GameplayStateContext): GameplayStateHandle {
  // Preview loads the game entry after createApp has assembled its world. The
  // explicit idempotent call wires this late-defined token into that world.
  registerStatesPlugin(ctx.world);
  const initialWitness: GameplayStateWitness = {
    phase: 'Play',
    updateTicks: 0,
    fixedTicks: 0,
    simulationSeconds: 0,
    resetTransitions: 0,
  };
  ctx.world.insertResource(GAMEPLAY_STATE_WITNESS_KEY, initialWitness);

  const witness = (): GameplayStateWitness => ctx.world.getResource<GameplayStateWitness>(GAMEPLAY_STATE_WITNESS_KEY);
  const patchWitness = (patch: Partial<GameplayStateWitness>): void => {
    ctx.world.insertResource(GAMEPLAY_STATE_WITNESS_KEY, { ...witness(), ...patch });
  };

  const request = (variant: 'Play' | 'Reset'): void => {
    const result = setNextState(ctx.world, GameState, variant);
    if (!result.ok) patchWitness({ lastErrorCode: result.error.code });
  };

  // Reset is a real state transition: cleanup is performed by the enter hook,
  // then the state returns to Play on the following transition tick.
  addOnEnter(GameState, 'Reset', (world) => {
    patchWitness({ resetTransitions: witness().resetTransitions + 1 });
    ctx.reset();
    const result = setNextState(world, GameState, 'Play');
    if (!result.ok) patchWitness({ lastErrorCode: result.error.code });
  });

  ctx.world.addSystem(Update, {
    name: 'game-state-witness',
    queries: [],
    after: ['transitionStates'],
    before: [FixedUpdate],
    fn: () => {
      const current = getState(ctx.world, GameState);
      patchWitness({
        updateTicks: witness().updateTicks + 1,
        phase: current.ok && (current.value === 'Play' || current.value === 'Reset') ? current.value : 'unknown',
      });
    },
  }).unwrap();

  ctx.world.addSystem(FixedUpdate, {
    name: 'game-fixed-simulation',
    queries: [],
    runIf: inState(GameState, 'Play'),
    fn: (world) => {
      const fixed = world.getResource(FixedTime);
      const current = witness();
      patchWitness({ fixedTicks: fixed.tick, simulationSeconds: current.simulationSeconds + fixed.delta });
    },
  }).unwrap();

  return {
    requestReset() { request('Reset'); },
    requestInvalid() {
      const result = setNextState(ctx.world, GameState, 'NotARealPhase' as never);
      if (result.ok) return undefined;
      patchWitness({ lastErrorCode: result.error.code });
      return result.error.code;
    },
    snapshot() { return { ...witness() }; },
  };
}
