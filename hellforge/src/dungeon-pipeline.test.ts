import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { CELL, CELLS, DUNGEON_SCENE_GUID, DUNGEON_SEED, generateLayout } from './dungeon-layout';
import { astarGrid } from './navigation';
import {
  generateModularLayout,
  isModularDungeon,
  resolveDungeonLayout,
  USE_GREYBOX_DUNGEON_LAYOUT,
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
