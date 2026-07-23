import { describe, expect, test } from 'bun:test';
import { CELL, CELLS, DUNGEON_SEED, mulberry32 } from './dungeon-layout';
import { GRAPH_STREAM_SALT, generateDungeonGraph } from './dungeon-graph';
import { MODULE_STREAM_SALT, selectModules } from './dungeon-modules';
import {
  CORRIDOR_STREAM_SALT,
  buildCorridorNav,
  type CorridorNavResult,
} from './dungeon-corridors';
import {
  BRANCH_CURSE_DAMAGE_MUL,
  ENCOUNTER_STREAM_SALT,
  SPAWN_SAFETY_CELLS,
  isInsideBranchCurseVolume,
  isRoomCleared,
  planEncounters,
  pointInRoomVolume,
  roomVolumeFromPlaced,
  type EncounterPlan,
} from './dungeon-encounters';

function buildNav(seed = DUNGEON_SEED): {
  graph: ReturnType<typeof generateDungeonGraph>;
  nav: CorridorNavResult;
} {
  const graph = generateDungeonGraph(seed);
  const nav = buildCorridorNav(graph, selectModules(graph, seed), seed);
  return { graph, nav };
}

function plan(seed = DUNGEON_SEED): EncounterPlan {
  const { graph, nav } = buildNav(seed);
  return planEncounters(graph, nav, seed);
}

function localToCell(x: number, z: number): { cx: number; cy: number } {
  return {
    cx: Math.round(x / CELL + CELLS / 2),
    cy: Math.round(z / CELL + CELLS / 2),
  };
}

function walkAt(walk: ArrayLike<number>, cx: number, cy: number): boolean {
  return walk[cy * CELLS + cx] === 1;
}

function chebyshev(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

describe('planEncounters', () => {
  test('ENCOUNTER_STREAM_SALT is distinct and forked', () => {
    expect(typeof ENCOUNTER_STREAM_SALT).toBe('number');
    expect(ENCOUNTER_STREAM_SALT).not.toBe(0);
    expect(ENCOUNTER_STREAM_SALT).not.toBe(GRAPH_STREAM_SALT);
    expect(ENCOUNTER_STREAM_SALT).not.toBe(MODULE_STREAM_SALT);
    expect(ENCOUNTER_STREAM_SALT).not.toBe(CORRIDOR_STREAM_SALT);

    const raw = mulberry32(DUNGEON_SEED)();
    const forked = mulberry32(DUNGEON_SEED ^ ENCOUNTER_STREAM_SALT)();
    expect(forked).not.toBe(raw);
  });

  test('determinism: same seed → identical encounter plan', () => {
    const a = plan(DUNGEON_SEED);
    const b = plan(DUNGEON_SEED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('different seeds diverge', () => {
    const a = plan(DUNGEON_SEED);
    const b = plan(DUNGEON_SEED + 1);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  test(`spawn-safety: no spawn within ${SPAWN_SAFETY_CELLS} cells of entry`, () => {
    for (const seed of [DUNGEON_SEED, 1, 42, 99, 12345]) {
      const { graph, nav } = buildNav(seed);
      const p = planEncounters(graph, nav, seed);
      for (const s of p.spawns) {
        const { cx, cy } = localToCell(s.x, s.z);
        expect(
          chebyshev(cx, cy, nav.entryCell.cx, nav.entryCell.cy),
        ).toBeGreaterThan(SPAWN_SAFETY_CELLS);
      }
    }
  });

  test('all spawns land on walkable cells inside their room volume', () => {
    for (const seed of [DUNGEON_SEED, 1, 42, 99]) {
      const { graph, nav } = buildNav(seed);
      const p = planEncounters(graph, nav, seed);
      const volById = new Map(p.volumes.map((v) => [v.nodeId, v]));
      for (const s of p.spawns) {
        const { cx, cy } = localToCell(s.x, s.z);
        expect(walkAt(nav.walk, cx, cy)).toBe(true);
        const vol = volById.get(s.nodeId);
        expect(vol).toBeDefined();
        expect(pointInRoomVolume(s.x, s.z, vol!)).toBe(true);
      }
    }
  });

  test('L1 archetype coverage: clears for combat, chest on branch, entrance empty', () => {
    const { graph, nav } = buildNav(DUNGEON_SEED);
    const p = planEncounters(graph, nav, DUNGEON_SEED);

    const combatIds = graph.nodes
      .filter((n) => n.archetype === 'combat')
      .map((n) => n.id);
    expect(combatIds.length).toBeGreaterThanOrEqual(1);
    for (const id of combatIds) {
      const clear = p.clears.find((c) => c.nodeId === id);
      expect(clear).toBeDefined();
      const kills = p.spawns.filter((s) => s.nodeId === id).length;
      expect(clear!.requiredKillCount).toBe(kills);
      expect(kills).toBeGreaterThan(0);
    }

    // Entrance / antechamber stay clear of spawns.
    expect(p.spawns.every((s) => s.nodeId !== 'entrance')).toBe(true);
    expect(p.spawns.every((s) => s.nodeId !== 'boss-antechamber')).toBe(true);

    // Boss carries slaglord.
    expect(p.spawns.some((s) => s.nodeId === 'boss' && s.kind === 'slaglord')).toBe(
      true,
    );

    // Exactly one branch chest with quality-floor hook.
    expect(p.branchChest.nodeId).toBe('branch-reward');
    expect(p.branchChest.qualityFloor).toBe('exceptional');
    const branchVol = p.volumes.find((v) => v.nodeId === 'branch-reward')!;
    expect(pointInRoomVolume(p.branchChest.x, p.branchChest.z, branchVol)).toBe(
      true,
    );

    // Branch clear only when vault pack spawned.
    const branchKills = p.spawns.filter((s) => s.nodeId === 'branch-reward').length;
    const branchClear = p.clears.find((c) => c.nodeId === 'branch-reward');
    if (branchKills > 0) {
      expect(branchClear?.requiredKillCount).toBe(branchKills);
    } else {
      expect(branchClear).toBeUndefined();
    }
  });

  test('branch curse data row present (L4 B2 hook)', () => {
    const p = plan(DUNGEON_SEED);
    expect(p.branchCurse.damageMul).toBe(BRANCH_CURSE_DAMAGE_MUL);
    expect(p.branchCurse.damageMul).toBeGreaterThan(1);
    expect(p.branchCurse.label.length).toBeGreaterThan(0);
  });

  test('volume AABB covers each placed room footprint', () => {
    const { graph, nav } = buildNav(DUNGEON_SEED);
    const p = planEncounters(graph, nav, DUNGEON_SEED);
    expect(p.volumes).toHaveLength(graph.nodes.length);

    for (const room of nav.rooms) {
      const node = graph.nodes.find((n) => n.id === room.nodeId)!;
      const expected = roomVolumeFromPlaced(room, node.archetype);
      const vol = p.volumes.find((v) => v.nodeId === room.nodeId)!;
      expect(vol).toEqual(expected);

      // SW corner of first cell and of the cell past the NE edge.
      const sw = {
        x: (room.x - CELLS / 2) * CELL,
        z: (room.y - CELLS / 2) * CELL,
      };
      const ne = {
        x: (room.x + room.w - CELLS / 2) * CELL,
        z: (room.y + room.h - CELLS / 2) * CELL,
      };
      expect(vol.minX).toBe(sw.x);
      expect(vol.minZ).toBe(sw.z);
      expect(vol.maxX).toBe(ne.x);
      expect(vol.maxZ).toBe(ne.z);
      expect(pointInRoomVolume(sw.x, sw.z, vol)).toBe(true);
      expect(pointInRoomVolume(ne.x, ne.z, vol)).toBe(true);
      expect(pointInRoomVolume(sw.x - 0.01, sw.z, vol)).toBe(false);
    }
  });

  test('L4 B1/B2 pure helpers: clear contract + curse volume scoping', () => {
    const p = plan(DUNGEON_SEED);
    const combatClear = p.clears.find((c) => c.nodeId.startsWith('combat'))!;
    expect(combatClear).toBeDefined();
    expect(isRoomCleared(combatClear, combatClear.requiredKillCount - 1)).toBe(
      false,
    );
    expect(isRoomCleared(combatClear, combatClear.requiredKillCount)).toBe(true);

    const branchVol = p.volumes.find((v) => v.nodeId === 'branch-reward')!;
    const midX = (branchVol.minX + branchVol.maxX) / 2;
    const midZ = (branchVol.minZ + branchVol.maxZ) / 2;
    expect(isInsideBranchCurseVolume(midX, midZ, p)).toBe(true);
    expect(
      isInsideBranchCurseVolume(branchVol.minX - 1, branchVol.minZ - 1, p),
    ).toBe(false);
  });

  test('SPAWN_SAFETY_CELLS is 3', () => {
    expect(SPAWN_SAFETY_CELLS).toBe(3);
  });

  test('branch chest is walkable and never shares a cell with a spawn', () => {
    for (const seed of [DUNGEON_SEED, 11, 19, 34, 55, 69, 80, 99, 12345]) {
      const { graph, nav } = buildNav(seed);
      const p = planEncounters(graph, nav, seed);
      const chest = localToCell(p.branchChest.x, p.branchChest.z);
      expect(walkAt(nav.walk, chest.cx, chest.cy)).toBe(true);

      const spawnCells = new Set(
        p.spawns.map((s) => {
          const c = localToCell(s.x, s.z);
          return `${c.cx},${c.cy}`;
        }),
      );
      expect(spawnCells.has(`${chest.cx},${chest.cy}`)).toBe(false);
      expect(spawnCells.size).toBe(p.spawns.length);
    }
  });

  test('combat clears stay positive across seeds', () => {
    for (const seed of [DUNGEON_SEED, 1, 42, 99, 12345]) {
      const { graph, nav } = buildNav(seed);
      const p = planEncounters(graph, nav, seed);
      for (const n of graph.nodes.filter((node) => node.archetype === 'combat')) {
        const clear = p.clears.find((c) => c.nodeId === n.id);
        expect(clear).toBeDefined();
        expect(clear!.requiredKillCount).toBeGreaterThan(0);
      }
      expect(
        p.spawns.some((s) => s.nodeId === 'boss' && s.kind === 'slaglord'),
      ).toBe(true);
    }
  });
});
