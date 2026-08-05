/// <reference types="vite/client" />

// The ForgeaX shader Vite plugin transforms WGSL sources into the same
// descriptor shape consumed by the game at runtime.
declare module '*.wgsl' {
  const value: { readonly hash: string; readonly wgsl: string };
  export default value;
}
