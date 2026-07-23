import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { CELLS, DUNGEON_SEED, mulberry32 } from './dungeon-layout';
import { GRAPH_STREAM_SALT, generateDungeonGraph } from './dungeon-graph';
import { MODULE_STREAM_SALT, selectModules } from './dungeon-modules';
import { astarGrid } from './navigation';
import {
  CORRIDOR_WIDTH,
  CORRIDOR_STREAM_SALT,
  ROOM_PAD,
  blockersFromWalk,
  buildCorridorNav,
  doorCell,
  edgeTravelDir,
  orientedSize,
  type CorridorNavResult,
  type PlacedRoom,
} from './dungeon-corridors';

function build(seed = DUNGEON_SEED): CorridorNavResult {
  const g = generateDungeonGraph(seed);
  const placements = selectModules(g, seed);
  return buildCorridorNav(g, placements, seed);
}

function walkAt(walk: ArrayLike<number>, cx: number, cy: number): boolean {
  return walk[cy * CELLS + cx] === 1;
}

function roomsOverlap(a: PlacedRoom, b: PlacedRoom, pad: number): boolean {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function socketOutsideCells(
  room: PlacedRoom,
  socket: { dir: 'N' | 'E' | 'S' | 'W'; offset: number },
): string[] {
  const door = doorCell(room, socket);
  const cells: string[] = [];
  for (let offset = 0; offset < CORRIDOR_WIDTH; offset++) {
    if (socket.dir === 'N' || socket.dir === 'S') {
      cells.push(
        cellKey(door.cx + offset, door.cy + (socket.dir === 'N' ? -1 : 1)),
      );
    } else {
      cells.push(
        cellKey(door.cx + (socket.dir === 'W' ? -1 : 1), door.cy + offset),
      );
    }
  }
  return cells;
}

function fingerprint(nav: CorridorNavResult): string {
  const walkHex = Buffer.from(nav.walk).toString('hex');
  return JSON.stringify({
    seed: nav.seed,
    rooms: nav.rooms,
    entryCell: nav.entryCell,
    bossCell: nav.bossCell,
    blockers: nav.blockers,
    walkHex,
  });
}

describe('orientedSize / doorCell / edgeTravelDir', () => {
  test('orientedSize swaps on odd quarter turns', () => {
    expect(orientedSize({ w: 5, h: 7 }, 0)).toEqual({ w: 5, h: 7 });
    expect(orientedSize({ w: 5, h: 7 }, 1)).toEqual({ w: 7, h: 5 });
    expect(orientedSize({ w: 5, h: 7 }, 2)).toEqual({ w: 5, h: 7 });
    expect(orientedSize({ w: 5, h: 7 }, 3)).toEqual({ w: 7, h: 5 });
  });

  test('doorCell sits on the named wall at mid + offset', () => {
    const room = { x: 10, y: 20, w: 5, h: 5 };
    expect(doorCell(room, { dir: 'N', offset: 0 })).toEqual({ cx: 12, cy: 20 });
    expect(doorCell(room, { dir: 'S', offset: 0 })).toEqual({ cx: 12, cy: 24 });
    expect(doorCell(room, { dir: 'W', offset: 0 })).toEqual({ cx: 10, cy: 22 });
    expect(doorCell(room, { dir: 'E', offset: 1 })).toEqual({ cx: 14, cy: 23 });
  });

  test('edgeTravelDir matches T2 contract', () => {
    expect(edgeTravelDir({ from: 'a', to: 'b', kind: 'critical' })).toBe('N');
    expect(edgeTravelDir({ from: 'a', to: 'b', kind: 'branch' })).toBe('E');
  });
});

describe('buildCorridorNav', () => {
  test('determinism: same seed → byte-identical nav result', () => {
    const a = build(DUNGEON_SEED);
    const b = build(DUNGEON_SEED);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  test('shipping seed matches the curated navigation fingerprint', () => {
    const hash = createHash('sha256')
      .update(fingerprint(build(DUNGEON_SEED)))
      .digest('hex');
    expect(hash).toBe(
      'dd58b11c5cc48c26266462ece3fe08a81cd1f2e51124523c16af3679047834fd',
    );
  });

  test('CORRIDOR_STREAM_SALT is distinct and forked', () => {
    expect(typeof CORRIDOR_STREAM_SALT).toBe('number');
    expect(CORRIDOR_STREAM_SALT).not.toBe(0);
    expect(CORRIDOR_STREAM_SALT).not.toBe(GRAPH_STREAM_SALT);
    expect(CORRIDOR_STREAM_SALT).not.toBe(MODULE_STREAM_SALT);

    const raw = mulberry32(DUNGEON_SEED)();
    const forked = mulberry32(DUNGEON_SEED ^ CORRIDOR_STREAM_SALT)();
    expect(forked).not.toBe(raw);

    // Centred entrance x jitter is the first corridor-stream draw.
    const g = generateDungeonGraph(DUNGEON_SEED);
    const placements = selectModules(g, DUNGEON_SEED);
    const nav = buildCorridorNav(g, placements, DUNGEON_SEED);
    const entrance = nav.rooms.find((r) => r.nodeId === 'entrance')!;
    const probe = mulberry32(DUNGEON_SEED ^ CORRIDOR_STREAM_SALT);
    const centreX = Math.floor((CELLS - entrance.w) / 2);
    const hint = Math.max(
      2,
      Math.min(CELLS - 2 - entrance.w, centreX + Math.floor(probe() * 5) - 2),
    );
    expect(entrance.x).toBe(hint);
  });

  test('rooms: every node placed, no overlap with pad≥1', () => {
    for (const seed of [DUNGEON_SEED, 1, 42, 99, 12345]) {
      const g = generateDungeonGraph(seed);
      const nav = buildCorridorNav(g, selectModules(g, seed), seed);
      expect(nav.rooms).toHaveLength(g.nodes.length);
      for (let i = 0; i < nav.rooms.length; i++) {
        for (let j = i + 1; j < nav.rooms.length; j++) {
          expect(roomsOverlap(nav.rooms[i]!, nav.rooms[j]!, ROOM_PAD)).toBe(false);
        }
      }
    }
  });

  test('grid writes and blocker footprints stay inside CELLS×CELLS', () => {
    for (const seed of [
      DUNGEON_SEED,
      ...Array.from({ length: 64 }, (_, index) => index),
    ]) {
      const nav = build(seed);
      expect(nav.walk).toHaveLength(CELLS * CELLS);
      for (let i = 0; i < CELLS; i++) {
        expect(walkAt(nav.walk, i, 0)).toBe(false);
        expect(walkAt(nav.walk, i, CELLS - 1)).toBe(false);
        expect(walkAt(nav.walk, 0, i)).toBe(false);
        expect(walkAt(nav.walk, CELLS - 1, i)).toBe(false);
      }
      for (const blocker of nav.blockers) {
        expect(blocker.x).toBeGreaterThanOrEqual(0);
        expect(blocker.z).toBeGreaterThanOrEqual(0);
        expect(blocker.x + blocker.w).toBeLessThanOrEqual(CELLS);
        expect(blocker.z + blocker.h).toBeLessThanOrEqual(CELLS);
      }
    }
  });

  test('entrance near south border; boss toward north / far side', () => {
    const nav = build(DUNGEON_SEED);
    const entrance = nav.rooms.find((r) => r.nodeId === 'entrance')!;
    const boss = nav.rooms.find((r) => r.nodeId === 'boss')!;
    // South border: entrance bottom edge within 4 cells of grid south margin ring.
    expect(entrance.y + entrance.h).toBeGreaterThanOrEqual(CELLS - 2 - 4);
    // Boss farther north (lower cy) than entrance, or at least farther by Manhattan.
    const ec = nav.entryCell;
    const bc = nav.bossCell;
    expect(bc.cy).toBeLessThan(ec.cy);
    const dist =
      Math.abs(bc.cx - ec.cx) + Math.abs(bc.cy - ec.cy);
    expect(dist).toBeGreaterThanOrEqual(10);
  });

  test('room centres advance in each graph edge travel direction', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const nav = buildCorridorNav(g, selectModules(g, DUNGEON_SEED), DUNGEON_SEED);
    const byRoom = new Map(nav.rooms.map((r) => [r.nodeId, r]));

    for (const edge of g.edges) {
      const from = centreOf(byRoom.get(edge.from)!);
      const to = centreOf(byRoom.get(edge.to)!);
      switch (edgeTravelDir(edge)) {
        case 'N':
          expect(to.cy).toBeLessThan(from.cy);
          break;
        case 'S':
          expect(to.cy).toBeGreaterThan(from.cy);
          break;
        case 'E':
          expect(to.cx).toBeGreaterThan(from.cx);
          break;
        case 'W':
          expect(to.cx).toBeLessThan(from.cx);
          break;
      }
    }
  });

  test('walk covers every room cell; door cells walkable', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const placements = selectModules(g, DUNGEON_SEED);
    const nav = buildCorridorNav(g, placements, DUNGEON_SEED);
    const byRoom = new Map(nav.rooms.map((r) => [r.nodeId, r]));
    const byP = new Map(placements.map((p) => [p.nodeId, p]));

    for (const r of nav.rooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          expect(walkAt(nav.walk, x, y)).toBe(true);
        }
      }
    }

    for (const e of g.edges) {
      const travel = edgeTravelDir(e);
      const from = byRoom.get(e.from)!;
      const to = byRoom.get(e.to)!;
      const fromSock = byP.get(e.from)!.sockets.find((s) => s.dir === travel)!;
      const toSock = byP.get(e.to)!.sockets.find((s) => s.dir === opposite(travel))!;
      const a = doorCell(from, fromSock);
      const b = doorCell(to, toSock);
      expect(walkAt(nav.walk, a.cx, a.cy)).toBe(true);
      expect(walkAt(nav.walk, b.cx, b.cy)).toBe(true);
    }
  });

  test('corridors cross socket normals and never open an un-socketed room wall', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const placements = selectModules(g, DUNGEON_SEED);
    const nav = buildCorridorNav(g, placements, DUNGEON_SEED);
    const byPlacement = new Map(placements.map((p) => [p.nodeId, p]));

    for (const room of nav.rooms) {
      const allowedOutside = new Set(
        byPlacement.get(room.nodeId)!.sockets.flatMap((socket) =>
          socketOutsideCells(room, socket),
        ),
      );

      for (const key of allowedOutside) {
        const [cx, cy] = key.split(',').map(Number) as [number, number];
        expect(walkAt(nav.walk, cx, cy)).toBe(true);
      }

      const outside: Array<[number, number]> = [];
      for (let x = room.x; x < room.x + room.w; x++) {
        outside.push([x, room.y - 1], [x, room.y + room.h]);
      }
      for (let y = room.y; y < room.y + room.h; y++) {
        outside.push([room.x - 1, y], [room.x + room.w, y]);
      }
      for (const [cx, cy] of outside) {
        if (walkAt(nav.walk, cx, cy)) {
          expect(allowedOutside.has(cellKey(cx, cy))).toBe(true);
        }
      }
    }
  });

  test('A* entry→boss exists for shipping + first 256 seeds', () => {
    for (const seed of [
      DUNGEON_SEED,
      ...Array.from({ length: 256 }, (_, index) => index),
    ]) {
      const nav = build(seed);
      expect(walkAt(nav.walk, nav.entryCell.cx, nav.entryCell.cy)).toBe(true);
      expect(walkAt(nav.walk, nav.bossCell.cx, nav.bossCell.cy)).toBe(true);
      const path = astarGrid(
        (cx, cy) =>
          cx >= 0 &&
          cy >= 0 &&
          cx < CELLS &&
          cy < CELLS &&
          nav.walk[cy * CELLS + cx] === 1,
        CELLS,
        CELLS,
        nav.entryCell,
        nav.bossCell,
        (cx, cy) => [cx, cy],
      );
      expect(path.length).toBeGreaterThan(0);
    }
  });

  test('single-truth: blockers derived from walk; no interior walk blockers', () => {
    const nav = build(DUNGEON_SEED);
    expect(nav.blockers.length).toBeGreaterThan(0);
    expect(JSON.stringify(nav.blockers)).toBe(JSON.stringify(blockersFromWalk(nav.walk)));

    for (const b of nav.blockers) {
      expect(b.kind).toBe('wall');
      for (let dz = 0; dz < b.h; dz++) {
        for (let dx = 0; dx < b.w; dx++) {
          const cx = b.x + dx;
          const cy = b.z + dz;
          // Blocker cells are non-walkable.
          expect(walkAt(nav.walk, cx, cy)).toBe(false);
          // And 8-adjacent to walk (wall semantics — not floating void).
          let adj = false;
          for (let dy = -1; dy <= 1 && !adj; dy++) {
            for (let ddx = -1; ddx <= 1; ddx++) {
              if (ddx === 0 && dy === 0) continue;
              const nx = cx + ddx;
              const ny = cy + dy;
              if (
                nx >= 0 &&
                ny >= 0 &&
                nx < CELLS &&
                ny < CELLS &&
                walkAt(nav.walk, nx, ny)
              ) {
                adj = true;
                break;
              }
            }
          }
          expect(adj).toBe(true);
        }
      }
    }
  });

  test('published nav snapshot has no mutable walk/blocker aliases', () => {
    const nav = build(DUNGEON_SEED);
    expect(Object.isFrozen(nav)).toBe(true);
    expect(Object.isFrozen(nav.walk)).toBe(true);
    expect(Object.isFrozen(nav.rooms)).toBe(true);
    expect(nav.rooms.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(nav.entryCell)).toBe(true);
    expect(Object.isFrozen(nav.bossCell)).toBe(true);
    expect(Object.isFrozen(nav.blockers)).toBe(true);
    expect(nav.blockers.every(Object.isFrozen)).toBe(true);

    const before = fingerprint(nav);
    expect(() => {
      (nav.walk as unknown as number[])[nav.entryCell.cy * CELLS + nav.entryCell.cx] = 0;
    }).toThrow();
    expect(() => {
      (nav.blockers as unknown[]).pop();
    }).toThrow();
    expect(fingerprint(nav)).toBe(before);
  });

  test('entry/boss cells marked and distinct (spawn-safety prep)', () => {
    const nav = build(DUNGEON_SEED);
    expect(nav.entryCell).toEqual(
      centreOf(nav.rooms.find((r) => r.nodeId === 'entrance')!),
    );
    expect(nav.bossCell).toEqual(
      centreOf(nav.rooms.find((r) => r.nodeId === 'boss')!),
    );
    expect(nav.entryCell).not.toEqual(nav.bossCell);
  });
});

function opposite(d: 'N' | 'E' | 'S' | 'W'): 'N' | 'E' | 'S' | 'W' {
  return ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[d];
}

function centreOf(r: PlacedRoom): { cx: number; cy: number } {
  return { cx: r.x + Math.floor(r.w / 2), cy: r.y + Math.floor(r.h / 2) };
}
