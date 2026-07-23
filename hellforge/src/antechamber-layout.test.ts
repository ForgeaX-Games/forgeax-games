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

describe('ANTECHAMBER_SCENE_GUID', () => {
  test('is a fixed UUID distinct from slagdeep pack', () => {
    expect(ANTECHAMBER_SCENE_GUID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ANTECHAMBER_SCENE_GUID).not.toBe('7d1f4b02-5c8e-4b3a-9f6d-2e8a1c0b4d97');
  });
});
