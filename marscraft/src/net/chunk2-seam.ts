/**
 * MarsCraft -> forgeax-engine — CHUNK 2 (NOW IMPLEMENTED)
 * =============================================================================
 * This file used to be a seam marking chunk 2 (the networking transport) as NOT
 * implemented. Chunk 2 IS implemented now — this is the pointer to it.
 *
 * The transport is a SEPARATE Bun process, not part of the client-only forgeax
 * preview host (there is nowhere in the preview to run a WS server). It builds
 * directly on chunk 1's transport-agnostic `TurnSync`:
 *
 *   - `../protocol.ts`            — the JSON wire messages (join / cmds / checksum /
 *                                   ping ↔ welcome / start / turn / rate / desync / pong).
 *   - `../rts-client.ts`          — `RtsClient`: wires a WebSocket to `TurnSync`
 *                                   (port of `web/network/RTSClient.ts`, lockstep path):
 *                                   send-ahead command batches + input-delay, and on
 *                                   `turn`(T) it `submitTurn`s every player then `step`s.
 *   - `./turn-collector.ts`       — `TurnCollector` (port of `server/TurnCollector.ts`):
 *                                   collects all players' commands for a turn, fires
 *                                   `onTurnReady`, auto-fills disconnected players.
 *   - `./room.ts`                 — `Room` (lockstep core of `server/RTSRoom.ts` +
 *                                   `ChecksumVerifier.ts`): broadcasts `turn_ready`,
 *                                   cross-checks reported checksums (desync detection).
 *   - `./index.ts`                — the Bun `Bun.serve` WS server (`createServer`) +
 *                                   CLI entry: `bun src/net/server/index.ts [port] [n]`.
 *   - `./lockstep-check.ts`       — the integration proof: a real 2-client match over
 *                                   real WebSockets, asserting checksum-lockstep + that
 *                                   the room detects an injected desync. Run:
 *                                   `bun src/net/server/lockstep-check.ts` (exit 0 = pass).
 *
 * `TurnSync` gained one option for this — `skipInputDelayPrelude` — so the networked
 * client only executes what the server broadcasts (the server owns the turn buffer),
 * while the local demo keeps its auto-empty prelude.
 */

export {};
