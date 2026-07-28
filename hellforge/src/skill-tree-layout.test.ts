import { describe, expect, test } from 'bun:test';
import { SKILL_NODE_IDS, type SkillNodeId } from './content-ids';
import {
  BRANCH_TABS,
  branchNodes,
  layoutForBranch,
  layoutPixels,
  nodeLayout,
  prereqEdges,
} from './skill-tree-layout';
import { getSkillNode } from './skill-tree';

/** Panel canvas size the layout targets (skill-panel ~420×560 usable). */
const REF_W = 420;
const REF_H = 560;
const REF_PAD = 48;
/** Normal node diameter — pairwise centers must clear this at 720p. */
const MIN_CENTER_PX = 54;

describe('skill-tree-layout', () => {
  test('three tabs lay out 11 nodes/branch (33 total) within bounds', () => {
    expect(BRANCH_TABS.map((t) => t.id)).toEqual(['flame', 'frost', 'arcane']);
    const seen = new Set<string>();
    for (const tab of BRANCH_TABS) {
      const nodes = layoutForBranch(tab.id);
      expect(nodes).toHaveLength(11);
      expect(branchNodes(tab.id)).toHaveLength(11);
      for (const n of nodes) {
        expect(seen.has(n.id)).toBe(false);
        seen.add(n.id);
        expect(SKILL_NODE_IDS.includes(n.id)).toBe(true);
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(1);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeLessThanOrEqual(1);
      }
    }
    expect(seen.size).toBe(33);
  });

  test('every SkillNodeId has a layout entry', () => {
    for (const id of SKILL_NODE_IDS) {
      const layout = nodeLayout(id);
      expect(layout.id).toBe(id);
      expect(getSkillNode(id).branch).toBe(
        BRANCH_TABS.find((t) => layoutForBranch(t.id).some((n) => n.id === id))!.id,
      );
    }
  });

  test('pairwise min-distance keeps 720p grid from silent collapse', () => {
    const innerW = REF_W - REF_PAD * 2;
    const innerH = REF_H - REF_PAD * 2;
    for (const tab of BRANCH_TABS) {
      const nodes = layoutForBranch(tab.id);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = (a.x - b.x) * innerW;
          const dy = (a.y - b.y) * innerH;
          const dist = Math.hypot(dx, dy);
          expect(dist).toBeGreaterThanOrEqual(MIN_CENTER_PX);
        }
      }
    }
  });

  test('capstone keystones are bottom-anchored', () => {
    for (const tab of BRANCH_TABS) {
      for (const n of layoutForBranch(tab.id)) {
        if (getSkillNode(n.id).kind === 'capstone') {
          expect(n.y).toBeGreaterThanOrEqual(0.8);
        }
      }
    }
  });

  test('prereq edges stay on-branch and match SkillNodeDef groups', () => {
    for (const tab of BRANCH_TABS) {
      const edges = prereqEdges(tab.id);
      for (const e of edges) {
        expect(getSkillNode(e.from).branch).toBe(tab.id);
        expect(getSkillNode(e.to).branch).toBe(tab.id);
        const to = getSkillNode(e.to);
        const ok = to.prereqGroups.some((g) => g.some((p) => p.nodeId === e.from));
        expect(ok).toBe(true);
      }
    }
    // Flame: Magma → Kindling/Scorch; Kindling|Scorch → Volatile; Volatile → Hellfire
    const flameFrom = new Set(prereqEdges('flame').map((e) => `${e.from}->${e.to}`));
    expect(flameFrom.has('magma-bolt->kindling')).toBe(true);
    expect(flameFrom.has('magma-bolt->scorch')).toBe(true);
    expect(flameFrom.has('kindling->volatile-core')).toBe(true);
    expect(flameFrom.has('scorch->volatile-core')).toBe(true);
    expect(flameFrom.has('volatile-core->hellfire-catalyst')).toBe(true);
    expect(flameFrom.has('hellfire-catalyst->furnace-heart')).toBe(true);
  });

  test('layoutPixels maps normalized coords into the padded canvas', () => {
    const px = layoutPixels('frost', 400, 300, 40);
    const fang = px.get('frost-fang')!;
    const layout = nodeLayout('frost-fang');
    expect(fang.x).toBeCloseTo(40 + layout.x * (400 - 80), 5);
    expect(fang.y).toBeCloseTo(40 + layout.y * (300 - 80), 5);
    // All 11 frost nodes get pixel positions.
    expect(px.size).toBe(11);
    for (const id of layoutForBranch('frost').map((n) => n.id)) {
      expect(px.has(id as SkillNodeId)).toBe(true);
    }
  });
});
