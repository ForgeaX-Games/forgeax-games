import { describe, expect, test } from 'bun:test';
import {
  clampFinisherTarget,
  commitFinisher,
  createFinisherState,
  FINISHER_AFTERMATH_S,
  FINISHER_DAMAGE_AT_S,
  FINISHER_HOTBAR_SLOT,
  FINISHER_ID,
  FINISHER_RADIUS_M,
  FINISHER_UNLOCK_LEVEL,
  FINISHER_WINDUP_S,
  grantFinisherHotbar,
  isFinisherInputLocked,
  tickFinisher,
} from './finisher';

describe('inferno-nova finisher constants (L5)', () => {
  test('id, unlock level, hotbar slot 4 (= index 3), radius 4 m', () => {
    expect(FINISHER_ID).toBe('inferno-nova');
    expect(FINISHER_UNLOCK_LEVEL).toBe(3);
    expect(FINISHER_HOTBAR_SLOT).toBe(3);
    expect(FINISHER_RADIUS_M).toBe(4);
    expect(FINISHER_WINDUP_S).toBe(0.4);
    expect(FINISHER_DAMAGE_AT_S).toBe(0.4);
    expect(FINISHER_AFTERMATH_S).toBe(1);
  });
});

describe('clampFinisherTarget', () => {
  test('keeps walkable cursor; falls back toward origin when blocked', () => {
    const walkable = (x: number, z: number) => x * x + z * z <= 9;
    expect(clampFinisherTarget(1, 1, 0, 0, walkable)).toEqual([1, 1]);
    // Far blocked point → walk toward origin along the ray and stop at last walkable.
    const [cx, cz] = clampFinisherTarget(10, 0, 0, 0, walkable);
    expect(cx).toBeCloseTo(3, 1);
    expect(cz).toBeCloseTo(0, 5);
    expect(walkable(cx, cz)).toBe(true);
  });
});

describe('finisher sequencing — damage independent of hero shot (L5/T5 hook)', () => {
  test('commit locks input, fires hero-shot hook immediately, damage at fixed timestamp', () => {
    let heroShots = 0;
    let damageAt: number | null = null;
    let heroShotElapsed: number | null = null;
    const hooks = {
      onFinisherHeroShot(targetXZ: readonly [number, number]) {
        heroShots += 1;
        heroShotElapsed = 0;
        expect(targetXZ).toEqual([2, 3]);
      },
      onDamage(_targetXZ: readonly [number, number], elapsed: number) {
        damageAt = elapsed;
      },
    };

    let s = createFinisherState();
    expect(isFinisherInputLocked(s)).toBe(false);

    s = commitFinisher(s, [2, 3], hooks);
    expect(s.phase).toBe('windup');
    expect(isFinisherInputLocked(s)).toBe(true);
    expect(heroShots).toBe(1);
    expect(heroShotElapsed).toBe(0);
    expect(s.damageDealt).toBe(false);

    // Hero-shot presentation can "stall" — damage must still land at 0.4 s.
    s = tickFinisher(s, FINISHER_DAMAGE_AT_S - 0.05, hooks);
    expect(s.damageDealt).toBe(false);
    expect(damageAt).toBeNull();

    s = tickFinisher(s, 0.05, hooks);
    expect(s.damageDealt).toBe(true);
    expect(damageAt).toBeCloseTo(FINISHER_DAMAGE_AT_S, 5);
    expect(heroShots).toBe(1); // not re-fired

    // Still locked through remainder of windup (= damage time here), then aftermath.
    expect(s.phase).toBe('aftermath');
    expect(isFinisherInputLocked(s)).toBe(false);

    s = tickFinisher(s, FINISHER_AFTERMATH_S, hooks);
    expect(s.phase).toBe('idle');
    expect(s.damageDealt).toBe(false);
  });

  test('second commit while active is ignored', () => {
    let commits = 0;
    const hooks = {
      onFinisherHeroShot() {
        commits += 1;
      },
    };
    let s = commitFinisher(createFinisherState(), [0, 0], hooks);
    s = commitFinisher(s, [9, 9], hooks);
    expect(commits).toBe(1);
    expect(s.targetX).toBe(0);
    expect(s.targetZ).toBe(0);
  });

  test('damage still fires from aftermath if windup tick skipped the threshold', () => {
    // Simulates DAMAGE_AT ≥ WINDUP / missed windup check: commit clock must
    // survive the phase wrap (L5 fixed timestamp).
    let damageAt: number | null = null;
    const hooks = {
      onDamage(_xz: readonly [number, number], elapsed: number) {
        damageAt = elapsed;
      },
    };
    let s: ReturnType<typeof createFinisherState> = {
      phase: 'aftermath',
      elapsed: 0,
      targetX: 1,
      targetZ: 2,
      damageDealt: false,
    };
    s = tickFinisher(s, 0.01, hooks);
    expect(s.damageDealt).toBe(true);
    expect(damageAt).toBeCloseTo(FINISHER_DAMAGE_AT_S, 5);
    expect(s.phase).toBe('aftermath');
  });
});

describe('grantFinisherHotbar (T6 helper)', () => {
  test('places inferno-nova on slot 4 without clobbering filled earlier slots', () => {
    const next = grantFinisherHotbar(['frost', 'magma', null, null]);
    expect(next[FINISHER_HOTBAR_SLOT]).toBe('inferno-nova');
    expect(next[0]).toBe('frost');
    expect(next[1]).toBe('magma');
  });
});
