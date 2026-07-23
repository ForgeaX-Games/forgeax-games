import { describe, expect, test } from 'bun:test';
import {
  canEnterArea,
  canEnterSlagdeep,
  chooseSeededDecor,
  chooseSeededEncounters,
  enterArea,
  getAreaDef,
  getExitDef,
  listAreaDefs,
  nextWildSpawn,
  slagdeepLayoutSeed,
} from './areas';
import { deriveAreaSeed } from './combat-run';
import { DUNGEON_SEED } from './dungeon-layout';
import { resolveDungeonLayout } from './dungeon-pipeline';

describe('AreaDef registry', () => {
  test('registers hub, wilderness, and dungeon', () => {
    const ids = listAreaDefs().map((a) => a.id).sort();
    expect(ids).toEqual(['ashen-reach', 'cinderwatch', 'slagdeep-hollow']);
    expect(getAreaDef('cinderwatch').kind).toBe('hub');
    expect(getAreaDef('ashen-reach').kind).toBe('wilderness');
    expect(getAreaDef('slagdeep-hollow').kind).toBe('dungeon');
    expect(getAreaDef('cinderwatch').music).toBe('camp');
    expect(getAreaDef('slagdeep-hollow').music).toBe('den');
    expect(slagdeepLayoutSeed()).toBe(DUNGEON_SEED);
  });

  test('Slagdeep entry denied for available; allowed for active|ready|completed', () => {
    const exit = getExitDef('reach-to-slagdeep')!;
    expect(canEnterArea(exit, { 'purge-slagdeep-hollow': { status: 'available' } })).toBe(false);
    expect(canEnterSlagdeep({ 'purge-slagdeep-hollow': { status: 'available' } })).toBe(false);
    for (const status of ['active', 'ready', 'completed'] as const) {
      expect(canEnterSlagdeep({ 'purge-slagdeep-hollow': { status } })).toBe(true);
    }
  });

  test('enterArea hides dungeon origin; seed is derived', () => {
    const t = enterArea('slagdeep-hollow', 'den-entry', {
      characterId: 'hero-1',
      den: { entry: { x: 312, z: 318 }, exitPad: { x: 312, z: 321 } },
    });
    expect(t.playerPos).toEqual([312, 318]);
    expect(t.runtimeTag).toBe('den');
    expect(t.music).toBe('den');
    expect(t.areaSeed).toBe(
      deriveAreaSeed('hero-1', 'purge-slagdeep-hollow', 'slagdeep-hollow'),
    );
    // Callers must not need the raw (300,300) constant.
    expect(t.playerPos[0]).not.toBe(300);
  });

  test('enterArea camp/wild use authored entry points', () => {
    const camp = enterArea('cinderwatch', 'camp-center', { characterId: 'h' });
    expect(camp.playerPos).toEqual([0, 5]);
    expect(camp.runtimeTag).toBe('camp');
    const wild = enterArea('ashen-reach', 'cave-mouth', { characterId: 'h' });
    expect(wild.runtimeTag).toBe('wild');
    expect(wild.playerPos[0]).toBe(11);
  });
});

describe('seeded wilderness + dungeon layout', () => {
  const markers = [
    { id: 'a', pos: [1, 2] as const, table: 'ashen-patrol' },
    { id: 'b', pos: [3, 4] as const, table: 'ashen-patrol' },
    { id: 'c', pos: [5, 6] as const, table: 'ashen-patrol' },
  ];
  const decor = [
    { id: 'd1', pos: [0, 1] as const, pool: 'ashen-ground' },
    { id: 'd2', pos: [2, 3] as const, pool: 'ashen-ground' },
  ];

  test('same area seed reproduces encounter and decor marker choices', () => {
    const seed = deriveAreaSeed('char-x', 'purge-slagdeep-hollow', 'ashen-reach');
    const e1 = chooseSeededEncounters(markers, seed);
    const e2 = chooseSeededEncounters(markers, seed);
    expect(e1).toEqual(e2);
    expect(e1).toHaveLength(3);
    const d1 = chooseSeededDecor(decor, seed);
    const d2 = chooseSeededDecor(decor, seed);
    expect(d1).toEqual(d2);
    // Different seed → different stream (very likely different kinds)
    const other = chooseSeededEncounters(markers, seed ^ 0xffff);
    expect(other).toHaveLength(3);
  });

  test('same dungeon seed reproduces layout rooms and spawns', () => {
    // Shipping path = modular pipeline (PR3 T5); greybox remains behind flag.
    const a = resolveDungeonLayout(DUNGEON_SEED);
    const b = resolveDungeonLayout(DUNGEON_SEED);
    expect(a.roomCount).toBe(b.roomCount);
    expect(a.monsterSpawns).toEqual(b.monsterSpawns);
    expect(a.entry).toEqual(b.entry);
    expect(a.bossAt).toEqual(b.bossAt);
    expect(slagdeepLayoutSeed()).toBe(DUNGEON_SEED);
  });

  test('nextWildSpawn is deterministic for the same tick/seed', () => {
    const seed = 123456789;
    const opts = {
      inCamp: () => false,
      walkable: () => true,
      inDungeon: () => false,
    };
    const a = nextWildSpawn(seed, 3, [0, 20], opts);
    const b = nextWildSpawn(seed, 3, [0, 20], opts);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });
});
