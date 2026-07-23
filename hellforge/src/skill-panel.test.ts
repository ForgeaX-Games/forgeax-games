import { describe, expect, test } from 'bun:test';
import { buildNodeViewModel, buildSkillTreeViewModel } from './skill-panel';
import { emptySkillRanks, investPoint, stateFromProgression } from './skill-tree';

describe('buildSkillTreeViewModel', () => {
  test('exposes four node states and 15 nodes', () => {
    let state = stateFromProgression({
      level: 6,
      unspentSkillPoints: 8,
      skillRanks: emptySkillRanks(),
      hotbar: ['frost', 'magma', null, null],
      selectedHotbarSlot: 0,
    });
    // Free Magma Bolt is rank 1; one paid invest → rank 2 unlocks Kindling prereq.
    const invested = investPoint(state, 'magma-bolt');
    expect(invested.ok).toBe(true);
    if (invested.ok) state = invested.state;

    const vm = buildSkillTreeViewModel({ treeState: state, inCamp: true, branch: 'flame' });
    expect(vm.nodes).toHaveLength(15);
    expect(vm.inCamp).toBe(true);
    expect(vm.unspentSkillPoints).toBe(7);

    const frost = vm.nodes.find((n) => n.id === 'frost-fang')!;
    expect(frost.state).toBe('invested');
    expect(frost.rank).toBe(1);

    const magma = vm.nodes.find((n) => n.id === 'magma-bolt')!;
    expect(magma.state).toBe('invested');
    expect(magma.rank).toBe(2);
    expect(magma.grantsActive).toBe('magma');

    const kindling = vm.nodes.find((n) => n.id === 'kindling')!;
    expect(kindling.state).toBe('available');

    const hellfire = buildNodeViewModel('hellfire-catalyst', state);
    expect(hellfire.requiredLevel).toBe(6);
    expect(hellfire.state).toBe('locked');
  });

  test('maxed frost fang reports maxed + null next delta', () => {
    let state = stateFromProgression({
      level: 10,
      unspentSkillPoints: 10,
      skillRanks: emptySkillRanks(),
      hotbar: ['frost', null, null, null],
      selectedHotbarSlot: 0,
    });
    for (let i = 0; i < 4; i++) {
      const res = investPoint(state, 'frost-fang');
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }
    const fang = buildNodeViewModel('frost-fang', state);
    expect(fang.state).toBe('maxed');
    expect(fang.rank).toBe(5);
    expect(fang.nextRankDelta).toBeNull();
  });
});
