import { describe, expect, test } from 'bun:test';
import { SKILL_NODE_IDS } from './content-ids';
import {
  BRANCH_TABS,
  branchNodes,
  layoutForBranch,
  layoutPixels,
  nodeLayout,
  prereqEdges,
} from './skill-tree-layout';
import { getSkillNode } from './skill-tree';

describe('skill-tree-layout', () => {
  test('three tabs cover all 15 nodes without overlap', () => {
    expect(BRANCH_TABS.map((t) => t.id)).toEqual(['flame', 'frost', 'arcane']);
    const seen = new Set<string>();
    for (const tab of BRANCH_TABS) {
      const nodes = layoutForBranch(tab.id);
      expect(nodes).toHaveLength(5);
      expect(branchNodes(tab.id)).toHaveLength(5);
      for (const n of nodes) {
        expect(seen.has(n.id)).toBe(false);
        seen.add(n.id);
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(1);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeLessThanOrEqual(1);
      }
    }
    expect(seen.size).toBe(SKILL_NODE_IDS.length);
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
  });

  test('layoutPixels maps normalized coords into the padded canvas', () => {
    const px = layoutPixels('frost', 400, 300, 40);
    const fang = px.get('frost-fang')!;
    const layout = nodeLayout('frost-fang');
    expect(fang.x).toBeCloseTo(40 + layout.x * (400 - 80), 5);
    expect(fang.y).toBeCloseTo(40 + layout.y * (300 - 80), 5);
  });
});
