// Hellforge dungeon LAYOUT — the pure, engine-free generator.
//
// One deterministic function of a seed. Both consumers run it with
// DUNGEON_SEED and therefore agree exactly:
//   • scripts/bake-dungeon.ts  — turns layout.geometry into the editable
//     scene pack `assets/scenes/slagdeep-hollow.pack.json` (LOCAL coordinates,
//     centred near the origin so the editor is pleasant to work in)
//   • src/dungeon.ts (runtime) — uses walls/entry/boss/monsterSpawns for
//     walkability + gameplay, and instantiates the baked pack under a root
//     at DUNGEON_ORIGIN (or, as a fallback, spawns geometry itself)
//
// EVERY random decision (rooms, corridors, torch skips, decor rolls) lives
// HERE so the baked geometry can never drift from the runtime grid. If you
// change anything in this file, re-run:  bun scripts/bake-dungeon.ts

export const DUNGEON_SEED = 20260703;
export const CELLS = 44;
export const CELL = 2.4;               // metres per grid cell
export const WALL_H = 3.2;

/** Scene-asset GUID of the baked pack (assets/scenes/slagdeep-hollow.pack.json).
 *  Fixed so re-baking never churns identity — bake script + runtime share it. */
export const DUNGEON_SCENE_GUID = '7d1f4b02-5c8e-4b3a-9f6d-2e8a1c0b4d97';

/** mulberry32 — tiny seeded PRNG so a seed's dungeon is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Y-axis rotation quaternion [x,y,z,w] — shared by bake + runtime fallback. */
export function quatY(rad: number): [number, number, number, number] {
  return [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
}

export interface Room { cx: number; cy: number; w: number; h: number }

export type DenMonsterKind = 'imp' | 'ashwalker' | 'charred' | 'flamecaller' | 'slaglord';

/** Geometry primitive in LOCAL coords (world = local + DUNGEON_ORIGIN). */
export type GeoKind =
  | 'floorA' | 'floorB' | 'wall'
  | 'torchPost' | 'flame' | 'brazier'
  | 'rubble' | 'bone' | 'slag' | 'crate';

export interface GeoItem {
  kind: GeoKind;
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  rotY?: number;
}

export interface DungeonLayout {
  walk: Uint8Array;                      // CELLS×CELLS walkability
  roomCount: number;
  /** LOCAL coords — consumers add DUNGEON_ORIGIN for world space. */
  entry: { x: number; z: number };
  bossAt: { x: number; z: number };
  /** Boss-room footprint in metres (LOCAL) — sizes the PR1 antechamber pack. */
  bossSize: { w: number; h: number };
  monsterSpawns: Array<{ kind: DenMonsterKind; x: number; z: number }>;
  geometry: GeoItem[];
}

const cellToLocal = (cx: number, cy: number) => ({
  x: (cx - CELLS / 2) * CELL,
  z: (cy - CELLS / 2) * CELL,
});

export function generateLayout(seed: number): DungeonLayout {
  const rnd = mulberry32(seed);
  const walk = new Uint8Array(CELLS * CELLS);
  const carve = (cx: number, cy: number): void => {
    if (cx >= 1 && cy >= 1 && cx < CELLS - 1 && cy < CELLS - 1) walk[cy * CELLS + cx] = 1;
  };

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
  for (const r of rooms) {
    for (let y = r.cy; y < r.cy + r.h; y++) {
      for (let x = r.cx; x < r.cx + r.w; x++) carve(x, y);
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
    const horizFirst = rnd() < 0.5;
    const carveH = (y: number, x0: number, x1: number) => {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { carve(x, y); carve(x, y + 1); }
    };
    const carveV = (x: number, y0: number, y1: number) => {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { carve(x, y); carve(x + 1, y); }
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
  const entry = cellToLocal(ec.x, ec.y);
  const bossAt = cellToLocal(bc.x, bc.y);

  // ── 4. geometry (all randomness stays in this pass) ──
  const geometry: GeoItem[] = [];
  // Floors: top at y=0 (walk plane). Walls pass explicit centre-y + height.
  const slab = (kind: GeoKind, x: number, z: number, w: number, d: number, yOrH?: number, h?: number): void => {
    const sy = h ?? yOrH ?? 0.28;
    const py = h !== undefined ? (yOrH ?? 0) : -(sy / 2);
    geometry.push({ kind, x, y: py, z, sx: w, sy, sz: d });
  };
  const inRoom = (cx: number, cy: number) => rooms.some((r) => cx >= r.cx && cx < r.cx + r.w && cy >= r.cy && cy < r.cy + r.h);

  // room floors — one slab each, alternating tint
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i]!;
    const w0 = cellToLocal(r.cx, r.cy);
    const w1 = cellToLocal(r.cx + r.w, r.cy + r.h);
    slab(i % 2 ? 'floorA' : 'floorB', (w0.x + w1.x) / 2 - CELL / 2, (w0.z + w1.z) / 2 - CELL / 2, r.w * CELL, r.h * CELL);
  }
  // corridor floors — merged horizontal runs of walkable non-room cells
  for (let cy = 0; cy < CELLS; cy++) {
    let run = -1;
    for (let cx = 0; cx <= CELLS; cx++) {
      const isCorr = cx < CELLS && !!walk[cy * CELLS + cx] && !inRoom(cx, cy);
      if (isCorr && run < 0) run = cx;
      if (!isCorr && run >= 0) {
        const a = cellToLocal(run, cy);
        const b = cellToLocal(cx - 1, cy);
        slab('floorA', (a.x + b.x) / 2, a.z, (cx - run) * CELL, CELL);
        run = -1;
      }
    }
  }
  // walls — merged horizontal runs of boundary cells (8-way seal)
  const isBoundary = (cx: number, cy: number): boolean => {
    if (walk[cy * CELLS + cx]) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < CELLS && ny < CELLS && walk[ny * CELLS + nx]) return true;
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
        slab('wall', (a.x + bw.x) / 2, a.z, (cx - run) * CELL, CELL, WALL_H / 2 - 0.1, WALL_H);
        run = -1;
      }
    }
  }
  // ── 4b. decor — SEPARATE seeded stream ──
  // Every visual-decor roll (torches, room clutter, wall-hug pieces, corridor
  // scatter, braziers) draws from dRnd, not the main `rnd` stream, so tuning
  // decor density/rules re-dresses the SAME dungeon: rooms, corridors and §5
  // monster packs stay put. Decor never touches `walk` — it is visual only.
  const dRnd = mulberry32(seed ^ 0xdec0de);

  // torches — big rooms light all four corners, small rooms two; some skipped
  // so rooms still feel unevenly lit
  for (const r of rooms) {
    const corners = [
      cellToLocal(r.cx + 1, r.cy + 1),
      cellToLocal(r.cx + r.w - 2, r.cy + r.h - 2),
      cellToLocal(r.cx + r.w - 2, r.cy + 1),
      cellToLocal(r.cx + 1, r.cy + r.h - 2),
    ];
    const nSpots = r.w >= 5 && r.h >= 5 ? 4 : 2;
    for (const s of corners.slice(0, nSpots)) {
      if (dRnd() < 0.2) continue;
      geometry.push({ kind: 'torchPost', x: s.x, y: 0.9, z: s.z, sx: 0.14, sy: 1.8, sz: 0.14 });
      geometry.push({ kind: 'flame', x: s.x, y: 1.95, z: s.z, sx: 0.26, sy: 0.34, sz: 0.26 });
    }
  }
  // room decor — density scales with room area; the weighted table gives every
  // decor kind a real share (braziers are no longer boss-room-exclusive)
  for (const r of rooms) {
    const decorN = Math.min(6, Math.max(2, Math.round(r.w * r.h * 0.1)));
    for (let k = 0; k < decorN; k++) {
      const cx = r.cx + 1 + Math.floor(dRnd() * Math.max(1, r.w - 2));
      const cy = r.cy + 1 + Math.floor(dRnd() * Math.max(1, r.h - 2));
      const s = cellToLocal(cx, cy);
      const jx = s.x + (dRnd() - 0.5) * CELL * 0.6;
      const jz = s.z + (dRnd() - 0.5) * CELL * 0.6;
      const roll = dRnd();
      if (roll < 0.28) {
        geometry.push({ kind: 'rubble', x: jx, y: 0.16, z: jz, sx: 0.55, sy: 0.32, sz: 0.45 });
        geometry.push({ kind: 'rubble', x: jx + 0.35, y: 0.1, z: jz + 0.2, sx: 0.3, sy: 0.2, sz: 0.3, rotY: 0.63 });
      } else if (roll < 0.5) {
        geometry.push({ kind: 'bone', x: jx, y: 0.07, z: jz, sx: 0.5, sy: 0.12, sz: 0.14, rotY: 0.4 });
        geometry.push({ kind: 'bone', x: jx + 0.1, y: 0.07, z: jz + 0.15, sx: 0.4, sy: 0.1, sz: 0.12, rotY: -0.87 });
      } else if (roll < 0.68) {
        const ry = (dRnd() - 0.5) * 1.4;
        geometry.push({ kind: 'slag', x: jx, y: -0.01, z: jz, sx: 1.0 + dRnd() * 0.9, sy: 0.03, sz: 0.7 + dRnd() * 0.6, rotY: ry });
      } else if (roll < 0.85) {
        // crate stash — 1-2 supply crates (second one nudged + spun)
        geometry.push({ kind: 'crate', x: jx, y: 0.2, z: jz, sx: 0.7, sy: 0.7, sz: 0.6, rotY: (dRnd() - 0.5) * 0.6 });
        if (dRnd() < 0.6) {
          geometry.push({ kind: 'crate', x: jx + 0.6, y: 0.18, z: jz + 0.2, sx: 0.55, sy: 0.55, sz: 0.5, rotY: (dRnd() - 0.5) * 1.2 });
        }
      } else {
        // lone brazier — a warm anchor in ordinary rooms
        geometry.push({ kind: 'brazier', x: jx, y: 0.35, z: jz, sx: 0.7, sy: 0.7, sz: 0.7 });
      }
    }
    // wall-hug clutter — small bones / rubble against the room's inner edge
    // (classic dungeon set dressing: debris collects at the walls)
    const hugN = Math.round((r.w + r.h) * 0.2);
    for (let k = 0; k < hugN; k++) {
      const side = Math.floor(dRnd() * 4);              // 0 N / 1 S / 2 W / 3 E
      const along = 1 + Math.floor(dRnd() * Math.max(1, (side < 2 ? r.w : r.h) - 2));
      const cx = side < 2 ? r.cx + along : side === 2 ? r.cx : r.cx + r.w - 1;
      const cy = side < 2 ? (side === 0 ? r.cy : r.cy + r.h - 1) : r.cy + along;
      const s = cellToLocal(cx, cy);
      const push = CELL * 0.32;                          // nudge toward the wall
      const jx = s.x + (side === 2 ? -push : side === 3 ? push : (dRnd() - 0.5) * 0.5);
      const jz = s.z + (side === 0 ? -push : side === 1 ? push : (dRnd() - 0.5) * 0.5);
      const alongWall = side < 2 ? 0 : Math.PI / 2;      // lay pieces parallel to the wall
      if (dRnd() < 0.5) {
        geometry.push({ kind: 'bone', x: jx, y: 0.06, z: jz, sx: 0.42, sy: 0.1, sz: 0.12, rotY: alongWall + (dRnd() - 0.5) * 0.5 });
      } else {
        geometry.push({ kind: 'rubble', x: jx, y: 0.11, z: jz, sx: 0.4, sy: 0.22, sz: 0.34, rotY: alongWall + (dRnd() - 0.5) * 0.8 });
      }
    }
  }
  // corridor scatter — sparse slag / rubble so corridors aren't bare planks
  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      if (!walk[cy * CELLS + cx] || inRoom(cx, cy)) continue;
      if (dRnd() >= 0.05) continue;
      const s = cellToLocal(cx, cy);
      const jx = s.x + (dRnd() - 0.5) * CELL * 0.4;
      const jz = s.z + (dRnd() - 0.5) * CELL * 0.4;
      if (dRnd() < 0.5) {
        geometry.push({ kind: 'slag', x: jx, y: -0.01, z: jz, sx: 0.6 + dRnd() * 0.5, sy: 0.03, sz: 0.5 + dRnd() * 0.4, rotY: (dRnd() - 0.5) * 1.4 });
      } else {
        geometry.push({ kind: 'rubble', x: jx, y: 0.1, z: jz, sx: 0.35, sy: 0.2, sz: 0.3, rotY: dRnd() * Math.PI });
      }
    }
  }
  // boss-room braziers — all four corners frame the arena
  for (const [ox, oz] of [[-3, -3], [3, 3], [-3, 3], [3, -3]] as const) {
    geometry.push({ kind: 'brazier', x: bossAt.x + ox, y: 0.35, z: bossAt.z + oz, sx: 0.7, sy: 0.7, sz: 0.7 });
  }

  // ── 5. monster packs ──
  const monsterSpawns: DungeonLayout['monsterSpawns'] = [];
  const maxD = bestD || 1;
  for (const r of rooms) {
    if (r === entryRoom) continue;
    const c = centre(r);
    const depth = (Math.abs(c.x - ec.x) + Math.abs(c.y - ec.y)) / maxD;
    if (r === bossRoom) {
      monsterSpawns.push({ kind: 'slaglord', ...cellToLocal(bc.x, bc.y) });
      monsterSpawns.push({ kind: 'flamecaller', ...cellToLocal(r.cx + 1, r.cy + 1) });
      monsterSpawns.push({ kind: 'flamecaller', ...cellToLocal(r.cx + r.w - 2, r.cy + r.h - 2) });
      continue;
    }
    const packSize = 2 + Math.floor(rnd() * 3) + (depth > 0.6 ? 1 : 0);
    for (let i = 0; i < packSize; i++) {
      const kind: DenMonsterKind =
        rnd() < 0.15 + depth * 0.2 ? (rnd() < 0.5 ? 'flamecaller' : 'charred')
        : rnd() < 0.5 ? 'imp' : 'ashwalker';
      const sx = r.cx + 1 + Math.floor(rnd() * Math.max(1, r.w - 2));
      const sy = r.cy + 1 + Math.floor(rnd() * Math.max(1, r.h - 2));
      monsterSpawns.push({ kind, ...cellToLocal(sx, sy) });
    }
  }

  return {
    walk,
    roomCount: rooms.length,
    entry,
    bossAt,
    bossSize: { w: bossRoom.w * CELL, h: bossRoom.h * CELL },
    monsterSpawns,
    geometry,
  };
}
