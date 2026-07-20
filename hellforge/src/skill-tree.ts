// Sorceress skill-tree definitions + pure invest/respec transitions (Spec §7).
// CharacterDomain remains the sole mutable owner; callers apply returned state
// via domain commands. Active skill ids stay magma/frost/arc/blink.

import {
  SKILL_NODE_IDS,
  type ActiveSkillId,
  type AreaId,
  type HotbarSlots,
  type SkillNodeId,
} from './content-ids';
import { SKILL_NODE_BY_ACTIVE } from './skill-availability';

export type SkillBranch = 'flame' | 'frost' | 'arcane';
export type SkillNodeKind = 'active' | 'passive' | 'modifier' | 'capstone';
export type NodeAvailability = 'locked' | 'available' | 'invested' | 'maxed';

/** One prerequisite edge: node must hold at least minRank. */
export interface SkillPrereq {
  readonly nodeId: SkillNodeId;
  readonly minRank: number;
}

/**
 * Formula metadata consumed by SkillResolver (Task 3.2). Encoded here so the
 * tree SSOT owns trigger/stack/cap numbers from Spec §7.2.
 */
export type SkillNodeFormula =
  | { readonly kind: 'active-rank-damage'; readonly active: ActiveSkillId; readonly perRankAbove1: number }
  | { readonly kind: 'fire-damage-mul'; readonly perRank: number }
  | {
      readonly kind: 'scorch-dot';
      readonly fractions: readonly [number, number, number];
      readonly durationSec: number;
    }
  | {
      readonly kind: 'splash-upgrade';
      readonly baseRadius: number;
      readonly baseRatio: number;
      readonly radiusPerRank: number;
      readonly ratioPerRank: number;
    }
  | {
      readonly kind: 'hellfire-crit-explosion';
      readonly radius: number;
      readonly ratio: number;
    }
  | { readonly kind: 'slow-duration'; readonly perRankSec: number }
  | { readonly kind: 'pierce'; readonly pierceCount: number }
  | {
      readonly kind: 'shatter-shards';
      readonly counts: readonly [number, number, number];
      readonly damageRatio: number;
      readonly rangeM: number;
    }
  | { readonly kind: 'slowed-target-bonus'; readonly mul: number }
  | {
      readonly kind: 'conduction-bolts';
      readonly baseBolts: number;
      readonly totalDamagePerRank: number;
    }
  | {
      readonly kind: 'phase-echo';
      readonly windowSec: number;
      readonly perRank: number;
    }
  | {
      readonly kind: 'overcharge-cdr';
      readonly perHitSec: number;
      readonly capPerCastSec: number;
    }
  | { readonly kind: 'grant-active'; readonly active: ActiveSkillId };

export interface SkillNodeDef {
  readonly id: SkillNodeId;
  readonly branch: SkillBranch;
  readonly name: string;
  readonly nameZh: string;
  readonly kind: SkillNodeKind;
  readonly maxRank: number;
  /** Character level required before any rank may be invested. */
  readonly requiredLevel: number;
  /**
   * Prerequisite groups are OR'd; each group is AND'd.
   * Empty → no skill-rank prerequisites.
   */
  readonly prereqGroups: readonly (readonly SkillPrereq[])[];
  /** Active skill granted while rank > 0. */
  readonly grantsActive?: ActiveSkillId;
  readonly formula: SkillNodeFormula;
}

export interface SkillTreeState {
  readonly level: number;
  readonly unspentSkillPoints: number;
  readonly skillRanks: Readonly<Record<SkillNodeId, number>>;
  readonly hotbar: HotbarSlots;
  readonly selectedHotbarSlot: 0 | 1 | 2 | 3;
}

export type SkillTreeFailReason =
  | 'unknown-node'
  | 'no-points'
  | 'max-rank'
  | 'level-gate'
  | 'prereq'
  | 'not-in-camp'
  | 'not-learned'
  | 'not-active'
  | 'bad-slot';

export type SkillTreeResult =
  | { readonly ok: true; readonly state: SkillTreeState }
  | { readonly ok: false; readonly reason: SkillTreeFailReason };

const FREE_FROST_FANG_RANK = 1;

/** Reverse map: skill-tree node → active kit id (only grant-active nodes). */
export const ACTIVE_BY_SKILL_NODE: Readonly<Partial<Record<SkillNodeId, ActiveSkillId>>> = {
  'magma-bolt': 'magma',
  'frost-fang': 'frost',
  'arc-surge': 'arc',
  'phase-step': 'blink',
};

export const SKILL_NODES: readonly SkillNodeDef[] = [
  // ── Flame ──────────────────────────────────────────────────────────────
  {
    id: 'magma-bolt',
    branch: 'flame',
    name: 'Magma Bolt',
    nameZh: '熔火弹',
    kind: 'active',
    maxRank: 5,
    requiredLevel: 1,
    prereqGroups: [],
    grantsActive: 'magma',
    formula: { kind: 'active-rank-damage', active: 'magma', perRankAbove1: 0.12 },
  },
  {
    id: 'kindling',
    branch: 'flame',
    name: 'Kindling',
    nameZh: '引火',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'magma-bolt', minRank: 2 }]],
    formula: { kind: 'fire-damage-mul', perRank: 0.06 },
  },
  {
    id: 'scorch',
    branch: 'flame',
    name: 'Scorch',
    nameZh: '灼烧',
    kind: 'modifier',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'magma-bolt', minRank: 2 }]],
    formula: {
      kind: 'scorch-dot',
      fractions: [0.20, 0.30, 0.40],
      durationSec: 2,
    },
  },
  {
    id: 'volatile-core',
    branch: 'flame',
    name: 'Volatile Core',
    nameZh: '爆裂核心',
    kind: 'modifier',
    maxRank: 2,
    requiredLevel: 1,
    prereqGroups: [
      [{ nodeId: 'kindling', minRank: 2 }],
      [{ nodeId: 'scorch', minRank: 2 }],
    ],
    formula: {
      kind: 'splash-upgrade',
      baseRadius: 1.7,
      baseRatio: 0.5,
      radiusPerRank: 0.35,
      ratioPerRank: 0.10,
    },
  },
  {
    id: 'hellfire-catalyst',
    branch: 'flame',
    name: 'Hellfire Catalyst',
    nameZh: '狱火触媒',
    kind: 'capstone',
    maxRank: 1,
    requiredLevel: 6,
    prereqGroups: [[{ nodeId: 'volatile-core', minRank: 2 }]],
    formula: { kind: 'hellfire-crit-explosion', radius: 1.5, ratio: 0.5 },
  },

  // ── Frost ──────────────────────────────────────────────────────────────
  {
    id: 'frost-fang',
    branch: 'frost',
    name: 'Frost Fang',
    nameZh: '霜牙',
    kind: 'active',
    maxRank: 5,
    requiredLevel: 1,
    prereqGroups: [],
    grantsActive: 'frost',
    formula: { kind: 'active-rank-damage', active: 'frost', perRankAbove1: 0.10 },
  },
  {
    id: 'permafrost',
    branch: 'frost',
    name: 'Permafrost',
    nameZh: '永冻',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'frost-fang', minRank: 2 }]],
    formula: { kind: 'slow-duration', perRankSec: 0.4 },
  },
  {
    id: 'piercing-ice',
    branch: 'frost',
    name: 'Piercing Ice',
    nameZh: '穿冰',
    kind: 'modifier',
    maxRank: 1,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'frost-fang', minRank: 2 }]],
    formula: { kind: 'pierce', pierceCount: 1 },
  },
  {
    id: 'shatter',
    branch: 'frost',
    name: 'Shatter',
    nameZh: '碎冰',
    kind: 'modifier',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [
      [{ nodeId: 'permafrost', minRank: 2 }],
      [{ nodeId: 'piercing-ice', minRank: 1 }],
    ],
    formula: {
      kind: 'shatter-shards',
      counts: [2, 3, 4],
      damageRatio: 0.15,
      rangeM: 3,
    },
  },
  {
    id: 'winters-grasp',
    branch: 'frost',
    name: "Winter's Grasp",
    nameZh: '冬之握',
    kind: 'capstone',
    maxRank: 1,
    requiredLevel: 6,
    prereqGroups: [[{ nodeId: 'shatter', minRank: 3 }]],
    formula: { kind: 'slowed-target-bonus', mul: 1.3 },
  },

  // ── Arcane ─────────────────────────────────────────────────────────────
  {
    id: 'arc-surge',
    branch: 'arcane',
    name: 'Arc Surge',
    nameZh: '电弧涌',
    kind: 'active',
    maxRank: 5,
    requiredLevel: 1,
    prereqGroups: [],
    grantsActive: 'arc',
    formula: { kind: 'active-rank-damage', active: 'arc', perRankAbove1: 0.10 },
  },
  {
    id: 'conduction',
    branch: 'arcane',
    name: 'Conduction',
    nameZh: '导流',
    kind: 'modifier',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'arc-surge', minRank: 2 }]],
    formula: {
      kind: 'conduction-bolts',
      baseBolts: 3,
      totalDamagePerRank: 0.08,
    },
  },
  {
    id: 'phase-step',
    branch: 'arcane',
    name: 'Phase Step',
    nameZh: '影踏',
    kind: 'active',
    maxRank: 1,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'arc-surge', minRank: 2 }]],
    grantsActive: 'blink',
    formula: { kind: 'grant-active', active: 'blink' },
  },
  {
    id: 'phase-echo',
    branch: 'arcane',
    name: 'Phase Echo',
    nameZh: '相位回响',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'phase-step', minRank: 1 }]],
    formula: { kind: 'phase-echo', windowSec: 2, perRank: 0.10 },
  },
  {
    id: 'overcharge',
    branch: 'arcane',
    name: 'Overcharge',
    nameZh: '过载',
    kind: 'capstone',
    maxRank: 1,
    requiredLevel: 1,
    prereqGroups: [[
      { nodeId: 'conduction', minRank: 3 },
      { nodeId: 'phase-echo', minRank: 2 },
    ]],
    formula: { kind: 'overcharge-cdr', perHitSec: 0.25, capPerCastSec: 1.0 },
  },
] as const;

const NODE_BY_ID: ReadonlyMap<SkillNodeId, SkillNodeDef> = new Map(
  SKILL_NODES.map((n) => [n.id, n]),
);

export function getSkillNode(id: SkillNodeId): SkillNodeDef {
  const node = NODE_BY_ID.get(id);
  if (!node) throw new Error(`Unknown skill node: ${id}`);
  return node;
}

export function nodesForBranch(branch: SkillBranch): readonly SkillNodeDef[] {
  return SKILL_NODES.filter((n) => n.branch === branch);
}

export function emptySkillRanks(): Record<SkillNodeId, number> {
  const ranks = {} as Record<SkillNodeId, number>;
  for (const id of SKILL_NODE_IDS) ranks[id] = 0;
  ranks['frost-fang'] = FREE_FROST_FANG_RANK;
  return ranks;
}

/** Paid ranks only — Frost Fang's free starter rank is never refunded. */
export function paidRankCount(nodeId: SkillNodeId, rank: number): number {
  if (nodeId === 'frost-fang') return Math.max(0, rank - FREE_FROST_FANG_RANK);
  return Math.max(0, rank);
}

export function totalPaidRanks(ranks: Readonly<Record<SkillNodeId, number>>): number {
  let sum = 0;
  for (const id of SKILL_NODE_IDS) sum += paidRankCount(id, ranks[id] ?? 0);
  return sum;
}

export function prereqsMet(
  node: SkillNodeDef,
  ranks: Readonly<Partial<Record<SkillNodeId, number>>>,
): boolean {
  if (node.prereqGroups.length === 0) return true;
  return node.prereqGroups.some((group) =>
    group.every((p) => (ranks[p.nodeId] ?? 0) >= p.minRank),
  );
}

export function canInvest(
  node: SkillNodeDef,
  state: SkillTreeState,
): boolean {
  const rank = state.skillRanks[node.id] ?? 0;
  if (state.unspentSkillPoints < 1) return false;
  if (rank >= node.maxRank) return false;
  if (state.level < node.requiredLevel) return false;
  if (!prereqsMet(node, state.skillRanks)) return false;
  return true;
}

export function nodeAvailability(
  node: SkillNodeDef,
  state: SkillTreeState,
  level: number = state.level,
): NodeAvailability {
  const rank = state.skillRanks[node.id] ?? 0;
  if (rank >= node.maxRank) return 'maxed';
  if (rank > 0) return 'invested';
  const levelOk = level >= node.requiredLevel;
  const prereqOk = prereqsMet(node, state.skillRanks);
  if (levelOk && prereqOk) return 'available';
  return 'locked';
}

function cloneState(state: SkillTreeState): {
  level: number;
  unspentSkillPoints: number;
  skillRanks: Record<SkillNodeId, number>;
  hotbar: [ActiveSkillId | null, ActiveSkillId | null, ActiveSkillId | null, ActiveSkillId | null];
  selectedHotbarSlot: 0 | 1 | 2 | 3;
} {
  return {
    level: state.level,
    unspentSkillPoints: state.unspentSkillPoints,
    skillRanks: { ...state.skillRanks } as Record<SkillNodeId, number>,
    hotbar: [...state.hotbar] as [
      ActiveSkillId | null,
      ActiveSkillId | null,
      ActiveSkillId | null,
      ActiveSkillId | null,
    ],
    selectedHotbarSlot: state.selectedHotbarSlot,
  };
}

/** Drop hotbar entries whose granting active-node is unlearned; keep Frost. */
export function sanitizeHotbar(
  ranks: Readonly<Partial<Record<SkillNodeId, number>>>,
  hotbar: HotbarSlots,
  selectedHotbarSlot: 0 | 1 | 2 | 3,
): { hotbar: HotbarSlots; selectedHotbarSlot: 0 | 1 | 2 | 3 } {
  const next = [...hotbar] as [
    ActiveSkillId | null,
    ActiveSkillId | null,
    ActiveSkillId | null,
    ActiveSkillId | null,
  ];
  for (let i = 0; i < 4; i++) {
    const skill = next[i];
    if (!skill) continue;
    const nodeId = SKILL_NODE_BY_ACTIVE[skill];
    if ((ranks[nodeId] ?? 0) <= 0) next[i] = null;
  }
  // Ensure Frost Fang remains assignable after respec.
  if ((ranks['frost-fang'] ?? 0) > 0 && !next.some((s) => s === 'frost')) {
    const empty = next.findIndex((s) => s === null);
    if (empty >= 0) next[empty] = 'frost';
    else next[0] = 'frost';
  }
  let selected = selectedHotbarSlot;
  const selectedSkill = next[selected];
  if (!selectedSkill || (ranks[SKILL_NODE_BY_ACTIVE[selectedSkill]] ?? 0) <= 0) {
    const frostSlot = next.findIndex((s) => s === 'frost');
    selected = (frostSlot >= 0 ? frostSlot : 0) as 0 | 1 | 2 | 3;
  }
  return {
    hotbar: next as unknown as HotbarSlots,
    selectedHotbarSlot: selected,
  };
}

export function investPoint(state: SkillTreeState, nodeId: SkillNodeId): SkillTreeResult {
  const node = NODE_BY_ID.get(nodeId);
  if (!node) return { ok: false, reason: 'unknown-node' };
  if (state.unspentSkillPoints < 1) return { ok: false, reason: 'no-points' };
  const rank = state.skillRanks[nodeId] ?? 0;
  if (rank >= node.maxRank) return { ok: false, reason: 'max-rank' };
  if (state.level < node.requiredLevel) return { ok: false, reason: 'level-gate' };
  if (!prereqsMet(node, state.skillRanks)) return { ok: false, reason: 'prereq' };

  const next = cloneState(state);
  next.skillRanks[nodeId] = rank + 1;
  next.unspentSkillPoints -= 1;
  return { ok: true, state: next };
}

/**
 * Camp-only respec: refund paid ranks, keep free Frost Fang rank 1, clear
 * unlearned hotbar actives, select a valid Frost Fang slot.
 */
export function respecInCamp(state: SkillTreeState, areaId: AreaId): SkillTreeResult {
  if (areaId !== 'cinderwatch') return { ok: false, reason: 'not-in-camp' };

  const refund = totalPaidRanks(state.skillRanks);
  const ranks = emptySkillRanks();
  const sanitized = sanitizeHotbar(ranks, state.hotbar, state.selectedHotbarSlot);
  return {
    ok: true,
    state: {
      level: state.level,
      unspentSkillPoints: state.unspentSkillPoints + refund,
      skillRanks: ranks,
      hotbar: sanitized.hotbar,
      selectedHotbarSlot: sanitized.selectedHotbarSlot,
    },
  };
}

/** Assign a learned active-granting node to a hotbar slot. */
export function assignActiveToHotbar(
  state: SkillTreeState,
  nodeId: SkillNodeId,
  slot: 0 | 1 | 2 | 3,
): SkillTreeResult {
  const node = NODE_BY_ID.get(nodeId);
  if (!node) return { ok: false, reason: 'unknown-node' };
  const active = node.grantsActive ?? ACTIVE_BY_SKILL_NODE[nodeId];
  if (!active) return { ok: false, reason: 'not-active' };
  if ((state.skillRanks[nodeId] ?? 0) <= 0) return { ok: false, reason: 'not-learned' };
  if (slot < 0 || slot > 3) return { ok: false, reason: 'bad-slot' };

  const next = cloneState(state);
  next.hotbar[slot] = active;
  return { ok: true, state: next };
}

/** Clamp persisted ranks to tree max + enforce free Frost Fang rank. */
export function clampSkillRanks(
  raw: Readonly<Partial<Record<SkillNodeId, number>>>,
): Record<SkillNodeId, number> {
  const ranks = emptySkillRanks();
  for (const id of SKILL_NODE_IDS) {
    const node = getSkillNode(id);
    const v = raw[id];
    if (v === undefined) continue;
    ranks[id] = Math.max(0, Math.min(node.maxRank, Math.floor(v)));
  }
  ranks['frost-fang'] = Math.max(FREE_FROST_FANG_RANK, ranks['frost-fang']);
  return ranks;
}

export function stateFromProgression(input: {
  level: number;
  unspentSkillPoints: number;
  skillRanks: Readonly<Partial<Record<SkillNodeId, number>>>;
  hotbar: HotbarSlots;
  selectedHotbarSlot: 0 | 1 | 2 | 3;
}): SkillTreeState {
  const ranks = clampSkillRanks(input.skillRanks);
  const sanitized = sanitizeHotbar(ranks, input.hotbar, input.selectedHotbarSlot);
  return {
    level: Math.max(1, input.level),
    unspentSkillPoints: Math.max(0, input.unspentSkillPoints),
    skillRanks: ranks,
    hotbar: sanitized.hotbar,
    selectedHotbarSlot: sanitized.selectedHotbarSlot,
  };
}
