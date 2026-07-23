// Hellforge dungeon PIPELINE — PR3 T5 compose + DungeonLayout adapter.
//
// Stages (each on its own forked PRNG stream):
//   graph → modules → corridors/nav → encounters → DungeonLayout fields
//
// Bake (`scripts/bake-dungeon.ts`) and runtime (`src/dungeon.ts`) both call
// `resolveDungeonLayout(DUNGEON_SEED)` so pack geometry and the live walk
// grid stay single-truth. Greybox `generateLayout` remains as an opt-in
// fallback behind `USE_GREYBOX_DUNGEON_LAYOUT` (or `{ useGreybox: true }`).

import {
  CELL,
  CELLS,
  WALL_H,
  generateLayout,
  mulberry32,
  type DungeonLayout,
  type GeoItem,
  type GeoKind,
} from './dungeon-layout';
import {
  generateDungeonGraph,
  type DungeonGraph,
} from './dungeon-graph';
import {
  selectModules,
  type ModulePlacement,
} from './dungeon-modules';
import {
  blockersFromWalk,
  buildCorridorNav,
  type CameraBlockerStub,
  type CorridorNavResult,
  type PlacedRoom,
} from './dungeon-corridors';
import {
  planEncounters,
  type EncounterPlan,
} from './dungeon-encounters';

/**
 * Escape hatch: when true, `resolveDungeonLayout` returns greybox
 * `generateLayout` (no graph/encounters extras). Default false — shipping
 * path is the modular pipeline.
 */
export const USE_GREYBOX_DUNGEON_LAYOUT = false;

/** Same decor fork salt as greybox dungeon-layout.ts (`seed ^ 0xdec0de`). */
const DECOR_STREAM_SALT = 0xdec0de;

export interface ModularDungeon extends DungeonLayout {
  graph: DungeonGraph;
  placements: ModulePlacement[];
  nav: CorridorNavResult;
  encounters: EncounterPlan;
}

function cellToLocal(cx: number, cy: number): { x: number; z: number } {
  return {
    x: (cx - CELLS / 2) * CELL,
    z: (cy - CELLS / 2) * CELL,
  };
}

/**
 * Floors + walls + greybox-style decor from walk + placed rooms.
 * Enough for bake-dungeon / runtime fallback spawn; camera proxies are T6.
 */
function buildGeometryFromNav(
  rooms: readonly PlacedRoom[],
  walk: ArrayLike<number>,
  seed: number,
  bossAt: { x: number; z: number },
): GeoItem[] {
  const geometry: GeoItem[] = [];
  const slab = (
    kind: GeoKind,
    x: number,
    z: number,
    w: number,
    d: number,
    yOrH?: number,
    h?: number,
  ): void => {
    const sy = h ?? yOrH ?? 0.28;
    const py = h !== undefined ? (yOrH ?? 0) : -(sy / 2);
    geometry.push({ kind, x, y: py, z, sx: w, sy, sz: d });
  };
  const inRoom = (cx: number, cy: number) =>
    rooms.some(
      (r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h,
    );

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i]!;
    const w0 = cellToLocal(r.x, r.y);
    const w1 = cellToLocal(r.x + r.w, r.y + r.h);
    slab(
      i % 2 ? 'floorA' : 'floorB',
      (w0.x + w1.x) / 2 - CELL / 2,
      (w0.z + w1.z) / 2 - CELL / 2,
      r.w * CELL,
      r.h * CELL,
    );
  }

  for (let cy = 0; cy < CELLS; cy++) {
    let run = -1;
    for (let cx = 0; cx <= CELLS; cx++) {
      const isCorr =
        cx < CELLS && !!walk[cy * CELLS + cx] && !inRoom(cx, cy);
      if (isCorr && run < 0) run = cx;
      if (!isCorr && run >= 0) {
        const a = cellToLocal(run, cy);
        const b = cellToLocal(cx - 1, cy);
        slab('floorA', (a.x + b.x) / 2, a.z, (cx - run) * CELL, CELL);
        run = -1;
      }
    }
  }

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
  for (let cy = 0; cy < CELLS; cy++) {
    let run = -1;
    for (let cx = 0; cx <= CELLS; cx++) {
      const b = cx < CELLS && isBoundary(cx, cy);
      if (b && run < 0) run = cx;
      if (!b && run >= 0) {
        const a = cellToLocal(run, cy);
        const bw = cellToLocal(cx - 1, cy);
        slab(
          'wall',
          (a.x + bw.x) / 2,
          a.z,
          (cx - run) * CELL,
          CELL,
          WALL_H / 2 - 0.1,
          WALL_H,
        );
        run = -1;
      }
    }
  }

  const dRnd = mulberry32(seed ^ DECOR_STREAM_SALT);
  for (const r of rooms) {
    const corners = [
      cellToLocal(r.x + 1, r.y + 1),
      cellToLocal(r.x + r.w - 2, r.y + r.h - 2),
      cellToLocal(r.x + r.w - 2, r.y + 1),
      cellToLocal(r.x + 1, r.y + r.h - 2),
    ];
    const nSpots = r.w >= 5 && r.h >= 5 ? 4 : 2;
    for (const s of corners.slice(0, nSpots)) {
      if (dRnd() < 0.2) continue;
      geometry.push({
        kind: 'torchPost',
        x: s.x,
        y: 0.9,
        z: s.z,
        sx: 0.14,
        sy: 1.8,
        sz: 0.14,
      });
      geometry.push({
        kind: 'flame',
        x: s.x,
        y: 1.95,
        z: s.z,
        sx: 0.26,
        sy: 0.34,
        sz: 0.26,
      });
    }
  }

  for (const r of rooms) {
    const decorN = Math.min(6, Math.max(2, Math.round(r.w * r.h * 0.1)));
    for (let k = 0; k < decorN; k++) {
      const cx = r.x + 1 + Math.floor(dRnd() * Math.max(1, r.w - 2));
      const cy = r.y + 1 + Math.floor(dRnd() * Math.max(1, r.h - 2));
      const s = cellToLocal(cx, cy);
      const jx = s.x + (dRnd() - 0.5) * CELL * 0.6;
      const jz = s.z + (dRnd() - 0.5) * CELL * 0.6;
      const roll = dRnd();
      if (roll < 0.28) {
        geometry.push({
          kind: 'rubble',
          x: jx,
          y: 0.16,
          z: jz,
          sx: 0.55,
          sy: 0.32,
          sz: 0.45,
        });
        geometry.push({
          kind: 'rubble',
          x: jx + 0.35,
          y: 0.1,
          z: jz + 0.2,
          sx: 0.3,
          sy: 0.2,
          sz: 0.3,
          rotY: 0.63,
        });
      } else if (roll < 0.5) {
        geometry.push({
          kind: 'bone',
          x: jx,
          y: 0.07,
          z: jz,
          sx: 0.5,
          sy: 0.12,
          sz: 0.14,
          rotY: 0.4,
        });
        geometry.push({
          kind: 'bone',
          x: jx + 0.1,
          y: 0.07,
          z: jz + 0.15,
          sx: 0.4,
          sy: 0.1,
          sz: 0.12,
          rotY: -0.87,
        });
      } else if (roll < 0.68) {
        const ry = (dRnd() - 0.5) * 1.4;
        geometry.push({
          kind: 'slag',
          x: jx,
          y: -0.01,
          z: jz,
          sx: 1.0 + dRnd() * 0.9,
          sy: 0.03,
          sz: 0.7 + dRnd() * 0.6,
          rotY: ry,
        });
      } else if (roll < 0.85) {
        geometry.push({
          kind: 'crate',
          x: jx,
          y: 0.2,
          z: jz,
          sx: 0.7,
          sy: 0.7,
          sz: 0.6,
          rotY: (dRnd() - 0.5) * 0.6,
        });
        if (dRnd() < 0.6) {
          geometry.push({
            kind: 'crate',
            x: jx + 0.6,
            y: 0.18,
            z: jz + 0.2,
            sx: 0.55,
            sy: 0.55,
            sz: 0.5,
            rotY: (dRnd() - 0.5) * 1.2,
          });
        }
      } else {
        geometry.push({
          kind: 'brazier',
          x: jx,
          y: 0.35,
          z: jz,
          sx: 0.7,
          sy: 0.7,
          sz: 0.7,
        });
      }
    }
    const hugN = Math.round((r.w + r.h) * 0.2);
    for (let k = 0; k < hugN; k++) {
      const side = Math.floor(dRnd() * 4);
      const along =
        1 + Math.floor(dRnd() * Math.max(1, (side < 2 ? r.w : r.h) - 2));
      const cx =
        side < 2 ? r.x + along : side === 2 ? r.x : r.x + r.w - 1;
      const cy =
        side < 2 ? (side === 0 ? r.y : r.y + r.h - 1) : r.y + along;
      const s = cellToLocal(cx, cy);
      const push = CELL * 0.32;
      const jx =
        s.x +
        (side === 2
          ? -push
          : side === 3
            ? push
            : (dRnd() - 0.5) * 0.5);
      const jz =
        s.z +
        (side === 0
          ? -push
          : side === 1
            ? push
            : (dRnd() - 0.5) * 0.5);
      const alongWall = side < 2 ? 0 : Math.PI / 2;
      if (dRnd() < 0.5) {
        geometry.push({
          kind: 'bone',
          x: jx,
          y: 0.06,
          z: jz,
          sx: 0.42,
          sy: 0.1,
          sz: 0.12,
          rotY: alongWall + (dRnd() - 0.5) * 0.5,
        });
      } else {
        geometry.push({
          kind: 'rubble',
          x: jx,
          y: 0.11,
          z: jz,
          sx: 0.4,
          sy: 0.22,
          sz: 0.34,
          rotY: alongWall + (dRnd() - 0.5) * 0.8,
        });
      }
    }
  }

  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      if (!walk[cy * CELLS + cx] || inRoom(cx, cy)) continue;
      if (dRnd() >= 0.05) continue;
      const s = cellToLocal(cx, cy);
      const jx = s.x + (dRnd() - 0.5) * CELL * 0.4;
      const jz = s.z + (dRnd() - 0.5) * CELL * 0.4;
      if (dRnd() < 0.5) {
        geometry.push({
          kind: 'slag',
          x: jx,
          y: -0.01,
          z: jz,
          sx: 0.6 + dRnd() * 0.5,
          sy: 0.03,
          sz: 0.5 + dRnd() * 0.4,
          rotY: (dRnd() - 0.5) * 1.4,
        });
      } else {
        geometry.push({
          kind: 'rubble',
          x: jx,
          y: 0.1,
          z: jz,
          sx: 0.35,
          sy: 0.2,
          sz: 0.3,
          rotY: dRnd() * Math.PI,
        });
      }
    }
  }

  for (const [ox, oz] of [
    [-3, -3],
    [3, 3],
    [-3, 3],
    [3, -3],
  ] as const) {
    geometry.push({
      kind: 'brazier',
      x: bossAt.x + ox,
      y: 0.35,
      z: bossAt.z + oz,
      sx: 0.7,
      sy: 0.7,
      sz: 0.7,
    });
  }

  return geometry;
}

/** Fail loud — never ship / bake an empty or boss-less den. */
function assertNonEmptyModular(mod: ModularDungeon): void {
  let walkable = 0;
  for (let i = 0; i < mod.walk.length; i++) {
    if (mod.walk[i]) walkable++;
  }
  if (mod.roomCount < 1) {
    throw new Error('generateModularLayout: empty roomCount');
  }
  if (walkable < 1) {
    throw new Error('generateModularLayout: empty walk grid');
  }
  if (
    !mod.geometry.some((g) => g.kind === 'floorA' || g.kind === 'floorB')
  ) {
    throw new Error('generateModularLayout: no floor geometry');
  }
  if (!mod.geometry.some((g) => g.kind === 'wall')) {
    throw new Error('generateModularLayout: no wall geometry');
  }
  if (mod.monsterSpawns.length < 1) {
    throw new Error('generateModularLayout: empty monsterSpawns');
  }
  if (!mod.monsterSpawns.some((s) => s.kind === 'slaglord')) {
    throw new Error('generateModularLayout: missing slaglord boss spawn');
  }
}

/**
 * Compose graph→modules→corridors→encounters into a DungeonLayout-compatible
 * object (plus stage extras for L4 / T6 consumers).
 */
export function generateModularLayout(seed: number): ModularDungeon {
  const graph = generateDungeonGraph(seed);
  const placements = selectModules(graph, seed);
  const nav = buildCorridorNav(graph, placements, seed);
  const encounters = planEncounters(graph, nav, seed);

  // Single-truth walk: reuse the frozen T3 snapshot — layout.walk === nav.walk.
  const walk = nav.walk;
  const entry = cellToLocal(nav.entryCell.cx, nav.entryCell.cy);
  const bossAt = cellToLocal(nav.bossCell.cx, nav.bossCell.cy);
  const bossRoom = nav.rooms.find((r) => r.nodeId === 'boss');
  if (!bossRoom) {
    throw new Error('generateModularLayout: boss room missing');
  }

  const monsterSpawns: DungeonLayout['monsterSpawns'] = encounters.spawns.map(
    (s) => ({ kind: s.kind, x: s.x, z: s.z }),
  );

  const geometry = buildGeometryFromNav(nav.rooms, walk, seed, bossAt);

  const mod: ModularDungeon = {
    walk,
    roomCount: nav.rooms.length,
    entry,
    bossAt,
    bossSize: { w: bossRoom.w * CELL, h: bossRoom.h * CELL },
    monsterSpawns,
    geometry,
    graph,
    placements,
    nav,
    encounters,
  };
  assertNonEmptyModular(mod);
  return mod;
}

/**
 * Bake + runtime entry: modular by default; greybox when the flag is set
 * (or when `options.useGreybox` is true — for tests / local escape hatch).
 * Greybox result has no graph/nav/encounters extras.
 */
export function resolveDungeonLayout(
  seed: number,
  options?: { useGreybox?: boolean },
): DungeonLayout | ModularDungeon {
  const useGreybox = options?.useGreybox ?? USE_GREYBOX_DUNGEON_LAYOUT;
  if (useGreybox) {
    return generateLayout(seed);
  }
  return generateModularLayout(seed);
}

export function isModularDungeon(
  layout: DungeonLayout | ModularDungeon,
): layout is ModularDungeon {
  return (
    'encounters' in layout &&
    'nav' in layout &&
    'graph' in layout &&
    (layout as ModularDungeon).encounters != null
  );
}

/**
 * T6 camera-stub source for den walls — same selection `Dungeon` uses.
 * Modular: frozen `nav.blockers`. Greybox: derive from `walk` (no nav).
 */
export function denCameraBlockerStubs(
  layout: DungeonLayout | ModularDungeon,
): readonly CameraBlockerStub[] {
  if (isModularDungeon(layout)) return layout.nav.blockers;
  return blockersFromWalk(layout.walk);
}
