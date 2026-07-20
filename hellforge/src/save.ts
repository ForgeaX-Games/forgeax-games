// Character save CRUD — localStorage persistence for CharacterRecord (see
// classes.ts for the shape). Direct port of aidiablo's main.ts CRUD
// (getCharacterList/saveCharacter/deleteCharacter/upsertCharacterLevel,
// SHELL-AND-UI-PORT-SPEC.md §4.5), minus the window.name reconnect-cache
// hack (single-player has no disconnect/reconnect to cache across).
//
// hellforge is single-player and client-authoritative (see classes.ts), so
// this module IS the save backend — no server round-trip to reconcile against.

import type { CharacterRecord, ClassId } from './classes';

const STORAGE_KEY = 'hellforge.characters.v1';
export const MAX_CHARACTERS = 12;

export function listCharacters(): CharacterRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CharacterRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: CharacterRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** Insert (by construction, always a fresh id) or update (matched by id). */
export function upsertCharacter(rec: CharacterRecord): void {
  const list = listCharacters();
  const i = list.findIndex((c) => c.id === rec.id);
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  writeAll(list);
}

export function deleteCharacter(id: string): void {
  writeAll(listCharacters().filter((c) => c.id !== id));
}

export function createCharacter(playerName: string, classId: ClassId): CharacterRecord {
  const list = listCharacters();
  if (list.length >= MAX_CHARACTERS) {
    throw new Error(`Character limit reached (${MAX_CHARACTERS})`);
  }
  const now = Date.now();
  const rec: CharacterRecord = {
    id: crypto.randomUUID(),
    playerName,
    classId,
    level: 1,
    createdAt: now,
    lastPlayedAt: now,
  };
  // Bypass upsert's re-read — we already hold the list and checked the cap.
  list.push(rec);
  writeAll(list);
  return rec;
}

/** Bump lastPlayedAt (and level, if it climbed this session) — call on enter/exit game. */
export function touchCharacter(id: string, level?: number): void {
  const list = listCharacters();
  const rec = list.find((c) => c.id === id);
  if (!rec) return;
  rec.lastPlayedAt = Date.now();
  if (level !== undefined) rec.level = level;
  writeAll(list);
}
