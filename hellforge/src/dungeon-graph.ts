// Hellforge dungeon GRAPH — stage 1 of the PR3 modular pipeline.
//
// Pure, engine-free semantic room graph from a seed. Downstream stages
// (modules / corridors / encounters) consume this; they are not wired yet.
//
// PRNG discipline: draws only from a NAMED forked stream
//   mulberry32(seed ^ GRAPH_STREAM_SALT)
// so the graph stage never shares entropy with the layout main / decor streams.

import { mulberry32 } from './dungeon-layout';

/** Fork salt for the graph PRNG stream (golden-ratio constant). */
export const GRAPH_STREAM_SALT: number = 0x9e3779b9;

export type RoomArchetype =
  | 'entrance'
  | 'combat'
  | 'branch-reward'
  | 'recovery'
  | 'boss-antechamber'
  | 'boss';

export interface GraphNode {
  id: string;
  archetype: RoomArchetype;
  depth: number; // 0 = entrance
  criticalPath: boolean; // false only for the single branch-reward
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: 'critical' | 'branch';
}

export interface DungeonGraph {
  seed: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Build the semantic room graph for `seed`.
 *
 * Always emits L1 inventory (entrance, ≥1 combat, ≥1 recovery, one
 * branch-reward, boss-antechamber, boss) and L2 branch policy (exactly one
 * optional branch-reward off a mid critical-path combat/recovery node).
 */
export function generateDungeonGraph(seed: number): DungeonGraph {
  const rnd = mulberry32(seed ^ GRAPH_STREAM_SALT);

  // Mid critical-path rooms between entrance and antechamber: 2..4 so we
  // always have room for ≥1 combat and ≥1 recovery, plus a branch parent.
  const midCount = 2 + Math.floor(rnd() * 3); // 2, 3, or 4

  // Pick which mid slots are recovery (rest combat); force ≥1 of each.
  const recoverySlots = new Set<number>();
  const firstRecovery = Math.floor(rnd() * midCount);
  recoverySlots.add(firstRecovery);
  // Extra recoveries with diminishing chance; leave at least one combat.
  for (let i = 0; i < midCount; i++) {
    if (recoverySlots.has(i)) continue;
    if (recoverySlots.size >= midCount - 1) break; // keep ≥1 combat
    if (rnd() < 0.35) recoverySlots.add(i);
  }

  // Branch attaches to a mid combat/recovery node (never entrance/boss).
  const branchParentIdx = Math.floor(rnd() * midCount);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const entranceId = 'entrance';
  nodes.push({
    id: entranceId,
    archetype: 'entrance',
    depth: 0,
    criticalPath: true,
  });

  let prevId = entranceId;
  let combatN = 0;
  let recoveryN = 0;
  const midIds: string[] = [];

  for (let i = 0; i < midCount; i++) {
    const isRecovery = recoverySlots.has(i);
    const archetype: RoomArchetype = isRecovery ? 'recovery' : 'combat';
    const id = isRecovery ? `recovery-${recoveryN++}` : `combat-${combatN++}`;
    const depth = i + 1;
    nodes.push({ id, archetype, depth, criticalPath: true });
    edges.push({ from: prevId, to: id, kind: 'critical' });
    midIds.push(id);
    prevId = id;
  }

  const anteId = 'boss-antechamber';
  const anteDepth = midCount + 1;
  nodes.push({
    id: anteId,
    archetype: 'boss-antechamber',
    depth: anteDepth,
    criticalPath: true,
  });
  edges.push({ from: prevId, to: anteId, kind: 'critical' });

  const bossId = 'boss';
  nodes.push({
    id: bossId,
    archetype: 'boss',
    depth: anteDepth + 1,
    criticalPath: true,
  });
  edges.push({ from: anteId, to: bossId, kind: 'critical' });

  const branchParentId = midIds[branchParentIdx]!;
  const parentNode = nodes.find((n) => n.id === branchParentId)!;
  const branchId = 'branch-reward';
  nodes.push({
    id: branchId,
    archetype: 'branch-reward',
    depth: parentNode.depth + 1,
    criticalPath: false,
  });
  edges.push({ from: branchParentId, to: branchId, kind: 'branch' });

  return { seed, nodes, edges };
}
