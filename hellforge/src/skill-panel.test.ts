import { describe, expect, test } from 'bun:test';
import {
  KEYSTONE_SIZE,
  NODE_SIZE,
  buildNodeViewModel,
  buildSkillTreeViewModel,
} from './skill-panel';
import type { SkillNodeId } from './content-ids';
import {
  emptySkillRanks,
  getSkillNode,
  investPoint,
  SKILL_NODES,
  stateFromProgression,
} from './skill-tree';

const PR9_NEW_NODES = [
  'flame-burst', 'ember', 'searing', 'wildfire', 'heat-shimmer', 'furnace-heart',
  'frost-nova', 'rime', 'piercing-cold', 'glacier-shards', 'frozen-focus', 'deep-freeze',
  'discharge', 'resonance', 'swift-phases', 'echo-mastery', 'overcast', 'tempest-conduit',
] as const satisfies readonly SkillNodeId[];

describe('buildSkillTreeViewModel', () => {
  test('exposes four node states and 33 nodes', () => {
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
    expect(vm.nodes).toHaveLength(33);
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

  test('keystones use larger frameSize; normals stay NODE_SIZE', () => {
    const state = stateFromProgression({
      level: 1,
      unspentSkillPoints: 0,
      skillRanks: emptySkillRanks(),
      hotbar: ['frost', null, null, null],
      selectedHotbarSlot: 0,
    });
    expect(NODE_SIZE).toBe(54);
    expect(KEYSTONE_SIZE).toBe(78);

    for (const def of SKILL_NODES) {
      const vm = buildNodeViewModel(def.id, state);
      if (def.kind === 'capstone') {
        expect(vm.isKeystone).toBe(true);
        expect(vm.frameSize).toBe(KEYSTONE_SIZE);
      } else {
        expect(vm.isKeystone).toBe(false);
        expect(vm.frameSize).toBe(NODE_SIZE);
      }
    }
    const capstones = SKILL_NODES.filter((n) => n.kind === 'capstone');
    expect(capstones).toHaveLength(6);
  });

  test('PR9 nodes expose concrete nextRankHint (not generic fallback)', () => {
    const state = stateFromProgression({
      level: 10,
      unspentSkillPoints: 0,
      skillRanks: emptySkillRanks(),
      hotbar: ['frost', null, null, null],
      selectedHotbarSlot: 0,
    });
    for (const id of PR9_NEW_NODES) {
      const def = getSkillNode(id);
      const vm = buildNodeViewModel(id, state);
      expect(vm.nextRankDelta).not.toBeNull();
      expect(vm.nextRankDelta).not.toMatch(/^下一阶：等级 \d+\/\d+$/);
      expect(vm.nextRankDelta!.startsWith('下一阶：')).toBe(true);
      expect(vm.maxRank).toBe(def.maxRank);
    }
  });
});
