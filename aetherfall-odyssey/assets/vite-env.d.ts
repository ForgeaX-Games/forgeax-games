/// <reference types="vite/client" />

// Studio `check-game-engine-imports` synthesizes include: main.ts + src/**/*.ts.
// Ambient *.wgsl types must live under src/ (or be triple-slash referenced from
// main.ts) — assets/vite-env.d.ts alone is invisible to that gate.
declare module '*.wgsl' {
  const value: { readonly hash: string; readonly wgsl: string };
  export default value;
}
