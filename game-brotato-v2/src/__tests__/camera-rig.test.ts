import { describe, expect, it } from 'vitest';
import { ARENA } from '../config/arena.ts';
import { computeCameraRig, constrainCameraCenter, desiredCameraOffset } from '../config/camera-rig.ts';

describe('Brotato v2 M1 camera rig', () => {
  it('keeps the ground footprint within the 25 x 25 contract', () => {
    for (const aspect of [16 / 9, 16 / 10, 4 / 3, 1, 21 / 9]) {
      const rig = computeCameraRig(aspect);
      expect(Math.max(rig.visibleWidth, rig.visibleDepth)).toBeLessThanOrEqual(25 + 1e-6);
    }
  });

  it('switches the limiting axis between wide and square views', () => {
    const wide = computeCameraRig(16 / 9);
    const square = computeCameraRig(1);
    expect(wide.visibleWidth).toBeGreaterThan(wide.visibleDepth);
    expect(square.visibleDepth).toBeGreaterThan(square.visibleWidth);
    expect(wide.visibleWidth).toBeCloseTo(25, 6);
    expect(square.visibleDepth).toBeCloseTo(25, 6);
  });

  it('keeps sampled arena-boundary positions inside the corresponding half-axis', () => {
    for (const aspect of [16 / 9, 1, 21 / 9]) {
      const rig = computeCameraRig(aspect);
      for (let x = -ARENA.limit; x <= ARENA.limit; x += 1.25) {
        const cameraX = desiredCameraOffset(x, rig.deadZoneX, rig.gainX, rig.clampX);
        expect(Math.abs(x - cameraX)).toBeLessThanOrEqual(rig.halfWidth + 1e-6);
      }
      for (let z = -ARENA.limit; z <= ARENA.limit; z += 1.25) {
        const cameraZ = desiredCameraOffset(z, rig.deadZoneZ, rig.gainZ, rig.clampZ);
        expect(Math.abs(z - cameraZ)).toBeLessThanOrEqual(rig.halfDepth + 1e-6);
      }
    }
  });

  it('keeps a moving player inside the tilted camera near edge', () => {
    const rig = computeCameraRig(16 / 9);
    let playerZ = 0;
    let velocityZ = 0;
    let cameraZ = 0;
    const frame = 1 / 60;
    const followAlpha = 1 - Math.exp(-frame * 6);

    for (let index = 0; index < 240; index += 1) {
      velocityZ = Math.min(6.2, velocityZ + 48 * frame);
      playerZ = Math.min(ARENA.limit, playerZ + velocityZ * frame);
      const desired = desiredCameraOffset(playerZ, rig.deadZoneZ, rig.gainZ, rig.clampZ);
      cameraZ = constrainCameraCenter(
        cameraZ + (desired - cameraZ) * followAlpha,
        playerZ,
        rig.nearHalfDepth,
      );
      expect(Math.abs(playerZ - cameraZ)).toBeLessThanOrEqual(rig.nearHalfDepth + 1e-6);
    }
  });
});
