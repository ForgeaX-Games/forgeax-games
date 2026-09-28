import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('SDK build-published FX roots', () => {
  const dir = join(import.meta.dir, '../assets/materials');
  const roots = readdirSync(dir).filter((file) => file.endsWith('.material.pack.json'))
    .map((file) => ({ file, asset: JSON.parse(readFileSync(join(dir, file), 'utf8')).assets[0] }));

  test('all eight roots use distinct GUIDs and compiled shader identities', () => {
    expect(roots.length).toBe(8);
    expect(new Set(roots.map(({ asset }) => asset.guid)).size).toBe(8);
    expect(new Set(roots.map(({ asset }) => asset.payload.passes[0].program.module)).size).toBe(8);
  });

  for (const { file, asset } of roots) {
    test(`${file} satisfies required numeric parameters before registration`, () => {
      for (const parameter of asset.payload.parameters) {
        if (parameter.type === 'texture' || parameter.optional || parameter.default !== undefined) continue;
        expect(asset.payload.values[parameter.name]).toBeDefined();
      }
      const state = asset.payload.passes[0].renderState;
      expect(state.depthWriteEnabled).toBe(false);
      expect(state.blend.color.srcFactor).toBe('one');
      expect(asset.sourceKey.endsWith('.wgsl')).toBe(true);
    });
  }
});

test('baked scene materials use SDK pass names and matching render tags', () => {
  const dir = join(import.meta.dir, '../assets/scenes');
  for (const file of readdirSync(dir).filter((file) => file.endsWith('.pack.json'))) {
    const pack = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const asset of pack.assets.filter((asset: { kind: string }) => asset.kind === 'material')) {
      for (const pass of asset.payload.passes ?? []) {
        const modes: Record<string, string> = { forward: 'Forward', deferred: 'Deferred', 'shadow-caster': 'ShadowCaster' };
        expect(modes[pass.name]).toBeDefined();
        expect(pass.renderState.tags.LightMode).toBe(modes[pass.name]);
      }
      expect(asset.payload.parameters.length).toBeGreaterThan(0);
    }
  }
});

test('every published FX shader owns the temporal ABI and reuses visible alpha', () => {
  for (const file of ['sprite', 'fire-bolt', 'frost-fang', 'frost-impact', 'frost-slow', 'portal-vortex', 'move-click']) {
    const source = readFileSync(join(import.meta.dir, `shaders/${file}.wgsl`), 'utf8');
    expect(source).toContain('fn vs_temporal(');
    expect(source).toContain('fn fs_temporal(');
    expect(source).toContain('temporalCurrentViewProj');
    expect(source).toContain('temporalPreviousViewProj');
    expect(source).toContain('previousWorldFromLocal');
    expect(source).toContain('packSceneTemporalV1WithValidity(');
    expect(source).toContain('if (shadeFx(in).a <= 0.0) { discard; }');
    expect(source).toContain('return shadeFx(in);');
  }
});

test('opaque stone kit never emits untextured white light', () => {
  const dir = join(import.meta.dir, '../assets/kit/modules');
  const files = readdirSync(dir).filter((file) => file.endsWith('.glb'));
  expect(files.length).toBe(7);
  for (const file of files) {
    const bytes = readFileSync(join(dir, file));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    for (const material of gltf.materials) {
      expect(material.emissiveTexture).toBeUndefined();
      expect(material.emissiveFactor ?? [0, 0, 0]).toEqual([0, 0, 0]);
    }
  }
});
