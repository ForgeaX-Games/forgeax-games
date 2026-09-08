import { describe, expect, it } from 'vitest';
import pack, { assets } from '../../assets/brotato-v2.pack.ts';
import { ARENA } from '../config/arena.ts';
import { createArenaGeometry } from '../../assets/lib.ts';

describe('Brotato v2 M0 arena pack', () => {
  it('builds every declared output and produces an 11-entity arena scene', async () => {
    const built = await pack.build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.value).sort()).toEqual(Object.keys(assets).sort());
    expect(built.value['scene/arena'].entities).toHaveLength(11);
    const sun = built.value['scene/arena'].entities.find(
      (entity) => entity.components.Name?.value === 'Arena Sun',
    );
    expect(sun?.components.DirectionalLight?.castShadow).toBe(true);

    const ambient = built.value['scene/arena'].entities.find(
      (entity) => entity.components.Name?.value === 'Arena Ambient',
    );
    const skybox = built.value['scene/arena'].entities.find(
      (entity) => entity.components.Name?.value === 'Arena Skybox',
    );
    expect(ambient?.components.Skylight?.equirect).not.toBe(
      skybox?.components.SkyboxBackground?.equirect,
    );
    expect(Array.from(built.value['equirect/background'].data)).toEqual([
      0x00, 0x28,
      0x00, 0x28,
      0x00, 0x28,
      0x00, 0x3c,
    ]);

    for (const key of ['material/potato-body', 'material/potato-sprout'] as const) {
      expect(built.value[key].passes?.some((pass) => pass.name === 'shadow-caster')).toBe(true);
    }
  });

  it('uses the 40 x 40 grid while keeping tiles in two renderable batches', () => {
    const geometry = createArenaGeometry();
    const baseTile = geometry.floor.vertices.length;
    expect(ARENA.grid).toEqual({ columns: 40, rows: 40 });
    expect(geometry.tileA.submeshes).toHaveLength(1);
    expect(geometry.tileB.submeshes).toHaveLength(1);
    expect(geometry.tileA.vertices.length).toBe(baseTile * (ARENA.grid.columns * ARENA.grid.rows / 2));
    expect(geometry.tileB.vertices.length).toBe(baseTile * (ARENA.grid.columns * ARENA.grid.rows / 2));
  });

  it('binds material slots and keeps all four walls at the configured offset', async () => {
    const built = await pack.build();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const key of ['mesh/arena-floor', 'mesh/arena-field-a', 'mesh/arena-field-b', 'mesh/arena-wall'] as const) {
      expect(built.value[key].submeshes.length).toBeGreaterThan(0);
      expect(built.value[key].materialSlots?.length ?? 0).toBeGreaterThan(0);
    }
    const walls = built.value['scene/arena'].entities.filter((entity) =>
      ['North Wall', 'South Wall', 'West Wall', 'East Wall'].includes(String(entity.components.Name?.value)),
    );
    expect(walls).toHaveLength(4);
    for (const wall of walls) {
      const pos = wall.components.Transform?.pos as readonly number[];
      expect(Math.max(Math.abs(pos[0] ?? 0), Math.abs(pos[2] ?? 0))).toBe(ARENA.wall.offset);
    }
  });
});
