/// <reference types="vite/client" />

// `@forgeax/engine-vite-plugin-shader` (configured in play-runtime's
// vite.config) transforms `*.wgsl` modules into `{ hash, wgsl }` JS modules
// at build time — same import shape cow-survivor and the engine demos use.
declare module '*.wgsl' {
  const value: { readonly hash: string; readonly wgsl: string };
  export default value;
}
