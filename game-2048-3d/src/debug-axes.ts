import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';

export const GAME_DEFAULT_AXES_EVIDENCE_KEY = '__forgeaxGameDefaultAxesEvidence';
const AXIS_LENGTH = 0.9;

type DebugDrawAxes = {
  axes(worldMat: ArrayLike<number>, length: number): void;
};

export type GameDefaultAxesEvidence = {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly reset: () => void;
  readonly snapshot: () => {
    readonly enabled: boolean;
    readonly available: boolean;
    readonly axesCalls: number;
    readonly liveTargets: number;
    readonly resetCount: number;
  };
};

export type DebugAxesHandle = {
  readonly enabled: boolean;
  readonly draw: () => void;
  readonly reset: () => void;
  readonly snapshot: () => ReturnType<GameDefaultAxesEvidence['snapshot']>;
};

/**
 * Install a query-gated local-coordinate overlay on authored gameplay targets.
 * The immediate-mode buffer is naturally reset at the end of every frame; the
 * explicit reset only clears the witness counters and makes the lifecycle
 * visible to the browser smoke.
 */
export function installDebugAxes(args: {
  readonly world: World;
  readonly targets: readonly EntityHandle[];
  readonly debugDraw: DebugDrawAxes | undefined;
  readonly registerCleanup?: (cleanup: () => void) => void;
}): DebugAxesHandle {
  const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug-axes') === '1';
  let axesCalls = 0;
  let resetCount = 0;
  const available = args.debugDraw !== undefined;
  const snapshot = () => ({
    enabled,
    available,
    axesCalls,
    liveTargets: args.targets.filter((entity) => args.world.get(entity, Transform).ok).length,
    resetCount,
  });
  const reset = () => {
    axesCalls = 0;
    resetCount++;
  };
  const handle: DebugAxesHandle = {
    enabled,
    draw: () => {
      if (!enabled || args.debugDraw === undefined) return;
      for (const entity of args.targets) {
        const transform = args.world.get(entity, Transform);
        if (!transform.ok) continue;
        args.debugDraw.axes(transform.value.world, AXIS_LENGTH);
        axesCalls++;
      }
    },
    reset,
    snapshot,
  };
  if (enabled) {
    const host = globalThis as unknown as Record<string, unknown>;
    const evidence: GameDefaultAxesEvidence = { enabled, available, reset, snapshot };
    host[GAME_DEFAULT_AXES_EVIDENCE_KEY] = evidence;
    args.registerCleanup?.(() => {
      if (host[GAME_DEFAULT_AXES_EVIDENCE_KEY] === evidence) delete host[GAME_DEFAULT_AXES_EVIDENCE_KEY];
    });
  }
  return handle;
}
