/** Recursive readonly — preserves tuple shapes (e.g. four-slot hotbar). */
export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepClone(v)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    out[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return out as T;
}

/** Deep-freeze for development/test snapshot guards. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value as object)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    if (child !== null && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

export function shouldFreezeSnapshots(): boolean {
  try {
    const env = (import.meta as ImportMeta & { env?: { PROD?: boolean; DEV?: boolean } }).env;
    if (env?.PROD === true) return false;
    if (env?.DEV === true) return true;
  } catch {
    // ignore
  }
  // Bun test / Node without Vite env — freeze so mutation guards stay meaningful.
  return true;
}
