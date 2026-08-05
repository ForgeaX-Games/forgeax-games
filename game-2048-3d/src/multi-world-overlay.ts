import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { type App } from '@forgeax/engine-app';
import { World } from '@forgeax/engine-ecs';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import type { MaterialAsset } from '@forgeax/engine-runtime';

export interface MultiWorldOverlaySnapshot {
  readonly enabled: boolean;
  readonly worldCount: number;
  readonly entityCount: number;
  readonly cameraOwner: number;
  readonly resourceOwner: number;
}

export interface MultiWorldOverlay {
  readonly world: World;
  readonly snapshot: () => MultiWorldOverlaySnapshot;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

function spawnBeacon(
  world: World,
  position: readonly [number, number, number],
  color: readonly [number, number, number, number],
): void {
  const material = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
    'MaterialAsset',
    Materials.standard({
      baseColor: color,
      metallic: 0,
      roughness: 0.35,
      emissive: [color[0], color[1], color[2]],
      emissiveIntensity: 0.15,
    }),
  );
  world
    .spawn(
      { component: Transform, data: { pos: position, scale: [0.45, 0.45, 0.45] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [material] } },
    )
    .unwrap();
}

/**
 * Add a small secondary World whose geometry borrows the primary world's
 * camera and light. The App owns the one frame loop; draw-source routing keeps
 * this composition explicit and updates the secondary World before drawing.
 */
export function installMultiWorldOverlay(
  app: App,
  registerCleanup?: (fn: () => void) => void,
): MultiWorldOverlay {
  const world = new World();
  spawnBeacon(world, [-6, 0.45, -1], [0.1, 0.85, 1, 1]);
  spawnBeacon(world, [-6, 1.35, -1], [1, 0.25, 0.65, 1]);

  let enabled = true;
  let disposed = false;
  const snapshot = (): MultiWorldOverlaySnapshot => ({
    enabled,
    worldCount: enabled ? 2 : 1,
    entityCount: 2,
    cameraOwner: 0,
    resourceOwner: 0,
  });
  const applyRouting = (): void => {
    app.setDrawSource(
      enabled
        ? () => ({ worlds: [app.world, world], cameraOwner: 0, resourceOwner: 0 })
        : undefined,
    );
  };
  const setEnabled = (nextEnabled: boolean): void => {
    if (disposed || enabled === nextEnabled) return;
    enabled = nextEnabled;
    applyRouting();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    app.setDrawSource(undefined);
  };

  applyRouting();
  registerCleanup?.(dispose);
  return { world, snapshot, setEnabled, dispose };
}
