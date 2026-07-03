/**
 * MarsCraft -> forgeax-engine — M15 chunk 2: Bun authoritative WS server
 * =============================================================================
 * The standalone lockstep server (port of `server/index.ts` + `server/websocket.ts`,
 * lockstep core only). It is NOT part of the forgeax preview (the preview host is a
 * single client with no place to run a server) — it's a separate Bun process:
 *
 *     bun src/net/server/index.ts [port=8787] [expectedPlayers=2]
 *
 * One `Room` per server instance (sufficient to prove lockstep; the source's
 * multi-room matchmaker in `server/rooms.ts` is a separate concern). Wires each
 * ServerWebSocket ↔ its numeric player id and pumps decoded messages into the room;
 * the room broadcasts via `ws.send`.
 *
 * ⚠️ Runs under Bun only (uses `Bun.serve`). It is never imported by `main.ts`, so
 * the vite/esbuild preview build never sees it. `Bun` is typed loosely to avoid a
 * build-time dependency on Bun's ambient types in the game package.
 */

import { Room } from './room';
import { decodeClient, encode } from '../protocol';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerWS = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Bun: any;

export interface LockstepServer {
  port: number;
  room: Room;
  stop(): void;
}

/** Start a lockstep WS server. Returns a handle (used by the test harness too). */
export function createServer(port = 8787, expectedPlayers = 2): LockstepServer {
  const pidToWs = new Map<number, ServerWS>();
  const room = new Room(expectedPlayers, (pid, msg) => {
    const ws = pidToWs.get(pid);
    if (ws) { try { ws.send(encode(msg)); } catch { /* peer gone */ } }
  });

  const server = Bun.serve({
    port,
    fetch(req: Request, srv: { upgrade: (r: Request, o?: unknown) => boolean }) {
      if (srv.upgrade(req, { data: { pid: -1 } })) return undefined;
      return new Response('marscraft lockstep server');
    },
    websocket: {
      message(ws: ServerWS, data: string | Uint8Array) {
        const msg = decodeClient(typeof data === 'string' ? data : new TextDecoder().decode(data));
        if (!msg) return;
        if (msg.t === 'join') { ws.data.pid = msg.playerId; pidToWs.set(msg.playerId, ws); }
        room.handle(ws.data.pid as number, msg);
      },
      close(ws: ServerWS) {
        const pid = ws.data?.pid as number | undefined;
        if (pid !== undefined && pid >= 0) { room.removePlayer(pid); pidToWs.delete(pid); }
      },
    },
  });

  return { port: server.port as number, room, stop: () => { room.stop(); server.stop(true); } };
}

// CLI entry (Bun): `bun src/net/server/index.ts [port] [expectedPlayers]`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((import.meta as any).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
  const port = Number(argv[2] ?? 8787) || 8787;
  const expected = Number(argv[3] ?? 2) || 2;
  const s = createServer(port, expected);
  // eslint-disable-next-line no-console
  console.log(`[marscraft] lockstep server on ws://localhost:${s.port} (waiting for ${expected} players)`);
}
