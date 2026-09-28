import { describe, expect, test } from 'bun:test';
import {
  colorMaterialStreamSources,
  recordMainGeometrySubmission,
  recordSceneShadowObservation,
  resetFrameShadowObservation,
  runtimeVariantSelector,
} from './sdk-runtime-variant.mjs';

describe('installed SDK direct-draw material isolation', () => {
  for (const storageBufferCapable of [false, true]) {
    for (const extendedLightingShaderAvailable of [false, true]) {
      test(`does not bind scene material row zero: storage=${storageBufferCapable}, extended=${extendedLightingShaderAvailable}`, () => {
        const select = runtimeVariantSelector({ storageBufferCapable, extendedLightingShaderAvailable, directionalPcssAvailable: true, projectorAvailable: true });
        const base = { STORAGE_BUFFER_AVAILABLE: storageBufferCapable, EXTENDED_LIGHTING_AVAILABLE: extendedLightingShaderAvailable };
        const indirect = { defines: { ...base, GPU_DRIVEN_SCENE_INDEX_AVAILABLE: true, GPU_DRIVEN_SCENE_INDEX_EXPLICIT: false } };
        const explicit = { defines: { ...base, GPU_DRIVEN_SCENE_INDEX_AVAILABLE: false, GPU_DRIVEN_SCENE_INDEX_EXPLICIT: true } };
        const direct = { defines: { ...base, GPU_DRIVEN_SCENE_INDEX_AVAILABLE: false, GPU_DRIVEN_SCENE_INDEX_EXPLICIT: false } };
        expect([indirect, explicit, direct].find(select)).toBe(direct);
        expect([direct, indirect, explicit].find(select)).toBe(direct);
        expect(select({ defines: base })).toBe(true); // Modules without these features remain supported.
        expect(select({ defines: { ...direct.defines, STORAGE_BUFFER_AVAILABLE: !storageBufferCapable } })).toBe(false);
      });
    }
  }
});

test('GPU color draws use the scene allocation plus batch material slot in the visible stream', () => {
  const { visible, scene } = colorMaterialStreamSources();
  expect(visible).toContain(
    'var materialOrPalette = primitive.materialIndex + (candidate.materialSlot & 0x7fffffffu);',
  );
  expect(visible).toContain('visibleIndices[candidate.visibleBase + localVisible] = vec4<u32>(');
  expect(visible).toContain('materialOrPalette,');
  expect(scene).toContain('materialIndexForSlot(slot, materialSlot) {');
  expect(scene).toContain('return allocation.materialStart + materialSlot;');
});

for (const gpu of [false, true]) for (const profiled of [false, true]) {
  test(`opaque GPU batches precede CPU transparent effects: gpu=${gpu}, profile=${profiled}`, () => {
    const calls: string[] = [];
    const pass = { setBindGroup: () => calls.push('view') };
    recordMainGeometrySubmission({
      pass, viewBindGroup: {}, viewBindGroupDynamicOffset: 0,
      recordContext: {}, matchedMaterials: null, materialSlotIndices: [], sampleCount: 1,
      meshGroup2: 2, meshBindGroup: {}, passKind: 'forward', selectedDispatch: [], colorFormats: [],
      gpuDrivenStandardPbrFrameResources: { materialBindGroups: [{}] },
      options: gpu ? { gpuDriven: { projection: { encode: () => calls.push('gpu-opaque') }, resources: {} } } : {},
      recordMode: undefined,
      c: profiled ? { profilePhase: (_name: string, callback: () => void) => callback() } : {},
      recordGeometryDraws: () => calls.push('cpu-opaque-then-transparent'),
    });
    expect(calls.filter((x) => x !== 'view')).toEqual(gpu
      ? ['gpu-opaque', 'cpu-opaque-then-transparent'] : ['cpu-opaque-then-transparent']);
    expect(calls[calls.indexOf('cpu-opaque-then-transparent') - 1]).toBe('view');
  });
}

test('GPU main-pass encode receives the filter and fragment entry point, then restores a non-zero view offset', () => {
  const events: Array<
    | { kind: 'bind'; index: number; group: unknown; offsets: number[] | undefined }
    | { kind: 'gpu' }
    | { kind: 'cpu' }
  > = [];
  const viewBindGroup = { kind: 'direct-view' };
  const resources = { kind: 'gpu-resources' };
  const frameResources = { materialBindGroups: [{}] };
  const encodeArguments: unknown[][] = [];
  const pass = {
    setBindGroup: (index: number, group: unknown, offsets?: number[]) => {
      events.push({ kind: 'bind', index, group, offsets });
    },
  };
  const encode = (...args: unknown[]) => {
    encodeArguments.push(args);
    // The real indirect encoder changes group 0 to its zero-offset view binding.
    pass.setBindGroup(0, { kind: 'indirect-view' }, [0, 0]);
    events.push({ kind: 'gpu' });
  };

  recordMainGeometrySubmission({
    pass,
    viewBindGroup,
    viewBindGroupDynamicOffset: 37,
    recordContext: {},
    matchedMaterials: null,
    materialSlotIndices: [],
    sampleCount: 1,
    meshGroup2: 2,
    meshBindGroup: {},
    passKind: 'forward',
    selectedDispatch: [],
    colorFormats: [],
    gpuDrivenStandardPbrFrameResources: frameResources,
    options: {
      gpuDriven: { projection: { encode }, resources },
      gpuDrivenFilter: 'opaque',
      fragmentEntryPoint: 'fs_gbuffer',
    },
    recordMode: undefined,
    c: {},
    recordGeometryDraws: () => events.push({ kind: 'cpu' }),
  });

  expect(encodeArguments).toHaveLength(1);
  expect(encodeArguments[0]?.[0]).toBe(viewBindGroup);
  expect(encodeArguments[0]?.[1]).toBe(pass);
  expect(encodeArguments[0]?.[2]).toBe(resources);
  expect(encodeArguments[0]?.[3]).toBe(frameResources);
  expect(encodeArguments[0]?.[4]).toBe('opaque');
  expect(encodeArguments[0]?.[5]).toBe('fs_gbuffer');
  expect(events).toEqual([
    { kind: 'bind', index: 0, group: { kind: 'indirect-view' }, offsets: [0, 0] },
    { kind: 'gpu' },
    { kind: 'bind', index: 0, group: viewBindGroup, offsets: [37, 0] },
    { kind: 'cpu' },
  ]);
});

test('coverage pass preserves the shadow views actually submitted by the main pass', () => {
  const directional = { label: 'directional-atlas' };
  const spot = { label: 'spot-atlas' };
  const internal = { frameState: { currentDirectionalShadowView: null, currentSpotShadowView: null } };
  const environment = { internal, resources: {}, resolvedView: (_resources: unknown, view: unknown) => view };
  recordSceneShadowObservation({ ...environment, options: { directionalShadow: { view: directional }, spotShadow: { view: spot } } });
  expect(internal.frameState.currentDirectionalShadowView).toBe(directional);
  expect(internal.frameState.currentSpotShadowView).toBe(spot);
  // Standard scene coverage has no shadow inputs. It runs after scene color.
  recordSceneShadowObservation({ ...environment, options: { passKind: 'temporal', coverageOnly: true } });
  expect(internal.frameState.currentDirectionalShadowView).toBe(directional);
  expect(internal.frameState.currentSpotShadowView).toBe(spot);

  // This body is extracted from the installed SDK's recordFrame reset path,
  // rather than reimplementing the reset in the test.
  resetFrameShadowObservation(internal.frameState);
  expect(internal.frameState.currentDirectionalShadowView).toBeNull();
  expect(internal.frameState.currentSpotShadowView).toBeNull();

  // A no-shadow coverage pass in the next frame must not resurrect frame-one state.
  recordSceneShadowObservation({ ...environment, options: { passKind: 'temporal', coverageOnly: true } });
  expect(internal.frameState.currentDirectionalShadowView).toBeNull();
  expect(internal.frameState.currentSpotShadowView).toBeNull();
});
