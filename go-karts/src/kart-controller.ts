import { Transform } from '@forgeax/engine-scene';
import { quat } from '@forgeax/engine-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { InputSnapshot } from '@forgeax/engine-input';
import {
  createTrackCurve,
  type TrackCurve,
  type Vec3,
  SPAWN_T,
  SPAWN_LATERAL,
} from './track-data';
import { forwardNegZ, plusZHeadingToNegZYaw } from './orientation';

export interface KartPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** ForgeaX yaw: local -Z is the driving forward. */
  readonly yaw: number;
  readonly speed: number;
  readonly trackT: number;
}

export interface KartController {
  update(dt: number, input: InputSnapshot, extras?: { driftHeld?: boolean }): KartPose;
  reset(): KartPose;
  getPose(): KartPose;
  getSpeedKph(): number;
  readonly track: TrackCurve;
  /** Current drift charge 0..~2 for HUD/VFX hooks. */
  getDriftT(): number;
}

export interface KartControllerOptions {
  world: World;
  entity: EntityHandle;
  /** Optional authored spawn; defaults to original grid slot. */
  spawn?: { x: number; y: number; z: number; yaw: number };
}

/** Original MainScene arcade driving baselines. */
const BASE_MAX_SPEED = 24;
const BOOST_EXTRA = 0;
const ACCEL = 16;
const BRAKE_DECEL = 26;
const REVERSE_ACCEL = 10;
const COAST_DECEL = 7;
const MAX_REVERSE = 7;
const STEER_RATE = 1.95;
const OFFROAD_MAX = 9;
const BODY_RADIUS = 0.8;
const WALL_HIT_COOLDOWN = 0.4;
const ESCAPE_TIMEOUT = 0.8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createKartController(options: KartControllerOptions): KartController {
  const { world, entity } = options;
  const track = createTrackCurve();

  const defaultSpawn = (() => {
    const p = track.pointAt(SPAWN_T);
    const side = track.sideAt(SPAWN_T);
    const tan = track.tangentAt(SPAWN_T);
    const yaw = plusZHeadingToNegZYaw(Math.atan2(tan.x, tan.z));
    return {
      x: p.x + side.x * SPAWN_LATERAL,
      y: p.y,
      z: p.z + side.z * SPAWN_LATERAL,
      yaw,
    };
  })();

  const spawn = options.spawn ?? defaultSpawn;
  let x = spawn.x;
  let y = spawn.y;
  let z = spawn.z;
  let yaw = spawn.yaw;
  let speed = 0;
  let trackT = SPAWN_T;
  let wallHitCd = 0;
  let outT = 0;
  let stunT = 0;
  let driftT = 0;

  const writeTransform = (): void => {
    const rotation = quat.create();
    quat.fromAxisAngle(rotation, [0, 1, 0], yaw);
    world.set(entity, Transform, {
      pos: [x, y, z],
      quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!],
    });
  };

  const pose = (): KartPose => ({ x, y, z, yaw, speed, trackT });

  const reset = (): KartPose => {
    x = spawn.x;
    y = spawn.y;
    z = spawn.z;
    yaw = spawn.yaw;
    speed = 0;
    trackT = SPAWN_T;
    wallHitCd = 0;
    outT = 0;
    stunT = 0;
    driftT = 0;
    writeTransform();
    return pose();
  };

  const respawnAtTrack = (): void => {
    const p = track.pointAt(trackT);
    const tan = track.tangentAt(trackT);
    x = p.x;
    y = p.y;
    z = p.z;
    yaw = Math.atan2(tan.x, tan.z) + Math.PI;
    speed = 0;
    stunT = 0.4;
    outT = 0;
    writeTransform();
  };

  writeTransform();

  return {
    track,

    update(dtRaw: number, input: InputSnapshot, extras?: { driftHeld?: boolean }): KartPose {
      const dt = Math.min(Math.max(dtRaw, 0), 0.05);
      if (input.action('resetKart').justPressed()) return reset();

      stunT = Math.max(0, stunT - dt);
      wallHitCd = Math.max(0, wallHitCd - dt);

      const accelerate = input.action('accelerate').isPressed();
      const brake = input.action('brake').isPressed();
      const steerLeft = input.action('steerLeft').isPressed();
      const steerRight = input.action('steerRight').isPressed();
      const drift =
        input.action('drift').isPressed() || Boolean(extras?.driftHeld);
      // Match original: A/Left = +1 (turn left), D/Right = -1.
      const steer = Number(steerLeft) - Number(steerRight);

      const info = track.nearestInfo({ x, y, z });
      trackT = info.t;
      const offroad = info.dist > track.roadWidth / 2 + 0.7;
      const stunned = stunT > 0;

      let maxSpeed = BASE_MAX_SPEED + BOOST_EXTRA;
      if (offroad) maxSpeed = OFFROAD_MAX;
      if (stunned) maxSpeed = 3;

      if (accelerate && !stunned) speed += ACCEL * dt;
      else if (brake) {
        if (speed > 0) speed -= BRAKE_DECEL * dt;
        else speed -= REVERSE_ACCEL * dt;
      } else {
        speed -= Math.sign(speed) * Math.min(Math.abs(speed), COAST_DECEL * dt);
      }
      speed = clamp(speed, -MAX_REVERSE, maxSpeed);

      const grip = Math.min(1, Math.abs(speed) / 9);
      const drifting = drift && Math.abs(speed) > 9 && steer !== 0;
      const driftMul = drift && Math.abs(speed) > 9 ? 1.55 : 1;
      if (!stunned && steer !== 0) {
        yaw += steer * STEER_RATE * driftMul * grip * Math.sign(speed || 1) * dt;
      }
      if (drifting) driftT += dt;
      else driftT = 0;

      const fwd = forwardNegZ(yaw);
      x += fwd.x * speed * dt;
      z += fwd.z * speed * dt;

      // Lateral hard boundary (original wall slide / bounce)
      const info2 = track.nearestInfo({ x, y, z });
      trackT = info2.t;
      const center = track.pointAt(info2.t);
      const sideV = track.sideAt(info2.t);
      const lat = sideV.x * (x - center.x) + sideV.z * (z - center.z);
      const lim = track.boundaryLat(info2.t) - BODY_RADIUS;
      if (Math.abs(lat) > lim) {
        const out = Math.sign(lat);
        const vel: Vec3 = { x: fwd.x * speed, y: 0, z: fwd.z * speed };
        const vl = sideV.x * vel.x + sideV.z * vel.z;
        const impact = Math.abs(vl);
        const hardHit = impact > 5 && wallHitCd <= 0;
        const newVl = vl * out > 0 ? vl * (hardHit ? -0.35 : 0) : vl;
        const nvx = vel.x + sideV.x * (newVl - vl);
        const nvz = vel.z + sideV.z * (newVl - vl);
        const nlen = Math.hypot(nvx, nvz);
        if (nlen > 0.01) {
          const sgn = speed >= 0 ? 1 : -1;
          // Convert world velocity back to ForgeaX -Z yaw
          yaw = Math.atan2(-nvx * sgn, -nvz * sgn);
          speed = nlen * sgn;
        }
        x = center.x + sideV.x * out * lim;
        z = center.z + sideV.z * out * lim;
        if (hardHit) {
          wallHitCd = WALL_HIT_COOLDOWN;
          speed *= 0.75;
        }
      }

      // Outer ring clamp
      const dcx = x - track.centroid.x;
      const dcz = z - track.centroid.z;
      const distC = Math.hypot(dcx, dcz);
      if (distC > 150) {
        x = track.centroid.x + (dcx / distC) * 150;
        z = track.centroid.z + (dcz / distC) * 150;
        speed *= 0.5;
      }

      const fell = y < center.y - 4 || y < -6;
      const escaped =
        info2.dist > track.boundaryLat(info2.t) + 2.5 || distC > 145;
      if (fell || escaped) {
        outT += dt;
        if (outT > ESCAPE_TIMEOUT || y < -6) {
          respawnAtTrack();
          return pose();
        }
      } else {
        outT = 0;
      }

      // Stick to track height (ramps)
      const targetY = offroad ? 0 : track.heightAt(info2.t);
      y = lerp(y, targetY, Math.min(1, dt * 10));

      writeTransform();
      return pose();
    },

    reset,
    getPose: pose,
    getSpeedKph: () => Math.abs(speed) * 3.6,
    getDriftT: () => driftT,
  };
}
