import { describe, expect, test } from 'bun:test';
import {
  abortDodge,
  cancelDodgeForSkillOrMove,
  createDodgeState,
  dodgeAllowsSkillOrMove,
  dodgeHitReactionAborts,
  dodgeLocksTranslation,
  DODGE_BUILDUP_S,
  DODGE_COOLDOWN_S,
  DODGE_DISTANCE_M,
  DODGE_MOVEMENT_S,
  DODGE_RECOVER_CANCEL_AFTER_S,
  DODGE_RECOVER_S,
  isDodgeInvulnerable,
  stepDodge,
  tickDodge,
  tryStartDodge,
} from './dodge';

const openWorld = () => true;

describe('tryStartDodge', () => {
  test('starts buildup when idle and off cooldown', () => {
    const s0 = createDodgeState();
    const s = tryStartDodge({ state: s0, x: 1, z: 2, dirX: 1, dirZ: 0 });
    expect(s.phase).toBe('buildup');
    expect(s.dirX).toBeCloseTo(1);
    expect(s.dirZ).toBeCloseTo(0);
    expect(s.startX).toBe(1);
    expect(s.startZ).toBe(2);
  });

  test('rejects while on cooldown or casting-locked', () => {
    let s = createDodgeState();
    s = { ...s, cooldown: 1 };
    expect(tryStartDodge({ state: s, x: 0, z: 0, dirX: 0, dirZ: 1 }).phase).toBe('idle');
    s = createDodgeState();
    expect(
      tryStartDodge({ state: s, x: 0, z: 0, dirX: 0, dirZ: 1, castingLocked: true }).phase,
    ).toBe('idle');
  });
});

describe('phase machine + i-frames (L2/L3)', () => {
  test('buildup → movement (invuln) → recover → idle+cooldown', () => {
    let s = tryStartDodge({
      state: createDodgeState(),
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
    });
    expect(isDodgeInvulnerable(s)).toBe(false);
    expect(dodgeAllowsSkillOrMove(s)).toBe(false);
    expect(dodgeHitReactionAborts(s)).toBe(true);

    let r = tickDodge({ state: s, dt: DODGE_BUILDUP_S, x: 0, z: 0, walkable: openWorld });
    s = r.state;
    expect(s.phase).toBe('movement');
    expect(isDodgeInvulnerable(s)).toBe(true);
    expect(dodgeHitReactionAborts(s)).toBe(false);
    expect(dodgeAllowsSkillOrMove(s)).toBe(false);

    r = tickDodge({
      state: s,
      dt: DODGE_MOVEMENT_S,
      x: r.x,
      z: r.z,
      walkable: openWorld,
    });
    s = r.state;
    expect(s.phase).toBe('recover');
    expect(isDodgeInvulnerable(s)).toBe(false);
    // Playtest retune: cancel open at recover start (AFTER_S = 0).
    expect(dodgeAllowsSkillOrMove(s)).toBe(true);
    expect(DODGE_RECOVER_CANCEL_AFTER_S).toBe(0);

    r = tickDodge({
      state: s,
      dt: DODGE_RECOVER_S,
      x: r.x,
      z: r.z,
      walkable: openWorld,
    });
    s = r.state;
    expect(s.phase).toBe('idle');
    expect(s.cooldown).toBeGreaterThan(0);
    expect(s.cooldown).toBeLessThanOrEqual(DODGE_COOLDOWN_S);
  });

  test('open-world roll travels ~DODGE_DISTANCE_M', () => {
    let s = tryStartDodge({
      state: createDodgeState(),
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
    });
    let x = 0;
    let z = 0;
    // One big tick through buildup+movement
    const r = tickDodge({
      state: s,
      dt: DODGE_BUILDUP_S + DODGE_MOVEMENT_S,
      x,
      z,
      walkable: openWorld,
    });
    s = r.state;
    x = r.x;
    z = r.z;
    expect(s.phase).toBe('recover');
    expect(Math.hypot(x, z)).toBeCloseTo(DODGE_DISTANCE_M, 1);
  });

  test('abortDodge arms cooldown', () => {
    let s = tryStartDodge({
      state: createDodgeState(),
      x: 0,
      z: 0,
      dirX: 0,
      dirZ: 1,
    });
    s = abortDodge(s);
    expect(s.phase).toBe('idle');
    expect(s.cooldown).toBe(DODGE_COOLDOWN_S);
  });

  test('translation lock ends at recover; roll-cancel aborts after window', () => {
    let s = tryStartDodge({
      state: createDodgeState(),
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
    });
    expect(dodgeLocksTranslation(s)).toBe(true);
    let r = tickDodge({
      state: s,
      dt: DODGE_BUILDUP_S + DODGE_MOVEMENT_S,
      x: 0,
      z: 0,
      walkable: openWorld,
    });
    s = r.state;
    expect(s.phase).toBe('recover');
    expect(dodgeLocksTranslation(s)).toBe(false);
    expect(dodgeAllowsSkillOrMove(s)).toBe(true);
    s = cancelDodgeForSkillOrMove(s);
    expect(s.phase).toBe('idle');
    expect(s.cooldown).toBe(DODGE_COOLDOWN_S);
  });
});

describe('stepDodge L4 corner-cutting', () => {
  test('blocks pure diagonal when both orthogonals blocked', () => {
    // Wall: only (0,0) walkable; diagonal into blocked corner
    const walkable = (x: number, z: number) => x <= 0.05 && z <= 0.05;
    const r = stepDodge(0, 0, 1, 1, 0.2, walkable);
    expect(r.moved).toBe(false);
  });

  test('allows diagonal when one orthogonal is free', () => {
    // Block +Z wall but allow +X
    const walkable = (x: number, z: number) => z <= 0.01 || x > 0.05;
    const r = stepDodge(0, 0, 1, 1, 0.2, walkable);
    expect(r.moved).toBe(true);
  });

  test('short roll stops at wall', () => {
    // Walkable for x < 1.0
    const walkable = (x: number, _z: number) => x < 1.0;
    let s = tryStartDodge({
      state: createDodgeState(),
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
    });
    const r = tickDodge({
      state: s,
      dt: DODGE_BUILDUP_S + DODGE_MOVEMENT_S,
      x: 0,
      z: 0,
      walkable,
    });
    expect(r.state.phase).toBe('recover');
    expect(r.x).toBeLessThan(1.05);
    expect(r.x).toBeGreaterThan(0.5);
    expect(r.state.traveled).toBeLessThan(DODGE_DISTANCE_M);
  });
});
