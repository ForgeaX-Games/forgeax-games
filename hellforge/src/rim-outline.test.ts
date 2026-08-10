// rim-outline G2-B spike unit tests (N4 lighting/decor) — pure logic only,
// no GPU: master-flag default, dual-shape registration + idempotency, shared
// per-kind material table shape / param packing, apply swap routing, and the
// __hf debug switch. Engine mocks come from the shared registry
// (tools/engine-test-mocks.ts header — process-global canonical identities);
// only the WGSL module is mocked locally (sprite.test.ts precedent).
//
// NOTE: the bun-side Materials mock returns the probe data verbatim (no
// `passes`), so `customPassShaderShape` resolves to the NEW shape
// ({ program: { module }, values }). The LEGACY shape branch
// ({ shader, paramValues }) is the same idiom as fx.ts:278-302 and is
// covered there; it is not reachable under bun without re-mocking
// @forgeax/engine-render, which the shared-mock rule forbids.

import { describe, expect, mock, spyOn, test } from 'bun:test';
import type { EntityHandle } from '@forgeax/engine-ecs';

import '../tools/engine-test-mocks';

mock.module('./shaders/rim-outline.wgsl', () => ({ default: { wgsl: '// stub' } }));

const { MeshRenderer } = await import('../tools/engine-test-mocks');

/** Test-only cast: entities are branded numbers at runtime. */
const ent = (n: number) => n as unknown as EntityHandle;

const {
  RIM_OUTLINE_ENABLED,
  RIM_OUTLINE_SHADER_ID,
  RIM_OUTLINE_PARAM_SCHEMA,
  RIM_TINT_KINDS,
  applyRimOutline,
  buildRimMaterialTable,
  ensureRimOutlineRegistered,
  installRimOutlineDebugSwitch,
} = await import('./rim-outline');

/** Recording World stub — covers allocSharedRef + set (the two APIs this module touches). */
class StubWorld {
  materials: unknown[] = [];
  sets: Array<{ e: unknown; component: unknown; data: unknown }> = [];

  allocSharedRef(kind: string, asset: unknown): unknown {
    this.materials.push(asset);
    return { fake: kind };
  }

  set(e: unknown, component: unknown, data: unknown): void {
    this.sets.push({ e, component, data });
  }
}

function makeApp(register: (id: string, entry: unknown) => void = () => {}) {
  // Current Engine API — dual helper prefers this over registerMaterialShader.
  return { renderer: { shader: { installMaterialArtifact: register } } };
}

describe('rim-outline flag (G2-B spike)', () => {
  test('RIM_OUTLINE_ENABLED defaults to false (opt-in spike)', () => {
    expect(RIM_OUTLINE_ENABLED).toBe(false);
  });

  test('shader id uses the user namespace, schema matches the WGSL ABI', () => {
    expect(RIM_OUTLINE_SHADER_ID).toBe('hellforge::rim-outline');
    expect(RIM_OUTLINE_SHADER_ID.startsWith('forgeax::')).toBe(false);
    expect(RIM_OUTLINE_PARAM_SCHEMA.map((p) => p.name)).toEqual([
      'rimColor',
      'rimPower',
      'rimIntensity',
    ]);
    expect(RIM_OUTLINE_PARAM_SCHEMA[0]?.type).toBe('color');
    expect(RIM_OUTLINE_PARAM_SCHEMA[1]?.type).toBe('f32');
    expect(RIM_OUTLINE_PARAM_SCHEMA[2]?.type).toBe('f32');
  });
});

describe('ensureRimOutlineRegistered', () => {
  test('registers the shader with source + paramSchema and returns true', () => {
    const registered: Array<{ id: string; entry: unknown }> = [];
    const app = makeApp((id, entry) => registered.push({ id, entry }));
    const ok = ensureRimOutlineRegistered(app);
    expect(ok).toBe(true);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.id).toBe('hellforge::rim-outline');
    const entry = registered[0]!.entry as { source: string; paramSchema: unknown };
    expect(entry.source).toBe('// stub');
    expect(entry.paramSchema).toEqual(RIM_OUTLINE_PARAM_SCHEMA);
  });

  test('idempotent — an "already registered" throw is swallowed, returns true', () => {
    const app = makeApp(() => {
      throw new Error("ShaderRegistry: material shader identifier 'hellforge::rim-outline' already registered;");
    });
    expect(ensureRimOutlineRegistered(app)).toBe(true);
  });

  test('unexpected register error returns false and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = makeApp(() => {
        throw new Error('boom');
      });
      expect(ensureRimOutlineRegistered(app)).toBe(false);
      expect(warn.mock.calls.length).toBe(1);
      expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('installMaterialArtifact');
    } finally {
      warn.mockRestore();
    }
  });

  test('returns false when the shader registry is unavailable (Edit mode)', () => {
    expect(ensureRimOutlineRegistered({})).toBe(false);
    expect(ensureRimOutlineRegistered({ renderer: {} })).toBe(false);
  });
});

describe('buildRimMaterialTable', () => {
  test('allocates exactly one shared material per tint kind (no per-entity clone)', () => {
    const world = new StubWorld();
    const table = buildRimMaterialTable(world as never);
    expect(RIM_TINT_KINDS).toEqual(['ember', 'frost', 'brimstone']);
    for (const kind of RIM_TINT_KINDS) {
      expect(table[kind]).toBeDefined();
    }
    expect(world.materials).toHaveLength(RIM_TINT_KINDS.length);
  });

  test('materials carry the new-shape pass + packed rim params', () => {
    const world = new StubWorld();
    const table = buildRimMaterialTable(world as never);
    const ember = world.materials[0] as {
      kind: string;
      passes: Array<{ program?: { module: string } }>;
      values: { rimColor: number[]; rimPower: number; rimIntensity: number };
    };
    expect(ember.kind).toBe('material');
    expect(ember.passes[0]?.program?.module).toBe('hellforge::rim-outline');
    expect(ember.values.rimColor).toHaveLength(4);
    expect(typeof ember.values.rimPower).toBe('number');
    expect(typeof ember.values.rimIntensity).toBe('number');
  });

  test('tint packing stays inside each hue family (ember warm, frost cool, brimstone green)', () => {
    const world = new StubWorld();
    buildRimMaterialTable(world as never);
    const values = world.materials.map(
      (m) => (m as { values: { rimColor: number[]; rimPower: number } }).values,
    );
    const [ember, frost, brimstone] = values;
    expect(ember!.rimColor[0]!).toBeGreaterThan(ember!.rimColor[2]!); // r > b
    expect(ember!.rimColor[0]!).toBeGreaterThan(ember!.rimColor[1]!); // r > g
    expect(frost!.rimColor[2]!).toBeGreaterThan(frost!.rimColor[0]!); // b > r
    expect(brimstone!.rimColor[1]!).toBeGreaterThan(brimstone!.rimColor[0]!); // g > r
    for (const v of values) {
      expect(v!.rimPower).toBeGreaterThan(0);
    }
  });
});

describe('applyRimOutline', () => {
  test('swaps MeshRenderer.materials to the shared per-kind handle', () => {
    const world = new StubWorld();
    const table = buildRimMaterialTable(world as never);
    const applied = applyRimOutline(world as never, [ent(11), ent(12)], table, 'frost');
    expect(applied).toBe(2);
    expect(world.sets).toHaveLength(2);
    for (const s of world.sets) {
      expect(s.component).toBe(MeshRenderer);
      expect((s.data as { materials: unknown[] }).materials).toEqual([table.frost]);
    }
  });

  test('defaults to the ember kind', () => {
    const world = new StubWorld();
    const table = buildRimMaterialTable(world as never);
    applyRimOutline(world as never, [ent(1)], table);
    expect(world.sets[0]?.data).toEqual({ materials: [table.ember] });
  });

  test('skips empty / sentinel entities and returns the applied count', () => {
    const world = new StubWorld();
    const table = buildRimMaterialTable(world as never);
    expect(applyRimOutline(world as never, [], table)).toBe(0);
    expect(applyRimOutline(world as never, [ent(0), ent(1), undefined as never, ent(2)], table)).toBe(2);
    expect(world.sets).toHaveLength(2);
  });
});

describe('installRimOutlineDebugSwitch', () => {
  test('merges a rimOutline panel into __hf without clobbering existing keys', () => {
    const target: { __hf?: unknown } = { __hf: { state: 'playing' } };
    installRimOutlineDebugSwitch(target);
    const hf = target.__hf as Record<string, unknown>;
    expect(hf.state).toBe('playing');
    const panel = hf.rimOutline as Record<string, unknown>;
    expect(panel.enabled).toBe(false);
    expect(panel.shaderId).toBe('hellforge::rim-outline');
    expect(panel.tintKinds).toEqual(['ember', 'frost', 'brimstone']);
  });

  test('creates __hf when absent', () => {
    const target: { __hf?: unknown } = {};
    installRimOutlineDebugSwitch(target);
    expect((target.__hf as Record<string, unknown>).rimOutline).toBeDefined();
  });
});
