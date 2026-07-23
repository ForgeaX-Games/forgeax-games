// PR3 T6 — camera proxies from modular nav.blockers + automap walk queries.
import { describe, expect, test } from 'bun:test';
import { CELL, CELLS, DUNGEON_SEED, WALL_H } from './dungeon-layout';
import { DUNGEON_ORIGIN } from './dungeon-origin';
import {
  blockersFromWalk,
  cameraBlockersToProbeBlockers,
  type CameraBlockerStub,
} from './dungeon-corridors';
import {
  denCameraBlockerStubs,
  generateModularLayout,
  isModularDungeon,
  resolveDungeonLayout,
} from './dungeon-pipeline';
import type { ProbeAabb, ProbeBlocker } from './camera-probe';

function isAabb(b: ProbeBlocker): b is ProbeAabb {
  return b.type === 'aabb';
}

/** Interior test with runtime probePad — walk centres must stay free. */
function pointInAabbPadded(
  x: number,
  z: number,
  b: ProbeAabb,
): boolean {
  const pad = b.probePad ?? 0;
  const minX = Math.min(b.min[0], b.max[0]) - pad;
  const maxX = Math.max(b.min[0], b.max[0]) + pad;
  const minZ = Math.min(b.min[1], b.max[1]) - pad;
  const maxZ = Math.max(b.min[1], b.max[1]) + pad;
  return x > minX && x < maxX && z > minZ && z < maxZ;
}

function cellCentreWorld(cx: number, cy: number): readonly [number, number] {
  return [
    (cx - CELLS / 2 + 0.5) * CELL + DUNGEON_ORIGIN.x,
    (cy - CELLS / 2 + 0.5) * CELL + DUNGEON_ORIGIN.z,
  ];
}

/** Same indexing automap.ts uses via dungeon.isWalkCell. */
function isWalkCell(walk: ArrayLike<number>, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) return false;
  return !!walk[cy * CELLS + cx];
}

describe('dungeon proxies (T6)', () => {
  test('cameraBlockersToProbeBlockers maps cell stubs → world ProbeAabb', () => {
    const stubs: CameraBlockerStub[] = [
      { id: 'wall-10-5', x: 5, z: 10, w: 3, h: 1, kind: 'wall' },
    ];
    const [p] = cameraBlockersToProbeBlockers(stubs, DUNGEON_ORIGIN);
    expect(p).toBeDefined();
    expect(p!.type).toBe('aabb');
    if (!isAabb(p!)) return;
    expect(p.label).toBe('wall-10-5');
    expect(p.probeHeight).toBe(WALL_H);
    const half = CELLS / 2;
    expect(p.min[0]).toBeCloseTo((5 - half) * CELL + DUNGEON_ORIGIN.x, 5);
    expect(p.min[1]).toBeCloseTo((10 - half) * CELL + DUNGEON_ORIGIN.z, 5);
    expect(p.max[0]).toBeCloseTo((8 - half) * CELL + DUNGEON_ORIGIN.x, 5);
    expect(p.max[1]).toBeCloseTo((11 - half) * CELL + DUNGEON_ORIGIN.z, 5);
  });

  test('shipping: denCameraBlockerStubs === nav.blockers (Dungeon path)', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    const stubs = denCameraBlockerStubs(mod);
    expect(stubs.length).toBeGreaterThan(0);
    expect(stubs).toEqual(mod.nav.blockers);
    const fromStubs = cameraBlockersToProbeBlockers(stubs, DUNGEON_ORIGIN);
    const fromWalk = cameraBlockersToProbeBlockers(
      blockersFromWalk(mod.walk),
      DUNGEON_ORIGIN,
    );
    expect(fromStubs).toEqual(fromWalk);
    expect(fromStubs.every(isAabb)).toBe(true);
  });

  test('proxy-overlap freedom: no walk cell centre inside padded den proxies', () => {
    const mod = generateModularLayout(DUNGEON_SEED);
    const proxies = cameraBlockersToProbeBlockers(
      denCameraBlockerStubs(mod),
      DUNGEON_ORIGIN,
    );
    expect(proxies.length).toBeGreaterThan(0);

    for (let cy = 0; cy < CELLS; cy++) {
      for (let cx = 0; cx < CELLS; cx++) {
        if (!mod.walk[cy * CELLS + cx]) continue;
        const [wx, wz] = cellCentreWorld(cx, cy);
        for (const b of proxies) {
          if (!isAabb(b)) continue;
          expect(pointInAabbPadded(wx, wz, b)).toBe(false);
        }
      }
    }
  });

  test('greybox: denCameraBlockerStubs from walk, non-empty, no walk overlap', () => {
    const grey = resolveDungeonLayout(DUNGEON_SEED, { useGreybox: true });
    expect(isModularDungeon(grey)).toBe(false);
    const stubs = denCameraBlockerStubs(grey);
    expect(stubs.length).toBeGreaterThan(0);
    expect(stubs).toEqual(blockersFromWalk(grey.walk));
    const proxies = cameraBlockersToProbeBlockers(stubs, DUNGEON_ORIGIN);
    expect(proxies.length).toBeGreaterThan(0);
    for (let cy = 0; cy < CELLS; cy++) {
      for (let cx = 0; cx < CELLS; cx++) {
        if (!grey.walk[cy * CELLS + cx]) continue;
        const [wx, wz] = cellCentreWorld(cx, cy);
        for (const b of proxies) {
          if (!isAabb(b)) continue;
          expect(pointInAabbPadded(wx, wz, b)).toBe(false);
        }
      }
    }
  });

  test('automap can query walk cells for shipping seed', () => {
    const layout = resolveDungeonLayout(DUNGEON_SEED);
    expect(isModularDungeon(layout)).toBe(true);
    expect(layout.walk).toHaveLength(CELLS * CELLS);

    let walkable = 0;
    for (let i = 0; i < layout.walk.length; i++) {
      if (layout.walk[i]) walkable++;
    }
    expect(walkable).toBeGreaterThan(0);

    // Same API surface automap.ts reads via dungeon.isWalkCell.
    expect(isWalkCell(layout.walk, layout.nav.entryCell.cx, layout.nav.entryCell.cy)).toBe(true);
    expect(isWalkCell(layout.walk, layout.nav.bossCell.cx, layout.nav.bossCell.cy)).toBe(true);
    expect(isWalkCell(layout.walk, 0, 0)).toBe(false);
  });
});
