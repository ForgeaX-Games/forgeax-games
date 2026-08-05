import { describe, expect, it } from 'vitest';
import { createFreeCameraState, FREE_CAMERA_RUN_SPEED, FREE_CAMERA_WALK_SPEED, resetFreeCamera, stepFreeCamera } from '../free-camera';

describe('game-default free-camera motion', () => {
  it('accelerates toward walk/run intent and decays when released', () => {
    const state = createFreeCameraState();
    const walk = stepFreeCamera(state, 1 / 60, [0, 0, -1], false, 0);
    expect(walk[2]).toBeLessThan(0);
    expect(Math.abs(walk[2] ?? 0)).toBeLessThan(FREE_CAMERA_WALK_SPEED / 60);
    const run = stepFreeCamera(state, 1 / 60, [0, 0, -1], true, 0);
    expect(Math.abs(run[2] ?? 0)).toBeGreaterThan(Math.abs(walk[2] ?? 0));
    const released = stepFreeCamera(state, 1 / 60, [0, 0, 0], false, 0);
    expect(Math.abs(released[2] ?? 0)).toBeLessThan(Math.abs(run[2] ?? 0));
    expect(state.runSpeed).toBe(FREE_CAMERA_RUN_SPEED);
  });

  it('keeps vertical flight and scroll speed in the same controller owner', () => {
    const state = createFreeCameraState();
    const up = stepFreeCamera(state, 1 / 60, [0, 1, 0], false, 1);
    expect(up[1]).toBeGreaterThan(0);
    expect(state.walkSpeed).toBeGreaterThan(FREE_CAMERA_WALK_SPEED);
    const beforeReset = state.velocityY;
    resetFreeCamera(state);
    expect(beforeReset).toBeGreaterThan(0);
    expect(state.velocityY).toBe(0);
    expect(state.walkSpeed).toBe(FREE_CAMERA_WALK_SPEED);
  });
});
