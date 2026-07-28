// Shared engine mocks for bun test files that import engine-touching modules.
//
// bun's mock.module registry is PROCESS-GLOBAL across all test files in one
// run — one registration per specifier serves every file's module graph, so
// per-file mocks with per-file Symbol identities silently clobber each other
// (whichever file "wins" a specifier breaks the others' identity assertions).
// Every engine-importing test MUST source its mocks from this single module:
// registrations are idempotent, identities canonical, and adding a new
// engine-mocking test file means importing from here — never a local mock.
//
// Union of what the current consumers need:
//   hero-preview.race.test.ts / monsters.load-visuals.test.ts / fx/sprite.test.ts
//
// CAVEAT: subpath specifiers like '@forgeax/engine-pack/guid' do NOT reliably
// intercept when mocked from this shared module (the consumer's import then
// binds the REAL module — observed: AssetGuid.parse returning 16-byte form).
// Mock such subpath imports LOCALLY in the consuming test file.

import { mock } from 'bun:test';

export const AnimationPlayer = Symbol('AnimationPlayer');
export const Camera = Symbol('Camera');
export const ChildOf = Symbol('ChildOf');
export const DirectionalLight = Symbol('DirectionalLight');
export const MeshFilter = Symbol('MeshFilter');
export const MeshRenderer = Symbol('MeshRenderer');
export const PointLight = Symbol('PointLight');
export const SceneInstance = Symbol('SceneInstance');
export const Skin = Symbol('Skin');
export const Transform = Symbol('Transform');

export const Materials = {
  standard: (data: unknown) => data,
};

export const quat = {
  eulerY: () => [0, 0, 0, 1],
  create: () => [0, 0, 0, 1],
  fromAxisAngle: () => undefined,
  multiply: () => undefined,
};

export const perspective = (p: unknown) => p;

export const HANDLE_CUBE = 1;
export const HANDLE_SPHERE = 2;
export const HANDLE_QUAD = 7;

export const AssetGuid = {
  parse: (dashForm: string) =>
    /^[0-9a-f-]{36}$/i.test(dashForm)
      ? { ok: true as const, value: dashForm }
      : { ok: false as const, error: new Error('bad guid') },
};

export const unwrapHandle = (h: unknown) => h;

mock.module('@forgeax/engine-animation', () => ({ AnimationPlayer }));

mock.module('@forgeax/engine-render', () => ({
  Camera,
  DirectionalLight,
  Materials,
  MeshFilter,
  MeshRenderer,
  PointLight,
  SceneInstance,
  perspective,
}));

mock.module('@forgeax/engine-scene', () => ({ ChildOf, Transform }));

mock.module('@forgeax/engine-skinning', () => ({ Skin }));

mock.module('@forgeax/engine-runtime', () => ({ quat }));

mock.module('@forgeax/engine-pack/guid', () => ({ AssetGuid }));

mock.module('@forgeax/engine-assets-runtime', () => ({
  HANDLE_CUBE,
  HANDLE_SPHERE,
  HANDLE_QUAD,
}));

mock.module('@forgeax/engine-types', () => ({ unwrapHandle }));
