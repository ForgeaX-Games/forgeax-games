// Hellforge dungeon CORRIDORS — stage 3 of the PR3 modular pipeline.
//
// Places oriented modules on the den CELLS grid, carves corridors between
// graph-edge door sockets, and emits the single-truth walk grid + camera
// blocker stubs from the same footprints.
//
// Grid note: kit art uses 2.0 m tiles; den uses CELL=2.4 m. For T3,
// module `sizeCells` maps 1:1 onto the den CELLS grid (placeholder stage).
// CameraBlockerStub x/z/w/h are in **cell indices** (not metres): x→cx, z→cy.
//
// PRNG discipline: draws only from a NAMED forked stream
//   mulberry32(seed ^ CORRIDOR_STREAM_SALT)
// distinct from GRAPH / MODULE / layout-main / decor streams.
//
// Placement heuristics (deterministic):
//   • Cardinal contract matches T2: critical edges travel N, branch travels E.
//   • N = decreasing cy, S = increasing cy, E = increasing cx, W = decreasing cx.
//   • Entrance AABB hugs the south border; boss prefers the north (far) side.
//   • Other rooms score by door-to-door Manhattan to the parent socket, with
//     pad ≥1 cell between AABBs; full-grid scan, stable tie-break (y then x).
//   • Width-2 corridors route outside room wall halos and cross only the two
//     endpoint socket normals; tie preference comes from the corridor stream.

import { CELL, CELLS, WALL_H, mulberry32 } from './dungeon-layout';
import {
  GRAPH_STREAM_SALT,
  type DungeonGraph,
  type GraphEdge,
} from './dungeon-graph';
import {
  MODULE_CATALOG,
  MODULE_STREAM_SALT,
  oppositeDir,
  type CardinalDir,
  type ModulePlacement,
  type RotQuarter,
} from './dungeon-modules';
import type { ProbeBlocker } from './camera-probe';

/** Fork salt for the corridor PRNG stream (MurmurHash3 c2 constant). */
export const CORRIDOR_STREAM_SALT: number = 0xc2b2ae35;

if (
  CORRIDOR_STREAM_SALT === GRAPH_STREAM_SALT ||
  CORRIDOR_STREAM_SALT === MODULE_STREAM_SALT
) {
  throw new Error('CORRIDOR_STREAM_SALT must differ from GRAPH/MODULE salts');
}

/** Minimum empty cells between room AABBs. */
export const ROOM_PAD = 1;

/** Corridor footprint width in cells (matches the greybox den). */
export const CORRIDOR_WIDTH = 2;

/** Keep rooms off the outer ring so walls can seal. */
const MARGIN = 2;

export interface PlacedRoom {
  readonly nodeId: string;
  /** Grid AABB min corner + size (cell space, integer). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly moduleId: string;
  readonly rotQuarter: RotQuarter;
  readonly mirrorX?: boolean;
}

export interface CameraBlockerStub {
  readonly id: string;
  /** Cell-space AABB: x→cx, z→cy, w/h in cells (not metres). */
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly kind: 'wall' | 'prop';
}

export interface CorridorNavResult {
  readonly seed: number;
  /** Immutable CELLS×CELLS snapshot; the builder is the sole writer. */
  readonly walk: ArrayLike<number>;
  readonly rooms: readonly PlacedRoom[];
  readonly entryCell: Readonly<{ cx: number; cy: number }>;
  readonly bossCell: Readonly<{ cx: number; cy: number }>;
  /** Immutable projection derived once from the published `walk` snapshot. */
  readonly blockers: readonly CameraBlockerStub[];
}

export function edgeTravelDir(edge: GraphEdge): CardinalDir {
  return edge.kind === 'branch' ? 'E' : 'N';
}

/** World AABB size after rotQuarter (mirrorX does not swap extents). */
export function orientedSize(
  sizeCells: { w: number; h: number },
  rotQuarter: RotQuarter,
): { w: number; h: number } {
  if (rotQuarter === 1 || rotQuarter === 3) {
    return { w: sizeCells.h, h: sizeCells.w };
  }
  return { w: sizeCells.w, h: sizeCells.h };
}

/**
 * Door cell on a placed room for a graph-local socket.
 * N/S walls use mid-x + offset; E/W walls use mid-y + offset.
 */
export function doorCell(
  room: Pick<PlacedRoom, 'x' | 'y' | 'w' | 'h'>,
  socket: { dir: CardinalDir; offset: number },
): { cx: number; cy: number } {
  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  switch (socket.dir) {
    case 'N':
      return { cx: midX + socket.offset, cy: room.y };
    case 'S':
      return { cx: midX + socket.offset, cy: room.y + room.h - 1 };
    case 'W':
      return { cx: room.x, cy: midY + socket.offset };
    case 'E':
      return { cx: room.x + room.w - 1, cy: midY + socket.offset };
  }
}

function roomClash(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad: number,
): boolean {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

function inBounds(r: { x: number; y: number; w: number; h: number }): boolean {
  return (
    r.x >= MARGIN &&
    r.y >= MARGIN &&
    r.x + r.w <= CELLS - MARGIN &&
    r.y + r.h <= CELLS - MARGIN
  );
}

function socketsHaveRoutingClearance(
  room: { x: number; y: number; w: number; h: number },
  sockets: readonly { dir: CardinalDir }[],
): boolean {
  return sockets.every((socket) => {
    switch (socket.dir) {
      case 'N':
        return room.y >= MARGIN + CORRIDOR_WIDTH;
      case 'S':
        return room.y + room.h <= CELLS - MARGIN - CORRIDOR_WIDTH;
      case 'W':
        return room.x >= MARGIN + CORRIDOR_WIDTH;
      case 'E':
        return room.x + room.w <= CELLS - MARGIN - CORRIDOR_WIDTH;
    }
  });
}

function centreCell(r: PlacedRoom): { cx: number; cy: number } {
  return {
    cx: r.x + Math.floor(r.w / 2),
    cy: r.y + Math.floor(r.h / 2),
  };
}

function catalogById(): Map<string, (typeof MODULE_CATALOG)[number]> {
  return new Map(MODULE_CATALOG.map((m) => [m.id, m]));
}

function socketFacing(
  placement: ModulePlacement,
  dir: CardinalDir,
): { dir: CardinalDir; offset: number } {
  const s = placement.sockets.find((sock) => sock.dir === dir);
  if (!s) {
    throw new Error(`Placement ${placement.nodeId} missing socket facing ${dir}`);
  }
  return s;
}

/**
 * Score a candidate AABB for `nodeId` given optional parent linkage.
 * Lower is better. Stable across engines (no PRNG in the score).
 */
function scoreCandidate(
  nodeId: string,
  cand: { x: number; y: number; w: number; h: number },
  parent: PlacedRoom | null,
  travel: CardinalDir | null,
  parentSock: { dir: CardinalDir; offset: number } | null,
  childSock: { dir: CardinalDir; offset: number } | null,
  entryCentre: { cx: number; cy: number } | null,
): number {
  if (nodeId === 'entrance') {
    // Prefer south border, then horizontally centred.
    const southDist = CELLS - MARGIN - (cand.y + cand.h);
    const mid = CELLS / 2 - cand.w / 2;
    return southDist * 1000 + Math.abs(cand.x - mid);
  }
  if (nodeId === 'boss') {
    // Prefer north border + far from entrance.
    const northDist = cand.y - MARGIN;
    const c = { cx: cand.x + Math.floor(cand.w / 2), cy: cand.y + Math.floor(cand.h / 2) };
    const far = entryCentre
      ? -(Math.abs(c.cx - entryCentre.cx) + Math.abs(c.cy - entryCentre.cy))
      : 0;
    return northDist * 1000 + far;
  }
  if (parent && travel && parentSock && childSock) {
    const pd = doorCell(parent, parentSock);
    const cd = doorCell(
      { x: cand.x, y: cand.y, w: cand.w, h: cand.h },
      childSock,
    );
    return Math.abs(pd.cx - cd.cx) + Math.abs(pd.cy - cd.cy);
  }
  return Math.abs(cand.x) + Math.abs(cand.y);
}

function placeRooms(
  graph: DungeonGraph,
  placements: readonly ModulePlacement[],
  rnd: () => number,
): PlacedRoom[] {
  const defs = catalogById();
  const byPlacement = new Map(placements.map((p) => [p.nodeId, p]));
  const placed = new Map<string, PlacedRoom>();
  const rooms: PlacedRoom[] = [];

  const placeOne = (
    nodeId: string,
    parent: PlacedRoom | null,
    travel: CardinalDir | null,
  ): PlacedRoom => {
    const p = byPlacement.get(nodeId);
    if (!p) throw new Error(`Missing module placement for ${nodeId}`);
    const def = defs.get(p.moduleId);
    if (!def) throw new Error(`Unknown module ${p.moduleId}`);
    const { w, h } = orientedSize(def.sizeCells, p.rotQuarter);

    const parentSock =
      parent && travel ? socketFacing(byPlacement.get(parent.nodeId)!, travel) : null;
    const childSock =
      travel != null ? socketFacing(p, oppositeDir(travel)) : null;

    const entry = placed.get('entrance');
    const entryCentre = entry ? centreCell(entry) : null;

    // Entrance: consume one PRNG draw for a small centred x jitter.
    let entranceXHint: number | null = null;
    if (nodeId === 'entrance') {
      const centreX = Math.floor((CELLS - w) / 2);
      entranceXHint = Math.max(
        MARGIN,
        Math.min(CELLS - MARGIN - w, centreX + Math.floor(rnd() * 5) - 2),
      );
    }

    let best: { x: number; y: number; score: number } | null = null;
    const branchCandidates: Array<{ x: number; y: number; score: number }> = [];
    for (let y = MARGIN; y <= CELLS - MARGIN - h; y++) {
      for (let x = MARGIN; x <= CELLS - MARGIN - w; x++) {
        if (nodeId === 'entrance' && entranceXHint != null) {
          if (x !== entranceXHint) continue;
        }
        const cand = { x, y, w, h };
        if (!inBounds(cand)) continue;
        if (!socketsHaveRoutingClearance(cand, p.sockets)) continue;
        let clash = false;
        for (const other of placed.values()) {
          if (roomClash(cand, other, ROOM_PAD)) {
            clash = true;
            break;
          }
        }
        if (clash) continue;
        const score = scoreCandidate(
          nodeId,
          cand,
          parent,
          travel,
          parentSock,
          childSock,
          entryCentre,
        );
        if (nodeId === 'branch-reward') {
          branchCandidates.push({ x, y, score });
          continue;
        }
        if (
          !best ||
          score < best.score ||
          (score === best.score && (y < best.y || (y === best.y && x < best.x)))
        ) {
          best = { x, y, score };
        }
      }
    }

    if (nodeId === 'branch-reward') {
      // The branch is placed last. Keep score order, but reject a candidate
      // that seals a previously placed socket route (notably the boss entry).
      branchCandidates.sort(
        (a, b) => a.score - b.score || a.y - b.y || a.x - b.x,
      );
      for (const candidate of branchCandidates) {
        const candidateRoom: PlacedRoom = {
          nodeId,
          x: candidate.x,
          y: candidate.y,
          w,
          h,
          moduleId: p.moduleId,
          rotQuarter: p.rotQuarter,
          ...(p.mirrorX ? { mirrorX: true } : {}),
        };
        if (
          allCorridorsRoutable(
            graph,
            [...placed.values(), candidateRoom],
            byPlacement,
          )
        ) {
          best = candidate;
          break;
        }
      }
    }

    // Entrance narrow band may fail if jitter lands in a bad column — widen.
    if (!best && nodeId === 'entrance') {
      for (let y = MARGIN; y <= CELLS - MARGIN - h; y++) {
        for (let x = MARGIN; x <= CELLS - MARGIN - w; x++) {
          const cand = { x, y, w, h };
          if (!socketsHaveRoutingClearance(cand, p.sockets)) continue;
          let clash = false;
          for (const other of placed.values()) {
            if (roomClash(cand, other, ROOM_PAD)) {
              clash = true;
              break;
            }
          }
          if (clash) continue;
          const score = scoreCandidate(
            nodeId,
            cand,
            null,
            null,
            null,
            null,
            null,
          );
          if (
            !best ||
            score < best.score ||
            (score === best.score && (y < best.y || (y === best.y && x < best.x)))
          ) {
            best = { x, y, score };
          }
        }
      }
    }

    if (!best) {
      throw new Error(`Could not place room ${nodeId} (${w}x${h}) on ${CELLS} grid`);
    }

    const room: PlacedRoom = {
      nodeId,
      x: best.x,
      y: best.y,
      w,
      h,
      moduleId: p.moduleId,
      rotQuarter: p.rotQuarter,
      ...(p.mirrorX ? { mirrorX: true } : {}),
    };
    placed.set(nodeId, room);
    rooms.push(room);
    return room;
  };

  // Entrance first (seeds the south anchor + consumes corridor stream).
  placeOne('entrance', null, null);

  // Critical path by increasing depth (skip entrance).
  const critical = graph.nodes
    .filter((n) => n.criticalPath && n.id !== 'entrance')
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  for (const node of critical) {
    const inEdge = graph.edges.find((e) => e.to === node.id && e.kind === 'critical');
    if (!inEdge) throw new Error(`Critical node ${node.id} has no inbound critical edge`);
    const parent = placed.get(inEdge.from);
    if (!parent) throw new Error(`Parent ${inEdge.from} not placed before ${node.id}`);
    placeOne(node.id, parent, edgeTravelDir(inEdge));
  }

  // Branch after its parent exists.
  const branchEdge = graph.edges.find((e) => e.kind === 'branch');
  if (branchEdge) {
    const parent = placed.get(branchEdge.from);
    if (!parent) throw new Error(`Branch parent ${branchEdge.from} missing`);
    placeOne(branchEdge.to, parent, edgeTravelDir(branchEdge));
  }

  // Stable output order: graph node order.
  const byId = new Map(rooms.map((r) => [r.nodeId, r]));
  return graph.nodes.map((n) => {
    const r = byId.get(n.id);
    if (!r) throw new Error(`Room ${n.id} was not placed`);
    return r;
  });
}

function carveCell(walk: Uint8Array, cx: number, cy: number): void {
  if (cx >= 1 && cy >= 1 && cx < CELLS - 1 && cy < CELLS - 1) {
    walk[cy * CELLS + cx] = 1;
  }
}

type GridCell = { cx: number; cy: number };

function corridorAnchor(
  room: PlacedRoom,
  socket: { dir: CardinalDir; offset: number },
): GridCell {
  const door = doorCell(room, socket);
  switch (socket.dir) {
    case 'N':
      return { cx: door.cx, cy: door.cy - 1 };
    case 'S':
      return door;
    case 'W':
      return { cx: door.cx - 1, cy: door.cy };
    case 'E':
      return door;
  }
}

function corridorFootprint(anchor: GridCell): GridCell[] {
  const cells: GridCell[] = [];
  for (let dy = 0; dy < CORRIDOR_WIDTH; dy++) {
    for (let dx = 0; dx < CORRIDOR_WIDTH; dx++) {
      cells.push({ cx: anchor.cx + dx, cy: anchor.cy + dy });
    }
  }
  return cells;
}

/**
 * Deterministic 4-connected router for a width-2 corridor footprint.
 * The orthogonal one-cell wall halo around every room remains sealed except
 * at this edge's two socket apertures, so no phantom door can be carved.
 */
function routeCorridor(
  rooms: readonly PlacedRoom[],
  fromRoom: PlacedRoom,
  fromSocket: { dir: CardinalDir; offset: number },
  toRoom: PlacedRoom,
  toSocket: { dir: CardinalDir; offset: number },
  horizFirst: boolean,
): GridCell[] {
  const start = corridorAnchor(fromRoom, fromSocket);
  const goal = corridorAnchor(toRoom, toSocket);
  const key = (cx: number, cy: number): number => cy * CELLS + cx;
  const allowedByRoom = new Map<string, Set<number>>([
    [
      fromRoom.nodeId,
      new Set(corridorFootprint(start).map((c) => key(c.cx, c.cy))),
    ],
    [
      toRoom.nodeId,
      new Set(corridorFootprint(goal).map((c) => key(c.cx, c.cy))),
    ],
  ]);

  const passable = (anchor: GridCell): boolean => {
    if (
      anchor.cx < 1 ||
      anchor.cy < 1 ||
      anchor.cx + CORRIDOR_WIDTH - 1 >= CELLS - 1 ||
      anchor.cy + CORRIDOR_WIDTH - 1 >= CELLS - 1
    ) {
      return false;
    }
    for (const cell of corridorFootprint(anchor)) {
      for (const room of rooms) {
        const withinRoomX = cell.cx >= room.x && cell.cx < room.x + room.w;
        const withinRoomY = cell.cy >= room.y && cell.cy < room.y + room.h;
        const touchesRoomHalo =
          (withinRoomX && cell.cy >= room.y - 1 && cell.cy <= room.y + room.h) ||
          (withinRoomY && cell.cx >= room.x - 1 && cell.cx <= room.x + room.w);
        if (
          touchesRoomHalo &&
          !allowedByRoom.get(room.nodeId)?.has(key(cell.cx, cell.cy))
        ) {
          return false;
        }
      }
    }
    return true;
  };

  const startIndex = key(start.cx, start.cy);
  const goalIndex = key(goal.cx, goal.cy);
  if (!passable(start) || !passable(goal)) {
    throw new Error(
      `Socket aperture out of bounds for ${fromRoom.nodeId}->${toRoom.nodeId}`,
    );
  }

  const parent = new Int32Array(CELLS * CELLS);
  parent.fill(-2);
  parent[startIndex] = -1;
  const queue = new Int32Array(CELLS * CELLS);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;

  const xStep = goal.cx >= start.cx ? 1 : -1;
  const yStep = goal.cy >= start.cy ? 1 : -1;
  const horizontalSteps = [
    [xStep, 0],
    [-xStep, 0],
  ] as const;
  const verticalSteps = [
    [0, yStep],
    [0, -yStep],
  ] as const;
  const steps = horizFirst
    ? [...horizontalSteps, ...verticalSteps]
    : [...verticalSteps, ...horizontalSteps];

  while (head < tail && parent[goalIndex] === -2) {
    const current = queue[head++]!;
    const cx = current % CELLS;
    const cy = (current / CELLS) | 0;
    for (const [dx, dy] of steps) {
      const next = { cx: cx + dx, cy: cy + dy };
      if (!passable(next)) continue;
      const nextIndex = key(next.cx, next.cy);
      if (parent[nextIndex] !== -2) continue;
      parent[nextIndex] = current;
      queue[tail++] = nextIndex;
    }
  }

  if (parent[goalIndex] === -2) {
    throw new Error(`Could not route corridor ${fromRoom.nodeId}->${toRoom.nodeId}`);
  }

  const route: GridCell[] = [];
  for (let current = goalIndex; current >= 0; current = parent[current]!) {
    route.push({ cx: current % CELLS, cy: (current / CELLS) | 0 });
  }
  route.reverse();
  return route;
}

function carveCorridorRoute(walk: Uint8Array, route: readonly GridCell[]): void {
  for (const anchor of route) {
    for (const cell of corridorFootprint(anchor)) {
      carveCell(walk, cell.cx, cell.cy);
    }
  }
}

function allCorridorsRoutable(
  graph: DungeonGraph,
  rooms: readonly PlacedRoom[],
  placements: ReadonlyMap<string, ModulePlacement>,
): boolean {
  const byRoom = new Map(rooms.map((room) => [room.nodeId, room]));
  try {
    for (const edge of graph.edges) {
      const travel = edgeTravelDir(edge);
      const fromRoom = byRoom.get(edge.from)!;
      const toRoom = byRoom.get(edge.to)!;
      const fromPlacement = placements.get(edge.from)!;
      const toPlacement = placements.get(edge.to)!;
      routeCorridor(
        rooms,
        fromRoom,
        socketFacing(fromPlacement, travel),
        toRoom,
        socketFacing(toPlacement, oppositeDir(travel)),
        true,
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * PR1-compatible world-space probe AABBs from cell-space camera stubs.
 * Origin shifts local den coords → world (typically `DUNGEON_ORIGIN`).
 * Cell (cx,cy) covers local [[cx−N)·CELL, (cx+1−N)·CELL) on X (N=CELLS/2).
 */
export function cameraBlockersToProbeBlockers(
  stubs: readonly CameraBlockerStub[],
  origin: Readonly<{ x: number; z: number }> = { x: 0, z: 0 },
): ProbeBlocker[] {
  const half = CELLS / 2;
  return stubs.map((s) => ({
    type: 'aabb' as const,
    label: s.id,
    min: [
      (s.x - half) * CELL + origin.x,
      (s.z - half) * CELL + origin.z,
    ] as const,
    max: [
      (s.x + s.w - half) * CELL + origin.x,
      (s.z + s.h - half) * CELL + origin.z,
    ] as const,
    probeHeight: WALL_H,
    probePad: 0.12,
  }));
}

/**
 * Wall blockers = non-walkable cells that 8-touch a walk cell.
 * Merged into horizontal runs. Same footprint truth as `walk`.
 */
export function blockersFromWalk(walk: ArrayLike<number>): CameraBlockerStub[] {
  const isBoundary = (cx: number, cy: number): boolean => {
    if (walk[cy * CELLS + cx]) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (
          nx >= 0 &&
          ny >= 0 &&
          nx < CELLS &&
          ny < CELLS &&
          walk[ny * CELLS + nx]
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const blockers: CameraBlockerStub[] = [];
  for (let cy = 0; cy < CELLS; cy++) {
    let run = -1;
    for (let cx = 0; cx <= CELLS; cx++) {
      const b = cx < CELLS && isBoundary(cx, cy);
      if (b && run < 0) run = cx;
      if (!b && run >= 0) {
        blockers.push({
          id: `wall-${cy}-${run}`,
          x: run,
          z: cy,
          w: cx - run,
          h: 1,
          kind: 'wall',
        });
        run = -1;
      }
    }
  }
  return blockers;
}

/**
 * Place rooms, carve socket-aligned corridors, emit walk + blockers.
 * Consumed by `generateModularLayout` (T5) for bake + runtime.
 */
export function buildCorridorNav(
  graph: DungeonGraph,
  placements: readonly ModulePlacement[],
  seed: number,
): CorridorNavResult {
  const rnd = mulberry32(seed ^ CORRIDOR_STREAM_SALT);
  const rooms = placeRooms(graph, placements, rnd);
  const byRoom = new Map(rooms.map((r) => [r.nodeId, r]));
  const byPlacement = new Map(placements.map((p) => [p.nodeId, p]));

  const walk = new Uint8Array(CELLS * CELLS);

  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        carveCell(walk, x, y);
      }
    }
  }

  for (const e of graph.edges) {
    const travel = edgeTravelDir(e);
    const fromP = byPlacement.get(e.from)!;
    const toP = byPlacement.get(e.to)!;
    const fromRoom = byRoom.get(e.from)!;
    const toRoom = byRoom.get(e.to)!;
    const fromSocket = socketFacing(fromP, travel);
    const toSocket = socketFacing(toP, oppositeDir(travel));
    const horizFirst = rnd() < 0.5;
    carveCorridorRoute(
      walk,
      routeCorridor(
        rooms,
        fromRoom,
        fromSocket,
        toRoom,
        toSocket,
        horizFirst,
      ),
    );
  }

  const entryRoom = byRoom.get('entrance');
  const bossRoom = byRoom.get('boss');
  if (!entryRoom || !bossRoom) {
    throw new Error('entrance/boss rooms missing after placement');
  }

  // Publish one immutable ownership-transfer snapshot. No consumer receives
  // the mutable builder buffer, so `walk` and its blocker projection cannot
  // drift through an alias after construction.
  const publishedWalk = Object.freeze(Array.from(walk));
  const publishedRooms = Object.freeze(
    rooms.map((room) => Object.freeze({ ...room })),
  );
  const entryCell = Object.freeze(centreCell(entryRoom));
  const bossCell = Object.freeze(centreCell(bossRoom));
  const blockers = Object.freeze(
    blockersFromWalk(publishedWalk).map((blocker) => Object.freeze(blocker)),
  );

  return Object.freeze({
    seed,
    walk: publishedWalk,
    rooms: publishedRooms,
    entryCell,
    bossCell,
    blockers,
  });
}
