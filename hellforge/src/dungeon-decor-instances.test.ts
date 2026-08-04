// N4 #17A — decor instancing + density guards.
//
// Pins three contracts of the decor reinforcement:
//   1. decor NEVER moves the grid: walkHash / room count / monster spawns stay
//      byte-identical to origin/main (decor draws only from the dRnd stream);
//   2. every multi-piece heap ("pile") is EXACTLY 3 transforms sharing a
//      cluster id, and per-room caps hold (wood ≤3 / stone ≤3 / campfire ≤2 /
//      trunk ≤2 / fence ≤3 per room);
//   3. the committed slagdeep pack carries Instances batches (one per
//      (mesh, material) group, transforms length % 16 === 0), the pack entity
//      count is BELOW the old per-entity bake count, and wood/stone pile tops
//      computed as bbox×scale+y stay ≤0.50 / ≤0.55 m.
//
// Re-run `bun scripts/bake-dungeon.ts` after ANY pipeline change; a stale pack
// fails loudly here (same discipline as dungeon-baked-pack.test.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { DUNGEON_SEED, CELL, CELLS, type DenMonsterKind } from './dungeon-layout';
import { generateModularLayout } from './dungeon-pipeline';

// ── origin/main grid fingerprint (f14ee47, decor-before/after identical) ──
const MAIN_WALK_HASH = -694360881;
const MAIN_ROOM_COUNT = 7;
const MAIN_SPAWNS: Array<{ kind: DenMonsterKind; x: number; z: number }> = [
  { kind: 'flamecaller', x: 0, z: 2.4 },
  { kind: 'flamecaller', x: 4.8, z: 4.8 },
  { kind: 'imp', x: 7.199999999999999, z: -14.399999999999999 },
  { kind: 'charred', x: 0, z: -7.199999999999999 },
  { kind: 'flamecaller', x: 4.8, z: -16.8 },
  { kind: 'slaglord', x: -38.4, z: -38.4 },
  { kind: 'flamecaller', x: -45.6, z: -45.6 },
  { kind: 'flamecaller', x: -31.2, z: -31.2 },
];

// ── asset constants (boulder/campfire-log bbox, from readPropBBox) ────────
const BOULDER_MAX_Y = 0.882; // size 1.764, min -0.882 → max +0.882
const LOG_MAX_Y = 0.329;     // size 0.657, min -0.328 → max +0.329
const STONE_TOP_LIMIT = 0.55;
const WOOD_TOP_LIMIT = 0.50;
// mesh GUIDs from the prop sidecars (pack refs point at these)
const BOULDER_MESH_GUID = '6b7d4106-61a6-310b-d930-9a30239a13f7';
const LOG_MESH_GUID = 'c7c1600e-d970-bb1c-5cbc-96e442ca9793';

const packPath = join(import.meta.dir, '..', 'assets', 'scenes', 'slagdeep-hollow.pack.json');
const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
  assets: Array<{
    kind: string;
    payload: { kind: string; entities?: Array<{
      localId: number;
      components: Record<string, { value?: unknown; assetHandle?: number; materials?: number[]; transforms?: number[] }>;
    }> };
    refs?: string[];
  }>;
};
const scene = pack.assets.find((a) => a.kind === 'scene');
if (!scene?.payload.entities) throw new Error('slagdeep pack: no scene entities');
const ents = scene.payload.entities;
const refs = scene.refs ?? [];

describe('decor never moves the grid (N4 #17A)', () => {
  test('walkHash / rooms / monster spawns identical to origin/main', () => {
    const l = generateModularLayout(DUNGEON_SEED);
    let hash = 0;
    for (let i = 0; i < l.walk.length; i++) hash = (hash * 31 + (l.walk[i] ? 1 : 0)) | 0;
    expect(hash).toBe(MAIN_WALK_HASH);
    expect(l.roomCount).toBe(MAIN_ROOM_COUNT);
    expect(l.monsterSpawns).toEqual(MAIN_SPAWNS);
  });
});

describe('pile clusters + per-room caps (N4 #17A)', () => {
  const l = generateModularLayout(DUNGEON_SEED);

  test('every cluster is EXACTLY 3 transforms; campfire = 1 base + 2 logs', () => {
    const perCluster = new Map<number, Array<{ kind: string; n: number }>>();
    for (const g of l.geometry) {
      if (g.cluster === undefined) continue;
      let list = perCluster.get(g.cluster);
      if (!list) { list = []; perCluster.set(g.cluster, list); }
      const e = list.find((x) => x.kind === g.kind);
      if (e) e.n += 1;
      else list.push({ kind: g.kind, n: 1 });
    }
    expect(perCluster.size).toBeGreaterThanOrEqual(15);
    for (const [, list] of perCluster) {
      const total = list.reduce((s, x) => s + x.n, 0);
      expect(total).toBe(3);
      const base = list.find((x) => x.kind === 'campfireBase');
      if (base) {
        expect(base.n).toBe(1);
        expect(list.find((x) => x.kind === 'woodPile')?.n).toBe(2);
      }
    }
  });

  test('per-room caps hold: wood ≤13, stone ≤9, campfire ≤2, trunk ≤2, fence ≤3 pieces', () => {
    const rooms = l.nav.rooms;
    const inRoom = (r: { x: number; y: number; w: number; h: number }, cx: number, cz: number): boolean =>
      cx >= r.x && cx < r.x + r.w && cz >= r.y && cz < r.y + r.h;
    const perRoom = new Map<number, Record<string, number>>();
    let corridor = 0;
    const roomOf = (x: number, z: number): number | 'corridor' => {
      const cx = Math.round(x / CELL + CELLS / 2);
      const cz = Math.round(z / CELL + CELLS / 2);
      for (let i = 0; i < rooms.length; i++) {
        if (inRoom(rooms[i]!, cx, cz)) return i;
      }
      return 'corridor';
    };
    for (const g of l.geometry) {
      const k = g.kind;
      if (k !== 'woodPile' && k !== 'stonePile' && k !== 'campfireBase' &&
          k !== 'deadtreeTrunk' && k !== 'fence') continue;
      const r = roomOf(g.x, g.z);
      if (r === 'corridor') {
        corridor += 1;
        continue;
      }
      const m = perRoom.get(r) ?? {};
      m[k] = (m[k] ?? 0) + 1;
      perRoom.set(r, m);
    }
    // corridor pieces are cap-free BY DESIGN (owner: "走廊也允许出现") — they
    // must never leak into a room bucket.
    expect(corridor).toBeGreaterThanOrEqual(1);
    for (const m of perRoom.values()) {
      expect(m.woodPile ?? 0).toBeLessThanOrEqual(3 * 3 + 2 * 2); // 3 logs/pile ×3 piles + 2 logs ×2 campfires
      expect(m.stonePile ?? 0).toBeLessThanOrEqual(3 * 3);
      expect(m.campfireBase ?? 0).toBeLessThanOrEqual(2);
      expect(m.deadtreeTrunk ?? 0).toBeLessThanOrEqual(2);
      expect(m.fence ?? 0).toBeLessThanOrEqual(3);
    }
  });
});

describe('baked pack: Instances batches + height discipline (N4 #17A)', () => {
  const batches = ents.filter((e) => 'Instances' in e.components);
  const perKindCounts = new Map<string, number>();
  for (const b of batches) {
    const kind = String(b.components.Name?.value ?? '').split('_')[1] ?? '';
    perKindCounts.set(kind, (perKindCounts.get(kind) ?? 0) + (b.components.Instances?.transforms?.length ?? 0) / 16);
  }

  test('pack entity count dropped below the pre-instancing bake (origin/main pack = 1556)', () => {
    // origin/main @ f14ee47 baked 1556 entities; instancing should bring the
    // pack BELOW that even while adding ~100 decor pieces.
    expect(ents.length).toBeLessThan(1556);
    expect(ents.length).toBeGreaterThan(1400);
    const ids = ents.map((e) => e.localId).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: ents.length }, (_, i) => i));
  });

  test('every decor kind has ≥1 batch; every batch is stride-16', () => {
    const expected = ['torchPost', 'flame', 'brazier', 'rubble', 'bone', 'slag', 'crate',
      'woodPile', 'stonePile', 'deadtreeTrunk', 'deadtreeBranch', 'campfireBase', 'fence'];
    for (const k of expected) expect(perKindCounts.get(k) ?? 0).toBeGreaterThanOrEqual(1);
    for (const b of batches) {
      const tr = b.components.Instances?.transforms;
      expect(tr).toBeDefined();
      expect(tr!.length).toBeGreaterThanOrEqual(16);
      expect(tr!.length % 16).toBe(0);
    }
  });

  test('density floor: decor instances well above the pre-#17A bake (141 pieces)', () => {
    const total = [...perKindCounts.values()].reduce((s, n) => s + n, 0);
    expect(total).toBeGreaterThanOrEqual(200);
  });

  test('pile tops: stone ≤0.55 m, wood ≤0.50 m (bbox×scale+y, from the pack)', () => {
    for (const b of batches) {
      const name = String(b.components.Name?.value ?? '');
      const kind = name.split('_')[1];
      if (kind !== 'stonePile' && kind !== 'woodPile') continue;
      const meshIdx = b.components.MeshFilter?.assetHandle;
      if (typeof meshIdx !== 'number') continue;
      const mesh = refs[meshIdx];
      if (mesh !== BOULDER_MESH_GUID && mesh !== LOG_MESH_GUID) {
        throw new Error(`pile batch ${name} references unexpected mesh ${mesh} — update bbox constants`);
      }
      const maxY = mesh === BOULDER_MESH_GUID ? BOULDER_MAX_Y : LOG_MAX_Y;
      const tr = b.components.Instances!.transforms!;
      for (let i = 0; i < tr.length; i += 16) {
        const us = Math.hypot(tr[i]!, tr[i + 1]!, tr[i + 2]!);
        const top = tr[i + 13]! + maxY * us;
        const limit = kind === 'stonePile' ? STONE_TOP_LIMIT : WOOD_TOP_LIMIT;
        expect(top).toBeLessThanOrEqual(limit);
      }
    }
  });

  test('pack stays v2 schema (no paramValues / shader strings)', () => {
    const raw = JSON.stringify(pack);
    expect(raw).not.toContain('paramValues');
    expect(raw).not.toContain('"shader"');
  });
});
