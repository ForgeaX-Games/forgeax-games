import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function rendererDistDirectory() {
  return fileURLToPath(
    new URL('../../../engine-render/dist/', import.meta.resolve('@forgeax/engine/render')),
  );
}

function readRendererModuleByMarker(marker, label) {
  const directory = rendererDistDirectory();
  const matches = readdirSync(directory)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => ({ name, path: `${directory}/${name}` }))
    .map((candidate) => ({ ...candidate, source: readFileSync(candidate.path, 'utf8') }))
    .filter((candidate) => candidate.source.includes(marker));
  if (matches.length !== 1) {
    throw new Error(
      `SDK ${label} marker must identify one compiled module; found ${matches.length}: ${matches
        .map(({ name }) => name)
        .join(', ')}`,
    );
  }
  return matches[0];
}

function rendererPackage() {
  return JSON.parse(
    readFileSync(
      new URL('../../../engine-render/package.json', import.meta.resolve('@forgeax/engine/render')),
      'utf8',
    ),
  );
}

export function installedRendererVersion() {
  const version = rendererPackage().version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('Installed @forgeax/engine-render package has no version');
  }
  return version;
}

function rendererSource() {
  return readRendererModuleByMarker('const idToRuntimeVariantWgsl =', 'runtime variant selector').source;
}

/** Execute the installed SDK selector, not a second copy of its predicates. */
export function runtimeVariantSelector(capabilities) {
  const source = rendererSource();
  const section = source.split('const idToRuntimeVariantWgsl =')[1]?.split('const patchRuntimeVariant =')[0];
  const predicate = section?.match(/const exact = ms\.variants\.find\(\s*([\s\S]*?)\s*\);/)?.[1];
  if (!predicate) throw new Error('SDK runtime variant selector changed; review the patch and this regression probe');
  // Trusted, locally installed SDK code. Extraction keeps this test sensitive to
  // the real selector without constructing a GPU device or copying its logic.
  return Function(...Object.keys(capabilities), `return (${predicate});`)(...Object.values(capabilities));
}

/** Read the installed GPU scene/visible-stream material-index contract. */
export function colorMaterialStreamSources() {
  return {
    visible: readRendererModuleByMarker(
      'var materialOrPalette = primitive.materialIndex +',
      'GPU color visible-stream material index',
    ).source,
    scene: readRendererModuleByMarker(
      'materialIndexForSlot(slot, materialSlot) {',
      'GPU scene material allocation',
    ).source,
  };
}

export function recordMainGeometrySubmission(environment) {
  const source = readRendererModuleByMarker(
    'function recordMainPass(c, selector, options, graphPass)',
    'main-pass recorder',
  ).source;
  const functionStart = source.indexOf('function recordMainPass(c, selector, options, graphPass)');
  const start = source.indexOf('    const resolveMaterialBindGroup =', functionStart);
  const end = source.indexOf('    if (passKind === "forward" && recordMode === void 0)', start);
  if (functionStart < 0 || start < 0 || end < 0)
    throw new Error('SDK main-pass recording changed; review transparent draw ordering');
  return Function(...Object.keys(environment), source.slice(start, end))(...Object.values(environment));
}

/** Coverage/TAA passes must not erase the main pass's shadow observation. */
export function recordSceneShadowObservation(environment) {
  const source = readRendererModuleByMarker(
    'function addTypedScenePass(graph, options)',
    'typed scene-pass recorder',
  ).source;
  const functionStart = source.indexOf('function addTypedScenePass(graph, options)');
  const start = source.indexOf('      const directionalShadow = options.directionalShadow', functionStart);
  const end = source.indexOf('      const groups = buildPerFrameBindGroups(', start);
  if (functionStart < 0 || start < 0 || end < 0)
    throw new Error('SDK scene-pass shadow observation changed; review the patch');
  return Function(...Object.keys(environment), source.slice(start, end))(...Object.values(environment));
}

/** Execute the installed renderer's per-frame shadow-observation reset. */
export function resetFrameShadowObservation(frameState) {
  const marker = 'function recordFrame(internals, world, cameras, lights, renderables';
  const source = readRendererModuleByMarker(marker, 'frame recorder').source;
  const functionStart = source.indexOf(marker);
  const start = source.indexOf('    frameState.currentDirectionalShadowView = null;', functionStart);
  const endMarker = '    frameState.currentSpotShadowView = null;';
  const end = source.indexOf(endMarker, start);
  if (functionStart < 0 || start < 0 || end < 0)
    throw new Error('SDK frame shadow reset changed; review the cross-frame observation contract');
  return Function('frameState', source.slice(start, end + endMarker.length))(frameState);
}
