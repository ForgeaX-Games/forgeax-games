import { describe, expect, test } from 'bun:test';
import { DUNGEON_SEED, mulberry32 } from './dungeon-layout';
import {
  GRAPH_STREAM_SALT,
  generateDungeonGraph,
  type DungeonGraph,
  type RoomArchetype,
} from './dungeon-graph';

const ARCHETYPES: readonly RoomArchetype[] = [
  'entrance',
  'combat',
  'branch-reward',
  'recovery',
  'boss-antechamber',
  'boss',
] as const;

function countByArchetype(g: DungeonGraph): Record<RoomArchetype, number> {
  const counts = Object.fromEntries(ARCHETYPES.map((a) => [a, 0])) as Record<RoomArchetype, number>;
  for (const n of g.nodes) counts[n.archetype]++;
  return counts;
}

function criticalReachableFromEntrance(g: DungeonGraph): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of g.edges) {
    if (e.kind !== 'critical') continue;
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const seen = new Set<string>();
  const queue = ['entrance'];
  seen.add('entrance');
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe('generateDungeonGraph', () => {
  test('determinism: same seed → identical structure', () => {
    const a = generateDungeonGraph(DUNGEON_SEED);
    const b = generateDungeonGraph(DUNGEON_SEED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('different seeds can produce different graphs', () => {
    const a = generateDungeonGraph(DUNGEON_SEED);
    const b = generateDungeonGraph(DUNGEON_SEED + 1);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  test('L1 inventory for shipping seed', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const c = countByArchetype(g);
    expect(c.entrance).toBe(1);
    expect(c.boss).toBe(1);
    expect(c['boss-antechamber']).toBe(1);
    expect(c['branch-reward']).toBe(1);
    expect(c.combat).toBeGreaterThanOrEqual(1);
    expect(c.recovery).toBeGreaterThanOrEqual(1);
    for (const a of ARCHETYPES) {
      expect(c[a]).toBeGreaterThanOrEqual(1);
    }
  });

  test('L2: exactly one branch node and one branch edge', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const branchNodes = g.nodes.filter((n) => !n.criticalPath);
    expect(branchNodes).toHaveLength(1);
    expect(branchNodes[0]!.archetype).toBe('branch-reward');

    const branchEdges = g.edges.filter((e) => e.kind === 'branch');
    expect(branchEdges).toHaveLength(1);
    expect(branchEdges[0]!.to).toBe(branchNodes[0]!.id);

    for (const n of g.nodes) {
      if (n.archetype === 'branch-reward') {
        expect(n.criticalPath).toBe(false);
      } else {
        expect(n.criticalPath).toBe(true);
      }
    }
  });

  test('critical path reaches boss from entrance', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const reachable = criticalReachableFromEntrance(g);
    expect(reachable.has('boss')).toBe(true);
    expect(reachable.has('boss-antechamber')).toBe(true);
    // Branch is not on critical edges
    expect(reachable.has('branch-reward')).toBe(false);
  });

  test('depths: entrance 0; critical chain increases; branch = parent+1', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get('entrance')!.depth).toBe(0);

    for (const e of g.edges) {
      if (e.kind !== 'critical') continue;
      const from = byId.get(e.from)!;
      const to = byId.get(e.to)!;
      expect(to.depth).toBe(from.depth + 1);
    }

    const branchEdge = g.edges.find((e) => e.kind === 'branch')!;
    const parent = byId.get(branchEdge.from)!;
    const branch = byId.get(branchEdge.to)!;
    expect(branch.depth).toBe(parent.depth + 1);
    expect(parent.criticalPath).toBe(true);
    expect(parent.archetype === 'combat' || parent.archetype === 'recovery').toBe(true);
  });

  test('GRAPH_STREAM_SALT forks away from the raw seed stream', () => {
    expect(typeof GRAPH_STREAM_SALT).toBe('number');
    expect(GRAPH_STREAM_SALT).not.toBe(0);

    // First draw from forked stream differs from first draw of raw seed
    // for the shipping seed (salt is not identity).
    const raw = mulberry32(DUNGEON_SEED)();
    const forked = mulberry32(DUNGEON_SEED ^ GRAPH_STREAM_SALT)();
    expect(forked).not.toBe(raw);

    // Generator consumes the forked stream: first midCount choice matches
    // a fresh forked PRNG's first draw.
    const probe = mulberry32(DUNGEON_SEED ^ GRAPH_STREAM_SALT);
    const expectedMid = 2 + Math.floor(probe() * 3);
    const g = generateDungeonGraph(DUNGEON_SEED);
    const midCount = g.nodes.filter(
      (n) => n.archetype === 'combat' || n.archetype === 'recovery',
    ).length;
    expect(midCount).toBe(expectedMid);
  });
});
