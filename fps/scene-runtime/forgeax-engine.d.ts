// Ambient module shims for the @forgeax/engine-* packages.
//
// These packages ship runtime ESM (dist/*.mjs) but, in this checkout, their
// declaration files (dist/*.d.ts) are NOT built — so tsc cannot resolve their
// types. esbuild/vite strip types at dev/build time, so the runtime is fine;
// these `declare module` shims just let tsc treat the engine surface as `any`
// instead of erroring on the missing declarations. Mirrors editor-runtime's
// src/forgeax-engine.d.ts. When the engine ships .d.ts, delete this file.

declare module '@forgeax/engine-runtime';
declare module '@forgeax/engine-ecs';
