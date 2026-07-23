import { describe, expect, test } from 'bun:test';
import { DUNGEON_SEED } from './dungeon-layout';
import { generateModularLayout } from './dungeon-pipeline';
import {
  branchCurseDamageMul,
  createRoomEventState,
  noteMonsterKill,
  resetRoomEventState,
  tickVaultPresence,
} from './dungeon-room-events';

function plan() {
  return generateModularLayout(DUNGEON_SEED).encounters;
}

describe('dungeon-room-events (L4 Option B)', () => {
  test('B1 clear beat fires once when kill tally meets requiredKillCount', () => {
    const p = plan();
    const state = createRoomEventState();
    const clear = p.clears.find((c) => c.nodeId.startsWith('combat'))!;
    expect(clear).toBeDefined();
    const vol = p.volumes.find((v) => v.nodeId === clear.nodeId)!;
    const x = (vol.minX + vol.maxX) / 2;
    const z = (vol.minZ + vol.maxZ) / 2;

    let last: ReturnType<typeof noteMonsterKill> = null;
    for (let i = 0; i < clear.requiredKillCount - 1; i++) {
      last = noteMonsterKill(state, p, x, z);
      expect(last).toBeNull();
    }
    last = noteMonsterKill(state, p, x, z);
    expect(last).toEqual({ kind: 'room-clear', nodeId: clear.nodeId });

    // Once-fire: further kills in the same room never re-emit.
    expect(noteMonsterKill(state, p, x, z)).toBeNull();
    expect(state.clearFired.has(clear.nodeId)).toBe(true);
  });

  test('B1 ignores deaths outside any clear room', () => {
    const p = plan();
    const state = createRoomEventState();
    expect(noteMonsterKill(state, p, 9999, 9999)).toBeNull();
  });

  test('B2 first enter shows card + activates curse; exit reverts; re-enter no card', () => {
    const p = plan();
    const state = createRoomEventState();
    const vol = p.volumes.find((v) => v.nodeId === 'branch-reward')!;
    const inX = (vol.minX + vol.maxX) / 2;
    const inZ = (vol.minZ + vol.maxZ) / 2;
    const outX = vol.minX - 2;
    const outZ = vol.minZ - 2;

    expect(branchCurseDamageMul(state, p)).toBe(1);

    const enter1 = tickVaultPresence(state, p, inX, inZ);
    expect(enter1?.kind).toBe('vault-enter');
    if (enter1?.kind !== 'vault-enter') throw new Error('expected vault-enter');
    expect(enter1.showCard).toBe(true);
    expect(enter1.modifierLine).toBe(p.branchCurse.label);
    expect(enter1.rewardLine.length).toBeGreaterThan(0);
    expect(enter1.damageMul).toBe(p.branchCurse.damageMul);
    expect(branchCurseDamageMul(state, p)).toBe(p.branchCurse.damageMul);

    // Still inside — no re-emit.
    expect(tickVaultPresence(state, p, inX, inZ)).toBeNull();

    const exit = tickVaultPresence(state, p, outX, outZ);
    expect(exit).toEqual({ kind: 'vault-exit' });
    expect(branchCurseDamageMul(state, p)).toBe(1);

    const enter2 = tickVaultPresence(state, p, inX, inZ);
    expect(enter2?.kind).toBe('vault-enter');
    if (enter2?.kind !== 'vault-enter') throw new Error('expected vault-enter');
    expect(enter2.showCard).toBe(false);
    expect(branchCurseDamageMul(state, p)).toBe(p.branchCurse.damageMul);
  });

  test('resetRoomEventState clears once-fire + curse', () => {
    const p = plan();
    const state = createRoomEventState();
    const vol = p.volumes.find((v) => v.nodeId === 'branch-reward')!;
    const x = (vol.minX + vol.maxX) / 2;
    const z = (vol.minZ + vol.maxZ) / 2;
    tickVaultPresence(state, p, x, z);
    expect(state.vaultCardShown).toBe(true);
    expect(state.curseActive).toBe(true);

    resetRoomEventState(state);
    expect(state.vaultCardShown).toBe(false);
    expect(state.curseActive).toBe(false);
    expect(state.clearFired.size).toBe(0);
    expect(state.killsByRoom.size).toBe(0);
  });
});
