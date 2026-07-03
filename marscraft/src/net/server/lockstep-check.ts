/**
 * MarsCraft -> forgeax-engine — M15 chunk 2: 2-client lockstep integration check
 * =============================================================================
 * The REAL proof of chunk 2: it stands up the authoritative Bun server, connects
 * TWO clients over real WebSockets, and drives a live match. Each client runs an
 * independent deterministic model behind its own `TurnSync` (skipInputDelayPrelude,
 * so it only executes what the server broadcasts) + `RtsClient` transport. Each
 * player sends its OWN per-turn commands; the server merges + broadcasts; both
 * clients apply BOTH players' commands in sorted order.
 *
 * If the transport keeps them in lockstep, the two independent models evolve
 * identically → their per-turn checksums MATCH at every checkpoint and the room
 * detects zero desyncs. That is exactly what this asserts.
 *
 * Run (Bun): `bun src/net/server/lockstep-check.ts`  →  exits 0 on success, 1 on fail.
 * The game's e2e (Playwright, preview) cannot cover this — a WS server + 2 clients
 * live outside the single-client preview host; this Bun harness is the right gate.
 */

import { ChecksumBuilder, type ChecksumResult, CHECKSUM_INTERVAL_TURNS } from '../checksum';
import { TurnSync, type PlayerCommand } from '../turn-sync';
import type { UnitCommand } from '../../components';
import { RtsClient } from '../rts-client';
import type { ServerMessage, SocketLike } from '../protocol';
import { createServer } from './index';
import { Room } from './room';

const SEED = 1234;
const TARGET_TURN = 60;
const PLAYERS = [0, 1];

/** A tiny deterministic "world": an accumulator advanced by commands + a seeded RNG
 * (inline mulberry32 so the harness stays self-contained; both clients seed alike). */
function makeModel() {
  let s = SEED >>> 0;
  let calls = 0;
  const nextInt = (max: number): number => {
    calls++;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % max);
  };
  let acc = 0;
  return {
    apply(playerId: number, cmds: PlayerCommand[]): void {
      for (const c of cmds) acc = (Math.imul(acc, 31) + playerId * 7 + (c.entity | 0) + nextInt(1000)) | 0;
    },
    checksum(): ChecksumResult {
      const b = new ChecksumBuilder();
      b.feedInt(acc).feedInt(s | 0);
      return { checksum: b.finalize(), entityCount: 1, rngState: s >>> 0, rngCallCount: calls };
    },
  };
}

/** Deterministic per-(player,turn) command batch (each peer knows only its own). */
function localCommands(playerId: number, turn: number): PlayerCommand[] {
  // player 0 acts on even turns, player 1 on odd — a genuinely different stream each.
  if (turn % 2 !== playerId) return [];
  return [{ entity: playerId * 1000 + turn, command: { type: 'stop' } as unknown as UnitCommand }];
}

/** Negative check (no sockets): the room must DETECT a checksum divergence. Feeds two
 *  players who report DIFFERENT hashes for the same turn and asserts a `desync`. */
function checkDesyncDetection(): string[] {
  const fails: string[] = [];
  const sent: ServerMessage[] = [];
  const room = new Room(2, (_pid, msg) => sent.push(msg));
  room.handle(0, { t: 'join', playerId: 0 });
  room.handle(1, { t: 'join', playerId: 1 });
  room.handle(0, { t: 'checksum', playerId: 0, turn: 0, hash: 'AAAA' });
  room.handle(1, { t: 'checksum', playerId: 1, turn: 0, hash: 'BBBB' }); // divergent
  const desync = sent.find((m) => m.t === 'desync');
  if (!desync) fails.push('room did not emit a desync for divergent checksums');
  if (room.desyncCount !== 1) fails.push(`expected desyncCount 1, got ${room.desyncCount}`);
  // and it must NOT flag matching checksums as a desync.
  room.handle(0, { t: 'checksum', playerId: 0, turn: 10, hash: 'SAME' });
  room.handle(1, { t: 'checksum', playerId: 1, turn: 10, hash: 'SAME' });
  if (room.desyncCount !== 1) fails.push('room false-flagged matching checksums as a desync');
  return fails;
}

interface ClientRig { client: RtsClient; checksums: Map<number, number>; }

function makeClient(port: number, playerId: number, onStep: (playerId: number, turn: number) => void): ClientRig {
  const model = makeModel();
  const checksums = new Map<number, number>();
  const turnSync = new TurnSync({
    players: PLAYERS,
    applyCommand: (pid, cmds) => model.apply(pid, cmds),
    computeChecksum: () => model.checksum(),
    skipInputDelayPrelude: true, // networked: the server owns the turn buffer
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socket = new (globalThis as any).WebSocket(`ws://localhost:${port}`) as SocketLike;
  const client = new RtsClient({
    socket,
    localPlayerId: playerId,
    turnSync,
    getLocalCommands: (turn) => localCommands(playerId, turn),
    // cap the send pipeline at the target so the match drains to a clean halt.
    shouldSend: (turn) => turn <= TARGET_TURN,
    onTurnStep: (turn) => {
      if (turn % CHECKSUM_INTERVAL_TURNS === 0 && turnSync.lastChecksum) checksums.set(turn, turnSync.lastChecksum.checksum);
      onStep(playerId, turn);
    },
  });
  return { client, checksums };
}

async function main(): Promise<number> {
  const server = createServer(0, 2); // port 0 → OS-assigned; read back server.port
  const port = server.port;
  // eslint-disable-next-line no-console
  console.log(`[lockstep-check] server on ws://localhost:${port}`);

  const reached = new Set<number>();
  let resolveDone: () => void;
  const done = new Promise<void>((res) => { resolveDone = res; });
  const onStep = (playerId: number, turn: number): void => {
    if (turn >= TARGET_TURN) { reached.add(playerId); if (reached.size === PLAYERS.length) resolveDone(); }
  };

  const a = makeClient(port, 0, onStep);
  const b = makeClient(port, 1, onStep);

  // resolve when both reach the target; a timeout guards a stalled transport.
  const timeout = new Promise<void>((res) => setTimeout(res, 10000));
  await Promise.race([done, timeout]);
  // `done` resolves INSIDE a WS message microtask; yield to a fresh macrotask before
  // tearing sockets/server down (closing them re-entrantly from a message handler
  // deadlocks Bun). The capped send pipeline has gone idle, so this timer fires.
  await new Promise<void>((res) => setTimeout(res, 100));
  console.log(`[lockstep-check] pump done — A=${a.client.currentTurn} B=${b.client.currentTurn}`);

  // ── assertions ──
  const fails: string[] = [];
  // (0) negative: the room's checksum cross-check actually catches divergence.
  fails.push(...checkDesyncDetection());
  if (a.client.currentTurn < TARGET_TURN || b.client.currentTurn < TARGET_TURN) {
    fails.push(`did not reach turn ${TARGET_TURN}: A=${a.client.currentTurn} B=${b.client.currentTurn}`);
  }
  let compared = 0;
  for (const [turn, ha] of a.checksums) {
    const hb = b.checksums.get(turn);
    if (hb === undefined) continue;
    compared++;
    if (ha !== hb) fails.push(`checksum mismatch @turn ${turn}: A=${ha} B=${hb}`);
  }
  if (compared === 0) fails.push('no overlapping checksum checkpoints were compared');
  if (server.room.desyncCount > 0) fails.push(`room reported ${server.room.desyncCount} desync(s)`);

  // NB: no graceful socket/server teardown here — `process.exit` (below) reclaims the
  // sockets + listener. Calling `server.stop(true)` under Bun with live WS peers could
  // block; a short-lived check process doesn't need the clean shutdown.

  if (fails.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[lockstep-check] ✅ PASS — 2 clients locked in step through turn ${a.client.currentTurn}; ${compared} checksum checkpoints matched; 0 desyncs`);
    return 0;
  }
  // eslint-disable-next-line no-console
  console.error(`[lockstep-check] ❌ FAIL\n  - ${fails.join('\n  - ')}`);
  return 1;
}

main().then((code) => {
  (globalThis as { process?: { exit: (c: number) => void } }).process?.exit(code);
}).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[lockstep-check] ❌ harness error:', err);
  (globalThis as { process?: { exit: (c: number) => void } }).process?.exit(1);
});
