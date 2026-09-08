import { quat } from '@forgeax/engine-math';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import {
  ANTIALIAS_FXAA,
  Camera,
  TONEMAP_ACES_FILMIC,
  perspective,
} from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { CAMERA } from '../config/arena.ts';
import {
  CAMERA_RIG_RESOURCE_KEY,
  computeCameraRig,
  type CameraRig,
} from '../config/camera-rig.ts';
import { VIEW } from '../config/camera-rig.ts';

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/** Spawn the one fixed-angle camera. Its look-at rotation is computed once. */
export function spawnArenaCamera(world: World, canvas?: CanvasSize): EntityHandle {
  const aspect = (canvas?.width ?? 1) / Math.max(1, canvas?.height ?? 1);
  const rig = computeCameraRig(aspect);
  const cameraQuat = quat.fromLookAt(
    quat.create(),
    [0, rig.height, rig.backOffset],
    CAMERA.target,
    CAMERA.up,
  );
  const camera = world
    .spawn(
      {
        component: Transform,
        data: { pos: [0, rig.height, rig.backOffset], quat: cameraQuat },
      },
      {
        component: Camera,
        data: {
          ...perspective({
            fov: VIEW.fov,
            aspect,
            near: CAMERA.near,
            far: CAMERA.far,
          }),
          clearColor: [...CAMERA.clearColor],
          tonemap: TONEMAP_ACES_FILMIC,
          antialias: ANTIALIAS_FXAA,
          exposure: CAMERA.exposure,
        },
      },
    )
    .unwrap();
  world.insertResource(CAMERA_RIG_RESOURCE_KEY, rig);
  return camera;
}

/** Recalculate the derived rig on resize while preserving the authored view direction. */
export function configureArenaCamera(world: World, canvas: CanvasSize): CameraRig | undefined {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const rig = computeCameraRig(aspect);
  const cameras = world.query({ write: [Transform, Camera] });
  if (!cameras.ok) return undefined;
  const row = [...cameras.value][0];
  if (row === undefined) return undefined;
  const transform = row.mut(Transform);
  const camera = row.mut(Camera);
  transform.pos[0] = 0;
  transform.pos[1] = rig.height;
  transform.pos[2] = rig.backOffset;
  camera.aspect = aspect;
  camera.fov = VIEW.fov;
  world.insertResource(CAMERA_RIG_RESOURCE_KEY, rig);
  return rig;
}
