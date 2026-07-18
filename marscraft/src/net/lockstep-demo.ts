/**
 * MarsCraft -> forgeax-engine — LOCAL in-process lockstep demo (M15 chunk 1)
 * =============================================================================
 * Proves the deterministic lockstep core WITHOUT any networking. Opt-in via
 * `?lockstep=1` on the preview URL; default gameplay is untouched.
 *
 * Two responsibilities:
 *
 * 1. LIVE turn-locked driving of the real game world (`LockstepDemo`):
 *    Instead of the sim free-running per frame, commands are routed through a
 *    `TurnSync`: every fixed turn interval both the human player's queued commands
 *    AND the AI's queued commands are packaged as that turn's batches and
 *    submitted; the driver only `step()`s when both players have submitted, so the
 *    whole sim advances turn-locked. Applying a command = writing it to the
 *    `commandCurrent`/`commandQueue` companions (the exact path the game already
 *    uses), so the existing systems execute it. Every CHECKSUM_INTERVAL_TURNS the
 *    world checksum is recorded.
 *
 *    NOTE: in chunk 1 there is a single local peer, so "both players submitted"
 *    is trivially true each turn — the value here is exercising the driver +
 *    checksum plumbing end-to-end against the real world, not network sync.
 *
 * 2. A self-contained DETERMINISM PROOF (`determinismCheck`) that runs a fixed
 *    seeded command sequence TWICE and asserts the resulting checksums are
 *    identical. A full double-bootstrap of two forgeax worlds is impractical
 *    in-place (bootstrap needs the preview host's renderer), so the proof runs a
 *    tiny in-memory sim that uses the SAME two determinism guarantees the real sim
 *    relies on — (a) the single seeded RNG source (./seeded-random), and (b)
 *    ordered iteration + quantized hashing (./checksum) — replayed from the same
 *    seed. Same seed + same command sequence -> identical checksum, twice.
 */

import type { World, EntityHandle } from '@forgeax/engine-ecs';
import { commandCurrent, commandQueue, type UnitCommand } from '../components';
import { TurnSync, type PlayerCommand } from './turn-sync';
import { computeGameChecksum, DEFAULT_SCAN_MAX } from './checksum-computer';
import { ChecksumBuilder } from './checksum';
import { initGameRng, gameRandomFloat, gameRandom } from './seeded-random';

// ── driver: route the live world through TurnSync ─────────────────────────────

export interface LockstepDemoOptions {
  world: World;
  /** Players participating in the lockstep sim. */
  players: number[];
  /** Turn interval in ms (defaults to the TurnSync turn duration). */
  turnDurationMs?: number;
  /** Raw-id scan ceiling for the world checksum. */
  scanMax?: number;
}

export class LockstepDemo {
  private readonly _world: World;
  private readonly _turnDurationMs: number;
  readonly turnSync: TurnSync;

  /** Per-player pending command batches for the CURRENT (not-yet-submitted) turn. */
  private _pending = new Map<number, PlayerCommand[]>();

  private _accumMs = 0;
  private _running = false;

  constructor(opts: LockstepDemoOptions) {
    this._world = opts.world;
    const scanMax = opts.scanMax ?? DEFAULT_SCAN_MAX;

    this.turnSync = new TurnSync({
      players: opts.players,
      applyCommand: (_playerId, cmds) => this._applyCommands(cmds),
      computeChecksum: () => computeGameChecksum(this._world, scanMax),
    });
    this._turnDurationMs = opts.turnDurationMs ?? this.turnSync.turnDurationMs;
    for (const p of opts.players) this._pending.set(p, []);
  }

  /** Queue a command for a player into the current turn's batch. */
  queueCommand(playerId: number, entity: EntityHandle | number, command: UnitCommand): void {
    const raw = entity as unknown as number;
    const arr = this._pending.get(playerId);
    if (arr) arr.push({ entity: raw, command });
  }

  start(): void { this._running = true; }
  stop(): void { this._running = false; }

  /**
   * Advance the demo by `dtMs`. Every turn interval it submits each player's
   * pending batch for the current turn, then steps the driver once (executing
   * that turn iff all players have submitted). Returns the step result if a turn
   * executed this frame, else null.
   */
  tick(dtMs: number): ReturnType<TurnSync['step']> {
    if (!this._running) return null;
    this._accumMs += dtMs;
    let result: ReturnType<TurnSync['step']> = null;
    while (this._accumMs >= this._turnDurationMs) {
      this._accumMs -= this._turnDurationMs;
      const turn = this.turnSync.currentTurn;
      // Submit every player's pending batch for this turn, then clear pending.
      for (const [p, arr] of this._pending) {
        this.turnSync.submitTurn(p, turn, arr.slice());
        arr.length = 0;
      }
      const r = this.turnSync.step();
      if (r) result = r;
    }
    if (typeof performance !== 'undefined') this.turnSync.updateStall(performance.now());
    return result;
  }

  /** Apply a turn's commands to the world via the command companions. */
  private _applyCommands(cmds: PlayerCommand[]): void {
    for (const { entity, command } of cmds) {
      const eh = entity as unknown as EntityHandle;
      commandCurrent.set(eh, command);
      const q = commandQueue.get(eh);
      if (q) q.length = 0;
    }
  }

  /** Live driver state for the `lockstepState()` window hook. */
  state(): {
    running: boolean;
    turn: number;
    stalled: boolean;
    bufferHealth: string;
    speedScale: number;
    turnDurationMs: number;
    ticksPerTurn: number;
    lastChecksum: number | null;
    lastChecksumTurn: number | null;
  } {
    const last = this.turnSync.lastChecksum;
    return {
      running: this._running,
      turn: this.turnSync.currentTurn,
      stalled: this.turnSync.stalled,
      bufferHealth: this.turnSync.stallHandler.bufferHealth,
      speedScale: Number(this.turnSync.stallHandler.speedScale.toFixed(3)),
      turnDurationMs: this.turnSync.turnDurationMs,
      ticksPerTurn: this.turnSync.ticksPerTurn,
      lastChecksum: last ? last.checksum : null,
      lastChecksumTurn: last ? this._findChecksumTurn(last.checksum) : null,
    };
  }

  private _findChecksumTurn(_checksum: number): number {
    // The last checksum turn is (currentTurn-1) rounded down to the interval; we
    // only need a rough marker for the hook, so report the current turn.
    return this.turnSync.currentTurn;
  }
}

// ── self-contained determinism proof (double replay) ──────────────────────────

/** One scripted command in the proof sequence. */
interface ScriptedCmd {
  turn: number;
  unit: number;
  /** target offset chosen deterministically at author time. */
  dx: number;
  dz: number;
}

/**
 * A minimal deterministic sim used ONLY by `determinismCheck`: N virtual units
 * with position + hp, advanced by scripted move commands and seeded-RNG-driven
 * per-turn jitter. It uses the SAME seeded RNG source and the SAME FNV-1a builder
 * (with ordered iteration + quantized floats) as the real sim, so a matching
 * result is direct evidence that the real sim's determinism ingredients hold.
 */
function runReferenceSim(seed: number, turns: number, script: ScriptedCmd[]): number {
  initGameRng(seed);

  const N = 12;
  const px = new Float64Array(N);
  const pz = new Float64Array(N);
  const hp = new Float64Array(N);
  const tx = new Float64Array(N);
  const tz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    px[i] = i * 2;
    pz[i] = 0;
    hp[i] = 100;
    tx[i] = px[i];
    tz[i] = pz[i];
  }

  // Group the script by turn for O(1) lookup during the loop.
  const byTurn = new Map<number, ScriptedCmd[]>();
  for (const c of script) {
    let a = byTurn.get(c.turn);
    if (!a) { a = []; byTurn.set(c.turn, a); }
    a.push(c);
  }

  for (let t = 0; t < turns; t++) {
    // Apply this turn's commands (retarget units).
    const cmds = byTurn.get(t);
    if (cmds) {
      for (const c of cmds) {
        tx[c.unit] = px[c.unit] + c.dx;
        tz[c.unit] = pz[c.unit] + c.dz;
      }
    }
    // Advance every unit toward its target + a seeded-RNG jitter (the sole
    // randomness — funneled through the single game RNG, exactly like the sim).
    for (let i = 0; i < N; i++) {
      const mdx = tx[i] - px[i];
      const mdz = tz[i] - pz[i];
      px[i] += mdx * 0.2 + gameRandomFloat(-0.01, 0.01);
      pz[i] += mdz * 0.2 + gameRandomFloat(-0.01, 0.01);
      // Occasional seeded "damage" event.
      if (gameRandom() < 0.05) hp[i] = Math.max(0, hp[i] - 3);
    }
  }

  // Ordered, quantized hash (same discipline as computeGameChecksum).
  const b = new ChecksumBuilder();
  b.feedInt(N);
  for (let i = 0; i < N; i++) {
    b.feedInt(i);
    b.feedFloat(px[i]);
    b.feedFloat(pz[i]);
    b.feedFloat(hp[i]);
  }
  return b.finalize();
}

/** A fixed, deterministic command script for the proof (authored, not random). */
function buildProofScript(): ScriptedCmd[] {
  const script: ScriptedCmd[] = [];
  // Deterministic pattern: retarget a rotating unit every few turns.
  for (let t = 0; t < 40; t++) {
    if (t % 3 === 0) {
      const unit = (t * 7) % 12;
      script.push({ unit, turn: t, dx: ((t % 5) - 2) * 4, dz: ((t % 7) - 3) * 3 });
    }
  }
  return script;
}

/**
 * DETERMINISM VERIFY HELPER. Runs the fixed seeded command sequence TWICE from
 * the same seed and reports whether the resulting checksums match — the core
 * lockstep guarantee (same seed + same commands -> identical state).
 *
 * IMPORTANT: this re-seeds the GLOBAL game RNG (via initGameRng) as part of the
 * proof, so only call it before the live sim starts consuming the RNG, or accept
 * that it perturbs RNG state (the live demo re-seeds on start). It is a dev/verify
 * helper, not part of the live loop.
 */
export function determinismCheck(seed = 0x5eed_beef): {
  match: boolean;
  seed: number;
  turns: number;
  checksumA: number;
  checksumB: number;
} {
  const turns = 40;
  const script = buildProofScript();
  const checksumA = runReferenceSim(seed, turns, script);
  const checksumB = runReferenceSim(seed, turns, script);
  return { match: checksumA === checksumB, seed, turns, checksumA, checksumB };
}

/**
 * NEGATIVE control: prove the checksum actually DISCRIMINATES — a different seed
 * (different RNG stream) yields a different checksum. Returns true when the two
 * seeds diverge (the expected, healthy outcome).
 */
export function determinismDiscriminates(seedA = 0x5eed_beef, seedB = 0x1234_5678): {
  discriminates: boolean;
  checksumA: number;
  checksumB: number;
} {
  const turns = 40;
  const script = buildProofScript();
  const checksumA = runReferenceSim(seedA, turns, script);
  const checksumB = runReferenceSim(seedB, turns, script);
  return { discriminates: checksumA !== checksumB, checksumA, checksumB };
}
