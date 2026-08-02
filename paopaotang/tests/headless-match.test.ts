import { describe, expect, test } from 'bun:test';
import { NPC_PROTOCOL_VERSION, type NpcDecision } from '@forgeax/npc-client';
import { HeadlessMatchAdapter, PLAYER_AFFORDANCES } from '../src/headless-match';

function decision(npcId: string, seq: number, action: string, params?: Record<string, string>): NpcDecision {
  return { v: NPC_PROTOCOL_VERSION, npcId, seq, intent: { action, ...(params ? { params } : {}), ttlSec: 1 } };
}

describe('headless match adapter', () => {
  test('exposes the complete live player action surface', () => {
    expect(PLAYER_AFFORDANCES.map((item) => item.action)).toEqual(['move', 'place_bubble', 'collect_item', 'wait']);
  });

  test('resolves combat through movement, fuse and cross-blast rather than a win roll', () => {
    const match = new HeadlessMatchAdapter(2, 'left', 'right');
    match.bots[0]!.x = 4; match.bots[0]!.y = 5;
    match.bots[1]!.x = 6; match.bots[1]!.y = 5;
    match.step([decision('left', 1, 'place_bubble'), decision('right', 1, 'wait')]);
    match.step([decision('left', 2, 'move', { direction: 'right' }), decision('right', 2, 'wait')]);
    match.step([decision('left', 3, 'move', { direction: 'down' }), decision('right', 3, 'wait')]);
    match.step([decision('left', 4, 'wait'), decision('right', 4, 'wait')]);

    expect(match.done).toBe(true);
    expect(match.winner).toBe('left');
    expect(match.stats.get('left')?.bubbles).toBe(1);
    expect(match.replay.length).toBe(8);
  });

  test('uses typed snapshots and deterministic seeded world layout', () => {
    const a = new HeadlessMatchAdapter(41);
    const b = new HeadlessMatchAdapter(41);
    expect(a.snapshot('aggressive')).toEqual(b.snapshot('aggressive'));
    expect(a.snapshot('aggressive').affordances).toEqual([...PLAYER_AFFORDANCES]);
  });
});
