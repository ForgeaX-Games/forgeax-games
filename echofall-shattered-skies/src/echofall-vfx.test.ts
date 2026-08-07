import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { landmarkVfxState } from './echofall-landmark-vfx';

const gameRoot = resolve(import.meta.dir, '..');
const mainSource = readFileSync(resolve(gameRoot, 'main.ts'), 'utf8');
const effectPack = JSON.parse(
  readFileSync(resolve(gameRoot, 'assets/vfx/beacon-aura.pack.json'), 'utf8'),
) as {
  schemaVersion: string;
  assets: Array<{
    kind: string;
    execution: string;
    payload: { emitters: Array<{
      capacity: number;
      backendPolicy: { kind: string; backend: string };
      output: { kind: string; material: string };
    }> };
  }>;
};

describe('Echofall native particle contract', () => {
  test('authors one cooked Pack v2 effect with four bounded CPU billboard layers', () => {
    expect(effectPack.schemaVersion).toBe('2.0.0');
    expect(effectPack.assets).toHaveLength(1);
    const effect = effectPack.assets[0]!;
    expect(effect.kind).toBe('particle-effect');
    expect(effect.execution).toBe('cooked');
    expect(effect.payload.emitters).toHaveLength(4);
    expect(effect.payload.emitters.map((emitter) => (emitter as { id: string }).id)).toEqual([
      'beacon-volume', 'golden-memory', 'skyward-runes', 'aether-breath',
    ]);
    expect(effect.payload.emitters.reduce((sum, emitter) => sum + emitter.capacity, 0)).toBe(120);
    expect(effect.payload.emitters.every((emitter) =>
      emitter.backendPolicy.kind === 'required' && emitter.backendPolicy.backend === 'cpu')).toBeTrue();
    expect(effect.payload.emitters.every((emitter) => emitter.output.kind === 'billboard')).toBeTrue();
    expect(effect.payload.emitters.map((emitter) => emitter.output.material)).toEqual([
      'cc0c6eaf-086b-4a02-b0d3-ea068b178105',
      '6d901653-687b-4a21-997e-719544fcc106',
      'cc0c6eaf-086b-4a02-b0d3-ea068b178105',
      'cc0c6eaf-086b-4a02-b0d3-ea068b178105',
    ]);
  });

  test('reads the engine simulation resource and contains no mesh-particle fallback', () => {
    expect(mainSource).toContain('PARTICLE_SIMULATION_RESOURCE_KEY');
    expect(mainSource).toContain("id: 'echofall.vfx'");
    expect(mainSource).not.toContain('const particles:');
    expect(mainSource).not.toContain('for (const particle of particles)');
    expect(readdirSync(resolve(gameRoot, 'assets/vfx')).some((name) => name.endsWith('particle.json'))).toBeFalse();
  });

  test('derives coherent proximity feedback for mesh, halo, and native player time', () => {
    const far = landmarkVfxState(1, 20, false);
    const near = landmarkVfxState(1, 1, false);
    const awakened = landmarkVfxState(1, 1, true);
    expect(near.proximity).toBeGreaterThan(far.proximity);
    expect(near.particleTimeScale).toBeGreaterThan(far.particleTimeScale);
    expect(awakened.coreScale).toBeGreaterThan(near.coreScale);
    expect(awakened.haloScale).toBeGreaterThan(near.haloScale);
  });
});
