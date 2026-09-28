// Build-output contract check, not a substitute for GPU/visual acceptance.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readShaderManifestPublication } from '@forgeax/engine/shader';
import { installedRendererVersion } from './lib/sdk-runtime-variant.mjs';

// SDK 0.1.38 publishes deduplicated fragments + source digests. Use the same
// decoder as the runtime, including verification of every source SHA-256.
const manifest = await readShaderManifestPublication(JSON.parse(readFileSync(new URL('../dist/shaders/manifest.json', import.meta.url), 'utf8')));
const shaders = manifest.materialShaders.filter((entry) => entry.identifier.startsWith('hellforge::'));
assert.equal(shaders.length, 8, 'Every published FX root must be present');
const expectedAxes = [
  'false:false',
  'false:true',
  'true:false',
  'true:true',
];
const results = [];
for (const shader of shaders) {
  assert.equal(shader.variants.length, 4, 'Storage/uniform and temporal/coverage axes must all compile');
  const actualAxes = shader.variants
    .map(({ defines }) => `${String(defines.STORAGE_BUFFER_AVAILABLE)}:${String(defines.COVERAGE_ONLY)}`)
    .sort();
  assert.deepEqual(actualAxes, expectedAxes, `${shader.identifier} must publish the exact storage×coverage matrix`);
  for (const variant of shader.variants) {
    const source = variant.composedWgsl;
    assert.match(source, /fn vs_temporal\(/, shader.identifier);
    assert.match(source, /fn fs_temporal\(/, shader.identifier);
    assert.match(source, /discard;/, 'Invisible pixels must not overwrite temporal history');
    if (!variant.defines.COVERAGE_ONLY) {
      assert.match(source, /packSceneTemporalV1WithValidity/, shader.identifier);
      if (variant.defines.STORAGE_BUFFER_AVAILABLE) assert.match(source, /previousWorldFromLocal/);
    }
  }
  results.push({ shader: shader.identifier, variants: shader.variants.map(({ defines }) => defines) });
}
console.log(JSON.stringify({ ok: true, sdk: `@forgeax/engine-render@${installedRendererVersion()}`, shaders: results }, null, 2));
