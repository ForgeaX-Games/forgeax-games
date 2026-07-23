// Dodge roll state machine + walkability stepper (PR2a L1–L4).
// Code-driven timing (not clip-driven). Engine-free; consumes a walkable probe.

export const DODGE_COOLDOWN_S = 2.5;
/** Playtest retune 2026-07-23: 3.5 m felt oversized vs hero scale → 2.0 m. */
export const DODGE_DISTANCE_M = 2.0;
export const DODGE_BUILDUP_S = 0.10;
export const DODGE_MOVEMENT_S = 0.30;
export const DODGE_RECOVER_S = 0.25;
export const DODGE_TOTAL_S = DODGE_BUILDUP_S + DODGE_MOVEMENT_S + DODGE_RECOVER_S;
/** Recover starts with cast/move cancel open (playtest: RMB after roll felt stuck). */
export const DODGE_RECOVER_CANCEL_AFTER_S = 0;
export const DODGE_STEP_M = 0.2;
export const DODGE_WALK_RADIUS = 0.35;

export type DodgePhase = 'idle' | 'buildup' | 'movement' | 'recover';

export type DodgeState = {
  phase: DodgePhase;
  /** Elapsed time inside the current phase. */
  phaseElapsed: number;
  /** Facing / roll direction (XZ), unit length when active. */
  dirX: number;
  dirZ: number;
  startX: number;
  startZ: number;
  /** Distance already traveled during movement. */
  traveled: number;
  /** Cooldown remaining after a completed or aborted roll (seconds). */
  cooldown: number;
};

export function createDodgeState(): DodgeState {
  return {
    phase: 'idle',
    phaseElapsed: 0,
    dirX: 0,
    dirZ: 1,
    startX: 0,
    startZ: 0,
    traveled: 0,
    cooldown: 0,
  };
}

export function isDodging(s: DodgeState): boolean {
  return s.phase !== 'idle';
}

/** L2: i-frames only during Movement. */
export function isDodgeInvulnerable(s: DodgeState): boolean {
  return s.phase === 'movement';
}

/** L3: skill cast / click-move allowed? */
export function dodgeAllowsSkillOrMove(s: DodgeState): boolean {
  if (s.phase === 'idle') return true;
  if (s.phase === 'buildup' || s.phase === 'movement') return false;
  return s.phaseElapsed >= DODGE_RECOVER_CANCEL_AFTER_S;
}

/**
 * L3: dodge owns XZ translation only in buildup+movement.
 * Recover (incl. pre-cancel) does not — late recover may loco after roll-cancel.
 */
export function dodgeLocksTranslation(s: DodgeState): boolean {
  return s.phase === 'buildup' || s.phase === 'movement';
}

/**
 * L3 roll-cancel: when recover cancel window is open, abort so cast/move
 * take ownership and cooldown arms. No-op otherwise.
 */
export function cancelDodgeForSkillOrMove(s: DodgeState): DodgeState {
  if (s.phase === 'recover' && dodgeAllowsSkillOrMove(s)) return abortDodge(s);
  return s;
}

/** L3: hit reaction aborts buildup/recover; movement is i-framed (no abort). */
export function dodgeHitReactionAborts(s: DodgeState): boolean {
  return s.phase === 'buildup' || s.phase === 'recover';
}

export type WalkableFn = (x: number, z: number, radius: number) => boolean;

/**
 * L4 stepper: advance along (dx,dz) by `step` meters with per-axis slide
 * and diagonal corner-cutting rule (need at least one orthogonal walkable).
 */
export function stepDodge(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  step: number,
  walkable: WalkableFn,
  radius: number = DODGE_WALK_RADIUS,
): { x: number; z: number; moved: boolean } {
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-8 || step <= 0) return { x, z, moved: false };
  const nx = dirX / len;
  const nz = dirZ / len;
  const tx = x + nx * step;
  const tz = z + nz * step;

  const diagOk = walkable(tx, tz, radius);
  const orthXOk = walkable(tx, z, radius);
  const orthZOk = walkable(x, tz, radius);

  if (Math.abs(nx) > 1e-8 && Math.abs(nz) > 1e-8) {
    if (diagOk && (orthXOk || orthZOk)) {
      return { x: tx, z: tz, moved: true };
    }
    if (orthXOk && !orthZOk) return { x: tx, z, moved: true };
    if (orthZOk && !orthXOk) return { x, z: tz, moved: true };
    if (orthXOk && orthZOk) {
      if (Math.abs(nx) >= Math.abs(nz)) return { x: tx, z, moved: true };
      return { x, z: tz, moved: true };
    }
    return { x, z, moved: false };
  }

  if (diagOk) return { x: tx, z: tz, moved: true };
  return { x, z, moved: false };
}

export type TryStartDodgeArgs = {
  state: DodgeState;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** Casting commit window blocks dodge start (L3). */
  castingLocked?: boolean;
};

export function tryStartDodge(args: TryStartDodgeArgs): DodgeState {
  const s = args.state;
  if (s.phase !== 'idle' || s.cooldown > 0 || args.castingLocked) return s;
  let dx = args.dirX;
  let dz = args.dirZ;
  const len = Math.hypot(dx, dz);
  if (len < 1e-8) {
    dx = s.dirX;
    dz = s.dirZ;
    const len2 = Math.hypot(dx, dz);
    if (len2 < 1e-8) {
      dx = 0;
      dz = 1;
    } else {
      dx /= len2;
      dz /= len2;
    }
  } else {
    dx /= len;
    dz /= len;
  }
  return {
    ...s,
    phase: 'buildup',
    phaseElapsed: 0,
    dirX: dx,
    dirZ: dz,
    startX: args.x,
    startZ: args.z,
    traveled: 0,
  };
}

export function abortDodge(s: DodgeState): DodgeState {
  if (s.phase === 'idle') return s;
  return {
    ...s,
    phase: 'idle',
    phaseElapsed: 0,
    traveled: 0,
    cooldown: DODGE_COOLDOWN_S,
  };
}

export type TickDodgeArgs = {
  state: DodgeState;
  dt: number;
  x: number;
  z: number;
  walkable: WalkableFn;
};

export type TickDodgeResult = {
  state: DodgeState;
  x: number;
  z: number;
};

function toIdle(s: DodgeState): DodgeState {
  return {
    ...s,
    phase: 'idle',
    phaseElapsed: 0,
    traveled: 0,
    cooldown: DODGE_COOLDOWN_S,
  };
}

/** Advance movement phase by `dt` seconds; may end early if blocked. */
function advanceMovement(
  s: DodgeState,
  dt: number,
  x: number,
  z: number,
  walkable: WalkableFn,
): { s: DodgeState; x: number; z: number; leftoverDt: number; blocked: boolean } {
  const speed = DODGE_DISTANCE_M / DODGE_MOVEMENT_S;
  let time = dt;
  let traveled = s.traveled;
  let blocked = false;

  while (time > 1e-8 && traveled < DODGE_DISTANCE_M - 1e-6) {
    const distLeft = DODGE_DISTANCE_M - traveled;
    const step = Math.min(DODGE_STEP_M, distLeft, speed * time);
    if (step <= 1e-8) break;
    const next = stepDodge(x, z, s.dirX, s.dirZ, step, walkable);
    if (!next.moved) {
      blocked = true;
      break;
    }
    const dist = Math.hypot(next.x - x, next.z - z);
    if (dist <= 1e-8) {
      blocked = true;
      break;
    }
    x = next.x;
    z = next.z;
    traveled += dist;
    time -= dist / speed;
  }

  const phaseElapsed = s.phaseElapsed + dt;
  if (blocked || traveled >= DODGE_DISTANCE_M - 1e-4) {
    // Enter recover; unused movement time does not carry (commitment ends).
    return {
      s: { ...s, phase: 'recover', phaseElapsed: 0, traveled },
      x,
      z,
      leftoverDt: 0,
      blocked,
    };
  }
  if (phaseElapsed >= DODGE_MOVEMENT_S) {
    return {
      s: { ...s, phase: 'recover', phaseElapsed: 0, traveled },
      x,
      z,
      leftoverDt: phaseElapsed - DODGE_MOVEMENT_S,
      blocked: false,
    };
  }
  return {
    s: { ...s, phase: 'movement', phaseElapsed, traveled },
    x,
    z,
    leftoverDt: 0,
    blocked: false,
  };
}

/**
 * Advance dodge phases. Movement steps along dir until distance budget
 * or a blocked step (short roll). Cooldown ticks while idle.
 */
export function tickDodge(args: TickDodgeArgs): TickDodgeResult {
  let s = args.state;
  let dt = Math.max(0, args.dt);
  let x = args.x;
  let z = args.z;

  if (s.phase === 'idle') {
    if (s.cooldown > 0) {
      return { state: { ...s, cooldown: Math.max(0, s.cooldown - dt) }, x, z };
    }
    return { state: s, x, z };
  }

  // Consume dt across phase transitions within one frame.
  while (dt > 1e-8 && s.phase !== 'idle') {
    if (s.phase === 'buildup') {
      const remain = DODGE_BUILDUP_S - s.phaseElapsed;
      if (dt < remain) {
        return {
          state: { ...s, phaseElapsed: s.phaseElapsed + dt },
          x,
          z,
        };
      }
      dt -= remain;
      s = { ...s, phase: 'movement', phaseElapsed: 0 };
      continue;
    }

    if (s.phase === 'movement') {
      const mov = advanceMovement(s, dt, x, z, args.walkable);
      s = mov.s;
      x = mov.x;
      z = mov.z;
      dt = mov.leftoverDt;
      continue;
    }

    if (s.phase === 'recover') {
      const remain = DODGE_RECOVER_S - s.phaseElapsed;
      if (dt < remain) {
        return {
          state: { ...s, phaseElapsed: s.phaseElapsed + dt },
          x,
          z,
        };
      }
      dt -= remain;
      s = toIdle(s);
      // leftover dt reduces cooldown
      if (dt > 0 && s.cooldown > 0) {
        s = { ...s, cooldown: Math.max(0, s.cooldown - dt) };
        dt = 0;
      }
      break;
    }
  }

  return { state: s, x, z };
}
