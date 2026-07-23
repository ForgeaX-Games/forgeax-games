// Hellforge dungeon MODULES — stage 2 of the PR3 modular pipeline.
//
// Maps each GraphNode → a kit/placeholder room module with rotation and
// optional mirroring. Emits transformed door sockets in graph-local
// orientation so T3 can carve corridors between opposite-facing pairs.
//
// PRNG discipline: draws only from a NAMED forked stream
//   mulberry32(seed ^ MODULE_STREAM_SALT)
// distinct from GRAPH_STREAM_SALT / layout main / decor streams.
//
// Catalog gaps vs L1 archetypes (PR1 kit reality):
//   PR1 shipped piece modules (kit-floor/wall/corner/doorframe/pillar/trim/rubble)
//   plus one assembled quality room (boss-antechamber.pack.json via
//   antechamber-layout.ts). There are NO authored room-shell packs for
//   entrance / combat / recovery / branch-reward / boss.
//   → Placeholder defs below carry the socket contract for T3. Prefer the
//     antechamber-linked module for boss-antechamber; other archetypes keep
//     graph semantics but may ship with reduced dressing until real packs exist.
//   Do not commission new art mid-PR (plan §9 risk).

import { mulberry32 } from './dungeon-layout';
import {
  GRAPH_STREAM_SALT,
  type DungeonGraph,
  type GraphEdge,
  type RoomArchetype,
} from './dungeon-graph';

/** Fork salt for the module PRNG stream (MurmurHash3 finalizer constant). */
export const MODULE_STREAM_SALT: number = 0x85ebca6b;

// Compile-time guard: module stream must not collide with the graph stream.
if (MODULE_STREAM_SALT === GRAPH_STREAM_SALT) {
  throw new Error('MODULE_STREAM_SALT must differ from GRAPH_STREAM_SALT');
}

export type CardinalDir = 'N' | 'E' | 'S' | 'W';
export type RotQuarter = 0 | 1 | 2 | 3;

export interface DoorSocket {
  dir: CardinalDir;
  /** Cell offset along the wall in local module space (pre-transform). */
  offset: number;
}

export interface ModuleDef {
  id: string;
  archetypes: RoomArchetype[];
  sizeCells: { w: number; h: number };
  sockets: readonly DoorSocket[];
  /**
   * When true, boss-antechamber nodes prefer this module (PR1 quality room).
   * At most one catalog entry should set this.
   */
  preferred?: boolean;
}

export interface ModulePlacement {
  nodeId: string;
  moduleId: string;
  rotQuarter: RotQuarter;
  mirrorX?: boolean;
  /** Sockets after rot/mirror — graph-local cardinal orientation. */
  sockets: DoorSocket[];
}

const DIRS: readonly CardinalDir[] = ['N', 'E', 'S', 'W'];
const DIR_INDEX: Record<CardinalDir, number> = { N: 0, E: 1, S: 2, W: 3 };

export function oppositeDir(d: CardinalDir): CardinalDir {
  return DIRS[(DIR_INDEX[d] + 2) % 4]!;
}

/**
 * Transform a local socket into graph-local orientation.
 * Order: mirrorX across the local N–S axis (E↔W), then rotate by rotQuarter
 * (0=0°, 1=90° CW looking down +Y, …).
 */
export function transformSocket(
  socket: DoorSocket,
  rotQuarter: RotQuarter,
  mirrorX = false,
): DoorSocket {
  let dir = socket.dir;
  let offset = socket.offset;
  if (mirrorX) {
    if (dir === 'E') dir = 'W';
    else if (dir === 'W') dir = 'E';
    offset = -offset;
  }
  const i = (DIR_INDEX[dir] + rotQuarter) % 4;
  return { dir: DIRS[i]!, offset };
}

export function transformSockets(
  sockets: readonly DoorSocket[],
  rotQuarter: RotQuarter,
  mirrorX = false,
): DoorSocket[] {
  return sockets.map((s) => transformSocket(s, rotQuarter, mirrorX));
}

/**
 * Placeholder room catalog.
 * `ph-boss-antechamber` is the preferred PR1 quality-room stand-in
 * (wires to boss-antechamber.pack / antechamber-layout at bake time later).
 */
export const MODULE_CATALOG: readonly ModuleDef[] = [
  {
    id: 'ph-entrance',
    archetypes: ['entrance'],
    sizeCells: { w: 5, h: 5 },
    sockets: [{ dir: 'N', offset: 0 }],
  },
  {
    id: 'ph-combat-2way',
    archetypes: ['combat'],
    sizeCells: { w: 7, h: 7 },
    sockets: [
      { dir: 'S', offset: 0 },
      { dir: 'N', offset: 0 },
    ],
  },
  {
    id: 'ph-combat-3way',
    archetypes: ['combat'],
    sizeCells: { w: 7, h: 7 },
    sockets: [
      { dir: 'S', offset: 0 },
      { dir: 'N', offset: 0 },
      { dir: 'E', offset: 0 },
    ],
  },
  {
    id: 'ph-recovery-2way',
    archetypes: ['recovery'],
    sizeCells: { w: 6, h: 6 },
    sockets: [
      { dir: 'S', offset: 0 },
      { dir: 'N', offset: 0 },
    ],
  },
  {
    id: 'ph-recovery-3way',
    archetypes: ['recovery'],
    sizeCells: { w: 6, h: 6 },
    sockets: [
      { dir: 'S', offset: 0 },
      { dir: 'N', offset: 0 },
      { dir: 'E', offset: 0 },
    ],
  },
  {
    id: 'ph-branch-reward',
    archetypes: ['branch-reward'],
    sizeCells: { w: 5, h: 5 },
    sockets: [{ dir: 'W', offset: 0 }],
  },
  {
    id: 'ph-boss-antechamber',
    archetypes: ['boss-antechamber'],
    sizeCells: { w: 8, h: 8 },
    sockets: [
      { dir: 'S', offset: 0 },
      { dir: 'N', offset: 0 },
    ],
    preferred: true,
  },
  {
    id: 'ph-boss',
    archetypes: ['boss'],
    sizeCells: { w: 9, h: 9 },
    sockets: [{ dir: 'S', offset: 0 }],
  },
];

type OrientCandidate = {
  moduleId: string;
  rotQuarter: RotQuarter;
  mirrorX: boolean;
  sockets: DoorSocket[];
};

/** Assign a travel direction per edge (from → to) for socket alignment. */
function assignEdgeTravelDirs(edges: readonly GraphEdge[]): Map<string, CardinalDir> {
  const travel = new Map<string, CardinalDir>();
  for (const e of edges) {
    const key = edgeKey(e.from, e.to);
    // Critical path advances north; the single branch steps east.
    travel.set(key, e.kind === 'branch' ? 'E' : 'N');
  }
  return travel;
}

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** Outward socket dirs this node must expose for its incident edges. */
function requiredDirsForNode(
  nodeId: string,
  edges: readonly GraphEdge[],
  travel: Map<string, CardinalDir>,
): CardinalDir[] {
  const dirs: CardinalDir[] = [];
  for (const e of edges) {
    if (e.from === nodeId) {
      dirs.push(travel.get(edgeKey(e.from, e.to))!);
    } else if (e.to === nodeId) {
      dirs.push(oppositeDir(travel.get(edgeKey(e.from, e.to))!));
    }
  }
  return dirs;
}

function coversRequired(
  transformed: readonly DoorSocket[],
  required: readonly CardinalDir[],
): boolean {
  const have = new Set(transformed.map((s) => s.dir));
  return required.every((d) => have.has(d));
}

/**
 * Exact door contract: every required dir present, no phantom extras.
 * (Superset covers would invent openings T3 must not carve.)
 */
function fitsRequired(
  transformed: readonly DoorSocket[],
  required: readonly CardinalDir[],
): boolean {
  return transformed.length === required.length && coversRequired(transformed, required);
}

function orientCandidates(
  def: ModuleDef,
  required: readonly CardinalDir[],
): OrientCandidate[] {
  const out: OrientCandidate[] = [];
  for (const rot of [0, 1, 2, 3] as const) {
    for (const mirrorX of [false, true]) {
      const sockets = transformSockets(def.sockets, rot, mirrorX);
      if (!fitsRequired(sockets, required)) continue;
      out.push({
        moduleId: def.id,
        rotQuarter: rot,
        mirrorX,
        sockets,
      });
    }
  }
  return out;
}

/**
 * Select and orient a module for every graph node.
 * Deterministic for the same (graph, seed). Does not carve corridors (T3).
 */
export function selectModules(graph: DungeonGraph, seed: number): ModulePlacement[] {
  const rnd = mulberry32(seed ^ MODULE_STREAM_SALT);
  const travel = assignEdgeTravelDirs(graph.edges);
  const placements: ModulePlacement[] = [];

  for (const node of graph.nodes) {
    const required = requiredDirsForNode(node.id, graph.edges, travel);
    const defs = MODULE_CATALOG.filter((m) => m.archetypes.includes(node.archetype));
    if (defs.length === 0) {
      throw new Error(`No module catalog entry for archetype ${node.archetype}`);
    }

    let candidates: OrientCandidate[] = [];
    const preferred = defs.find((m) => m.preferred);
    if (node.archetype === 'boss-antechamber' && preferred) {
      candidates = orientCandidates(preferred, required);
    }
    if (candidates.length === 0) {
      candidates = defs.flatMap((d) => orientCandidates(d, required));
    }
    if (candidates.length === 0) {
      throw new Error(
        `No orientable module for node ${node.id} (${node.archetype}) needing [${required.join(',')}]`,
      );
    }

    // Stable order so the PRNG index is reproducible across engines.
    candidates.sort((a, b) => {
      const idCmp = a.moduleId.localeCompare(b.moduleId);
      if (idCmp !== 0) return idCmp;
      if (a.rotQuarter !== b.rotQuarter) return a.rotQuarter - b.rotQuarter;
      return Number(!!a.mirrorX) - Number(!!b.mirrorX);
    });

    const pick = candidates[Math.floor(rnd() * candidates.length)]!;
    const placement: ModulePlacement = {
      nodeId: node.id,
      moduleId: pick.moduleId,
      rotQuarter: pick.rotQuarter,
      sockets: pick.sockets,
    };
    if (pick.mirrorX) placement.mirrorX = true;
    placements.push(placement);
  }

  return placements;
}
