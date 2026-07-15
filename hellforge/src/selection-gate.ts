import type { CharacterRecord } from './classes';

export interface CharacterSelectionGate {
  readonly promise: Promise<CharacterRecord>;
  select(record: CharacterRecord): boolean;
}

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
      settled = true;
      resolveSelection(record);
      return true;
    },
  };
}
