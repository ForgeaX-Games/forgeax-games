import { Transform } from '@forgeax/engine-scene';
import { quat } from '@forgeax/engine-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { KartPose } from './kart-controller';
import type { TrackCurve } from './track-data';
import { forwardNegZ } from './orientation';

export interface FollowCamera {
  snapTo(pose: KartPose): void;
  update(dt: number, pose: KartPose): void;
  /** Original MainScene intro: high arc down to follow seat (~3s). */
  beginIntro(pose: KartPose): void;
  /** Returns true while the intro arc is still playing. */
  updateIntro(dt: number, pose: KartPose): boolean;
  isIntroPlaying(): boolean;
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
  let introT = 0;
  let introPlaying = false;
  const INTRO_DURATION = 2.8;

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

  const writeIntroCamera = (pose: KartPose, s: number): void => {
    const fwd = forwardNegZ(pose.yaw);
    // Right-hand side of forwardNegZ on XZ.
    const sideX = fwd.z;
    const sideZ = -fwd.x;
    // Quadratic Bezier: aerial wide → mid → follow seat (original MainScene).
    const ax = pose.x + fwd.x * 30 + sideX * 16;
    const ay = pose.y + 26;
    const az = pose.z + fwd.z * 30 + sideZ * 16;
    const mx = pose.x + fwd.x * 6 + sideX * 7;
    const my = pose.y + 12;
    const mz = pose.z + fwd.z * 6 + sideZ * 7;
    const bx = pose.x - fwd.x * distance;
    const by = pose.y + height;
    const bz = pose.z - fwd.z * distance;
    const w0 = (1 - s) * (1 - s);
    const w1 = 2 * (1 - s) * s;
    const w2 = s * s;
    cameraX = ax * w0 + mx * w1 + bx * w2;
    cameraY = ay * w0 + my * w1 + by * w2;
    cameraZ = az * w0 + mz * w1 + bz * w2;
    const lookFarX = pose.x + fwd.x * 60;
    const lookFarY = pose.y + 10;
    const lookFarZ = pose.z + fwd.z * 60;
    const lookNearX = pose.x + fwd.x * lookAhead;
    const lookNearY = pose.y + lookHeight;
    const lookNearZ = pose.z + fwd.z * lookAhead;
    const lx = lookFarX + (lookNearX - lookFarX) * s;
    const ly = lookFarY + (lookNearY - lookFarY) * s;
    const lz = lookFarZ + (lookNearZ - lookFarZ) * s;
    const rotation = quat.create();
    quat.fromLookAt(rotation, [cameraX, cameraY, cameraZ], [lx, ly, lz], [0, 1, 0]);
    world.set(camera, Transform, {
      pos: [cameraX, cameraY, cameraZ],
      quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
    });
  };

  const updateIntro = (dtRaw: number, pose: KartPose): boolean => {
    if (!introPlaying) return false;
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    introT += dt;
    const u = Math.min(1, introT / INTRO_DURATION);
    const s = u * u * (3 - 2 * u);
    writeIntroCamera(pose, s);
    if (u >= 1) {
      introPlaying = false;
      snapTo(pose);
      return false;
    }
    return true;
  };

  return {
    snapTo,
    beginIntro(pose) {
      introT = 0;
      introPlaying = true;
      writeIntroCamera(pose, 0);
    },
    updateIntro,
    isIntroPlaying: () => introPlaying,
    update(dtRaw: number, pose: KartPose): void {
      if (introPlaying) {
        updateIntro(dtRaw, pose);
        return;
      }
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
