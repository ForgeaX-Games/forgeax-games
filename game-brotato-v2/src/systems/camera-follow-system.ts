import { FixedUpdate, Time, Update, type World } from '@forgeax/engine-ecs';
import { Camera } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { Player } from '../ecs/components.ts';
import {
  CAMERA_RIG_RESOURCE_KEY,
  constrainCameraCenter,
  desiredCameraOffset,
  type CameraRig,
  VIEW,
} from '../config/camera-rig.ts';

export const CAMERA_FOLLOW_SYSTEM_NAME = 'brotato-v2/camera-follow';

export function installCameraFollowSystem(world: World): () => void {
  const result = world.addSystem(Update, {
    name: CAMERA_FOLLOW_SYSTEM_NAME,
    after: [FixedUpdate],
    queries: [
      { read: [Transform], with: [Player] },
      { write: [Transform], with: [Camera] },
    ],
    fn: (world, [players, cameras]) => {
      if (!world.hasResource(CAMERA_RIG_RESOURCE_KEY)) return;
      const rig = world.getResource<CameraRig>(CAMERA_RIG_RESOURCE_KEY);
      const player = [...players][0];
      const camera = [...cameras][0];
      if (player === undefined || camera === undefined) return;
      const playerTransform = player.get(Transform);
      const cameraTransform = camera.mut(Transform);
      const playerX = playerTransform.pos[0] ?? 0;
      const playerZ = playerTransform.pos[2] ?? 0;
      const desiredX = desiredCameraOffset(playerX, rig.deadZoneX, rig.gainX, rig.clampX);
      const desiredZ = desiredCameraOffset(playerZ, rig.deadZoneZ, rig.gainZ, rig.clampZ);
      const delta = Math.max(0, world.getResource(Time).delta);
      const alpha = 1 - Math.exp(-delta * VIEW.followLambda);
      const cameraX = cameraTransform.pos[0] ?? 0;
      const cameraZ = cameraTransform.pos[2] ?? rig.backOffset;
      const smoothedX = cameraX + (desiredX - cameraX) * alpha;
      const currentCenterZ = cameraZ - rig.backOffset;
      const smoothedZ = currentCenterZ + (desiredZ - currentCenterZ) * alpha;
      // Perspective + tilt compresses the screen-bottom ground footprint. A
      // pure lagged follow can therefore let a fast player cross that edge;
      // catch up only when necessary to preserve the visible-player invariant.
      cameraTransform.pos[0] = constrainCameraCenter(smoothedX, playerX, rig.nearHalfWidth);
      cameraTransform.pos[2] = constrainCameraCenter(smoothedZ, playerZ, rig.nearHalfDepth) + rig.backOffset;
      // The camera quaternion is authored once by spawnArenaCamera. Follow
      // changes position only, so the rig never orbits as the player moves.
    },
  });
  result.unwrap();
  return () => world.removeSystem(Update, CAMERA_FOLLOW_SYSTEM_NAME).unwrap();
}
