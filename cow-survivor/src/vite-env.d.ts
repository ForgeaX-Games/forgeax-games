/// <reference types="vite/client" />

// `@forgeax/engine-vite-plugin-shader` (configured in play-runtime/vite.config.ts)
// transforms `*.wgsl` modules into `{ hash, wgsl }` JS modules at build time.
// cow-survivor consumes them via the same import shape as the engine's
// custom-shader / framebuffers demos.
declare module '*.wgsl' {
  const value: { readonly hash: string; readonly wgsl: string };
  export default value;
}
