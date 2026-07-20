import { describe, expect, test } from 'bun:test';
import {
  LOCOMOTION_IDLE_SPEED,
  LOCOMOTION_RUN_SPEED,
  LOCOMOTION_RUN_SPEED_PATH,
  selectLocomotionClip,
} from './locomotion';

describe('selectLocomotionClip', () => {
  test('idle at rest and below the idle epsilon', () => {
    expect(selectLocomotionClip(0, false)).toBe('idle');
    expect(selectLocomotionClip(LOCOMOTION_IDLE_SPEED, false)).toBe('idle');
    expect(selectLocomotionClip(LOCOMOTION_IDLE_SPEED, true)).toBe('idle');
  });

  test('walk for base SPEED band (WASD, not sprint)', () => {
    expect(selectLocomotionClip(3.4, false)).toBe('walk');
    expect(selectLocomotionClip(LOCOMOTION_RUN_SPEED - 0.01, false)).toBe('walk');
  });

  test('run at or above WASD run gate', () => {
    expect(selectLocomotionClip(LOCOMOTION_RUN_SPEED, false)).toBe('run');
    expect(selectLocomotionClip(5.4, false)).toBe('run');
  });

  test('path-driven keeps walk through base SPEED / mild haste', () => {
    expect(selectLocomotionClip(3.4, true)).toBe('walk');
    expect(selectLocomotionClip(4.5, true)).toBe('walk');
    expect(selectLocomotionClip(LOCOMOTION_RUN_SPEED_PATH - 0.01, true)).toBe('walk');
  });

  test('path-driven runs only at the higher path gate', () => {
    expect(selectLocomotionClip(LOCOMOTION_RUN_SPEED_PATH, true)).toBe('run');
    expect(selectLocomotionClip(5.4, true)).toBe('run');
  });

  test('selection is driven by speed magnitude, not a key flag', () => {
    // Same speed → same clip whether path or WASD when below both run gates.
    expect(selectLocomotionClip(2.0, false)).toBe(selectLocomotionClip(2.0, true));
  });
});
