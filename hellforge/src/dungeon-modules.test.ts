import { describe, expect, test } from 'bun:test';
import { DUNGEON_SEED, mulberry32 } from './dungeon-layout';
import { GRAPH_STREAM_SALT, generateDungeonGraph } from './dungeon-graph';
import {
  MODULE_CATALOG,
  MODULE_STREAM_SALT,
  oppositeDir,
  selectModules,
  transformSocket,
  type CardinalDir,
  type ModulePlacement,
} from './dungeon-modules';

const OPPOSITE: Record<CardinalDir, CardinalDir> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E',
};

function byNodeId(placements: readonly ModulePlacement[]): Map<string, ModulePlacement> {
  return new Map(placements.map((p) => [p.nodeId, p]));
}

describe('transformSocket', () => {
  test('rotQuarter is CW looking down +Y; mirrorX swaps E↔W then rotates', () => {
    expect(transformSocket({ dir: 'N', offset: 0 }, 0).dir).toBe('N');
    expect(transformSocket({ dir: 'N', offset: 0 }, 1).dir).toBe('E');
    expect(transformSocket({ dir: 'N', offset: 0 }, 2).dir).toBe('S');
    expect(transformSocket({ dir: 'N', offset: 0 }, 3).dir).toBe('W');
    expect(transformSocket({ dir: 'E', offset: 2 }, 0, true)).toEqual({ dir: 'W', offset: -2 });
    // mirror E→W, then rot 1 → N
    expect(transformSocket({ dir: 'E', offset: 0 }, 1, true).dir).toBe('N');
  });

  test('oppositeDir is 180° for every cardinal', () => {
    for (const d of ['N', 'E', 'S', 'W'] as const) {
      expect(oppositeDir(d)).toBe(OPPOSITE[d]);
      expect(oppositeDir(oppositeDir(d))).toBe(d);
    }
  });
});

describe('selectModules', () => {
  test('determinism: same seed+graph → identical placements', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const a = selectModules(g, DUNGEON_SEED);
    const b = selectModules(g, DUNGEON_SEED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('every graph node gets a placement', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const placements = selectModules(g, DUNGEON_SEED);
    expect(placements).toHaveLength(g.nodes.length);
    const ids = new Set(placements.map((p) => p.nodeId));
    for (const n of g.nodes) {
      expect(ids.has(n.id)).toBe(true);
    }
  });

  test('archetype → module validity', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const placements = selectModules(g, DUNGEON_SEED);
    const byId = byNodeId(placements);
    const catalogById = new Map(MODULE_CATALOG.map((m) => [m.id, m]));

    for (const n of g.nodes) {
      const p = byId.get(n.id)!;
      const def = catalogById.get(p.moduleId);
      expect(def).toBeDefined();
      expect(def!.archetypes).toContain(n.archetype);
    }
  });

  test('MODULE_STREAM_SALT exported and used (forked stream)', () => {
    expect(typeof MODULE_STREAM_SALT).toBe('number');
    expect(MODULE_STREAM_SALT).not.toBe(0);
    expect(MODULE_STREAM_SALT).not.toBe(GRAPH_STREAM_SALT);

    const raw = mulberry32(DUNGEON_SEED)();
    const forked = mulberry32(DUNGEON_SEED ^ MODULE_STREAM_SALT)();
    expect(forked).not.toBe(raw);

    // First node (entrance) always has multiple orients for ph-entrance;
    // the pick index must match the first draw of the forked stream.
    const g = generateDungeonGraph(DUNGEON_SEED);
    const placements = selectModules(g, DUNGEON_SEED);
    const entrance = placements.find((p) => p.nodeId === 'entrance')!;
    const probe = mulberry32(DUNGEON_SEED ^ MODULE_STREAM_SALT);
    const firstDraw = probe();
    // ph-entrance local N → rot 0 (N), 1 (E), 2 (S), 3 (W); + mirror duplicates.
    // Critical path needs outward N → only rot 0 (no mirror) and rot 0+mirrorX
    // both keep N. Sorted: (ph-entrance,0,false), (ph-entrance,0,true).
    const expectedIdx = Math.floor(firstDraw * 2);
    const expectedMirror = expectedIdx === 1;
    expect(entrance.moduleId).toBe('ph-entrance');
    expect(entrance.rotQuarter).toBe(0);
    expect(!!entrance.mirrorX).toBe(expectedMirror);
  });

  test('each edge aligns on travel dir (critical=N, branch=E) with opposite sockets', () => {
    const g = generateDungeonGraph(DUNGEON_SEED);
    const byId = byNodeId(selectModules(g, DUNGEON_SEED));

    for (const e of g.edges) {
      const travel: CardinalDir = e.kind === 'branch' ? 'E' : 'N';
      const from = byId.get(e.from)!;
      const to = byId.get(e.to)!;
      expect(from.sockets.some((s) => s.dir === travel)).toBe(true);
      expect(to.sockets.some((s) => s.dir === OPPOSITE[travel])).toBe(true);
    }
  });

  test('socket count equals graph degree (no phantom doors)', () => {
    for (const seed of [DUNGEON_SEED, 1, 42, 99, 12345]) {
      const g = generateDungeonGraph(seed);
      const byId = byNodeId(selectModules(g, seed));
      for (const n of g.nodes) {
        const deg = g.edges.filter((e) => e.from === n.id || e.to === n.id).length;
        expect(byId.get(n.id)!.sockets.length).toBe(deg);
      }
    }
  });

  test('boss-antechamber gets the preferred catalog module', () => {
    const preferred = MODULE_CATALOG.find((m) => m.preferred);
    expect(preferred).toBeDefined();
    expect(preferred!.archetypes).toContain('boss-antechamber');

    const g = generateDungeonGraph(DUNGEON_SEED);
    const ante = selectModules(g, DUNGEON_SEED).find((p) => p.nodeId === 'boss-antechamber');
    expect(ante).toBeDefined();
    expect(ante!.moduleId).toBe(preferred!.id);
  });
});
