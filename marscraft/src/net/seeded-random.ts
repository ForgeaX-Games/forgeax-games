/**
 * MarsCraft -> forgeax-engine — deterministic RNG (Milestone M15 chunk 1)
 * =============================================================================
 * Port of the Three.js source `shared/sync/SeededRandom.ts` (VERBATIM logic).
 * This is the SSOT of ALL simulation randomness for lockstep determinism: every
 * sim system that needs "random" MUST funnel through `gameRandom*` so that two
 * peers replaying the same command stream from the same seed produce identical
 * state (verified by the per-turn checksum, see ./checksum-computer.ts).
 *
 * Two independent RNGs (faithful to the source):
 *   - gameRng   : affects GAME LOGIC — must be deterministic & identical on all
 *                 peers. Seeded from the shared game seed.
 *   - visualRng : affects VISUAL-ONLY effects (particle jitter etc.) — does NOT
 *                 affect sync, so it may be wall-clock seeded.
 *
 * ── Determinism guarantee ────────────────────────────────────────────────────
 * `initGameRng(seed)` is the ONE place the sim RNG is seeded. Re-seeding with the
 * same seed and issuing the same sequence of `gameRandom*` calls (which happens
 * iff the same command stream drives the sim) yields the identical number stream.
 * `getGameRngState()` + `getGameRngCallCount()` are folded into every checksum so
 * an RNG divergence surfaces immediately as a desync.
 */

// ---------------------------------------------------------------------------
// Seeded LCG (identical constants to the source & to mapgen's SeededRandom, so
// the number stream matches the Three.js reference bit-for-bit).
// ---------------------------------------------------------------------------

class SeededRandom {
  private s: number;
  private _callCount = 0;

  constructor(seed: number) {
    this.s = seed & 0x7fffffff;
    if (this.s === 0) this.s = 1;
  }

  next(): number {
    this.s = (this.s * 1103515245 + 12345) & 0x7fffffff;
    this._callCount++;
    return this.s / 0x7fffffff;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  nextRange(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  getState(): number { return this.s; }
  getCallCount(): number { return this._callCount; }
}

// ---------------------------------------------------------------------------
// Global singletons (the sim RNG SSOT)
// ---------------------------------------------------------------------------

let _gameRng: SeededRandom | null = null;
let _visualRng: SeededRandom | null = null;

/** The default seed used when nobody has called `initGameRng` yet. */
export const DEFAULT_GAME_SEED = 42;

/** Seed both RNGs from the shared game seed (call ONCE at game start). */
export function initGameRng(seed: number): void {
  _gameRng = new SeededRandom(seed);
  _visualRng = new SeededRandom((seed ^ 0x5a3c7e9b) >>> 0);
}

function ensureGameRng(): SeededRandom {
  if (!_gameRng) _gameRng = new SeededRandom(DEFAULT_GAME_SEED);
  return _gameRng;
}

/** True once `initGameRng` has been called (used to guard opt-in wiring). */
export function isGameRngInitialized(): boolean {
  return _gameRng !== null;
}

// ---------------------------------------------------------------------------
// Game-logic randomness (deterministic, affects sync — the SSOT)
// ---------------------------------------------------------------------------

export function gameRandom(): number { return ensureGameRng().next(); }
export function gameRandomInt(max: number): number { return ensureGameRng().nextInt(max); }
export function gameRandomRange(min: number, max: number): number { return ensureGameRng().nextRange(min, max); }
export function gameRandomFloat(min: number, max: number): number { return ensureGameRng().nextFloat(min, max); }
export function gameRandomShuffle<T>(arr: T[]): T[] { return ensureGameRng().shuffle(arr); }

// ---------------------------------------------------------------------------
// Visual-only randomness (NOT required to be deterministic)
// ---------------------------------------------------------------------------

export function visualRandom(): number {
  if (!_visualRng) _visualRng = new SeededRandom(Date.now());
  return _visualRng.next();
}

export function visualRandomFloat(min: number, max: number): number {
  if (!_visualRng) _visualRng = new SeededRandom(Date.now());
  return _visualRng.nextFloat(min, max);
}

// ---------------------------------------------------------------------------
// Debug / checksum introspection
// ---------------------------------------------------------------------------

export function getGameRngState(): number { return ensureGameRng().getState(); }
export function getGameRngCallCount(): number { return ensureGameRng().getCallCount(); }
