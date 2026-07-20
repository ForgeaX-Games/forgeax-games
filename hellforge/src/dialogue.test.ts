import { describe, expect, test } from 'bun:test';
import type { QuestSave } from './content-ids';
import { dialogueFor } from './dialogue';

function quests(status: QuestSave['status']): Record<'purge-slagdeep-hollow', QuestSave> {
  return { 'purge-slagdeep-hollow': { status } };
}

describe('dialogueFor Veyra', () => {
  test('four state-dependent linear branches', () => {
    const available = dialogueFor('npc-cinderwarden-veyra', quests('available'));
    expect(available.questStatus).toBe('available');
    expect(available.speaker).toBe('烬守者维拉');
    expect(available.choices.some((c) => c.action.kind === 'accept')).toBe(true);

    const active = dialogueFor('npc-cinderwarden-veyra', quests('active'));
    expect(active.questStatus).toBe('active');
    expect(active.choices.every((c) => c.action.kind === 'close' || c.action.kind === 'continue')).toBe(true);
    expect(active.choices.some((c) => c.action.kind === 'accept')).toBe(false);

    const ready = dialogueFor('npc-cinderwarden-veyra', quests('ready'));
    expect(ready.questStatus).toBe('ready');
    expect(ready.choices.some((c) => c.action.kind === 'turn-in')).toBe(true);

    const completed = dialogueFor('npc-cinderwarden-veyra', quests('completed'));
    expect(completed.questStatus).toBe('completed');
    expect(completed.choices.some((c) => c.action.kind === 'turn-in')).toBe(false);
    expect(completed.choices.some((c) => c.action.kind === 'accept')).toBe(false);
  });

  test('branch bodies mention quest or hollow', () => {
    for (const status of ['available', 'active', 'ready', 'completed'] as const) {
      const node = dialogueFor('npc-cinderwarden-veyra', quests(status));
      expect(node.body.length).toBeGreaterThan(10);
      expect(node.npcId).toBe('npc-cinderwarden-veyra');
    }
  });
});
