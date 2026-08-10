import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { mat4 } from '@forgeax/engine-math';
import type { Mat4 } from '@forgeax/engine-math';
import { Camera } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { activeScoringTargetEntities, type ScoringTargetQuery } from './scoring-target';

export const GAME_DEFAULT_AXES_EVIDENCE_KEY = '__forgeaxGameDefaultAxesEvidence';
const AXIS_LENGTH = 0.9;

type DebugDrawAxes = {
  axes(worldMat: ArrayLike<number>, length: number): void;
  aabb(min: ArrayLike<number>, max: ArrayLike<number>, color: ArrayLike<number>): void;
  frustum(viewProj: Mat4, color: ArrayLike<number>): void;
};

export type GameDefaultAxesEvidence = {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly reset: () => void;
  readonly snapshot: () => {
    readonly enabled: boolean;
    readonly available: boolean;
    readonly axesCalls: number;
    readonly aabbCalls: number;
    readonly frustumCalls: number;
    readonly cameraReady: boolean;
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
  readonly camera: EntityHandle;
  readonly targetQuery: ScoringTargetQuery;
  readonly debugDraw: DebugDrawAxes | undefined;
  readonly registerCleanup?: (cleanup: () => void) => void;
}): DebugAxesHandle {
  const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug-axes') === '1';
  let axesCalls = 0;
  let aabbCalls = 0;
  let frustumCalls = 0;
  let resetCount = 0;
  const available = args.debugDraw !== undefined;
  const cameraSnapshot = () => {
    const transform = args.world.get(args.camera, Transform);
    const camera = args.world.get(args.camera, Camera);
    if (!transform.ok || !camera.ok) return null;
    return { transform: transform.value, camera: camera.value };
  };
  const snapshot = () => ({
    enabled,
    available,
    axesCalls,
    aabbCalls,
    frustumCalls,
    cameraReady: cameraSnapshot() !== null,
    liveTargets: activeScoringTargetEntities(args.world, args.targetQuery).filter((entity) => args.world.get(entity, Transform).ok).length,
    resetCount,
  });
  const reset = () => {
    axesCalls = 0;
    aabbCalls = 0;
    frustumCalls = 0;
    resetCount++;
  };
  const handle: DebugAxesHandle = {
    enabled,
    draw: () => {
      if (!enabled || args.debugDraw === undefined) return;
      for (const entity of activeScoringTargetEntities(args.world, args.targetQuery)) {
        const transform = args.world.get(entity, Transform);
        if (!transform.ok) continue;
        args.debugDraw.axes(transform.value.world, AXIS_LENGTH);
        axesCalls++;
        const worldMat = transform.value.world;
        const halfX = Math.hypot(worldMat[0] ?? 0, worldMat[1] ?? 0, worldMat[2] ?? 0) * 0.7;
        const halfY = Math.hypot(worldMat[4] ?? 0, worldMat[5] ?? 0, worldMat[6] ?? 0) * 0.7;
        const halfZ = Math.hypot(worldMat[8] ?? 0, worldMat[9] ?? 0, worldMat[10] ?? 0) * 0.7;
        const x = worldMat[12] ?? 0;
        const y = worldMat[13] ?? 0;
        const z = worldMat[14] ?? 0;
        args.debugDraw.aabb(
          [x - halfX, y - halfY, z - halfZ],
          [x + halfX, y + halfY, z + halfZ],
          [1, 0.25, 0.1, 1],
        );
        aabbCalls++;
      }
      const camera = cameraSnapshot();
      if (camera !== null) {
        const view = mat4.invert(mat4.create(), camera.transform.world);
        const projection = mat4.create();
        const data = camera.camera;
        if (data.projection === 1) {
          mat4.orthographic(projection, data.left, data.right, data.bottom, data.top, data.near, data.far);
        } else {
          mat4.perspective(projection, data.fov, data.aspect, data.near, data.far);
        }
        const viewProj = mat4.multiply(mat4.create(), projection, view);
        args.debugDraw.frustum(viewProj, [0.2, 0.8, 1, 1]);
        frustumCalls++;
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
