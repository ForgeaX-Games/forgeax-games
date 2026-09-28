// Read-only probe of the installed SDK selector against the built shader manifest.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { installedRendererVersion, runtimeVariantSelector } from './lib/sdk-runtime-variant.mjs';

const manifest = JSON.parse(readFileSync(new URL('../dist/shaders/manifest.json', import.meta.url), 'utf8'));
const shader = manifest.materialShaders.find((entry) => entry.identifier === 'forgeax::pbr-skin');
if (!shader) throw new Error('Build first: pbr-skin manifest entry missing');

// The desktop capability cases are illustrative, not a claim about GPU limits.
const cases = [false, true].map((extendedLighting) => {
  const matches = shader.variants.filter(runtimeVariantSelector({
    storageBufferCapable: true, directionalPcssAvailable: true,
    projectorAvailable: true, extendedLightingShaderAvailable: extendedLighting,
  }));
  assert.equal(matches.length, 1, 'Direct skin variant must be unambiguous');
  assert.equal(matches[0].defines.GPU_DRIVEN_SCENE_INDEX_AVAILABLE, false);
  assert.notEqual(matches[0].defines.GPU_DRIVEN_SCENE_INDEX_EXPLICIT, true);
  return {
    extendedLighting,
    matches: matches.length,
    selectedByFirstMatch: matches[0]?.defines,
    matchingSceneIndexValues: matches.map(({ defines }) => defines.GPU_DRIVEN_SCENE_INDEX_AVAILABLE),
    directVariantExists: matches.some(({ defines }) => defines.GPU_DRIVEN_SCENE_INDEX_AVAILABLE === false),
  };
});
console.log(JSON.stringify({
  sdk: `@forgeax/engine-render@${installedRendererVersion()}`, shader: shader.identifier,
  interpretation: 'Installed selector and build-manifest regression only; GPU pixels require a separate browser check.',
  cases,
}, null, 2));
