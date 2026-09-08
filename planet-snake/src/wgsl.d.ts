// forgeaxShader (vite-plugin-shader) transforms any *.wgsl import; its predicate
// is a bare `id.endsWith('.wgsl')` with no include/exclude globs, so a game-dir
// shader is in scope exactly like an engine app's.
declare module '*.wgsl' {
  const shader: { wgsl: string } & string;
  export default shader;
}
