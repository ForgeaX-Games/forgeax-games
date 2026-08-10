import { describe, expect, it } from 'vitest';
import { ORBIT_INITIAL_PITCH, ORBIT_INITIAL_YAW, ORBIT_PITCH_LIMIT, ORBIT_RADIUS, orbitPose, orbitRadius } from '../assets/plugins/camera-orbit';

describe('game-default orbit camera', () => {
  it('keeps the camera at the canonical radius around its target', () => {
    const target: [number, number, number] = [2, 0.8, -3];
    const pose = orbitPose(target, ORBIT_INITIAL_YAW, ORBIT_INITIAL_PITCH);
    expect(orbitRadius(pose.pos, target)).toBeCloseTo(ORBIT_RADIUS, 5);
  });

  it('clamps pitch before deriving a look-at pose', () => {
    const target: [number, number, number] = [0, 0, 0];
    const pose = orbitPose(target, 0, Math.PI);
    expect(orbitRadius(pose.pos, target)).toBeCloseTo(ORBIT_RADIUS, 5);
    expect(pose.pos[1]).toBeCloseTo(Math.sin(ORBIT_PITCH_LIMIT) * ORBIT_RADIUS, 5);
  });
});
