import type { IMinigame } from '../IMinigame';
import { StubMinigame } from '../impl/StubMinigame';
import type { MinigameLibraryEntry, MinigameStatus } from './types';
import { CHAPTER_MX_MINIGAMES, CHAPTER_RU_MINIGAMES_PLANNED } from './entries/chapter_mx';

const entries = new Map<string, MinigameLibraryEntry>();

function ingest(list: MinigameLibraryEntry[]): void {
  for (const e of list) {
    if (entries.has(e.id)) console.warn(`[minigame-library] duplicate id ${e.id}`);
    entries.set(e.id, e);
  }
}

ingest(CHAPTER_MX_MINIGAMES);
ingest(CHAPTER_RU_MINIGAMES_PLANNED);

/** Full library (including planned). */
export function listLibrary(filter?: {
  chapterId?: string;
  status?: MinigameStatus | MinigameStatus[];
}): MinigameLibraryEntry[] {
  let out = [...entries.values()];
  if (filter?.chapterId) {
    out = out.filter((e) => e.chapterIds.includes(filter.chapterId!));
  }
  if (filter?.status) {
    const set = new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
    out = out.filter((e) => set.has(e.status));
  }
  return out;
}

export function getLibraryEntry(id: string): MinigameLibraryEntry | undefined {
  return entries.get(id);
}

/** Register / replace an entry (new country packs or shipping a stub). */
export function upsertLibraryEntry(entry: MinigameLibraryEntry): void {
  entries.set(entry.id, entry);
}

/**
 * Build runtime factories for every stub|shipped entry that has `create`.
 * Called once from registry.ts.
 */
export function installPlayableFactories(
  reg: (id: string, factory: () => IMinigame) => void,
): void {
  for (const e of entries.values()) {
    if (e.status === 'planned') continue;
    if (e.create) {
      reg(e.id, e.create);
    } else {
      reg(
        e.id,
        () =>
          new StubMinigame(e.id, e.tags, Math.min(8, e.targetDurationSec)),
      );
    }
  }
}

export function libraryStats() {
  const all = [...entries.values()];
  return {
    total: all.length,
    planned: all.filter((e) => e.status === 'planned').length,
    stub: all.filter((e) => e.status === 'stub').length,
    shipped: all.filter((e) => e.status === 'shipped').length,
  };
}
