import { describe, expect, test } from 'bun:test';
import type { CharacterRecord } from './classes';
import { createCharacterSelectionGate } from './selection-gate';

const first: CharacterRecord = {
  id: 'first', playerName: 'Ash', classId: 'sorceress',
  level: 1, createdAt: 1, lastPlayedAt: 1,
};
const second: CharacterRecord = { ...first, id: 'second' };

describe('createCharacterSelectionGate', () => {
  test('first selection resolves the promise', async () => {
    const gate = createCharacterSelectionGate();
    expect(gate.select(first)).toBe(true);
    expect(await gate.promise).toEqual(first);
  });

  test('later selections are rejected', async () => {
    const gate = createCharacterSelectionGate();
    expect(gate.select(first)).toBe(true);
    expect(gate.select(second)).toBe(false);
    expect(await gate.promise).toEqual(first);
  });
});
