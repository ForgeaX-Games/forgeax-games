import type { NarrativeCatalogStats, NarrativeScript } from './types';
import { CHAPTER_MX_SCRIPTS } from './scripts/chapter_mx';

const byId = new Map<string, NarrativeScript>();

function register(script: NarrativeScript): void {
  if (byId.has(script.id)) {
    console.warn(`[narrative] duplicate script id: ${script.id}`);
  }
  byId.set(script.id, script);
}

for (const s of CHAPTER_MX_SCRIPTS) register(s);

/** Lookup影游剧本。未知 id → mx_gap 兜底（同章）或抛错由调用方处理。 */
export function getNarrativeScript(id: string): NarrativeScript | undefined {
  return byId.get(id);
}

export function requireNarrativeScript(id: string): NarrativeScript {
  const s = byId.get(id) ?? byId.get('mx_gap');
  if (!s) throw new Error(`[narrative] missing script: ${id}`);
  if (!byId.has(id)) {
    console.warn(`[narrative] unknown script "${id}", falling back to ${s.id}`);
  }
  return s;
}

export function listNarrativeScripts(chapterId?: string): NarrativeScript[] {
  const all = [...byId.values()];
  return chapterId ? all.filter((s) => s.chapterId === chapterId) : all;
}

export function narrativeCatalogStats(): NarrativeCatalogStats {
  const byChapter: Record<string, number> = {};
  for (const s of byId.values()) {
    byChapter[s.chapterId] = (byChapter[s.chapterId] ?? 0) + 1;
  }
  return { scriptCount: byId.size, byChapter };
}

/** Register a script at runtime (new chapter packs). */
export function registerNarrativeScript(script: NarrativeScript): void {
  register(script);
}
