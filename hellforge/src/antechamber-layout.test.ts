import { describe, expect, test } from 'bun:test';
import {
  ANTECHAMBER_SCENE_GUID,
  ANTECHAMBER_TILE,
  buildAntechamberLayout,
  doorYawToward,
  type AntechamberPlacement,
} from './antechamber-layout';
import { isCampForegroundFadeLabel } from './camera-fade';
import { CELL, DUNGEON_SEED } from './dungeon-layout';
import { resolveDungeonLayout } from './dungeon-pipeline';

describe('doorYawToward', () => {
  test('faces -Z when target is south of room', () => {
    expect(doorYawToward(0, 0, 0, -10)).toBeCloseTo(Math.PI, 5);
  });

  test('faces +X when target is east of room', () => {
    expect(doorYawToward(0, 0, 8, 0)).toBeCloseTo(-Math.PI / 2, 5);
  });
});

describe('buildAntechamberLayout', () => {
  const base: AntechamberPlacement = {
    widthM: 10,
    depthM: 10,
    doorTowardX: 0,
    doorTowardZ: -20,
  };

  test('uses kit 2m tile language and covers the footprint with floors', () => {
    const layout = buildAntechamberLayout(base);
    expect(ANTECHAMBER_TILE).toBe(2);
    expect(layout.tilesX).toBe(5);
    expect(layout.tilesZ).toBe(5);
    const floors = layout.pieces.filter((p) => p.moduleId === 'kit-floor');
    expect(floors).toHaveLength(25);
  });

  test('includes wall/corner/doorframe/pillar/trim/rubble kit modules', () => {
    const layout = buildAntechamberLayout(base);
    const ids = new Set(layout.pieces.map((p) => p.moduleId));
    for (const id of [
      'kit-floor', 'kit-wall', 'kit-corner', 'kit-doorframe',
      'kit-pillar', 'kit-trim', 'kit-rubble',
    ] as const) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test('registers doorframe + major occluders into probe/fade blockers', () => {
    const layout = buildAntechamberLayout(base);
    const frames = layout.pieces.filter((p) => p.moduleId === 'kit-doorframe');
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames.every((p) => p.name.startsWith('Doorframe1'))).toBe(true);
    const labels = layout.probeBlockers.map((b) => b.label);
    expect(labels).toContain('Doorframe1');
    expect(labels.some((l) => l?.startsWith('Antechamber_wall_'))).toBe(true);
    expect(labels.some((l) => l?.startsWith('Antechamber_corner_'))).toBe(true);
    expect(labels.some((l) => l?.startsWith('Antechamber_pillar_'))).toBe(true);
    expect(labels.every((l) => l && !l.includes('floor') && !l.includes('trim') && !l.includes('rubble'))).toBe(true);
    for (const b of layout.probeBlockers) {
      expect(b.type).toBe('aabb');
    }
    // One probe AABB per occluder piece (walls + corners + door + pillars).
    const occluderPieces = layout.pieces.filter((p) =>
      p.moduleId === 'kit-wall' || p.moduleId === 'kit-corner'
      || p.moduleId === 'kit-doorframe' || p.moduleId === 'kit-pillar');
    expect(layout.probeBlockers).toHaveLength(occluderPieces.length);
  });

  test('light seats sit above floor for den torch pool (no emissive textures)', () => {
    const layout = buildAntechamberLayout(base);
    expect(layout.lightSeats.length).toBeGreaterThanOrEqual(2);
    for (const s of layout.lightSeats) {
      expect(s.y).toBeGreaterThan(1);
    }
  });

  test('sizes to den boss footprint from resolveDungeonLayout (PR1 placement lock)', () => {
    const den = resolveDungeonLayout(DUNGEON_SEED);
    expect(den.bossSize.w).toBeGreaterThan(0);
    expect(den.bossSize.h).toBeGreaterThan(0);
    const layout = buildAntechamberLayout({
      widthM: den.bossSize.w,
      depthM: den.bossSize.h,
      doorTowardX: den.entry.x - den.bossAt.x,
      doorTowardZ: den.entry.z - den.bossAt.z,
    });
    expect(layout.tilesX * ANTECHAMBER_TILE).toBeGreaterThanOrEqual(den.bossSize.w - CELL);
    expect(layout.tilesZ * ANTECHAMBER_TILE).toBeGreaterThanOrEqual(den.bossSize.h - CELL);
  });
});

describe('antechamber fade label extension', () => {
  test('Doorframe + antechamber wall/corner/pillar labels are fade-eligible', () => {
    expect(isCampForegroundFadeLabel('Doorframe1')).toBe(true);
    expect(isCampForegroundFadeLabel('Antechamber_wall_n_12')).toBe(true);
    expect(isCampForegroundFadeLabel('Antechamber_corner_20')).toBe(true);
    expect(isCampForegroundFadeLabel('Antechamber_pillar_24')).toBe(true);
    expect(isCampForegroundFadeLabel('Hut1')).toBe(true);
    expect(isCampForegroundFadeLabel('Antechamber_floor_1')).toBe(false);
    expect(isCampForegroundFadeLabel('FenceW')).toBe(false);
  });
});

describe('N4 #17B two-layer decor (wall band + combat ring)', () => {
  const den = resolveDungeonLayout(DUNGEON_SEED);
  const layout = buildAntechamberLayout({
    widthM: den.bossSize.w,
    depthM: den.bossSize.h,
    doorTowardX: den.entry.x - den.bossAt.x,
    doorTowardZ: den.entry.z - den.bossAt.z,
  });
  const half = (layout.tilesX * ANTECHAMBER_TILE) / 2;
  const DECOR = new Set(['kit-rubble', 'den-log', 'den-boulder', 'den-fence']);
  const decor = layout.pieces.filter((p) => DECOR.has(p.moduleId));
  type Decor = (typeof decor)[number];
  const radius = (p: Decor): number => Math.hypot(p.x, p.z);
  const wallDist = (p: Decor): number =>
    Math.min(half - Math.abs(p.x), half - Math.abs(p.z));
  const ring = decor.filter((p) => radius(p) >= 3.5 && radius(p) <= 7.0);
  const wallBand = decor.filter((p) => wallDist(p) <= 1.2);

  test('total 28–36, split wall band 14–18 / second ring 12–16', () => {
    expect(decor.length).toBeGreaterThanOrEqual(28);
    expect(decor.length).toBeLessThanOrEqual(36);
    expect(wallBand.length).toBeGreaterThanOrEqual(14);
    expect(wallBand.length).toBeLessThanOrEqual(18);
    expect(ring.length).toBeGreaterThanOrEqual(12);
    expect(ring.length).toBeLessThanOrEqual(16);
  });

  test('every piece is ring (3.5≤r≤7.0) XOR wall band (≤1.2 m to wall) — no gap-zone decor', () => {
    for (const p of decor) {
      const inRing = radius(p) >= 3.5 && radius(p) <= 7.0;
      const inWall = wallDist(p) <= 1.2;
      expect(inRing !== inWall).toBe(true);
    }
  });

  test('centre disc r<2.8 holds ZERO decor', () => {
    expect(decor.filter((p) => radius(p) < 2.8)).toHaveLength(0);
  });

  test('doorway channel (3.6 m wide) holds ZERO decor', () => {
    const door = layout.pieces.find((p) => p.moduleId === 'kit-doorframe');
    expect(door).toBeDefined();
    // channel = 3.6 m wide strip from the doorframe inward as far as the
    // clearance disc edge (door centre → circle edge ≈ 8.1 m for the 22 m room)
    const doorDist = Math.hypot(door!.x, door!.z);
    const axisX = -(door!.x) / doorDist;
    const axisZ = -(door!.z) / doorDist;
    const channelLen = doorDist - 2.8;
    for (const p of decor) {
      const rx = p.x - door!.x;
      const rz = p.z - door!.z;
      const distToAxis = Math.abs(rx * axisZ - rz * axisX);
      const inward = rx * axisX + rz * axisZ;
      expect(distToAxis > 1.8 || inward < 0 || inward > channelLen).toBe(true);
    }
  });

  test('second ring = 4 uneven clusters of 3–4 pieces, no fence in the ring', () => {
    const clusterIds = new Set<string>();
    for (const p of ring) {
      const m = /^Antechamber_ringC(\d+)_/.exec(p.name);
      expect(m).not.toBeNull();
      clusterIds.add(m![1]!);
      expect(p.moduleId).not.toBe('den-fence');
    }
    expect(clusterIds.size).toBe(4);
    for (const id of clusterIds) {
      const count = ring.filter((p) => p.name.startsWith(`Antechamber_ringC${id}_`)).length;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(4);
    }
  });

  test('clear of pillars (REAL mesh half-width 0.65 m) and the corner blocks', () => {
    const inset = 1.6;
    const pillarHalf = 0.65;   // kit-pillar.glb measured half-width (probe uses 0.28 — too small)
    const decorHalf = 0.75;    // kit-rubble @0.7 half-extent ≈ 0.7 + margin
    for (const p of decor) {
      for (const [px, pz] of [
        [-half + inset, -half + inset], [half - inset, -half + inset],
        [-half + inset, half - inset], [half - inset, half - inset],
      ] as const) {
        expect(Math.hypot(p.x - px, p.z - pz)).toBeGreaterThanOrEqual(pillarHalf + decorHalf);
      }
      // kit-corner is a SOLID block reaching half−1.4 inward — the literal corner
      // square (both |coord| ≥ half−1.5) must hold no decor.
      expect(Math.abs(p.x) >= half - 1.5 && Math.abs(p.z) >= half - 1.5).toBe(false);
    }
  });

  test('den-prop sizes keep stone ≤0.55 m / wood ≤0.50 m tops', () => {
    // tops = bbox.height × scale (bottom-aligned bake): boulder 1.764·s, log 0.657·s
    for (const p of decor) {
      if (p.moduleId === 'den-boulder') expect(p.sx).toBeLessThanOrEqual(0.31);
      if (p.moduleId === 'den-log') expect(p.sx).toBeLessThanOrEqual(0.51);
    }
  });

  test('ring invariants hold for ALL door bearings (n/e/s/w rotation sweep)', () => {
    // Ring offsets are absolute (not rotated per door side) — adversarial
    // rotation must not push any piece out of the combat ring. Regression
    // lock for the doorBearing math (caught cluster drift r>7.0 at e/w).
    for (const [dx, dz] of [[0, 20], [20, 0], [0, -20], [-20, 0]] as const) {
      const l = buildAntechamberLayout({
        widthM: den.bossSize.w,
        depthM: den.bossSize.h,
        doorTowardX: dx,
        doorTowardZ: dz,
      });
      const h = (l.tilesX * ANTECHAMBER_TILE) / 2;
      const dd = l.pieces.filter((p) => DECOR.has(p.moduleId));
      const door = l.pieces.find((p) => p.moduleId === 'kit-doorframe');
      expect(door).toBeDefined();
      const doorDist = Math.hypot(door!.x, door!.z);
      const axisX = -(door!.x) / doorDist;
      const axisZ = -(door!.z) / doorDist;
      const channelLen = doorDist - 2.8;
      let ringCount = 0;
      for (const p of dd) {
        const r = Math.hypot(p.x, p.z);
        const wd = Math.min(h - Math.abs(p.x), h - Math.abs(p.z));
        const inRing = r >= 3.5 && r <= 7.0;
        expect(inRing !== (wd <= 1.2)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(2.8);
        if (inRing) ringCount++;
        const rx = p.x - door!.x;
        const rz = p.z - door!.z;
        const distToAxis = Math.abs(rx * axisZ - rz * axisX);
        const inward = rx * axisX + rz * axisZ;
        expect(distToAxis > 1.8 || inward < 0 || inward > channelLen).toBe(true);
      }
      expect(ringCount).toBeGreaterThanOrEqual(12);
      expect(ringCount).toBeLessThanOrEqual(16);
    }
  });
});

describe('ANTECHAMBER_SCENE_GUID', () => {
  test('is a fixed UUID distinct from slagdeep pack', () => {
    expect(ANTECHAMBER_SCENE_GUID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ANTECHAMBER_SCENE_GUID).not.toBe('7d1f4b02-5c8e-4b3a-9f6d-2e8a1c0b4d97');
  });
});
