export type V3 = readonly [number, number, number];

export type ExodusState = 'idle' | 'warning' | 'active' | 'passed';

export interface Exodus {
  readonly state: ExodusState;
  readonly gateDir: readonly number[] | null;
  readonly foodFade: number;
  readonly sinceActive: number;
  /** Seconds/progress since the warning began; the eclipse spans warning + escape. */
  readonly sinceTrigger: number;
  readonly eclipse: number;
  readonly startAngle: number;
  readonly drainScale: number;
  trigger(pick: () => readonly number[], startDir?: readonly number[]): void;
  update(dt: number): 'spawned' | null;
  /** drain (length/sec) and speed multiplier at a direction. idle → [0, 1]. */
  fieldAt(dir: readonly number[]): [number, number];
  markPassed(): void;
  reset(): void;
}

export const EXODUS_WARN_S = 3.2;
export const EXODUS_BASE_DRAIN = 0.45;
/** The eclipse begins with the warning and reaches totality during the run. */
export const EXODUS_ECLIPSE_S = 13;
/** The old random gate was tuned around a two-radian journey. */
export const EXODUS_REFERENCE_ANG = 2;
/** Prevent a gate almost underfoot from turning one frame into a lethal spike. */
export const EXODUS_DRAIN_SCALE_MAX = 3;
export const EXODUS_FIELD_ANG = 0.62;
export const EXODUS_GATE_DRAIN_X = 3.0;
export const EXODUS_SLOW_MAX = 0.45;
export const EXODUS_FOOD_FADE_S = 9;
export const EXODUS_ENTER_ANG = 1.9 / 52;
export const EXODUS_MIN_LEN = 3;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function createExodus(planetRadius: number): Exodus {
  if (!Number.isFinite(planetRadius) || planetRadius <= 0) {
    throw new Error('planetRadius must be positive');
  }

  let state: ExodusState = 'idle';
  let gateDir: readonly number[] | null = null;
  let warningTime = 0;
  let sinceActive = 0;
  let sinceTrigger = 0;
  let foodFade = 1;
  let startAngle = EXODUS_REFERENCE_ANG;
  let drainScale = 1;

  return {
    get state() { return state; },
    get gateDir() { return gateDir; },
    get foodFade() { return foodFade; },
    get sinceActive() { return sinceActive; },
    get sinceTrigger() { return sinceTrigger; },
    get eclipse() { return clamp01(sinceTrigger / EXODUS_ECLIPSE_S); },
    get startAngle() { return startAngle; },
    get drainScale() { return drainScale; },

    trigger(pick, startDir) {
      if (state !== 'idle') return;
      gateDir = pick();
      warningTime = 0;
      sinceTrigger = 0;
      if (startDir) {
        const d =
          (startDir[0] ?? 0) * (gateDir[0] ?? 0) +
          (startDir[1] ?? 0) * (gateDir[1] ?? 0) +
          (startDir[2] ?? 0) * (gateDir[2] ?? 0);
        startAngle = Math.acos(Math.max(-1, Math.min(1, d)));
        drainScale = Math.min(
          EXODUS_DRAIN_SCALE_MAX,
          EXODUS_REFERENCE_ANG / Math.max(startAngle, EXODUS_REFERENCE_ANG / EXODUS_DRAIN_SCALE_MAX),
        );
      } else {
        startAngle = EXODUS_REFERENCE_ANG;
        drainScale = 1;
      }
      state = 'warning';
    },

    update(dt) {
      const step = Math.max(0, dt);
      if (state === 'warning' || state === 'active') sinceTrigger += step;
      if (state === 'warning') {
        warningTime += step;
        if (warningTime >= EXODUS_WARN_S) {
          state = 'active';
          sinceActive = 0;
          return 'spawned';
        }
      } else if (state === 'active') {
        sinceActive += step;
        foodFade = Math.max(0, 1 - sinceActive / EXODUS_FOOD_FADE_S);
      }
      return null;
    },

    fieldAt(dir) {
      if (state !== 'active' || !gateDir) return [0, 1];
      const d =
        (dir[0] ?? 0) * (gateDir[0] ?? 0) +
        (dir[1] ?? 0) * (gateDir[1] ?? 0) +
        (dir[2] ?? 0) * (gateDir[2] ?? 0);
      const ang = Math.acos(Math.max(-1, Math.min(1, d)));
      const x = clamp01(1 - ang / EXODUS_FIELD_ANG);
      const f = x * x * (3 - 2 * x);
      // The gate taxes the final approach: slower movement and faster dissolution.
      return [
        EXODUS_BASE_DRAIN * drainScale * (1 + EXODUS_GATE_DRAIN_X * f),
        1 - EXODUS_SLOW_MAX * f,
      ];
    },

    markPassed() {
      if (state === 'active') state = 'passed';
    },

    reset() {
      state = 'idle';
      gateDir = null;
      warningTime = 0;
      sinceActive = 0;
      sinceTrigger = 0;
      foodFade = 1;
      startAngle = EXODUS_REFERENCE_ANG;
      drainScale = 1;
    },
  };
}
