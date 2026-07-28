import { Transform } from '@forgeax/engine-scene';
import { quat } from '@forgeax/engine-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { KartPose } from './kart-controller';
import type { TrackCurve } from './track-data';
import { forwardNegZ } from './orientation';

export interface FollowCamera {
  snapTo(pose: KartPose): void;
  update(dt: number, pose: KartPose): void;
}

export interface FollowCameraOptions {
  world: World;
  camera: EntityHandle;
  track: TrackCurve;
  /** Distance behind kart along -forward (original 8.6). */
  distance?: number;
  /** Height above kart (original 4.6). */
  height?: number;
  /** Look-ahead along forward (original 5). */
  lookAhead?: number;
  /** Look height above kart (original 1.2). */
  lookHeight?: number;
  positionSharpness?: number;
}

/**
 * Third-person race camera matching original MainScene.followCamera.
 * ForgeaX cameras look down local -Z; quat.fromLookAt encodes that.
 */
export function createFollowCamera(options: FollowCameraOptions): FollowCamera {
  const {
    world,
    camera,
    track,
    distance = 8.6,
    height = 4.6,
    lookAhead = 5,
    lookHeight = 1.2,
    positionSharpness = 5,
  } = options;

  let cameraX = 0;
  let cameraY = 0;
  let cameraZ = 0;

  const constrainCamera = (
    desired: [number, number, number],
  ): [number, number, number] => {
    const [dx, dy, dz] = desired;
    const ci = track.nearestInfo({ x: dx, y: dy, z: dz });
    const cc = track.pointAt(ci.t);
    const cs = track.sideAt(ci.t);
    const clat = cs.x * (dx - cc.x) + cs.z * (dz - cc.z);
    const inCorr =
      ci.t > track.corrT0 - 0.006 && ci.t < track.corrT1 + 0.006;
    const camLim = inCorr ? 8.8 : track.boundaryLat(ci.t) + 1.5;
    let x = dx;
    let y = dy;
    let z = dz;
    if (Math.abs(clat) > camLim) {
      const cl = Math.sign(clat) * camLim;
      x = cc.x + cs.x * cl + (dx - cc.x - cs.x * clat);
      z = cc.z + cs.z * cl + (dz - cc.z - cs.z * clat);
    }
    if (inCorr) y = Math.min(y, cc.y + 4.5);
    y = Math.max(y, cc.y + 1.5);
    return [x, y, z];
  };

  const desiredPosition = (pose: KartPose): [number, number, number] => {
    const fwd = forwardNegZ(pose.yaw);
    return constrainCamera([
      pose.x - fwd.x * distance,
      pose.y + height,
      pose.z - fwd.z * distance,
    ]);
  };

  const writeCamera = (pose: KartPose): void => {
    const fwd = forwardNegZ(pose.yaw);
    const targetX = pose.x + fwd.x * lookAhead;
    const targetY = pose.y + lookHeight;
    const targetZ = pose.z + fwd.z * lookAhead;

    const rotation = quat.create();
    quat.fromLookAt(rotation, [cameraX, cameraY, cameraZ], [targetX, targetY, targetZ], [
      0, 1, 0,
    ]);

    world.set(camera, Transform, {
      pos: [cameraX, cameraY, cameraZ],
      quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
    });
  };

  const snapTo = (pose: KartPose): void => {
    [cameraX, cameraY, cameraZ] = desiredPosition(pose);
    writeCamera(pose);
  };

  return {
    snapTo,
    update(dtRaw: number, pose: KartPose): void {
      const dt = Math.min(Math.max(dtRaw, 0), 0.05);
      const desired = desiredPosition(pose);
      const alpha = 1 - Math.exp(-positionSharpness * dt);
      cameraX += (desired[0] - cameraX) * alpha;
      cameraY += (desired[1] - cameraY) * alpha;
      cameraZ += (desired[2] - cameraZ) * alpha;
      writeCamera(pose);
    },
  };
}
