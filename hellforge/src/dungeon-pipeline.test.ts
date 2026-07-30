import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { CELL, CELLS, DUNGEON_SCENE_GUID, DUNGEON_SEED, generateLayout } from './dungeon-layout';
import { astarGrid } from './navigation';
import {
  generateModularLayout,
  isModularDungeon,
  resolveDungeonLayout,
  USE_GREYBOX_DUNGEON_LAYOUT,
  WALL_FLOOR_OVERHANG,
  WALL_FLOOR_STRIP_DROP,
} from './dungeon-pipeline';

function fingerprint(mod: ReturnType<typeof generateModularLayout>): string {
  const h = createHash('sha256');
  h.update(Buffer.from(mod.walk));
  h.update(
    JSON.stringify(
      mod.monsterSpawns.map((s) => [s.kind, +s.x.toFixed(4), +s.z.toFixed(4)]),
    ),
  );
  h.update(String(mod.roomCount));
  h.update(JSON.stringify(mod.entry));
  h.update(JSON.stringify(mod.bossAt));
  return h.digest('hex');
}

describe('dungeon-pipeline (T5)', () => {
  test('shipping path uses modular (greybox flag off)', () => {
    expect(USE_GREYBOX_DUNGEON_LAYOUT).toBe(false);
    const layout = resolveDungeonLayout(DUNGEON_SEED);
    expect(isModularDungeon(layout)).toBe(true);
  });

  test('greybox override returns generateLayout (flag path works)', () => {
    const grey = resolveDungeonLayout(DUNGEON_SEED, { useGreybox: true });
    expect(isModularDungeon(grey)).toBe(false);
    const legacy = generateLayout(DUNGEON_SEED);
    expect(grey.roomCount).toBe(legacy.roomCount);
    expect(grey.monsterSpawns).toEqual(legacy.monsterSpawns);
    expect([...grey.walk]).toEqual([...legacy.walk]);
    // Default resolve stays modular even when override was used elsewhere.
    expect(isModularDungeon(resolveDungeonLayout(DUNGEON_SEED))).toBe(true);
  });

  test('determinism: same seed → identical walk + spawn fingerprint', () => {
    const a = generateModularLayout(DUNGEON_SEED);
    const b = generateModularLayout(DUNGEON_SEED);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.monsterSpawns).toEqual(b.monsterSpawns);
    expect([...a.walk]).toEqual([...b.walk]);
  });

  test('different seeds diverge (walk or spawns)', () => {
    const a = fingerprint(generateModularLayout(DUNGEON_SEED));
    const b = fingerprint(generateModularLayout(DUNGEON_SEED + 1));
    expect(a).not.toBe(b);
  });

  test('single-truth: layout.walk === nav.walk (same frozen reference)', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    expect(mod.walk).toBe(mod.nav.walk);
    expect(Object.isFrozen(mod.walk)).toBe(true);
    expect(mod.walk).toHaveLength(CELLS * CELLS);
    expect(() => {
      (mod.walk as number[])[mod.nav.entryCell.cy * CELLS + mod.nav.entryCell.cx] = 0;
    }).toThrow();
  });

  test('monsterSpawns match encounter plan (order + local coords)', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    expect(mod.monsterSpawns).toEqual(
      mod.encounters.spawns.map((s) => ({ kind: s.kind, x: s.x, z: s.z })),
    );
    expect(mod.monsterSpawns.some((s) => s.kind === 'slaglord')).toBe(true);
  });

  test('roomCount matches placed rooms; bossSize from boss module', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    expect(mod.roomCount).toBe(mod.nav.rooms.length);
    expect(mod.roomCount).toBe(mod.graph.nodes.length);
    const boss = mod.nav.rooms.find((r) => r.nodeId === 'boss')!;
    expect(mod.bossSize.w).toBe(boss.w * CELL);
    expect(mod.bossSize.h).toBe(boss.h * CELL);
  });

  test('A* entry→boss on generated layout.walk', () => {
    for (const seed of [DUNGEON_SEED, 1, 42, 99, 12345]) {
      const mod = generateModularLayout(seed);
      const path = astarGrid(
        (cx, cy) =>
          cx >= 0 &&
          cy >= 0 &&
          cx < CELLS &&
          cy < CELLS &&
          mod.walk[cy * CELLS + cx] === 1,
        CELLS,
        CELLS,
        mod.nav.entryCell,
        mod.nav.bossCell,
        (cx, cy) => [cx, cy],
      );
      expect(path.length).toBeGreaterThan(0);
    }
  });

  test('geometry has floors and walls for bake; pack GUID/seed stable', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    expect(mod.geometry.some((g) => g.kind === 'floorA' || g.kind === 'floorB')).toBe(
      true,
    );
    expect(mod.geometry.some((g) => g.kind === 'wall')).toBe(true);
    expect(mod.geometry.length).toBeGreaterThan(20);
    expect(DUNGEON_SEED).toBe(20260703);
    expect(DUNGEON_SCENE_GUID).toBe('7d1f4b02-5c8e-4b3a-9f6d-2e8a1c0b4d97');
  });

  test('bake + runtime share resolveDungeonLayout entry (no generateLayout import drift)', () => {
    // Both scripts/bake-dungeon.ts and src/dungeon.ts call resolveDungeonLayout.
    // Guard: shipping resolve must equal generateModularLayout for the pin seed.
    const viaResolve = resolveDungeonLayout(DUNGEON_SEED);
    const viaModular = generateModularLayout(DUNGEON_SEED);
    expect(isModularDungeon(viaResolve)).toBe(true);
    if (!isModularDungeon(viaResolve)) return;
    expect(fingerprint(viaResolve)).toBe(fingerprint(viaModular));
    expect(viaResolve.walk).toBe(viaResolve.nav.walk);
  });
});

// ── trench-fix geometry: wall facing + under-wall floor strips ─────────────
// The bake seats wall blocks by each run's rotY facing (block +Z → walkable
// side, native depth, bbox front face on the walkable-cell boundary) and the
// pipeline grows floor strips WALL_FLOOR_OVERHANG under every wall cell.
// These tests pin the pipeline-side contract; the pack-level check lives in
// dungeon-baked-pack.test.ts.

const cellToLocal = (cx: number, cy: number): { x: number; z: number } => ({
  x: (cx - CELLS / 2) * CELL,
  z: (cy - CELLS / 2) * CELL,
});

const walkAt = (walk: ArrayLike<number>, cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < CELLS && cy < CELLS && !!walk[cy * CELLS + cx];

const isBoundaryCell = (walk: ArrayLike<number>, cx: number, cy: number): boolean => {
  if (walkAt(walk, cx, cy)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (walkAt(walk, cx + dx, cy + dy)) return true;
    }
  }
  return false;
};

/** Facing yaw → unit axis (sin, cos) so rotY 0/π/±π/2 map to +Z/-Z/+X/-X. */
const AXIS_ALIGNED_YAWS = new Set([0, Math.PI / 2, Math.PI, -Math.PI / 2]);

describe('dungeon trench fix (wall facing + under-wall floors)', () => {
  test('every wall item carries an axis-aligned facing yaw', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    const walls = mod.geometry.filter((g) => g.kind === 'wall');
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) {
      expect(w.rotY).toBeDefined();
      expect(AXIS_ALIGNED_YAWS.has(w.rotY!)).toBe(true);
      // emission shapes: full-depth single seat, or half-depth split pair member
      const thin = Math.min(w.sx, w.sz);
      expect(
        Math.abs(thin - CELL) < 1e-9 || Math.abs(thin - CELL / 2) < 1e-9,
      ).toBe(true);
    }
  });

  test('wall runs: item count + facing match the run-level walk votes', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    const walls = mod.geometry.filter((g) => g.kind === 'wall');
    const EPS = 1e-6;
    const covering = (cx: number, cy: number) => {
      const L = cellToLocal(cx, cy);
      return walls.filter(
        (w) =>
          Math.abs(L.x - w.x) <= w.sx / 2 + EPS &&
          Math.abs(L.z - w.z) <= w.sz / 2 + EPS,
      );
    };
    let sawSingle = 0;
    let sawSplit = 0;
    for (let cy = 0; cy < CELLS; cy++) {
      let run = -1;
      for (let cx = 0; cx <= CELLS; cx++) {
        const b = cx < CELLS && isBoundaryCell(mod.walk, cx, cy);
        if (b && run < 0) run = cx;
        if (b || run < 0) continue;
        const runCx0 = run;
        const runCx1 = cx - 1;
        run = -1;
        let vPZ = 0;
        let vNZ = 0;
        let vPX = 0;
        let vNX = 0;
        for (let x = runCx0; x <= runCx1; x++) {
          if (walkAt(mod.walk, x, cy + 1)) vPZ++;
          if (walkAt(mod.walk, x, cy - 1)) vNZ++;
          if (walkAt(mod.walk, x + 1, cy)) vPX++;
          if (walkAt(mod.walk, x - 1, cy)) vNX++;
        }
        const a = cellToLocal(runCx0, cy);
        const bw = cellToLocal(runCx1, cy);
        const centerX = (a.x + bw.x) / 2;
        const centerZ = a.z;
        const w = (runCx1 - runCx0 + 1) * CELL;
        const items = covering(runCx0, cy);
        const bothZ = vPZ > 0 && vNZ > 0;
        const bothX =
          runCx0 === runCx1 && vPX > 0 && vNX > 0 && vPZ === 0 && vNZ === 0;
        if (bothZ || bothX) {
          // thin wall between two walkable areas: one seat per boundary
          sawSplit++;
          expect(items).toHaveLength(2);
          const yaws = items.map((it) => it.rotY!).sort((p, q) => p - q);
          expect(Math.abs(yaws[1]! - yaws[0]! - Math.PI)).toBeLessThan(EPS);
          if (bothZ) {
            expect(yaws[0]).toBe(0);
            expect(yaws[1]).toBe(Math.PI);
            for (const it of items) {
              expect(Math.abs(it.sx - w)).toBeLessThan(EPS);
              expect(Math.abs(it.sz - CELL / 2)).toBeLessThan(EPS);
              expect(Math.abs(it.x - centerX)).toBeLessThan(EPS);
              expect(
                Math.abs(Math.abs(it.z - centerZ) - CELL / 4),
              ).toBeLessThan(EPS);
            }
          } else {
            expect(Math.abs(yaws[0])).toBe(Math.PI / 2);
            expect(Math.abs(yaws[1])).toBe(Math.PI / 2);
            for (const it of items) {
              expect(Math.abs(it.sx - CELL / 2)).toBeLessThan(EPS);
              expect(Math.abs(it.sz - w)).toBeLessThan(EPS);
              expect(Math.abs(it.z - centerZ)).toBeLessThan(EPS);
              expect(
                Math.abs(Math.abs(it.x - centerX) - CELL / 4),
              ).toBeLessThan(EPS);
            }
          }
        } else {
          sawSingle++;
          expect(items).toHaveLength(1);
          const it = items[0]!;
          expect(Math.abs(it.x - centerX)).toBeLessThan(EPS);
          expect(Math.abs(it.z - centerZ)).toBeLessThan(EPS);
          expect(Math.abs(it.sx - w)).toBeLessThan(EPS);
          expect(Math.abs(it.sz - CELL)).toBeLessThan(EPS);
          // facing must point at a run-voted walkable direction
          const fx = Math.round(Math.sin(it.rotY!));
          const fz = Math.round(Math.cos(it.rotY!));
          const faced =
            (fz > 0 && vPZ > 0) ||
            (fz < 0 && vNZ > 0) ||
            (fx > 0 && vPX > 0) ||
            (fx < 0 && vNX > 0);
          expect(faced).toBe(true);
          // and when only one axis has votes, facing must use it
          if (vPZ + vNZ === 0) expect(fz).toBe(0);
          if (vPX + vNX === 0) expect(fx).toBe(0);
        }
      }
    }
    expect(sawSingle).toBeGreaterThan(0);
    expect(sawSplit).toBeGreaterThan(0); // seed has thin room↔room walls
  });

  test('every boundary cell gets exactly one under-wall floor strip, top below the walk plane', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    const EPS = 1e-6;
    const floors = mod.geometry.filter(
      (g) => g.kind === 'floorA' || g.kind === 'floorB',
    );
    const strips = floors.filter((g) => g.y + g.sy / 2 < -EPS);
    const base = floors.filter((g) => g.y + g.sy / 2 >= -EPS);
    // base slabs keep their top exactly on the walk plane
    expect(base.length).toBeGreaterThan(0);
    for (const b of base) {
      expect(Math.abs(b.y + b.sy / 2)).toBeLessThan(EPS);
    }

    let boundaryCount = 0;
    for (let cy = 0; cy < CELLS; cy++) {
      for (let cx = 0; cx < CELLS; cx++) {
        if (!isBoundaryCell(mod.walk, cx, cy)) continue;
        boundaryCount++;
        const L = cellToLocal(cx, cy);
        const x0 = L.x - CELL / 2;
        const x1 = L.x + CELL / 2;
        const z0 = L.z - CELL / 2;
        const z1 = L.z + CELL / 2;
        // required coverage: WALL_FLOOR_OVERHANG in from each walkable side
        // (a walkable diagonal contributes both adjacent sides — corners)
        const need: Array<[number, number, number, number]> = [];
        const O = WALL_FLOOR_OVERHANG;
        const zSide = (top: boolean): [number, number, number, number] =>
          top ? [x0, x1, z1 - O, z1] : [x0, x1, z0, z0 + O];
        const xSide = (right: boolean): [number, number, number, number] =>
          right ? [x1 - O, x1, z0, z1] : [x0, x0 + O, z0, z1];
        if (walkAt(mod.walk, cx, cy + 1)) need.push(zSide(true));
        if (walkAt(mod.walk, cx, cy - 1)) need.push(zSide(false));
        if (walkAt(mod.walk, cx + 1, cy)) need.push(xSide(true));
        if (walkAt(mod.walk, cx - 1, cy)) need.push(xSide(false));
        for (const [dx, dy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ] as const) {
          if (!walkAt(mod.walk, cx + dx, cy + dy)) continue;
          need.push(xSide(dx > 0));
          need.push(zSide(dy > 0));
        }
        const mine = strips.filter(
          (s) =>
            s.x - s.sx / 2 >= x0 - EPS &&
            s.x + s.sx / 2 <= x1 + EPS &&
            s.z - s.sz / 2 >= z0 - EPS &&
            s.z + s.sz / 2 <= z1 + EPS,
        );
        expect(mine).toHaveLength(1);
        const strip = mine[0]!;
        expect(Math.abs(strip.y + strip.sy / 2 + WALL_FLOOR_STRIP_DROP)).toBeLessThan(EPS);
        // every required strip rect is covered by the strip slab
        for (const [nx0, nx1, nz0, nz1] of need) {
          expect(strip.x - strip.sx / 2).toBeLessThanOrEqual(nx0 + EPS);
          expect(strip.x + strip.sx / 2).toBeGreaterThanOrEqual(nx1 - EPS);
          expect(strip.z - strip.sz / 2).toBeLessThanOrEqual(nz0 + EPS);
          expect(strip.z + strip.sz / 2).toBeGreaterThanOrEqual(nz1 - EPS);
        }
      }
    }
    expect(strips).toHaveLength(boundaryCount);
    expect(boundaryCount).toBeGreaterThan(100); // sanity: real dungeon perimeter
  });

  test('geometry is deterministic across generations', () => {
    const a = generateModularLayout(DUNGEON_SEED);
    const b = generateModularLayout(DUNGEON_SEED);
    expect(JSON.stringify(a.geometry)).toBe(JSON.stringify(b.geometry));
  });
});
