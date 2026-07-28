// Pure layout for the three-branch Sorceress skill tree UI (Spec §7).
// Positions are normalized 0–1 within the branch canvas; edges follow prereqs.

import type { SkillNodeId } from './content-ids';
import {
  getSkillNode,
  nodesForBranch,
  type SkillBranch,
  type SkillNodeDef,
} from './skill-tree';

export interface SkillNodeLayout {
  readonly id: SkillNodeId;
  /** Normalized x in [0, 1] within the branch panel. */
  readonly x: number;
  /** Normalized y in [0, 1] (0 = top). */
  readonly y: number;
}

export interface SkillPrereqEdge {
  readonly from: SkillNodeId;
  readonly to: SkillNodeId;
}

/**
 * Authored node positions per branch — 11 nodes each (9 normal + 2 capstone),
 * readable at 1280×720. Capstones bottom-anchored with wider x spacing so a
 * ~78px keystone badge (L4 / T5) still clears neighbors on the ~420×560 canvas.
 */
const LAYOUT: Readonly<Record<SkillBranch, readonly SkillNodeLayout[]>> = {
  flame: [
    { id: 'magma-bolt', x: 0.50, y: 0.08 },
    { id: 'kindling', x: 0.22, y: 0.26 },
    { id: 'flame-burst', x: 0.50, y: 0.26 },
    { id: 'scorch', x: 0.78, y: 0.26 },
    { id: 'searing', x: 0.22, y: 0.44 },
    { id: 'volatile-core', x: 0.50, y: 0.44 },
    { id: 'ember', x: 0.78, y: 0.44 },
    { id: 'heat-shimmer', x: 0.22, y: 0.62 },
    { id: 'wildfire', x: 0.50, y: 0.62 },
    { id: 'hellfire-catalyst', x: 0.32, y: 0.88 },
    { id: 'furnace-heart', x: 0.68, y: 0.88 },
  ],
  frost: [
    { id: 'frost-fang', x: 0.50, y: 0.08 },
    { id: 'permafrost', x: 0.22, y: 0.26 },
    { id: 'frost-nova', x: 0.50, y: 0.26 },
    { id: 'piercing-ice', x: 0.78, y: 0.26 },
    { id: 'rime', x: 0.22, y: 0.44 },
    { id: 'shatter', x: 0.50, y: 0.44 },
    { id: 'piercing-cold', x: 0.78, y: 0.44 },
    { id: 'frozen-focus', x: 0.22, y: 0.62 },
    { id: 'glacier-shards', x: 0.50, y: 0.62 },
    { id: 'winters-grasp', x: 0.32, y: 0.88 },
    { id: 'deep-freeze', x: 0.68, y: 0.88 },
  ],
  arcane: [
    { id: 'arc-surge', x: 0.50, y: 0.08 },
    { id: 'conduction', x: 0.22, y: 0.26 },
    { id: 'discharge', x: 0.50, y: 0.26 },
    { id: 'phase-step', x: 0.78, y: 0.26 },
    { id: 'overcast', x: 0.22, y: 0.44 },
    { id: 'resonance', x: 0.50, y: 0.44 },
    { id: 'phase-echo', x: 0.78, y: 0.44 },
    { id: 'swift-phases', x: 0.22, y: 0.62 },
    { id: 'echo-mastery', x: 0.78, y: 0.62 },
    { id: 'overcharge', x: 0.32, y: 0.88 },
    { id: 'tempest-conduit', x: 0.68, y: 0.88 },
  ],
};

export const BRANCH_TABS: readonly { id: SkillBranch; label: string }[] = [
  { id: 'flame', label: '火焰' },
  { id: 'frost', label: '冰霜' },
  { id: 'arcane', label: '奥术' },
];

export function layoutForBranch(branch: SkillBranch): readonly SkillNodeLayout[] {
  return LAYOUT[branch];
}

export function nodeLayout(id: SkillNodeId): SkillNodeLayout {
  const node = getSkillNode(id);
  const row = LAYOUT[node.branch].find((n) => n.id === id);
  if (!row) throw new Error(`Missing layout for ${id}`);
  return row;
}

/**
 * Prerequisite edges for drawing lines. OR-groups produce multiple inbound
 * edges; the UI draws all of them (Diablo-style soft gates).
 */
export function prereqEdges(branch: SkillBranch): readonly SkillPrereqEdge[] {
  const edges: SkillPrereqEdge[] = [];
  for (const node of nodesForBranch(branch)) {
    for (const group of node.prereqGroups) {
      for (const p of group) {
        // Only draw edges whose source is on the same branch canvas.
        if (getSkillNode(p.nodeId).branch === branch) {
          edges.push({ from: p.nodeId, to: node.id });
        }
      }
    }
  }
  return edges;
}

/** Pixel positions inside a canvas of the given size (node centers). */
export function layoutPixels(
  branch: SkillBranch,
  width: number,
  height: number,
  pad = 48,
): ReadonlyMap<SkillNodeId, { x: number; y: number }> {
  const map = new Map<SkillNodeId, { x: number; y: number }>();
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  for (const n of LAYOUT[branch]) {
    map.set(n.id, {
      x: pad + n.x * innerW,
      y: pad + n.y * innerH,
    });
  }
  return map;
}

export function branchNodes(branch: SkillBranch): readonly SkillNodeDef[] {
  return nodesForBranch(branch);
}
