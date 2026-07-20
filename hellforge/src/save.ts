// Versioned character saves — hellforge.character-saves.v1 envelopes.
// Legacy hellforge.characters.v1 is READ-ONLY (migration source + disabled cards).

import type { CharacterRecord, ClassId } from './classes';
import {
  createDomainFromRecord,
  createSorceressDomain,
  hydrateSorceressDomain,
  isPlayableClass,
  projectCharacterRecord,
  type CharacterDomain,
  type CharacterSnapshot,
} from './character-domain';
import type { DeepReadonly } from './deep-readonly';
import { deepClone, deepFreeze, shouldFreezeSnapshots } from './deep-readonly';
import {
  CHECKPOINT_CINDERWATCH,
  emptySavesStore,
  envelopeToRecord,
  LEGACY_STORAGE_KEY,
  parseEnvelope,
  parseLegacyList,
  parseSavesStore,
  SAVE_SCHEMA_VERSION,
  SAVES_STORAGE_KEY,
  type CharacterSaveEnvelope,
  type CharacterSavesStore,
} from './save-schema';

export const MAX_CHARACTERS = 12;
export { LEGACY_STORAGE_KEY, SAVES_STORAGE_KEY } from './save-schema';
export type { CharacterSaveEnvelope } from './save-schema';

/** Minimal Storage surface — injectable for unit tests (Bun has no localStorage). */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryFallback = new Map<string, string>();

function browserStorage(): SaveStorage | null {
  try {
    const ls = (globalThis as { localStorage?: SaveStorage }).localStorage;
    if (!ls) return null;
    // Probe — some environments expose a stub that throws.
    const probe = '__hellforge_save_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

let storage: SaveStorage = browserStorage() ?? {
  getItem: (k) => memoryFallback.get(k) ?? null,
  setItem: (k, v) => { memoryFallback.set(k, v); },
  removeItem: (k) => { memoryFallback.delete(k); },
};

const SAVE_DEBOUNCE_MS = 250;

let pendingSnapshot: DeepReadonly<CharacterSnapshot> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let latestSnapshotProvider: (() => DeepReadonly<CharacterSnapshot> | null) | null = null;
let lifecycleInstalled = false;
const lifecycleCleanups: Array<() => void> = [];

/** Test seam — swap storage and reset coordinator state. */
export function __setSaveStorageForTests(next: SaveStorage | null): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingSnapshot = null;
  latestSnapshotProvider = null;
  while (lifecycleCleanups.length > 0) {
    lifecycleCleanups.pop()?.();
  }
  memoryFallback.clear();
  storage = next ?? browserStorage() ?? {
    getItem: (k) => memoryFallback.get(k) ?? null,
    setItem: (k, v) => { memoryFallback.set(k, v); },
    removeItem: (k) => { memoryFallback.delete(k); },
  };
}

function readJson(key: string): unknown {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

function readSavesStore(): CharacterSavesStore {
  return parseSavesStore(readJson(SAVES_STORAGE_KEY));
}

function writeSavesStore(store: CharacterSavesStore): void {
  writeJson(SAVES_STORAGE_KEY, store);
}

/** READ-ONLY view of the legacy character list. Never writes this key. */
export function listLegacyCharacters(): CharacterRecord[] {
  return parseLegacyList(readJson(LEGACY_STORAGE_KEY));
}

/**
 * Merged list for title UI: v1 envelopes + unmigrated legacy rows.
 * Prefer envelope projection when both exist; never rewrite barb/necro class.
 */
export function listCharacters(): CharacterRecord[] {
  const store = readSavesStore();
  const hidden = new Set(store.hiddenLegacyIds);
  const byId = new Map<string, CharacterRecord>();

  for (const env of Object.values(store.envelopes)) {
    byId.set(env.character.id, envelopeToRecord(env));
  }

  for (const rec of listLegacyCharacters()) {
    if (hidden.has(rec.id)) continue;
    if (byId.has(rec.id)) continue; // envelope wins; legacy kept on disk
    byId.set(rec.id, rec);
  }

  return [...byId.values()];
}

function writeEnvelopeAtomic(
  envelope: CharacterSaveEnvelope,
): DeepReadonly<CharacterSaveEnvelope> {
  const store = readSavesStore();
  const next: CharacterSavesStore = {
    envelopes: { ...store.envelopes, [envelope.character.id]: envelope },
    hiddenLegacyIds: store.hiddenLegacyIds,
  };
  writeSavesStore(next);
  const reread = loadEnvelope(envelope.character.id);
  if (!reread) {
    throw new Error(`Failed to validate character save after write (${envelope.character.id})`);
  }
  return reread;
}

/** Load + validate a v1 envelope; null if missing/malformed. */
export function loadEnvelope(id: string): DeepReadonly<CharacterSaveEnvelope> | null {
  const store = readSavesStore();
  const env = store.envelopes[id];
  if (!env) return null;
  const parsed = parseEnvelope(env);
  if (!parsed) return null;
  const detached = deepClone(parsed);
  return (shouldFreezeSnapshots() ? deepFreeze(detached) : detached) as DeepReadonly<CharacterSaveEnvelope>;
}

export function serializeCharacter(
  snapshot: DeepReadonly<CharacterSnapshot>,
): CharacterSaveEnvelope {
  if (!isPlayableClass(snapshot.identity.classId)) {
    throw new Error(`Class "${snapshot.identity.classId}" is not playable — only Sorceress may be serialized`);
  }
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    character: {
      id: snapshot.identity.id,
      playerName: snapshot.identity.playerName,
      classId: snapshot.identity.classId,
      createdAt: snapshot.identity.createdAt,
      lastPlayedAt: snapshot.identity.lastPlayedAt,
    },
    progression: {
      level: snapshot.level,
      xp: snapshot.xp,
      gold: snapshot.gold,
      unspentSkillPoints: snapshot.unspentSkillPoints,
      skillRanks: deepClone(snapshot.skillRanks as Record<string, number>) as CharacterSaveEnvelope['progression']['skillRanks'],
      hotbar: [...snapshot.hotbar] as CharacterSaveEnvelope['progression']['hotbar'],
      selectedHotbarSlot: snapshot.selectedHotbarSlot,
    },
    inventory: {
      bag: deepClone(snapshot.bag as Array<unknown>) as CharacterSaveEnvelope['inventory']['bag'],
      equipment: deepClone(snapshot.equipment as object) as CharacterSaveEnvelope['inventory']['equipment'],
    },
    quests: deepClone(snapshot.quests as object) as CharacterSaveEnvelope['quests'],
    checkpointId: CHECKPOINT_CINDERWATCH,
  };
}

/**
 * Validate→hydrate→discard. The returned domain owns progression; the envelope
 * must not be retained as mutable gameplay state.
 */
export function hydrateCharacter(
  envelope: DeepReadonly<CharacterSaveEnvelope>,
): CharacterDomain {
  const parsed = parseEnvelope(envelope);
  if (!parsed) {
    throw new Error('Invalid character save envelope');
  }
  if (!isPlayableClass(parsed.character.classId)) {
    throw new Error(`Class "${parsed.character.classId}" is not playable — only Sorceress may be hydrated`);
  }
  return hydrateSorceressDomain({
    identity: {
      id: parsed.character.id,
      playerName: parsed.character.playerName,
      classId: parsed.character.classId,
      createdAt: parsed.character.createdAt,
      lastPlayedAt: parsed.character.lastPlayedAt,
    },
    level: parsed.progression.level,
    xp: parsed.progression.xp,
    gold: parsed.progression.gold,
    unspentSkillPoints: parsed.progression.unspentSkillPoints,
    skillRanks: parsed.progression.skillRanks,
    hotbar: parsed.progression.hotbar,
    selectedHotbarSlot: parsed.progression.selectedHotbarSlot,
    bag: parsed.inventory.bag,
    equipment: parsed.inventory.equipment,
    quests: parsed.quests,
  });
}

/** Build a v1 envelope from a legacy Sorceress record (defaults for missing fields). */
export function migrateLegacySorceress(record: CharacterRecord): CharacterSaveEnvelope {
  if (!isPlayableClass(record.classId)) {
    throw new Error(`Refusing to migrate non-Sorceress class "${record.classId}"`);
  }
  const domain = createDomainFromRecord(record);
  return serializeCharacter(domain.snapshot());
}

/**
 * Atomic/idempotent migration: write + re-read a valid envelope before treating
 * the character as migrated. Never deletes or rewrites the legacy list.
 */
export function ensureCharacterEnvelope(record: CharacterRecord): DeepReadonly<CharacterSaveEnvelope> {
  const existing = loadEnvelope(record.id);
  if (existing) return existing;
  if (!isPlayableClass(record.classId)) {
    throw new Error(`Class "${record.classId}" is not playable — only Sorceress may be migrated`);
  }
  const migrated = migrateLegacySorceress(record);
  return writeEnvelopeAtomic(migrated);
}

/** Debounced persistence of an immutable domain snapshot. */
export function saveSnapshot(snapshot: DeepReadonly<CharacterSnapshot>): void {
  if (!isPlayableClass(snapshot.identity.classId)) {
    throw new Error(`Class "${snapshot.identity.classId}" is not playable — only Sorceress may be saved`);
  }
  pendingSnapshot = snapshot;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flushCharacterSaves();
  }, SAVE_DEBOUNCE_MS);
}

function writeSnapshotNow(snapshot: DeepReadonly<CharacterSnapshot>): void {
  writeEnvelopeAtomic(serializeCharacter(snapshot));
}

/**
 * Synchronously flush the latest pending snapshot (and optional live provider)
 * before control returns. Used by pagehide / visibility hidden / return-to-title /
 * cleanup.
 */
export function flushCharacterSaves(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const live = latestSnapshotProvider?.() ?? null;
  const toWrite = live ?? pendingSnapshot;
  pendingSnapshot = null;
  if (toWrite) writeSnapshotNow(toWrite);
}

/** Flush after capturing the current domain snapshot (return-to-title path). */
export function flushReturnToTitle(snapshot: DeepReadonly<CharacterSnapshot>): void {
  pendingSnapshot = snapshot;
  flushCharacterSaves();
}

/**
 * Register pagehide / visibilitychange:hidden flush hooks. Provider supplies the
 * live domain snapshot so a pending debounce never loses the newest mutation.
 */
export function installSaveLifecycleHooks(
  getSnapshot: () => DeepReadonly<CharacterSnapshot> | null,
): () => void {
  latestSnapshotProvider = getSnapshot;
  if (!lifecycleInstalled && typeof window !== 'undefined') {
    lifecycleInstalled = true;
    const onPageHide = (): void => { flushCharacterSaves(); };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushCharacterSaves();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    lifecycleCleanups.push(() => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      lifecycleInstalled = false;
    });
  }
  return () => {
    flushCharacterSaves();
    latestSnapshotProvider = null;
    while (lifecycleCleanups.length > 0) {
      lifecycleCleanups.pop()?.();
    }
  };
}

export function deleteCharacter(id: string): void {
  flushCharacterSaves();
  const store = readSavesStore();
  const envelopes = { ...store.envelopes };
  delete envelopes[id];
  const hidden = store.hiddenLegacyIds.includes(id)
    ? store.hiddenLegacyIds
    : [...store.hiddenLegacyIds, id];
  writeSavesStore({ envelopes, hiddenLegacyIds: hidden });
}

/**
 * Create a Sorceress via CharacterDomain and persist a v1 envelope immediately.
 * Non-Sorceress classIds are rejected at the domain seam.
 */
export function createCharacter(playerName: string, classId: ClassId): CharacterRecord {
  if (!isPlayableClass(classId)) {
    throw new Error(`Class "${classId}" is not playable — only Sorceress may be created`);
  }
  const list = listCharacters();
  if (list.length >= MAX_CHARACTERS) {
    throw new Error(`Character limit reached (${MAX_CHARACTERS})`);
  }
  const domain = createSorceressDomain({ playerName });
  const snap = domain.snapshot();
  writeEnvelopeAtomic(serializeCharacter(snap));
  return projectCharacterRecord(snap);
}

/**
 * Sealed — shallow CharacterRecord must not rehydrate a second domain and
 * clobber a live session. Persist only via saveSnapshot(character.snapshot()).
 */
export function persistDomainProjection(_rec: CharacterRecord): void {
  throw new Error('persistDomainProjection is sealed — use saveSnapshot via CharacterDomain');
}

/**
 * Sealed — must not mutate level / lastPlayedAt outside CharacterDomain.
 */
export function touchCharacter(_id: string, _level?: number): void {
  throw new Error('touchCharacter is sealed — use saveSnapshot via CharacterDomain');
}

/** Test helper: seed READ-ONLY legacy list without going through createCharacter. */
export function __seedLegacyCharactersForTests(list: CharacterRecord[]): void {
  writeJson(LEGACY_STORAGE_KEY, list);
}

/** Test helper: clear both stores. */
export function __clearAllSavesForTests(): void {
  flushCharacterSaves();
  storage.removeItem(LEGACY_STORAGE_KEY);
  storage.removeItem(SAVES_STORAGE_KEY);
  memoryFallback.clear();
  pendingSnapshot = null;
}

export function __getPendingSnapshotForTests(): DeepReadonly<CharacterSnapshot> | null {
  return pendingSnapshot;
}

export { emptySavesStore };
