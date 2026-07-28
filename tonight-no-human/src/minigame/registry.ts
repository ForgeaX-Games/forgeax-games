import type { IMinigame } from './IMinigame';
import { StubMinigame } from './impl/StubMinigame';
import { getLibraryEntry, installPlayableFactories, listLibrary } from './library';

const registry = new Map<string, () => IMinigame>();

function reg(id: string, factory: () => IMinigame): void {
  registry.set(id, factory);
}

// Hydrate from expandable library (chapter_mx stubs + future packs).
installPlayableFactories(reg);

export function createMinigame(id: string): IMinigame {
  const factory = registry.get(id);
  if (!factory) {
    const meta = getLibraryEntry(id);
    console.warn(`[minigame] no factory for "${id}" (status=${meta?.status ?? 'missing'})`);
    return new StubMinigame(id, meta?.tags ?? { type: 'coop', scene: [], mech: ['unknown'] }, 5);
  }
  return factory();
}

export function listMinigameIds(): string[] {
  return [...registry.keys()];
}

/** Re-export library queries for tools / HUD / future editor. */
export { listLibrary, getLibraryEntry };
