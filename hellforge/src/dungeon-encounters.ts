// Hellforge dungeon ENCOUNTERS — stage 4 of the PR3 modular pipeline.
//
// Pure, engine-free encounter plan from graph + corridor nav. Emits spawn
// markers, per-room clear specs (L4 B1), room AABB volumes, and the branch
// vault chest/curse data row (L4 B2). Runtime once-fire / enter-exit lives in
// dungeon-room-events.ts (wired from main.ts).
//
// Coordinates: local metres, same convention as dungeon-layout
//   x = (cx - CELLS/2) * CELL,  z = (cy - CELLS/2) * CELL
// RoomVolume AABB edges are those cell-corner positions of the PlacedRoom
// footprint (min = SW corner of first cell, max = SW corner of the cell
// just past the NE extent — i.e. covers the room in metres).
//
// PRNG discipline: draws only from a NAMED forked stream
//   mulberry32(seed ^ ENCOUNTER_STREAM_SALT)
// distinct from GRAPH / MODULE / CORRIDOR / layout-main / decor streams.

import { CELL, CELLS, mulberry32, type DenMonsterKind } from './dungeon-layout';
import {
  CORRIDOR_STREAM_SALT,
  type CorridorNavResult,
  type PlacedRoom,
} from './dungeon-corridors';
import {
  GRAPH_STREAM_SALT,
  type DungeonGraph,
  type RoomArchetype,
} from './dungeon-graph';
import { MODULE_STREAM_SALT } from './dungeon-modules';

/** Fork salt for the encounter PRNG stream (MurmurHash3 c1 constant). */
export const ENCOUNTER_STREAM_SALT: number = 0xcc9e2d51;

if (
  ENCOUNTER_STREAM_SALT === GRAPH_STREAM_SALT ||
  ENCOUNTER_STREAM_SALT === MODULE_STREAM_SALT ||
  ENCOUNTER_STREAM_SALT === CORRIDOR_STREAM_SALT
) {
  throw new Error(
    'ENCOUNTER_STREAM_SALT must differ from GRAPH/MODULE/CORRIDOR salts',
  );
}

/**
 * No spawn within this many cells of `nav.entryCell` (Chebyshev / king-move).
 * Distance ≤ N is forbidden; N=3 matches the plan spawn-safety prep.
 */
export const SPAWN_SAFETY_CELLS = 3;

/** L4 B2 default damage multiplier while inside the branch vault volume. */
export const BRANCH_CURSE_DAMAGE_MUL = 1.3;

export interface RoomVolume {
  nodeId: string;
  archetype: RoomArchetype;
  /** Local metres — derived from PlacedRoom × CELL (see file header). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface EncounterSpawn {
  nodeId: string;
  kind: DenMonsterKind;
  /** Local metres, consistent with dungeon-layout / CorridorNavResult. */
  x: number;
  z: number;
}

export interface BranchChest {
  nodeId: string; // branch-reward
  x: number;
  z: number;
  /** L4 B2 quality-floor hook — runtime loot table consumes later. */
  qualityFloor: 'exceptional';
}

export interface RoomClearSpec {
  nodeId: string;
  requiredKillCount: number;
}

export interface EncounterPlan {
  seed: number;
  volumes: RoomVolume[];
  spawns: EncounterSpawn[];
  clears: RoomClearSpec[];
  branchChest: BranchChest;
  /** L4 B2 data row — applied later by runtime when player inside volume. */
  branchCurse: { damageMul: number; label: string };
}

function cellToLocal(cx: number, cy: number): { x: number; z: number } {
  return {
    x: (cx - CELLS / 2) * CELL,
    z: (cy - CELLS / 2) * CELL,
  };
}

/** Room AABB in local metres from a placed room footprint. */
export function roomVolumeFromPlaced(
  room: PlacedRoom,
  archetype: RoomArchetype,
): RoomVolume {
  return {
    nodeId: room.nodeId,
    archetype,
    minX: (room.x - CELLS / 2) * CELL,
    maxX: (room.x + room.w - CELLS / 2) * CELL,
    minZ: (room.y - CELLS / 2) * CELL,
    maxZ: (room.y + room.h - CELLS / 2) * CELL,
  };
}

/** Inclusive AABB hit-test in local metres (L4 B2 volume scoping helper). */
export function pointInRoomVolume(
  x: number,
  z: number,
  volume: RoomVolume,
): boolean {
  return (
    x >= volume.minX &&
    x <= volume.maxX &&
    z >= volume.minZ &&
    z <= volume.maxZ
  );
}

/** L4 B1 — clear when kill tally meets the planned pack size. */
export function isRoomCleared(
  spec: RoomClearSpec,
  killsInRoom: number,
): boolean {
  return killsInRoom >= spec.requiredKillCount;
}

/** L4 B2 — true while the player is inside the branch-reward volume. */
export function isInsideBranchCurseVolume(
  x: number,
  z: number,
  plan: EncounterPlan,
): boolean {
  const vol = plan.volumes.find((v) => v.nodeId === plan.branchChest.nodeId);
  return vol ? pointInRoomVolume(x, z, vol) : false;
}

function chebyshev(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function isWalkable(
  walk: ArrayLike<number>,
  cx: number,
  cy: number,
): boolean {
  if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return false;
  return walk[cy * CELLS + cx] === 1;
}

function inRoomCells(room: PlacedRoom, cx: number, cy: number): boolean {
  return (
    cx >= room.x &&
    cx < room.x + room.w &&
    cy >= room.y &&
    cy < room.y + room.h
  );
}

function isSpawnSafe(
  cx: number,
  cy: number,
  entry: Readonly<{ cx: number; cy: number }>,
): boolean {
  return chebyshev(cx, cy, entry.cx, entry.cy) > SPAWN_SAFETY_CELLS;
}

/** Interior walkable cells in `room` that pass spawn-safety. */
function candidateCells(
  room: PlacedRoom,
  walk: ArrayLike<number>,
  entry: Readonly<{ cx: number; cy: number }>,
): Array<{ cx: number; cy: number }> {
  const out: Array<{ cx: number; cy: number }> = [];
  const x0 = room.x + 1;
  const y0 = room.y + 1;
  const x1 = room.x + room.w - 1;
  const y1 = room.y + room.h - 1;
  // Fall back to full footprint if the room is too small for a 1-cell inset.
  const useInset = x1 > x0 && y1 > y0;
  const minX = useInset ? x0 : room.x;
  const maxX = useInset ? x1 : room.x + room.w;
  const minY = useInset ? y0 : room.y;
  const maxY = useInset ? y1 : room.y + room.h;

  for (let cy = minY; cy < maxY; cy++) {
    for (let cx = minX; cx < maxX; cx++) {
      if (!inRoomCells(room, cx, cy)) continue;
      if (!isWalkable(walk, cx, cy)) continue;
      if (!isSpawnSafe(cx, cy, entry)) continue;
      out.push({ cx, cy });
    }
  }
  return out;
}

function pickCell(
  candidates: Array<{ cx: number; cy: number }>,
  rnd: () => number,
  used: Set<string>,
): { cx: number; cy: number } | null {
  if (candidates.length === 0) return null;
  // Never stack markers — overcrowded packs truncate instead of colliding.
  const free = candidates.filter((c) => !used.has(`${c.cx},${c.cy}`));
  if (free.length === 0) return null;
  return free[Math.floor(rnd() * free.length)]!;
}

/** Walkable cells in `room` not already claimed by a spawn (chest placement). */
function freeWalkableInRoom(
  room: PlacedRoom,
  walk: ArrayLike<number>,
  used: Set<string>,
): Array<{ cx: number; cy: number }> {
  const out: Array<{ cx: number; cy: number }> = [];
  for (let cy = room.y; cy < room.y + room.h; cy++) {
    for (let cx = room.x; cx < room.x + room.w; cx++) {
      if (!isWalkable(walk, cx, cy)) continue;
      if (used.has(`${cx},${cy}`)) continue;
      out.push({ cx, cy });
    }
  }
  return out;
}

function pickKind(depthNorm: number, rnd: () => number): DenMonsterKind {
  // Mirrors greybox dungeon-layout.ts pack tables (depth-weighted).
  if (rnd() < 0.15 + depthNorm * 0.2) {
    return rnd() < 0.5 ? 'flamecaller' : 'charred';
  }
  return rnd() < 0.5 ? 'imp' : 'ashwalker';
}

function pushSpawn(
  spawns: EncounterSpawn[],
  used: Set<string>,
  nodeId: string,
  kind: DenMonsterKind,
  cx: number,
  cy: number,
): void {
  const { x, z } = cellToLocal(cx, cy);
  spawns.push({ nodeId, kind, x, z });
  used.add(`${cx},${cy}`);
}

/**
 * Build the encounter plan for `seed`.
 *
 * Spawn tables by archetype (see plan §T4):
 *   entrance          — empty
 *   combat            — depth-scaled pack
 *   recovery          — empty or light (0–1)
 *   boss-antechamber  — empty (quality room)
 *   boss              — slaglord + flamecaller pack
 *   branch-reward     — vault pack OR empty; always one quality-floor chest
 */
export function planEncounters(
  graph: DungeonGraph,
  nav: CorridorNavResult,
  seed: number,
): EncounterPlan {
  const rnd = mulberry32(seed ^ ENCOUNTER_STREAM_SALT);
  const byRoom = new Map(nav.rooms.map((r) => [r.nodeId, r]));
  const byNode = new Map(graph.nodes.map((n) => [n.id, n]));

  const maxDepth = Math.max(...graph.nodes.map((n) => n.depth), 1);
  const volumes: RoomVolume[] = [];
  const spawns: EncounterSpawn[] = [];
  const usedByRoom = new Map<string, Set<string>>();

  for (const node of graph.nodes) {
    const room = byRoom.get(node.id);
    if (!room) {
      throw new Error(`planEncounters: missing placed room for ${node.id}`);
    }
    volumes.push(roomVolumeFromPlaced(room, node.archetype));
    usedByRoom.set(node.id, new Set());
  }

  for (const node of graph.nodes) {
    const room = byRoom.get(node.id)!;
    const used = usedByRoom.get(node.id)!;
    const depthNorm = node.depth / maxDepth;
    const candidates = candidateCells(room, nav.walk, nav.entryCell);

    switch (node.archetype) {
      case 'entrance':
        break;

      case 'boss-antechamber':
        break;

      case 'recovery': {
        if (rnd() < 0.3 && candidates.length > 0) {
          const cell = pickCell(candidates, rnd, used);
          if (cell) {
            pushSpawn(spawns, used, node.id, pickKind(depthNorm, rnd), cell.cx, cell.cy);
          }
        }
        break;
      }

      case 'combat': {
        const packSize = 2 + Math.floor(rnd() * 3) + (depthNorm > 0.6 ? 1 : 0);
        for (let i = 0; i < packSize; i++) {
          const cell = pickCell(candidates, rnd, used);
          if (!cell) break;
          pushSpawn(spawns, used, node.id, pickKind(depthNorm, rnd), cell.cx, cell.cy);
        }
        break;
      }

      case 'branch-reward': {
        // Vault pack OR empty — chest is always placed below.
        if (rnd() < 0.55) {
          const packSize = 2 + Math.floor(rnd() * 2); // 2..3
          for (let i = 0; i < packSize; i++) {
            const cell = pickCell(candidates, rnd, used);
            if (!cell) break;
            pushSpawn(spawns, used, node.id, pickKind(depthNorm, rnd), cell.cx, cell.cy);
          }
        }
        break;
      }

      case 'boss': {
        const bc = nav.bossCell;
        if (
          isWalkable(nav.walk, bc.cx, bc.cy) &&
          isSpawnSafe(bc.cx, bc.cy, nav.entryCell) &&
          !used.has(`${bc.cx},${bc.cy}`)
        ) {
          pushSpawn(spawns, used, node.id, 'slaglord', bc.cx, bc.cy);
        }
        const corners = [
          { cx: room.x + 1, cy: room.y + 1 },
          { cx: room.x + room.w - 2, cy: room.y + room.h - 2 },
        ];
        for (const c of corners) {
          if (!isWalkable(nav.walk, c.cx, c.cy)) continue;
          if (!isSpawnSafe(c.cx, c.cy, nav.entryCell)) continue;
          if (!inRoomCells(room, c.cx, c.cy)) continue;
          if (used.has(`${c.cx},${c.cy}`)) continue;
          pushSpawn(spawns, used, node.id, 'flamecaller', c.cx, c.cy);
        }
        break;
      }

      default: {
        const _exhaustive: never = node.archetype;
        void _exhaustive;
        break;
      }
    }
  }

  // Per-room clears: every combat room; branch only when it has kills (L4 B1).
  const clears: RoomClearSpec[] = [];
  for (const node of graph.nodes) {
    const killCount = spawns.filter((s) => s.nodeId === node.id).length;
    if (node.archetype === 'combat') {
      clears.push({ nodeId: node.id, requiredKillCount: killCount });
    } else if (node.archetype === 'branch-reward' && killCount > 0) {
      clears.push({ nodeId: node.id, requiredKillCount: killCount });
    }
  }

  const branchNode = byNode.get('branch-reward');
  const branchRoom = byRoom.get('branch-reward');
  if (!branchNode || !branchRoom) {
    throw new Error('planEncounters: branch-reward node/room missing');
  }

  // Chest must be walkable and must not share a cell with a vault spawn.
  const branchUsed = usedByRoom.get('branch-reward')!;
  const branchCentre = {
    cx: branchRoom.x + Math.floor(branchRoom.w / 2),
    cy: branchRoom.y + Math.floor(branchRoom.h / 2),
  };
  let chestCell: { cx: number; cy: number } | null = null;
  if (
    isWalkable(nav.walk, branchCentre.cx, branchCentre.cy) &&
    !branchUsed.has(`${branchCentre.cx},${branchCentre.cy}`)
  ) {
    chestCell = branchCentre;
  } else {
    const safeFree = candidateCells(branchRoom, nav.walk, nav.entryCell).filter(
      (c) => !branchUsed.has(`${c.cx},${c.cy}`),
    );
    if (safeFree.length > 0) {
      chestCell = safeFree[0]!;
    } else {
      const anyFree = freeWalkableInRoom(branchRoom, nav.walk, branchUsed);
      if (anyFree.length === 0) {
        throw new Error(
          'planEncounters: no free walkable cell for branch-reward chest',
        );
      }
      chestCell = anyFree[0]!;
    }
  }
  const chestLocal = cellToLocal(chestCell.cx, chestCell.cy);
  const branchChest: BranchChest = {
    nodeId: 'branch-reward',
    x: chestLocal.x,
    z: chestLocal.z,
    qualityFloor: 'exceptional',
  };

  return {
    seed,
    volumes,
    spawns,
    clears,
    branchChest,
    branchCurse: {
      damageMul: BRANCH_CURSE_DAMAGE_MUL,
      label: 'Slag-cursed: monsters +30% damage',
    },
  };
}
