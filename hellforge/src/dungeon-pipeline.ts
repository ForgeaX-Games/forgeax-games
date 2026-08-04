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

/**
 * Floor runs this far UNDER each wall cell from every side that touches
 * walkable space. The wall prop (prop-den-wall) is an organic rock blob whose
 * base silhouette recedes up to ~1 m behind its bbox front face, so a floor
 * that stops at the walkable-cell boundary leaves a dark trench at every wall
 * foot (worst at corners). 0.6 m covers the common recession depth.
 */
export const WALL_FLOOR_OVERHANG = 0.6;

/**
 * Under-wall floor strips sit this far below the walk plane (y=0). Wherever a
 * strip overlaps a base floor slab the base slab wins the depth test, so the
 * strip shows only inside wall cells — never a z-fight, never a visible step.
 */
export const WALL_FLOOR_STRIP_DROP = 0.004;

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
  const roomIndexAt = (cx: number, cy: number) =>
    rooms.findIndex(
      (r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h,
    );
  const walkAt = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < CELLS && cy < CELLS && !!walk[cy * CELLS + cx];

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
    if (walkAt(cx, cy)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (walkAt(cx + dx, cy + dy)) {
          return true;
        }
      }
    }
    return false;
  };

  // Wall runs carry their FACING as rotY (yaw mapping the wall prop's +Z
  // front onto the walkable side); the bake seats each block so its bbox
  // front face lands exactly on the walkable-cell boundary (native prop
  // depth, no cell-filling stretch). A run squeezed between two walkable
  // areas (walkable on BOTH ±Z sides, or both ±X sides of a 1-cell pillar)
  // is emitted as TWO half-depth runs — one seated on each boundary — so
  // neither side keeps a gap; 2× native depth (2.28 m) still fits the cell.
  // Multi-cell runs never face ±X (only their end cells can vote ±X, and
  // those sides are covered flush by the column end caps).
  const emitWallRun = (runCx0: number, runCx1: number, cy: number): void => {
    const a = cellToLocal(runCx0, cy);
    const bw = cellToLocal(runCx1, cy);
    const centerX = (a.x + bw.x) / 2;
    const centerZ = a.z;
    const w = (runCx1 - runCx0 + 1) * CELL;
    let vPZ = 0;
    let vNZ = 0;
    let vPX = 0;
    let vNX = 0;
    for (let x = runCx0; x <= runCx1; x++) {
      if (walkAt(x, cy + 1)) vPZ++;
      if (walkAt(x, cy - 1)) vNZ++;
      if (walkAt(x + 1, cy)) vPX++;
      if (walkAt(x - 1, cy)) vNX++;
    }
    const yC = WALL_H / 2 - 0.1;
    const wall = (
      x: number,
      z: number,
      sx: number,
      sz: number,
      rotY: number,
    ): void => {
      geometry.push({ kind: 'wall', x, y: yC, z, sx, sy: WALL_H, sz, rotY });
    };
    if (vPZ > 0 && vNZ > 0) {
      wall(centerX, centerZ + CELL / 4, w, CELL / 2, 0);
      wall(centerX, centerZ - CELL / 4, w, CELL / 2, Math.PI);
      return;
    }
    if (vPX > 0 && vNX > 0 && vPZ === 0 && vNZ === 0 && runCx0 === runCx1) {
      wall(centerX + CELL / 4, centerZ, CELL / 2, CELL, Math.PI / 2);
      wall(centerX - CELL / 4, centerZ, CELL / 2, CELL, -Math.PI / 2);
      return;
    }
    const rotY =
      vPZ + vNZ >= vPX + vNX
        ? vPZ >= vNZ
          ? 0
          : Math.PI
        : vPX >= vNX
          ? Math.PI / 2
          : -Math.PI / 2;
    wall(centerX, centerZ, w, CELL, rotY);
  };

  for (let cy = 0; cy < CELLS; cy++) {
    let run = -1;
    for (let cx = 0; cx <= CELLS; cx++) {
      const b = cx < CELLS && isBoundary(cx, cy);
      if (b && run < 0) run = cx;
      if (!b && run >= 0) {
        emitWallRun(run, cx - 1, cy);
        run = -1;
      }
    }
  }

  // Under-wall floor strips: extend the floor WALL_FLOOR_OVERHANG metres
  // under every boundary cell from each side that touches walkable (a
  // walkable DIAGONAL neighbour contributes the two adjacent side strips —
  // that covers inner corners, where the trench was worst). One merged slab
  // per boundary cell; its top sits WALL_FLOOR_STRIP_DROP below the walk
  // plane so it never z-fights the base slabs or the wall blocks above it.
  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      if (!isBoundary(cx, cy)) continue;
      const L = cellToLocal(cx, cy);
      const x0 = L.x - CELL / 2;
      const x1 = L.x + CELL / 2;
      const z0 = L.z - CELL / 2;
      const z1 = L.z + CELL / 2;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      const growZSide = (top: boolean): void => {
        minX = Math.min(minX, x0);
        maxX = Math.max(maxX, x1);
        if (top) {
          minZ = Math.min(minZ, z1 - WALL_FLOOR_OVERHANG);
          maxZ = Math.max(maxZ, z1);
        } else {
          minZ = Math.min(minZ, z0);
          maxZ = Math.max(maxZ, z0 + WALL_FLOOR_OVERHANG);
        }
      };
      const growXSide = (right: boolean): void => {
        minZ = Math.min(minZ, z0);
        maxZ = Math.max(maxZ, z1);
        if (right) {
          minX = Math.min(minX, x1 - WALL_FLOOR_OVERHANG);
          maxX = Math.max(maxX, x1);
        } else {
          minX = Math.min(minX, x0);
          maxX = Math.max(maxX, x0 + WALL_FLOOR_OVERHANG);
        }
      };
      if (walkAt(cx, cy + 1)) growZSide(true);
      if (walkAt(cx, cy - 1)) growZSide(false);
      if (walkAt(cx + 1, cy)) growXSide(true);
      if (walkAt(cx - 1, cy)) growXSide(false);
      for (const [dx, dy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        if (!walkAt(cx + dx, cy + dy)) continue;
        growXSide(dx > 0);
        growZSide(dy > 0);
      }
      if (!Number.isFinite(minX)) continue; // boundary ⇒ ≥1 walkable neighbour
      // Tint follows the adjacent room slab when there is one (corridor and
      // room-edge floors otherwise match the corridor tint, floorA).
      let kind: GeoKind = 'floorA';
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const ri = roomIndexAt(cx + dx, cy + dy);
        if (ri >= 0) {
          kind = ri % 2 ? 'floorA' : 'floorB';
          break;
        }
      }
      geometry.push({
        kind,
        x: (minX + maxX) / 2,
        y: -WALL_FLOOR_STRIP_DROP - 0.28 / 2, // 0.28 = slab() default floor thickness
        z: (minZ + maxZ) / 2,
        sx: maxX - minX,
        sy: 0.28,
        sz: maxZ - minZ,
      });
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
      if (dRnd() < 0.1) continue;
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

  // room decor — N4 #17A: density pushed to the ceiling (decorN ≈ 22% of room
  // area, capped 14) with a rich weighted table; every multi-piece heap gets a
  // `cluster` id (exactly 3 pieces) so bake + tests can verify pile structure.
  // Piles cap at 3 each per room; once a cap is hit the roll falls through to
  // the next band (intentional distribution shift, not a bug).
  let pileSerial = 0;
  for (const r of rooms) {
    const decorN = Math.min(14, Math.max(5, Math.round(r.w * r.h * 0.22)));
    let woodPiles = 0;
    let stonePiles = 0;
    let campfireBases = 0;
    for (let k = 0; k < decorN; k++) {
      const cx = r.x + 1 + Math.floor(dRnd() * Math.max(1, r.w - 2));
      const cy = r.y + 1 + Math.floor(dRnd() * Math.max(1, r.h - 2));
      const s = cellToLocal(cx, cy);
      const jx = s.x + (dRnd() - 0.5) * CELL * 0.6;
      const jz = s.z + (dRnd() - 0.5) * CELL * 0.6;
      const roll = dRnd();
      if (roll < 0.18) {
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
      } else if (roll < 0.34) {
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
      } else if (roll < 0.46) {
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
      } else if (roll < 0.56) {
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
      } else if (roll < 0.68 && woodPiles < 3) {
        // wood pile — THREE logs fanned out (y = lift above floor; the 'pile'
        // bake policy honours it, the runtime fallback mirrors it)
        woodPiles++;
        const cluster = ++pileSerial;
        geometry.push({
          kind: 'woodPile',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.9,
          sy: 0.45,
          sz: 0.5,
          rotY: (dRnd() - 0.5) * 0.8,
          cluster,
        });
        geometry.push({
          kind: 'woodPile',
          x: jx + 0.35,
          y: 0.1,
          z: jz + 0.2,
          sx: 0.7,
          sy: 0.35,
          sz: 0.4,
          rotY: (dRnd() - 0.5) * 1.6,
          cluster,
        });
        geometry.push({
          kind: 'woodPile',
          x: jx - 0.25,
          y: 0.07,
          z: jz + 0.3,
          sx: 0.6,
          sy: 0.3,
          sz: 0.35,
          rotY: (dRnd() - 0.5) * 1.6,
          cluster,
        });
      } else if (roll < 0.8 && stonePiles < 3) {
        // stone pile — boulder + two companions (near-cubic GLB: uniform-scale
        // top = sx×0.66 with pile down-only jitter, keeps every top ≤0.55 m)
        stonePiles++;
        const cluster = ++pileSerial;
        geometry.push({
          kind: 'stonePile',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.4,
          sy: 0.32,
          sz: 0.38,
          rotY: (dRnd() - 0.5) * 0.8,
          cluster,
        });
        geometry.push({
          kind: 'stonePile',
          x: jx + 0.45,
          y: 0.05,
          z: jz - 0.2,
          sx: 0.28,
          sy: 0.22,
          sz: 0.26,
          rotY: (dRnd() - 0.5) * 1.6,
          cluster,
        });
        geometry.push({
          kind: 'stonePile',
          x: jx - 0.15,
          y: 0.03,
          z: jz + 0.45,
          sx: 0.22,
          sy: 0.18,
          sz: 0.2,
          rotY: (dRnd() - 0.5) * 1.6,
          cluster,
        });
      } else if (roll < 0.9) {
        // dead tree branch — low sprawl piece (h ≈ sx×0.65)
        geometry.push({
          kind: 'deadtreeBranch',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.5,
          sy: 0.33,
          sz: 0.3,
          rotY: dRnd() * Math.PI,
        });
      } else if (roll < 0.97 && campfireBases < 2) {
        // abandoned campfire — stone base ring + two dead logs (cap 2/room)
        campfireBases++;
        const cluster = ++pileSerial;
        geometry.push({
          kind: 'campfireBase',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.7,
          sy: 0.32,
          sz: 0.65,
          rotY: (dRnd() - 0.5) * 0.6,
          cluster,
        });
        geometry.push({
          kind: 'woodPile',
          x: jx + 0.35,
          y: 0.03,
          z: jz + 0.25,
          sx: 0.5,
          sy: 0.26,
          sz: 0.3,
          rotY: (dRnd() - 0.5) * 1.4,
          cluster,
        });
        geometry.push({
          kind: 'woodPile',
          x: jx - 0.3,
          y: 0.02,
          z: jz - 0.15,
          sx: 0.45,
          sy: 0.23,
          sz: 0.28,
          rotY: (dRnd() - 0.5) * 1.4,
          cluster,
        });
      } else if (roll < 0.97) {
        // campfire cap hit — rubble pair fallback
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
    // wall-hug clutter — bones / rubble / dead tree trunks / fence panels
    // against the room's inner edge (debris collects at the walls)
    const hugN = Math.round((r.w + r.h) * 0.35);
    let trunks = 0;
    let fences = 0;
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
      const hroll = dRnd();
      if (hroll < 0.3) {
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
      } else if (hroll < 0.6) {
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
      } else if (hroll < 0.8 && trunks < 2) {
        // dead tree trunk — short wall-hug bole (h ≈ sx)
        trunks++;
        geometry.push({
          kind: 'deadtreeTrunk',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.45,
          sy: 0.45,
          sz: 0.4,
          rotY: alongWall + (dRnd() - 0.5) * 0.4,
        });
      } else if (hroll < 1 && fences < 3) {
        // fence panel — low palisade against the wall (h ≈ sx×0.6)
        fences++;
        geometry.push({
          kind: 'fence',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.55,
          sy: 0.3,
          sz: 0.25,
          rotY: alongWall + (dRnd() - 0.5) * 0.4,
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
      if (dRnd() >= 0.15) continue;
      const s = cellToLocal(cx, cy);
      const jx = s.x + (dRnd() - 0.5) * CELL * 0.4;
      const jz = s.z + (dRnd() - 0.5) * CELL * 0.4;
      const croll = dRnd();
      if (croll < 0.3) {
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
      } else if (croll < 0.6) {
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
      } else if (croll < 0.75) {
        // corridor stone heap — 3 small pieces hugging the walkway
        const cluster = ++pileSerial;
        geometry.push({
          kind: 'stonePile',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.32,
          sy: 0.26,
          sz: 0.3,
          rotY: dRnd() * Math.PI,
          cluster,
        });
        geometry.push({
          kind: 'stonePile',
          x: jx + 0.3,
          y: 0.03,
          z: jz + 0.15,
          sx: 0.22,
          sy: 0.18,
          sz: 0.2,
          rotY: dRnd() * Math.PI,
          cluster,
        });
        geometry.push({
          kind: 'stonePile',
          x: jx - 0.22,
          y: 0.02,
          z: jz - 0.12,
          sx: 0.18,
          sy: 0.14,
          sz: 0.16,
          rotY: dRnd() * Math.PI,
          cluster,
        });
      } else if (croll < 0.85) {
        // corridor wood heap — 3 small logs
        const cluster = ++pileSerial;
        geometry.push({
          kind: 'woodPile',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.55,
          sy: 0.32,
          sz: 0.4,
          rotY: dRnd() * Math.PI,
          cluster,
        });
        geometry.push({
          kind: 'woodPile',
          x: jx + 0.25,
          y: 0.06,
          z: jz - 0.2,
          sx: 0.4,
          sy: 0.24,
          sz: 0.3,
          rotY: dRnd() * Math.PI,
          cluster,
        });
        geometry.push({
          kind: 'woodPile',
          x: jx - 0.2,
          y: 0.03,
          z: jz + 0.15,
          sx: 0.32,
          sy: 0.2,
          sz: 0.24,
          rotY: dRnd() * Math.PI,
          cluster,
        });
      } else {
        // sprawled dead branch
        geometry.push({
          kind: 'deadtreeBranch',
          x: jx,
          y: 0,
          z: jz,
          sx: 0.4,
          sy: 0.26,
          sz: 0.25,
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
