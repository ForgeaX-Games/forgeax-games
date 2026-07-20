import type { CharacterRecord } from './classes';
import { isPlayableClass } from './character-domain';

export interface CharacterSelectionGate {
  readonly promise: Promise<CharacterRecord>;
  select(record: CharacterRecord): boolean;
}

/**
 * Title → gameplay hand-off gate. Only Sorceress records may settle; barb/necro
 * stay visible in the list but cannot enter. Migration to v1 envelopes happens
 * in main via ensureCharacterEnvelope after this resolves.
 */
export function createCharacterSelectionGate(): CharacterSelectionGate {
  let settled = false;
  let resolveSelection!: (record: CharacterRecord) => void;
  const promise = new Promise<CharacterRecord>((resolve) => {
    resolveSelection = resolve;
  });
  return {
    promise,
    select(record) {
      if (settled) return false;
      // Reject non-Sorceress at the domain seam before gameplay starts.
      if (!isPlayableClass(record.classId)) return false;
      settled = true;
      resolveSelection(record);
      return true;
    },
  };
}
