import type { AssetRegistry } from '@forgeax/engine-assets-runtime';
import { Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { meshAssetKind } from '@forgeax/engine-geometry';
import {
  Camera,
  MeshFilter,
  MeshRenderer,
  Visibility,
  VisibilityStateValue,
} from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { materialAssetKind } from '@forgeax/engine-types';
import { CAMERA_RIG_RESOURCE_KEY } from '../config/camera-rig.ts';
import { ASSET_IDS } from './asset-ids.ts';
import { CAMERA_FOLLOW_SYSTEM_NAME } from '../systems/camera-follow-system.ts';

export const VIEW_CALIBRATION_SYSTEM_NAME = 'brotato-v2/view-calibration-follow';

export interface ViewCalibrationController {
  readonly entity: EntityHandle;
  readonly visible: () => boolean;
  readonly setVisible: (visible: boolean) => void;
  readonly toggle: () => boolean;
  readonly dispose: () => void;
}

function fail(message: string, error?: { readonly code?: string; readonly hint?: string }): never {
  const details = error === undefined ? '' : ` (${error.code ?? 'unknown'}: ${error.hint ?? 'no hint'})`;
  throw new Error(`${message}${details}`);
}

/** Spawn the hidden cyan 25 x 25 view-calibration cross and bind it to the camera center. */
export async function spawnViewCalibration(
  world: World,
  assets: AssetRegistry,
): Promise<ViewCalibrationController> {
  const [meshResult, materialResult] = await Promise.all([
    assets.load(ASSET_IDS.meshViewCalibration, meshAssetKind),
    assets.load(ASSET_IDS.materialViewCalibration, materialAssetKind),
  ]);
  if (!meshResult.ok) fail('Brotato v2 view calibration mesh load failed', meshResult.error);
  if (!materialResult.ok) fail('Brotato v2 view calibration material load failed', materialResult.error);

  const mesh = world.allocSharedRef('MeshAsset', meshResult.value);
  const material = world.allocSharedRef('MaterialAsset', materialResult.value);
  const entity = world
    .spawn(
      { component: Transform, data: { pos: [0, 0.03, 0] } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
      { component: Visibility, data: { state: VisibilityStateValue.hidden } },
    )
    .unwrap();

  world
    .addSystem(Update, {
      name: VIEW_CALIBRATION_SYSTEM_NAME,
      after: [CAMERA_FOLLOW_SYSTEM_NAME],
      queries: [{ read: [Transform], with: [Camera] }],
      fn: (world, [cameras]) => {
        if (!world.hasResource(CAMERA_RIG_RESOURCE_KEY)) return;
        const camera = [...cameras][0];
        if (camera === undefined) return;
        const cameraPos = camera.get(Transform).pos;
        const result = world.set(entity, Transform, {
          pos: [cameraPos[0] ?? 0, 0.03, cameraPos[2] ?? 0],
        });
        if (!result.ok && result.error.code !== 'stale-entity') {
          throw new Error(`Brotato v2 view calibration follow failed: ${result.error.hint}`);
        }
      },
    })
    .unwrap();

  let isVisible = false;
  let disposed = false;
  const setVisible = (next: boolean): void => {
    if (disposed) return;
    const result = world.set(entity, Visibility, {
      state: next ? VisibilityStateValue.visible : VisibilityStateValue.hidden,
    });
    if (!result.ok) fail('Brotato v2 view calibration visibility update failed', result.error);
    isVisible = next;
  };
  return {
    entity,
    visible: () => isVisible,
    setVisible,
    toggle: () => {
      setVisible(!isVisible);
      return isVisible;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      world.removeSystem(Update, VIEW_CALIBRATION_SYSTEM_NAME).unwrap();
      world.despawn(entity).unwrap();
      world.sharedRefs.release(mesh).unwrap();
      world.sharedRefs.release(material).unwrap();
    },
  };
}
