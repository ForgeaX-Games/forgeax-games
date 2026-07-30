// Baked-pack regression guard for the wall trench fix.
//
// Reads the COMMITTED assets/scenes/slagdeep-hollow.pack.json and checks it
// against the current pipeline geometry (same single-truth path the bake
// uses). If the pack goes stale (pipeline changed without re-running
// `bun scripts/bake-dungeon.ts`), the per-item name lookup breaks and these
// tests fail — re-bake to fix.
//
// Invariants pinned here:
//   1. every wall block keeps NATIVE depth scale (scale[2] === 1) — the old
//      ~2.1 cell-fill stretch skewed tangent frames on turning surfaces;
//   2. every wall block's bbox front face sits exactly on the walkable-cell
//      boundary of its run's facing side (bake seating);
//   3. every under-wall floor strip slab has its tiles in the pack, with the
//      tile top below the walk plane (no z-fight with base slabs).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { DUNGEON_SEED, type GeoItem } from './dungeon-layout';
import { generateModularLayout } from './dungeon-pipeline';
import { measureGlbBBox } from '../scripts/lib/scene-authoring';

interface PackEntity {
  localId: number;
  components: {
    Name?: { value?: string };
    Transform: {
      pos: number[];
      quat?: number[];
      scale: number[];
    };
  };
}

const packPath = join(import.meta.dir, '..', 'assets', 'scenes', 'slagdeep-hollow.pack.json');
const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
  assets: Array<{ kind: string; payload?: { entities?: PackEntity[] } }>;
};
const scene = pack.assets.find((a) => a.kind === 'scene');
const entities = scene?.payload?.entities;
if (!entities || entities.length < 1) {
  throw new Error('slagdeep-hollow.pack.json: no scene entities — pack missing or corrupt');
}

const propsDir = join(import.meta.dir, '..', 'assets', '3d', 'props', 'meshes');
const wallBB = measureGlbBBox(join(propsDir, 'prop-den-wall.glb'));
const floorBB = measureGlbBBox(join(propsDir, 'prop-den-floor-b.glb'));

// Same per-kind item numbering the bake uses (counters over layout.geometry).
const itemByKey = new Map<string, GeoItem>();
{
  const mod = generateModularLayout(DUNGEON_SEED);
  const counters: Partial<Record<string, number>> = {};
  for (const g of mod.geometry) {
    const n = (counters[g.kind] = (counters[g.kind] ?? 0) + 1);
    itemByKey.set(`${g.kind}_${n}`, g);
  }
}

const wallEntities = entities.filter((e) =>
  e.components.Name?.value?.startsWith('Den_wall_'),
);

describe('baked slagdeep pack (trench fix)', () => {
  test('wall blocks keep native depth scale (no ~2.1 stretch)', () => {
    expect(wallEntities.length).toBeGreaterThan(0);
    for (const e of wallEntities) {
      const name = e.components.Name!.value!;
      const m = name.match(/^Den_wall_(\d+)__/);
      expect(m).not.toBeNull();
      expect(itemByKey.has(`wall_${m![1]}`)).toBe(true); // pack↔pipeline in sync
      expect(e.components.Transform.scale[2]).toBe(1);
    }
  });

  test('wall bbox front face sits exactly on the walkable-cell boundary', () => {
    const front = wallBB.max[2]; // +Z bbox extent of the wall prop (z-symmetric)
    let worst = 0;
    for (const e of wallEntities) {
      const name = e.components.Name!.value!;
      const item = itemByKey.get(`wall_${name.match(/^Den_wall_(\d+)__/)![1]}`)!;
      const facing = item.rotY ?? 0;
      const fx = Math.sin(facing);
      const fz = Math.cos(facing);
      const depth = Math.min(item.sx, item.sz);
      const t = e.components.Transform;
      const q = t.quat ?? [0, 0, 0, 1];
      // local ±z bbox faces → world; the boundary face is whichever of the
      // two lands on the plane (the alternating 180° flips swap front/back,
      // and the prop bbox is z-symmetric so both extent checks are valid)
      const sin = 2 * q[1]! * q[3]!;
      const cos = q[3]! * q[3]! - q[1]! * q[1]!;
      const errs = [1, -1].map((sign) => {
        const wx = t.pos[0]! + sign * sin * front * t.scale[2]!;
        const wz = t.pos[2]! + sign * cos * front * t.scale[2]!;
        const signed = (wx - item.x) * fx + (wz - item.z) * fz;
        return Math.abs(signed - depth / 2);
      });
      worst = Math.max(worst, Math.min(...errs));
    }
    // transforms are rounded to 4 decimals on write — 0.1 mm tolerance
    expect(worst).toBeLessThan(5e-4);
  });

  test('under-wall floor strips are baked with tile tops below the walk plane', () => {
    // Strip slabs are the floor items whose top sits below y=0 (pipeline).
    const stripPrefix: string[] = [];
    for (const [key, g] of itemByKey) {
      if ((g.kind === 'floorA' || g.kind === 'floorB') && g.y + g.sy / 2 < -1e-9) {
        stripPrefix.push(`Den_${key}__`);
      }
    }
    expect(stripPrefix.length).toBeGreaterThan(100); // one per boundary cell
    let tiles = 0;
    for (const e of entities) {
      const name = e.components.Name?.value ?? '';
      if (!stripPrefix.some((p) => name.startsWith(p))) continue;
      tiles++;
      const t = e.components.Transform;
      const top = t.pos[1]! + floorBB.max[1] * t.scale[1]!;
      // below the walk plane so base slabs always win the depth test…
      expect(top).toBeLessThan(-0.001);
      // …but only by a few mm (never a visible step)
      expect(top).toBeGreaterThan(-0.01);
    }
    expect(tiles).toBe(stripPrefix.length); // one tile per strip slab
  });

  test('localIds are contiguous (engine indexes by localId)', () => {
    const ids = entities.map((e) => e.localId).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      expect(ids[i]).toBe(i);
    }
  });
});
