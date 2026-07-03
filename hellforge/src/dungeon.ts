// Hellforge PCG dungeon — 熔渣深窟 Slagdeep Hollow, the Act 1 dungeon.
//
// A seeded room-and-corridor generator. The dungeon lives IN THE SAME WORLD
// as the encampment, offset far away at DUNGEON_ORIGIN (beyond the camera's
// far plane, so neither area ever renders while you're in the other) —
// entering/leaving is a player teleport, which sidesteps the engine's
// scene-switch full-rebuild renderer bug entirely.
//
// Generation
//   1. scatter candidate rooms on a CELLS×CELLS grid, reject overlaps
//   2. Prim-style connect: every room links to the nearest connected room
//      with an L-shaped 2-cell-wide corridor
//   3. carve a walkable[] grid; geometry = one floor slab per room, merged
//      horizontal runs for corridor floors, merged runs of boundary cells
//      for walls (entity-budget friendly: ~120 entities total)
//   4. room furthest from the entrance = boss room; the rest get monster
//      packs whose difficulty scales with distance from the entrance
//
// The walkable(x, z) query is the movement collision for both the player
// and dungeon monsters.

import {
  Transform, MeshFilter, MeshRenderer, Materials,
  HANDLE_CUBE,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle } from '@forgeax/engine-types';

import type { MonsterKind } from './monsters';

type MatHandle = Handle<'MaterialAsset', 'shared'>;

export const DUNGEON_ORIGIN = { x: 300, z: 300 };
const CELLS = 44;
const CELL = 2.4;               // metres per grid cell
const WALL_H = 3.2;

/** mulberry32 — tiny seeded PRNG so a run's dungeon is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Room { cx: number; cy: number; w: number; h: number }

export interface MonsterSpawn { kind: MonsterKind; x: number; z: number }

export class Dungeon {
  private walk: Uint8Array = new Uint8Array(CELLS * CELLS);
  /** World-space entry pad (where the player appears when entering). */
  entry = { x: 0, z: 0 };
  /** World-space boss-room centre. */
  bossAt = { x: 0, z: 0 };
  monsterSpawns: MonsterSpawn[] = [];
  roomCount = 0;

  constructor(private world: World, seed: number) {
    this.generate(seed);
  }

  private cellToWorld(cx: number, cy: number): { x: number; z: number } {
    return {
      x: DUNGEON_ORIGIN.x + (cx - CELLS / 2) * CELL,
      z: DUNGEON_ORIGIN.z + (cy - CELLS / 2) * CELL,
    };
  }

  /** World-space walkability (small square footprint so hugging walls works). */
  walkable(wx: number, wz: number): boolean {
    for (const [ox, oz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]] as const) {
      const cx = Math.floor((wx + ox - DUNGEON_ORIGIN.x) / CELL + CELLS / 2);
      const cy = Math.floor((wz + oz - DUNGEON_ORIGIN.z) / CELL + CELLS / 2);
      if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return false;
      if (!this.walk[cy * CELLS + cx]) return false;
    }
    return true;
  }

  /** True when a world point is anywhere inside the dungeon's grid bounds. */
  contains(wx: number, wz: number): boolean {
    return Math.abs(wx - DUNGEON_ORIGIN.x) < (CELLS / 2 + 2) * CELL
        && Math.abs(wz - DUNGEON_ORIGIN.z) < (CELLS / 2 + 2) * CELL;
  }

  private carve(cx: number, cy: number): void {
    if (cx >= 1 && cy >= 1 && cx < CELLS - 1 && cy < CELLS - 1) this.walk[cy * CELLS + cx] = 1;
  }

  private generate(seed: number): void {
    const rnd = mulberry32(seed);
    // ── 1. rooms ──
    const rooms: Room[] = [];
    for (let tries = 0; tries < 60 && rooms.length < 9; tries++) {
      const w = 4 + Math.floor(rnd() * 4);
      const h = 4 + Math.floor(rnd() * 4);
      const cx = 2 + Math.floor(rnd() * (CELLS - w - 4));
      const cy = 2 + Math.floor(rnd() * (CELLS - h - 4));
      const cand: Room = { cx, cy, w, h };
      const clash = rooms.some((r) =>
        cand.cx < r.cx + r.w + 2 && r.cx < cand.cx + cand.w + 2 &&
        cand.cy < r.cy + r.h + 2 && r.cy < cand.cy + cand.h + 2);
      if (!clash) rooms.push(cand);
    }
    this.roomCount = rooms.length;
    for (const r of rooms) {
      for (let y = r.cy; y < r.cy + r.h; y++) {
        for (let x = r.cx; x < r.cx + r.w; x++) this.carve(x, y);
      }
    }
    // ── 2. corridors (Prim-lite: link each room to the nearest connected) ──
    const centre = (r: Room) => ({ x: r.cx + Math.floor(r.w / 2), y: r.cy + Math.floor(r.h / 2) });
    const connected = [rooms[0]!];
    const pending = rooms.slice(1);
    while (pending.length > 0) {
      let bi = 0, bj = 0, bd = Infinity;
      for (let i = 0; i < pending.length; i++) {
        for (let j = 0; j < connected.length; j++) {
          const a = centre(pending[i]!), b = centre(connected[j]!);
          const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
      }
      const a = centre(pending[bi]!), b = centre(connected[bj]!);
      // L-shape, 2 cells wide, horizontal-then-vertical or vice versa.
      const horizFirst = rnd() < 0.5;
      const carveH = (y: number, x0: number, x1: number) => {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { this.carve(x, y); this.carve(x, y + 1); }
      };
      const carveV = (x: number, y0: number, y1: number) => {
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { this.carve(x, y); this.carve(x + 1, y); }
      };
      if (horizFirst) { carveH(a.y, a.x, b.x); carveV(b.x, a.y, b.y); }
      else { carveV(a.x, a.y, b.y); carveH(b.y, a.x, b.x); }
      connected.push(pending[bi]!);
      pending.splice(bi, 1);
    }
    // ── 3. entrance / boss rooms ──
    const entryRoom = rooms[0]!;
    const ec = centre(entryRoom);
    let bossRoom = rooms[rooms.length - 1]!;
    let bestD = -1;
    for (const r of rooms.slice(1)) {
      const c = centre(r);
      const d = Math.abs(c.x - ec.x) + Math.abs(c.y - ec.y);
      if (d > bestD) { bestD = d; bossRoom = r; }
    }
    const bc = centre(bossRoom);
    this.entry = this.cellToWorld(ec.x, ec.y);
    this.bossAt = this.cellToWorld(bc.x, bc.y);

    // ── 4. geometry ──
    this.spawnGeometry(rooms, rnd);

    // ── 5. monster packs ──
    const maxD = bestD || 1;
    for (const r of rooms) {
      if (r === entryRoom) continue;
      const c = centre(r);
      const depth = (Math.abs(c.x - ec.x) + Math.abs(c.y - ec.y)) / maxD;   // 0..1
      if (r === bossRoom) {
        this.monsterSpawns.push({ kind: 'slaglord', ...this.cellToWorld(bc.x, bc.y) });
        // Boss guards: a couple of shamans in the corners.
        this.monsterSpawns.push({ kind: 'flamecaller', ...this.cellToWorld(r.cx + 1, r.cy + 1) });
        this.monsterSpawns.push({ kind: 'flamecaller', ...this.cellToWorld(r.cx + r.w - 2, r.cy + r.h - 2) });
        continue;
      }
      const packSize = 2 + Math.floor(rnd() * 3) + (depth > 0.6 ? 1 : 0);
      for (let i = 0; i < packSize; i++) {
        const kind: MonsterKind =
          rnd() < 0.15 + depth * 0.2 ? (rnd() < 0.5 ? 'flamecaller' : 'charred')
          : rnd() < 0.5 ? 'imp' : 'ashwalker';
        const sx = r.cx + 1 + Math.floor(rnd() * Math.max(1, r.w - 2));
        const sy = r.cy + 1 + Math.floor(rnd() * Math.max(1, r.h - 2));
        this.monsterSpawns.push({ kind, ...this.cellToWorld(sx, sy) });
      }
    }
  }

  private spawnGeometry(rooms: Room[], rnd: () => number): void {
    const mkMat = (color: [number, number, number, number], opts: { rough?: number; emissive?: [number, number, number]; ei?: number } = {}) =>
      this.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: color, roughness: opts.rough ?? 0.9, metallic: 0.02,
        emissive: opts.emissive, emissiveIntensity: opts.ei ?? (opts.emissive ? 2 : 0),
      }));
    const floorMat = mkMat([0.16, 0.13, 0.14, 1]);
    const floorMat2 = mkMat([0.13, 0.11, 0.13, 1]);
    const wallMat = mkMat([0.24, 0.17, 0.15, 1]);
    const torchPostMat = mkMat([0.2, 0.13, 0.08, 1]);
    const flameMat = mkMat([1, 0.5, 0.12, 1], { emissive: [1, 0.45, 0.10], ei: 2.2 });
    const brazierMat = mkMat([0.45, 0.08, 0.03, 1], { emissive: [1, 0.12, 0.03], ei: 1.2 });
    const rubbleMat = mkMat([0.30, 0.26, 0.25, 1]);
    const boneMat = mkMat([0.62, 0.56, 0.44, 1], { rough: 0.7 });
    // Slag/brazier reds: keep the total emissive peak ≈1 with G ≪ R, or the
    // ACES tonemap spills the over-bright red into green → amber/yellow.
    const slagMat = mkMat([0.40, 0.06, 0.02, 1], { rough: 0.5, emissive: [1, 0.10, 0.02], ei: 1.0 });

    const slab = (wx: number, wz: number, w: number, d: number, mat: MatHandle, y = -0.1, h = 0.2): void => {
      this.world.spawn(
        { component: Transform, data: { posX: wx, posY: y, posZ: wz, scaleX: w, scaleY: h, scaleZ: d } },
        { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
        { component: MeshRenderer, data: { materials: [mat] } },
      );
    };

    // Room floors — one slab each (alternating tint so rooms read distinct).
    const inRoom = (cx: number, cy: number) => rooms.some((r) => cx >= r.cx && cx < r.cx + r.w && cy >= r.cy && cy < r.cy + r.h);
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i]!;
      const w0 = this.cellToWorld(r.cx, r.cy);
      const w1 = this.cellToWorld(r.cx + r.w, r.cy + r.h);
      slab((w0.x + w1.x) / 2 - CELL / 2, (w0.z + w1.z) / 2 - CELL / 2, r.w * CELL, r.h * CELL, i % 2 ? floorMat : floorMat2);
    }
    // Corridor floors — merged horizontal runs of walkable non-room cells.
    for (let cy = 0; cy < CELLS; cy++) {
      let run = -1;
      for (let cx = 0; cx <= CELLS; cx++) {
        const isCorr = cx < CELLS && !!this.walk[cy * CELLS + cx] && !inRoom(cx, cy);
        if (isCorr && run < 0) run = cx;
        if (!isCorr && run >= 0) {
          const a = this.cellToWorld(run, cy);
          const b = this.cellToWorld(cx - 1, cy);
          slab((a.x + b.x) / 2, a.z, (cx - run) * CELL, CELL, floorMat);
          run = -1;
        }
      }
    }
    // Walls — merged horizontal runs of boundary cells (non-walkable cells
    // that touch a walkable neighbour, 8-way so diagonal corners seal).
    const isBoundary = (cx: number, cy: number): boolean => {
      if (this.walk[cy * CELLS + cx]) return false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < CELLS && ny < CELLS && this.walk[ny * CELLS + nx]) return true;
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
          const a = this.cellToWorld(run, cy);
          const bw = this.cellToWorld(cx - 1, cy);
          slab((a.x + bw.x) / 2, a.z, (cx - run) * CELL, CELL, wallMat, WALL_H / 2 - 0.1, WALL_H);
          run = -1;
        }
      }
    }
    // Torches — 2 per room (post + emissive flame), no PointLight except the
    // boss room's braziers (light budget: the player torch follows anyway).
    for (const r of rooms) {
      const spots = [
        this.cellToWorld(r.cx + 1, r.cy + 1),
        this.cellToWorld(r.cx + r.w - 2, r.cy + r.h - 2),
      ];
      for (const s of spots) {
        if (rnd() < 0.2) continue;   // some rooms feel darker
        this.world.spawn(
          { component: Transform, data: { posX: s.x, posY: 0.9, posZ: s.z, scaleX: 0.14, scaleY: 1.8, scaleZ: 0.14 } },
          { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
          { component: MeshRenderer, data: { materials: [torchPostMat] } },
        );
        this.world.spawn(
          { component: Transform, data: { posX: s.x, posY: 1.95, posZ: s.z, scaleX: 0.26, scaleY: 0.34, scaleZ: 0.26 } },
          { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
          { component: MeshRenderer, data: { materials: [flameMat] } },
        );
      }
    }
    // Room decor — rubble piles, charred-bone piles, glowing slag pools
    // (the hollow IS a slag vein; the pools are the theme's signature).
    // Small enough to walk over — no walkability carve-outs needed.
    for (const r of rooms) {
      const decorN = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < decorN; k++) {
        const cx = r.cx + 1 + Math.floor(rnd() * Math.max(1, r.w - 2));
        const cy = r.cy + 1 + Math.floor(rnd() * Math.max(1, r.h - 2));
        const s = this.cellToWorld(cx, cy);
        const jx = s.x + (rnd() - 0.5) * CELL * 0.6;
        const jz = s.z + (rnd() - 0.5) * CELL * 0.6;
        const roll = rnd();
        if (roll < 0.4) {
          // rubble pile: 2 tumbled rocks
          this.world.spawn(
            { component: Transform, data: { posX: jx, posY: 0.16, posZ: jz, scaleX: 0.55, scaleY: 0.32, scaleZ: 0.45 } },
            { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
            { component: MeshRenderer, data: { materials: [rubbleMat] } },
          );
          this.world.spawn(
            { component: Transform, data: { posX: jx + 0.35, posY: 0.1, posZ: jz + 0.2, scaleX: 0.3, scaleY: 0.2, scaleZ: 0.3, quatX: 0, quatY: 0.31, quatZ: 0, quatW: 0.95 } },
            { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
            { component: MeshRenderer, data: { materials: [rubbleMat] } },
          );
        } else if (roll < 0.7) {
          // charred-bone pile: 2 crossed slats
          this.world.spawn(
            { component: Transform, data: { posX: jx, posY: 0.07, posZ: jz, scaleX: 0.5, scaleY: 0.12, scaleZ: 0.14, quatX: 0, quatY: 0.2, quatZ: 0, quatW: 0.98 } },
            { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
            { component: MeshRenderer, data: { materials: [boneMat] } },
          );
          this.world.spawn(
            { component: Transform, data: { posX: jx + 0.1, posY: 0.07, posZ: jz + 0.15, scaleX: 0.4, scaleY: 0.1, scaleZ: 0.12, quatX: 0, quatY: -0.42, quatZ: 0, quatW: 0.91 } },
            { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
            { component: MeshRenderer, data: { materials: [boneMat] } },
          );
        } else {
          // glowing slag pool (flat emissive slab)
          const ry = (rnd() - 0.5) * 1.4;
          this.world.spawn(
            { component: Transform, data: { posX: jx, posY: 0.02, posZ: jz, scaleX: 1.0 + rnd() * 0.9, scaleY: 0.04, scaleZ: 0.7 + rnd() * 0.6, quatX: 0, quatY: Math.sin(ry / 2), quatZ: 0, quatW: Math.cos(ry / 2) } },
            { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
            { component: MeshRenderer, data: { materials: [slagMat] } },
          );
        }
      }
    }
    // Boss-room braziers (emissive only — the engine's multi-light system
    // caps point lights at 4 and the camp pack + player torch already fill
    // the budget; a 5th here would just be dropped with a warning).
    const bossSpots = [
      { x: this.bossAt.x - 3, z: this.bossAt.z - 3 },
      { x: this.bossAt.x + 3, z: this.bossAt.z + 3 },
    ];
    for (const s of bossSpots) {
      this.world.spawn(
        { component: Transform, data: { posX: s.x, posY: 0.35, posZ: s.z, scaleX: 0.7, scaleY: 0.7, scaleZ: 0.7 } },
        { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
        { component: MeshRenderer, data: { materials: [brazierMat] } },
      );
    }
  }
}

/** One EntityHandle-typed export so main.ts can hold portals uniformly. */
export interface PortalDisc {
  e: EntityHandle;
  x: number; z: number;
  r: number;
}
