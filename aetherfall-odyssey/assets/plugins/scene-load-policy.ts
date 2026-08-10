/** Refuse to construct a partial Play world when the authored scene is absent. */
export function requireAuthoredScene<T>(loaded: T | null | undefined): T {
  if (loaded === null || loaded === undefined) {
    throw new Error('[aetherfall] authored scene could not be loaded; refusing to start an incomplete fallback world');
  }
  return loaded;
}
