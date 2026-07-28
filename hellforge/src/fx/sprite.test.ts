// SpriteSystem spawn/lifecycle unit tests (PR8 T1) — the layer between pure
// flipbook math (sprite-anim.test.ts) and the executor port (executor.test.ts):
// spawn → tick → die → pool drain, persistent move/release, cap gate, decals.
// Engine mocks come from the shared registry (process-global mock identity —
// see tools/engine-test-mocks.ts header); only the WGSL module is mocked locally.

import { describe, expect, mock, test } from 'bun:test';

import '../../tools/engine-test-mocks';

mock.module('../shaders/sprite.wgsl', () => ({ default: { wgsl: '// stub' } }));

const { SpriteSystem } = await import('./sprite');

interface SpawnRecord {
  entity: number;
  comps: Array<{ component: unknown; data: unknown }>;
}

/** Recording World stub — covers the four World APIs SpriteSystem touches. */
class StubWorld {
  private next = 1;
  spawns: SpawnRecord[] = [];
  despawns: number[] = [];
  sets: Array<{ e: number; data: { pos?: number[] } }> = [];
  materials: unknown[] = [];
  textures: unknown[] = [];

  spawn(...comps: Array<{ component: unknown; data: unknown }>) {
    const entity = this.next++;
    this.spawns.push({ entity, comps });
    return { ok: true as const, value: entity };
  }

  despawn(e: number): void {
    this.despawns.push(e);
  }

  set(e: number, _component: unknown, data: { pos?: number[] }): void {
    this.sets.push({ e, data });
  }

  allocSharedRef(kind: string, asset: unknown): unknown {
    if (kind === 'TextureAsset') this.textures.push(asset);
    else this.materials.push(asset);
    return { fake: kind };
  }
}

function makeApp(registered: string[] = []) {
  return {
    renderer: {
      shader: {
        registerMaterialShader: (id: string) => { registered.push(id); },
      },
    },
  };
}

function makeSystem(canSpawn: () => boolean = () => true) {
  const world = new StubWorld();
  const registered: string[] = [];
  const sys = new SpriteSystem(world as never, makeApp(registered), canSpawn);
  return { world, sys, registered };
}

describe('SpriteSystem spawn/lifecycle (PR8 T1)', () => {
  test('registers the uber shader and becomes available', () => {
    const { sys, registered } = makeSystem();
    expect(registered).toEqual(['hellforge::sprite']);
    expect(sys.available()).toBe(true);
  });

  test('one-shot integrates per tick and despawns at end of life', () => {
    const { world, sys } = makeSystem();
    const e = sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'glow', life: 0.5 });
    expect(e).not.toBeNull();
    expect(sys.count()).toBe(1);
    sys.tick(0.25, 0.25);
    expect(sys.count()).toBe(1);
    sys.tick(0.3, 0.55);
    expect(sys.count()).toBe(0);
    expect(world.despawns).toContain(e);
  });

  test('gravity sprites ground-clamp instead of falling through the floor', () => {
    const { world, sys } = makeSystem();
    sys.spawn({ pos: [0, 0.2, 0], vel: [0, -5, 0], gy: -9, size: 1, sheet: 'glow', life: 0.5 });
    sys.tick(0.1, 0.1);
    const set = world.sets.at(-1)!;
    expect(set.data.pos![1]).toBeGreaterThanOrEqual(0.03);
  });

  test('persistent sprite animates but never auto-dies; move re-anchors it', () => {
    const { world, sys } = makeSystem();
    const h = sys.spawnPersistent({ pos: [1, 2, 3], size: 1, sheet: 'flame' });
    expect(h).toBeGreaterThan(0);
    const entity = world.spawns.at(-1)!.entity;
    sys.tick(10, 10);
    expect(sys.persistentCount()).toBe(1);
    expect(world.despawns).not.toContain(entity);
    sys.move(h, 4, 5, 6);
    const last = world.sets.at(-1)!;
    expect(last.e).toBe(entity);
    expect(last.data.pos).toEqual([4, 5, 6]);
  });

  test('persistent release is exactly-once; move on a stale handle is a no-op', () => {
    const { world, sys } = makeSystem();
    const h = sys.spawnPersistent({ pos: [0, 0, 0], size: 1, sheet: 'glow' });
    const entity = world.spawns.at(-1)!.entity;
    sys.release(h);
    expect(sys.persistentCount()).toBe(0);
    expect(world.despawns).toContain(entity);
    sys.release(h);
    expect(world.despawns.filter((d) => d === entity)).toHaveLength(1);
    const setsBefore = world.sets.length;
    sys.move(h, 9, 9, 9);
    expect(world.sets.length).toBe(setsBefore);
  });

  test('combined-cap gate blocks one-shots but persistent fixtures bypass it', () => {
    const { world, sys } = makeSystem(() => false);
    expect(sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'glow' })).toBeNull();
    const h = sys.spawnPersistent({ pos: [0, 0, 0], size: 1, sheet: 'glow' });
    expect(h).toBeGreaterThan(0);
    sys.clear();
    expect(sys.count()).toBe(0);
    expect(sys.persistentCount()).toBe(0);
    expect(world.despawns.length).toBe(1);
  });

  test('decal spawns flat (ground quat) and dies by erosion life', () => {
    const { world, sys } = makeSystem();
    const e = sys.spawnDecal(1, 0.045, 2, {
      pos: [1, 0.045, 2], sheet: 'scorch', size: 1.3, life: 0.4,
    });
    expect(e).not.toBeNull();
    const t = world.spawns.at(-1)!.comps[0]!.data as { quat?: number[] };
    expect(t.quat).toBeDefined();
    sys.tick(0.45, 0.45);
    expect(sys.count()).toBe(0);
  });

  test('unknown sheet no-ops and warns at most once', () => {
    const { sys } = makeSystem();
    const warnings: unknown[][] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      expect(sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'nope' })).toBeNull();
      expect(sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'nope' })).toBeNull();
    } finally {
      console.warn = orig;
    }
    expect(warnings).toHaveLength(1);
    expect(sys.count()).toBe(0);
  });

  test('inert when the shader registry is unavailable (Edit mode)', () => {
    const world = new StubWorld();
    const sys = new SpriteSystem(world as never, undefined);
    expect(sys.available()).toBe(false);
    expect(sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'glow' })).toBeNull();
    expect(sys.spawnPersistent({ pos: [0, 0, 0], size: 1, sheet: 'glow' })).toBe(0);
    expect(world.spawns).toHaveLength(0);
  });

  test('material slots pool per sheet|blend across deaths (no realloc)', () => {
    const { world, sys } = makeSystem();
    sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'glow', life: 0.1 });
    sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'glow', life: 0.1 });
    const matsAfterTwo = world.materials.length;
    sys.tick(0.2, 0.2);
    expect(sys.count()).toBe(0);
    sys.spawn({ pos: [0, 0, 0], size: 1, sheet: 'glow', life: 0.1 });
    expect(world.materials.length).toBe(matsAfterTwo); // slot reused from free list
  });
});
