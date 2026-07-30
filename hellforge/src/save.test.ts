// Save robustness — flush failures surface (boolean) and never drop pending
// state; memory fallback warns once, not per operation.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createSorceressDomain,
  type CharacterSnapshot,
} from './character-domain';
import {
  __clearAllSavesForTests,
  __getPendingSnapshotForTests,
  __setSaveStorageForTests,
  flushCharacterSaves,
  flushReturnToTitle,
  installSaveLifecycleHooks,
  listCharacters,
  loadEnvelope,
  saveSnapshot,
  type SaveStorage,
} from './save';

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** Memory storage whose writes can be toggled to throw (quota/disk failures). */
function togglableStorage(inner: ReturnType<typeof memoryStorage>): SaveStorage & {
  failWrites: boolean;
} {
  const st = {
    failWrites: false,
    getItem: (k: string) => inner.getItem(k),
    setItem: (k: string, v: string) => {
      if (st.failWrites) throw new Error('QuotaExceededError (simulated)');
      inner.setItem(k, v);
    },
    removeItem: (k: string) => { inner.removeItem(k); },
  };
  return st;
}

function snapAt(level: number, gold: number, id = 'rob-1'): CharacterSnapshot {
  const d = createSorceressDomain({
    playerName: '韧性',
    id,
    level,
    gold,
    createdAt: 1,
    lastPlayedAt: 1,
  });
  return d.snapshot() as CharacterSnapshot;
}

let mem: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  mem = memoryStorage();
  __setSaveStorageForTests(mem);
  __clearAllSavesForTests();
});

afterEach(() => {
  flushCharacterSaves();
  __setSaveStorageForTests(null);
});

describe('flush failure surfacing', () => {
  test('successful flush returns true and clears pending', () => {
    saveSnapshot(snapAt(3, 30) as never);
    expect(flushCharacterSaves()).toBe(true);
    expect(__getPendingSnapshotForTests()).toBeNull();
    expect(loadEnvelope('rob-1')?.progression.level).toBe(3);
  });

  test('nothing pending → true (no-op, not an error)', () => {
    expect(flushCharacterSaves()).toBe(true);
  });

  test('failed flush returns false, keeps pending, writes nothing; retry succeeds', () => {
    const st = togglableStorage(mem);
    __setSaveStorageForTests(st);
    saveSnapshot(snapAt(4, 44) as never);

    const warns: unknown[][] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args); };
    try {
      st.failWrites = true;
      expect(flushCharacterSaves()).toBe(false);
      // Pending state survives the failed write; nothing reached storage.
      expect(__getPendingSnapshotForTests()?.level).toBe(4);
      expect(loadEnvelope('rob-1')).toBeNull();

      st.failWrites = false;
      expect(flushCharacterSaves()).toBe(true);
      expect(__getPendingSnapshotForTests()).toBeNull();
      expect(loadEnvelope('rob-1')?.progression.level).toBe(4);
      expect(loadEnvelope('rob-1')?.progression.gold).toBe(44);
    } finally {
      console.warn = origWarn;
    }
    expect(warns.some((a) => String(a[0]).includes('flush failed'))).toBe(true);
  });

  test('failed flush keeps the LIVE provider snapshot (not a stale pending one)', () => {
    const st = togglableStorage(mem);
    __setSaveStorageForTests(st);
    let live = snapAt(5, 55);
    const uninstall = installSaveLifecycleHooks(() => live as never);
    saveSnapshot(snapAt(2, 2) as never); // stale pending
    live = snapAt(7, 77);

    st.failWrites = true;
    expect(flushCharacterSaves()).toBe(false);
    expect(__getPendingSnapshotForTests()?.level).toBe(7); // live won, and was kept

    st.failWrites = false;
    expect(flushCharacterSaves()).toBe(true);
    expect(loadEnvelope('rob-1')?.progression.level).toBe(7);
    expect(loadEnvelope('rob-1')?.progression.gold).toBe(77);
    uninstall();
  });

  test('flushReturnToTitle propagates failure and keeps the snapshot queued', () => {
    const st = togglableStorage(mem);
    __setSaveStorageForTests(st);
    st.failWrites = true;
    expect(flushReturnToTitle(snapAt(9, 90) as never)).toBe(false);
    expect(__getPendingSnapshotForTests()?.level).toBe(9);
    expect(loadEnvelope('rob-1')).toBeNull();

    st.failWrites = false;
    expect(flushCharacterSaves()).toBe(true);
    expect(loadEnvelope('rob-1')?.progression.level).toBe(9);
  });
});

describe('memory fallback warning', () => {
  test('warns exactly once across many operations (not per operation)', () => {
    const warns: unknown[][] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args); };
    try {
      __setSaveStorageForTests(null); // installs the in-memory fallback (Bun has no localStorage)
      listCharacters();
      listCharacters();
      saveSnapshot(snapAt(1, 1) as never);
      flushCharacterSaves();
      listCharacters();
    } finally {
      console.warn = origWarn;
    }
    const fallbackWarns = warns.filter((a) => String(a[0]).includes('in-memory fallback'));
    expect(fallbackWarns).toHaveLength(1);
  });
});
