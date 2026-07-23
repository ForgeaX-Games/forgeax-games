// Inferno Nova (狱火新星) — PR2a L5 finisher sequencer.
// Pure gameplay authority: preview clamp + commit windup + fixed damage time.
// Hero Shot is a presentation hook (T5); damage never waits on it.

import type { ActiveSkillId, HotbarSlots } from './content-ids';

export const FINISHER_ID = 'inferno-nova' as const satisfies ActiveSkillId;
export const FINISHER_UNLOCK_LEVEL = 3;
/** Hotbar slot 4 → index 3 when granted (L5/L8). */
export const FINISHER_HOTBAR_SLOT = 3 as const;
export const FINISHER_RADIUS_M = 4;
export const FINISHER_WINDUP_S = 0.4;
/** Damage lands at this elapsed time from commit — independent of Hero Shot. */
export const FINISHER_DAMAGE_AT_S = 0.4;
export const FINISHER_AFTERMATH_S = 1.0;

export type FinisherPhase = 'idle' | 'windup' | 'aftermath';

export type FinisherState = {
  phase: FinisherPhase;
  /** Elapsed seconds inside the current phase (from commit for windup). */
  elapsed: number;
  targetX: number;
  targetZ: number;
  damageDealt: boolean;
};

export type FinisherHooks = {
  /** T5 fills this — presentation only; must not gate damage. */
  onFinisherHeroShot?(targetXZ: readonly [number, number]): void;
  onDamage?(targetXZ: readonly [number, number], elapsedFromCommit: number): void;
};

export type WalkableFn = (x: number, z: number) => boolean;

export function createFinisherState(): FinisherState {
  return {
    phase: 'idle',
    elapsed: 0,
    targetX: 0,
    targetZ: 0,
    damageDealt: false,
  };
}

/** Input-locked only during windup (L5 commit window). */
export function isFinisherInputLocked(s: FinisherState): boolean {
  return s.phase === 'windup';
}

/**
 * Clamp a ground cursor to walkable space. Steps from origin toward the
 * cursor and keeps the last walkable sample (same spirit as blink).
 */
export function clampFinisherTarget(
  cursorX: number,
  cursorZ: number,
  originX: number,
  originZ: number,
  walkable: WalkableFn,
): readonly [number, number] {
  if (walkable(cursorX, cursorZ)) return [cursorX, cursorZ];
  const dx = cursorX - originX;
  const dz = cursorZ - originZ;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) {
    return walkable(originX, originZ) ? [originX, originZ] : [cursorX, cursorZ];
  }
  const ux = dx / dist;
  const uz = dz / dist;
  let bx = originX;
  let bz = originZ;
  const step = 0.25;
  for (let d = step; d <= dist + 1e-6; d += step) {
    const nx = originX + ux * Math.min(d, dist);
    const nz = originZ + uz * Math.min(d, dist);
    if (!walkable(nx, nz)) break;
    bx = nx;
    bz = nz;
  }
  return [bx, bz];
}

export function commitFinisher(
  state: FinisherState,
  targetXZ: readonly [number, number],
  hooks: FinisherHooks = {},
): FinisherState {
  if (state.phase !== 'idle') return state;
  const next: FinisherState = {
    phase: 'windup',
    elapsed: 0,
    targetX: targetXZ[0],
    targetZ: targetXZ[1],
    damageDealt: false,
  };
  hooks.onFinisherHeroShot?.([next.targetX, next.targetZ]);
  return next;
}

/** Commit-relative clock — survives windup→aftermath phase wrap (L5). */
function commitElapsed(phase: FinisherPhase, phaseElapsed: number): number {
  if (phase === 'windup') return phaseElapsed;
  if (phase === 'aftermath') return FINISHER_WINDUP_S + phaseElapsed;
  return 0;
}

export function tickFinisher(
  state: FinisherState,
  dt: number,
  hooks: FinisherHooks = {},
): FinisherState {
  if (state.phase === 'idle' || dt <= 0) return state;
  let elapsed = state.elapsed + dt;
  let phase = state.phase;
  let damageDealt = state.damageDealt;

  if (phase === 'windup' && elapsed >= FINISHER_WINDUP_S) {
    phase = 'aftermath';
    elapsed -= FINISHER_WINDUP_S;
  }

  // Damage at a fixed commit-relative timestamp — never gated on Hero Shot /
  // phase-local elapsed after the windup wrap (L5).
  if (!damageDealt && commitElapsed(phase, elapsed) >= FINISHER_DAMAGE_AT_S) {
    damageDealt = true;
    hooks.onDamage?.([state.targetX, state.targetZ], FINISHER_DAMAGE_AT_S);
  }

  if (phase === 'aftermath' && elapsed >= FINISHER_AFTERMATH_S) {
    return createFinisherState();
  }

  return {
    phase,
    elapsed,
    targetX: state.targetX,
    targetZ: state.targetZ,
    damageDealt,
  };
}

/** T6: place finisher on hotbar slot 4 (index 3); leave other slots intact. */
export function grantFinisherHotbar(hotbar: HotbarSlots): HotbarSlots {
  const next = [...hotbar] as [
    ActiveSkillId | null,
    ActiveSkillId | null,
    ActiveSkillId | null,
    ActiveSkillId | null,
  ];
  next[FINISHER_HOTBAR_SLOT] = FINISHER_ID;
  return next as unknown as HotbarSlots;
}
