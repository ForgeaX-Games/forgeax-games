import { describe, expect, test } from 'bun:test';
import { SKILL_NODE_IDS, type SkillNodeId } from './content-ids';
import {
  ACTIVE_BY_SKILL_NODE,
  assignActiveToHotbar,
  canInvest,
  clampSkillRanks,
  emptySkillRanks,
  getSkillNode,
  investPoint,
  nodeAvailability,
  nodesForBranch,
  paidRankCount,
  prereqsMet,
  respecInCamp,
  SKILL_NODES,
  stateFromProgression,
  totalPaidRanks,
  type SkillTreeState,
} from './skill-tree';

function baseState(overrides: Partial<SkillTreeState> = {}): SkillTreeState {
  return {
    level: overrides.level ?? 10,
    unspentSkillPoints: overrides.unspentSkillPoints ?? 20,
    skillRanks: overrides.skillRanks ?? emptySkillRanks(),
    hotbar: overrides.hotbar ?? ['frost', 'magma', null, null],
    selectedHotbarSlot: overrides.selectedHotbarSlot ?? 0,
  };
}

/** Invest a sequence; fails the test if any step rejects. */
function investPath(state: SkillTreeState, path: readonly SkillNodeId[]): SkillTreeState {
  let cur = state;
  for (const id of path) {
    const res = investPoint(cur, id);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`invest ${id} failed: ${res.reason}`);
    cur = res.state;
  }
  return cur;
}

describe('skill-tree definitions', () => {
  test('encodes exactly 33 nodes covering all SkillNodeIds (bijection)', () => {
    expect(SKILL_NODES).toHaveLength(33);
    expect(SKILL_NODE_IDS).toHaveLength(33);
    const ids = new Set(SKILL_NODES.map((n) => n.id));
    expect(ids.size).toBe(33);
    for (const id of SKILL_NODE_IDS) expect(ids.has(id)).toBe(true);
    for (const n of SKILL_NODES) expect(SKILL_NODE_IDS.includes(n.id)).toBe(true);
  });

  test('three branches have eleven nodes each (9 normal + 2 capstone)', () => {
    for (const branch of ['flame', 'frost', 'arcane'] as const) {
      const nodes = nodesForBranch(branch);
      expect(nodes).toHaveLength(11);
      expect(nodes.filter((n) => n.kind === 'capstone')).toHaveLength(2);
      expect(nodes.filter((n) => n.kind !== 'capstone')).toHaveLength(9);
    }
  });

  test('prereq graph has no dangling SkillNodeId refs', () => {
    const ids = new Set<SkillNodeId>(SKILL_NODE_IDS);
    for (const n of SKILL_NODES) {
      for (const group of n.prereqGroups) {
        for (const p of group) {
          expect(ids.has(p.nodeId)).toBe(true);
          expect(p.minRank).toBeGreaterThan(0);
          expect(p.minRank).toBeLessThanOrEqual(getSkillNode(p.nodeId).maxRank);
        }
      }
    }
  });

  test('active identity stays magma/frost/arc/blink + PR9 actives', () => {
    expect(ACTIVE_BY_SKILL_NODE['magma-bolt']).toBe('magma');
    expect(ACTIVE_BY_SKILL_NODE['frost-fang']).toBe('frost');
    expect(ACTIVE_BY_SKILL_NODE['arc-surge']).toBe('arc');
    expect(ACTIVE_BY_SKILL_NODE['phase-step']).toBe('blink');
    expect(ACTIVE_BY_SKILL_NODE['flame-burst']).toBe('flame-burst');
    expect(ACTIVE_BY_SKILL_NODE['frost-nova']).toBe('frost-nova');
    expect(ACTIVE_BY_SKILL_NODE['discharge']).toBe('discharge');
    expect(getSkillNode('magma-bolt').grantsActive).toBe('magma');
    expect(getSkillNode('phase-step').grantsActive).toBe('blink');
    expect(getSkillNode('flame-burst').grantsActive).toBe('flame-burst');
    expect(getSkillNode('frost-nova').grantsActive).toBe('frost-nova');
    expect(getSkillNode('discharge').grantsActive).toBe('discharge');
  });

  test('emptySkillRanks grants Frost Fang + Magma Bolt free ranks once', () => {
    const a = emptySkillRanks();
    const b = emptySkillRanks();
    expect(a['frost-fang']).toBe(1);
    expect(a['magma-bolt']).toBe(1);
    expect(b['frost-fang']).toBe(1);
    expect(b['magma-bolt']).toBe(1);
    expect(totalPaidRanks(a)).toBe(0);
    expect(paidRankCount('frost-fang', 1)).toBe(0);
    expect(paidRankCount('frost-fang', 3)).toBe(2);
    expect(paidRankCount('magma-bolt', 1)).toBe(0);
    expect(paidRankCount('magma-bolt', 3)).toBe(2);
  });

  test('formula caps match Spec §7.2 trigger/stack numbers', () => {
    expect(getSkillNode('magma-bolt').formula).toEqual({
      kind: 'active-rank-damage', active: 'magma', perRankAbove1: 0.12,
    });
    expect(getSkillNode('kindling').formula).toEqual({
      kind: 'fire-damage-mul', perRank: 0.06,
    });
    expect(getSkillNode('scorch').formula).toMatchObject({
      kind: 'scorch-dot', fractions: [0.2, 0.3, 0.4], durationSec: 2,
    });
    expect(getSkillNode('volatile-core').formula).toMatchObject({
      kind: 'splash-upgrade', baseRadius: 1.7, baseRatio: 0.5,
      radiusPerRank: 0.35, ratioPerRank: 0.1,
    });
    expect(getSkillNode('hellfire-catalyst').formula).toEqual({
      kind: 'hellfire-crit-explosion', radius: 1.5, ratio: 0.5,
    });
    expect(getSkillNode('frost-fang').formula).toEqual({
      kind: 'active-rank-damage', active: 'frost', perRankAbove1: 0.1,
    });
    expect(getSkillNode('permafrost').formula).toEqual({
      kind: 'slow-duration', perRankSec: 0.4,
    });
    expect(getSkillNode('piercing-ice').formula).toEqual({
      kind: 'pierce', pierceCount: 1,
    });
    expect(getSkillNode('shatter').formula).toMatchObject({
      kind: 'shatter-shards', counts: [2, 3, 4], damageRatio: 0.15, rangeM: 3,
    });
    expect(getSkillNode('winters-grasp').formula).toEqual({
      kind: 'slowed-target-bonus', mul: 1.3,
    });
    expect(getSkillNode('arc-surge').formula).toEqual({
      kind: 'active-rank-damage', active: 'arc', perRankAbove1: 0.1,
    });
    expect(getSkillNode('conduction').formula).toEqual({
      kind: 'conduction-bolts', baseBolts: 3, totalDamagePerRank: 0.08,
    });
    expect(getSkillNode('phase-echo').formula).toEqual({
      kind: 'phase-echo', windowSec: 2, perRank: 0.1,
    });
    expect(getSkillNode('overcharge').formula).toEqual({
      kind: 'overcharge-cdr', perHitSec: 0.25, capPerCastSec: 1,
    });
  });
});

describe('nodeAvailability + investPoint', () => {
  test('Frost Fang + Magma Bolt start invested (free ranks), not available/locked', () => {
    const state = baseState({ level: 1, unspentSkillPoints: 0 });
    expect(nodeAvailability(getSkillNode('frost-fang'), state)).toBe('invested');
    expect(nodeAvailability(getSkillNode('magma-bolt'), state)).toBe('invested');
    expect(nodeAvailability(getSkillNode('kindling'), state)).toBe('locked');
  });

  test('max rank blocks further invest and reports maxed', () => {
    let state = baseState({ unspentSkillPoints: 10 });
    state = investPath(state, ['frost-fang', 'frost-fang', 'frost-fang', 'frost-fang']);
    expect(state.skillRanks['frost-fang']).toBe(5);
    expect(nodeAvailability(getSkillNode('frost-fang'), state)).toBe('maxed');
    expect(investPoint(state, 'frost-fang')).toEqual({ ok: false, reason: 'max-rank' });
  });

  test('no points rejects invest', () => {
    const state = baseState({ unspentSkillPoints: 0 });
    expect(investPoint(state, 'magma-bolt')).toEqual({ ok: false, reason: 'no-points' });
  });

  test('level gate: Hellfire Catalyst / Winter\'s Grasp require level 6', () => {
    let state = baseState({ level: 5, unspentSkillPoints: 20 });
    state = investPath(state, [
      'magma-bolt', 'magma-bolt',
      'kindling', 'kindling',
      'volatile-core', 'volatile-core',
    ]);
    expect(prereqsMet(getSkillNode('hellfire-catalyst'), state.skillRanks)).toBe(true);
    expect(canInvest(getSkillNode('hellfire-catalyst'), state)).toBe(false);
    expect(investPoint(state, 'hellfire-catalyst')).toEqual({ ok: false, reason: 'level-gate' });
    expect(nodeAvailability(getSkillNode('hellfire-catalyst'), state, 5)).toBe('locked');

    state = { ...state, level: 6 };
    expect(nodeAvailability(getSkillNode('hellfire-catalyst'), state)).toBe('available');
    const ok = investPoint(state, 'hellfire-catalyst');
    expect(ok.ok).toBe(true);
  });

  test('Flame prerequisite path: Magma→Kindling→Volatile→Hellfire', () => {
    let state = baseState({ level: 6 });
    expect(investPoint(state, 'kindling').ok).toBe(false);
    state = investPath(state, ['magma-bolt', 'magma-bolt']);
    expect(nodeAvailability(getSkillNode('kindling'), state)).toBe('available');
    expect(nodeAvailability(getSkillNode('scorch'), state)).toBe('available');
    expect(investPoint(state, 'volatile-core').ok).toBe(false);

    state = investPath(state, ['kindling', 'kindling']);
    expect(nodeAvailability(getSkillNode('volatile-core'), state)).toBe('available');
    state = investPath(state, ['volatile-core', 'volatile-core', 'hellfire-catalyst']);
    expect(state.skillRanks['hellfire-catalyst']).toBe(1);
  });

  test('Volatile Core accepts Scorch 2 OR Kindling 2', () => {
    let viaScorch = baseState();
    viaScorch = investPath(viaScorch, ['magma-bolt', 'magma-bolt', 'scorch', 'scorch']);
    expect(prereqsMet(getSkillNode('volatile-core'), viaScorch.skillRanks)).toBe(true);

    let viaKindling = baseState();
    viaKindling = investPath(viaKindling, ['magma-bolt', 'magma-bolt', 'kindling', 'kindling']);
    expect(prereqsMet(getSkillNode('volatile-core'), viaKindling.skillRanks)).toBe(true);
  });

  test('Frost prerequisite path: Fang→Permafrost/Pierce→Shatter→Winter', () => {
    let state = baseState({ level: 6 });
    expect(investPoint(state, 'permafrost').ok).toBe(false);
    state = investPath(state, ['frost-fang']); // rank 1→2 (paid)
    expect(nodeAvailability(getSkillNode('permafrost'), state)).toBe('available');
    expect(nodeAvailability(getSkillNode('piercing-ice'), state)).toBe('available');

    // Shatter via Piercing Ice alone
    state = investPath(state, ['piercing-ice']);
    expect(prereqsMet(getSkillNode('shatter'), state.skillRanks)).toBe(true);
    state = investPath(state, ['shatter', 'shatter', 'shatter', 'winters-grasp']);
    expect(state.skillRanks['winters-grasp']).toBe(1);

    // Alternate: Shatter via Permafrost 2
    let alt = investPath(baseState({ level: 6 }), [
      'frost-fang', 'permafrost', 'permafrost',
    ]);
    expect(prereqsMet(getSkillNode('shatter'), alt.skillRanks)).toBe(true);
  });

  test('Arcane prerequisite path: Surge→Conduction/Phase→Echo→Overcharge', () => {
    let state = baseState();
    expect(investPoint(state, 'conduction').ok).toBe(false);
    expect(investPoint(state, 'phase-step').ok).toBe(false);
    state = investPath(state, ['arc-surge', 'arc-surge']);
    expect(nodeAvailability(getSkillNode('conduction'), state)).toBe('available');
    expect(nodeAvailability(getSkillNode('phase-step'), state)).toBe('available');

    state = investPath(state, [
      'conduction', 'conduction', 'conduction',
      'phase-step',
      'phase-echo', 'phase-echo',
      'overcharge',
    ]);
    expect(state.skillRanks['overcharge']).toBe(1);
    expect(state.skillRanks['phase-step']).toBe(1);
  });

  test('point accounting: each invest spends exactly one point', () => {
    let state = baseState({ unspentSkillPoints: 3 });
    state = investPath(state, ['magma-bolt', 'magma-bolt', 'kindling']);
    expect(state.unspentSkillPoints).toBe(0);
    expect(totalPaidRanks(state.skillRanks)).toBe(3);
    // Frost Fang free rank is not paid
    expect(state.skillRanks['frost-fang']).toBe(1);
    expect(paidRankCount('frost-fang', state.skillRanks['frost-fang'])).toBe(0);
  });
});

describe('respecInCamp', () => {
  test('rejects outside Cinderwatch', () => {
    const state = investPath(baseState(), ['magma-bolt']);
    expect(respecInCamp(state, 'ashen-reach')).toEqual({ ok: false, reason: 'not-in-camp' });
    expect(respecInCamp(state, 'slagdeep-hollow')).toEqual({ ok: false, reason: 'not-in-camp' });
  });

  test('in camp: keeps free Frost Fang + Magma Bolt, refunds paid ranks only', () => {
    let state = baseState({ unspentSkillPoints: 5 });
    state = investPath(state, [
      'frost-fang', 'frost-fang', // paid 2 → rank 3
      'magma-bolt', // paid 1 → rank 2 (free starter is rank 1)
      'arc-surge',
    ]);
    expect(state.skillRanks['frost-fang']).toBe(3);
    expect(totalPaidRanks(state.skillRanks)).toBe(4);
    expect(state.unspentSkillPoints).toBe(1);

    const res = respecInCamp(state, 'cinderwatch');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.skillRanks['frost-fang']).toBe(1);
    expect(res.state.skillRanks['magma-bolt']).toBe(1);
    expect(res.state.skillRanks['arc-surge']).toBe(0);
    expect(totalPaidRanks(res.state.skillRanks)).toBe(0);
    expect(res.state.unspentSkillPoints).toBe(1 + 4);
  });

  test('clears hotbar slots whose active is now unlearned; keeps free starters', () => {
    let state = baseState({ unspentSkillPoints: 5 });
    state = investPath(state, ['magma-bolt', 'arc-surge', 'arc-surge', 'phase-step']);
    const assigned = assignActiveToHotbar(state, 'magma-bolt', 1);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    state = assigned.state;
    const blink = assignActiveToHotbar(state, 'phase-step', 2);
    expect(blink.ok).toBe(true);
    if (!blink.ok) return;
    state = { ...blink.state, selectedHotbarSlot: 2 };

    const res = respecInCamp(state, 'cinderwatch');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.hotbar).toContain('frost');
    expect(res.state.hotbar).toContain('magma');
    expect(res.state.hotbar).not.toContain('arc');
    expect(res.state.hotbar).not.toContain('blink');
    expect(res.state.hotbar[res.state.selectedHotbarSlot]).toBe('frost');
  });

  test('PR9: camp respec refunds new-node paid ranks and clears new actives', () => {
    let state = baseState({ level: 10, unspentSkillPoints: 12 });
    state = investPath(state, [
      'magma-bolt', 'magma-bolt', // →3
      'flame-burst', 'flame-burst',
      'frost-fang', 'frost-fang', // →3
      'frost-nova',
      'arc-surge', 'arc-surge', 'arc-surge', // →3
      'discharge',
    ]);
    const paid = totalPaidRanks(state.skillRanks);
    expect(state.skillRanks['flame-burst']).toBe(2);
    expect(state.skillRanks['frost-nova']).toBe(1);
    expect(state.skillRanks.discharge).toBe(1);

    let assigned = assignActiveToHotbar(state, 'flame-burst', 1);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    state = assigned.state;
    assigned = assignActiveToHotbar(state, 'frost-nova', 2);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    state = assigned.state;
    assigned = assignActiveToHotbar(state, 'discharge', 3);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    state = assigned.state;

    const res = respecInCamp(state, 'cinderwatch');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.skillRanks['flame-burst']).toBe(0);
    expect(res.state.skillRanks['frost-nova']).toBe(0);
    expect(res.state.skillRanks.discharge).toBe(0);
    expect(res.state.skillRanks['frost-fang']).toBe(1);
    expect(res.state.skillRanks['magma-bolt']).toBe(1);
    expect(totalPaidRanks(res.state.skillRanks)).toBe(0);
    expect(res.state.unspentSkillPoints).toBe(state.unspentSkillPoints + paid);
    expect(res.state.hotbar).toContain('frost');
    expect(res.state.hotbar).toContain('magma');
    expect(res.state.hotbar).not.toContain('flame-burst');
    expect(res.state.hotbar).not.toContain('frost-nova');
    expect(res.state.hotbar).not.toContain('discharge');
  });
});

describe('assignActiveToHotbar + clamp', () => {
  test('rejects unlearned / non-active nodes', () => {
    const state = baseState();
    expect(assignActiveToHotbar(state, 'arc-surge', 1)).toEqual({
      ok: false, reason: 'not-learned',
    });
    expect(assignActiveToHotbar(state, 'kindling', 1)).toEqual({
      ok: false, reason: 'not-active',
    });
  });

  test('clampSkillRanks enforces free starter ranks and max ranks', () => {
    const clamped = clampSkillRanks({
      'frost-fang': 0,
      'magma-bolt': 99,
      'kindling': -3,
    });
    expect(clamped['frost-fang']).toBe(1);
    expect(clamped['magma-bolt']).toBe(5);
    expect(clamped['kindling']).toBe(0);
    const zeroMagma = clampSkillRanks({ 'magma-bolt': 0 });
    expect(zeroMagma['magma-bolt']).toBe(1);
  });

  test('stateFromProgression sanitizes hotbar against ranks', () => {
    const state = stateFromProgression({
      level: 3,
      unspentSkillPoints: 2,
      skillRanks: { 'frost-fang': 1 },
      hotbar: ['frost', 'magma', 'blink', null],
      selectedHotbarSlot: 2,
    });
    // Free Magma Bolt survives clamp; unlearned blink is cleared.
    expect(state.hotbar[1]).toBe('magma');
    expect(state.hotbar[2]).toBeNull();
    expect(state.hotbar).toContain('frost');
    expect(state.selectedHotbarSlot).toBeTypeOf('number');
    expect(state.hotbar[state.selectedHotbarSlot]).toBe('frost');
  });

  test('stateFromProgression keeps inferno-nova at level ≥3 (level-granted)', () => {
    const unlocked = stateFromProgression({
      level: 3,
      unspentSkillPoints: 0,
      skillRanks: { 'frost-fang': 1, 'magma-bolt': 1 },
      hotbar: ['frost', 'magma', null, 'inferno-nova'],
      selectedHotbarSlot: 3,
    });
    expect(unlocked.hotbar[3]).toBe('inferno-nova');

    const locked = stateFromProgression({
      level: 2,
      unspentSkillPoints: 0,
      skillRanks: { 'frost-fang': 1, 'magma-bolt': 1 },
      hotbar: ['frost', 'magma', null, 'inferno-nova'],
      selectedHotbarSlot: 0,
    });
    expect(locked.hotbar[3]).toBeNull();
  });
});
