import { describe, expect, test } from 'bun:test';
import { npcLodSyncAction } from '../src/npc-brain';

describe('NPC cognitive LOD synchronization', () => {
  test('does not address a detached ambient NPC', () => {
    expect(npcLodSyncAction(false, 'ambient')).toBe('none');
  });

  test('attaches only when a detached NPC enters spotlight', () => {
    expect(npcLodSyncAction(false, 'spotlight')).toBe('attach');
    expect(npcLodSyncAction(true, 'spotlight')).toBe('set');
  });

  test('detaches an attached offstage NPC once', () => {
    expect(npcLodSyncAction(true, 'offstage')).toBe('detach');
    expect(npcLodSyncAction(false, 'offstage')).toBe('none');
  });
});
