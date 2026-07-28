// Sorceress skill-tree definitions + pure invest/respec transitions (Spec §7).
// CharacterDomain remains the sole mutable owner; callers apply returned state
// via domain commands. Tree-granted actives: magma/frost/arc/blink;
// level-granted finisher: inferno-nova (PR2a L5).

import {
  SKILL_NODE_IDS,
  type ActiveSkillId,
  type AreaId,
  type HotbarSlots,
  type SkillNodeId,
} from './content-ids';
import { LEVEL_UNLOCK_ACTIVE, SKILL_NODE_BY_ACTIVE } from './skill-availability';

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
  | { readonly kind: 'grant-active'; readonly active: ActiveSkillId }
  // PR9 — metadata only here; resolver folds land in T2.
  | { readonly kind: 'scorch-duration'; readonly perRankSec: number }
  | { readonly kind: 'burn-crit-chance'; readonly perRank: number }
  | { readonly kind: 'splash-scorch'; readonly fractions: readonly [number, number] }
  | {
      readonly kind: 'projectile-speed-mul';
      readonly active: ActiveSkillId;
      readonly perRank: number;
    }
  | {
      readonly kind: 'burn-kill-detonate';
      readonly ratio: number;
      readonly radius: number;
    }
  | { readonly kind: 'slow-magnitude'; readonly perRank: number }
  | { readonly kind: 'shatter-count-bonus'; readonly perRank: number }
  | {
      readonly kind: 'mana-cost';
      readonly active: ActiveSkillId;
      readonly perRank: number;
    }
  | {
      readonly kind: 'deep-freeze';
      readonly damageMul: number;
      readonly refreshSlowSec: number;
    }
  | {
      readonly kind: 'discharge-burst';
      readonly perRankAbove1: number;
      readonly baseBolts: number;
      readonly boltsPerRank: number;
    }
  | { readonly kind: 'arc-damage-mul'; readonly perRank: number }
  | {
      readonly kind: 'cooldown';
      readonly active: ActiveSkillId;
      readonly perRankSec: number;
    }
  | {
      readonly kind: 'echo-mastery';
      readonly windowPerRankSec: number;
      readonly damagePerRank: number;
    }
  | {
      readonly kind: 'cooldown-mul';
      readonly active: ActiveSkillId;
      readonly perRank: number;
    }
  | {
      readonly kind: 'tempest-conduit';
      readonly overchargeCapSec: number;
      readonly appliesTo: ActiveSkillId;
    };

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
/** PR2a L8 onboarding — Magma Bolt is a free creation grant (survives respec). */
const FREE_MAGMA_BOLT_RANK = 1;

/** Reverse map: skill-tree node → active kit id (only grant-active nodes). */
export const ACTIVE_BY_SKILL_NODE: Readonly<Partial<Record<SkillNodeId, ActiveSkillId>>> = {
  'magma-bolt': 'magma',
  'frost-fang': 'frost',
  'arc-surge': 'arc',
  'phase-step': 'blink',
  'flame-burst': 'flame-burst',
  'frost-nova': 'frost-nova',
  discharge: 'discharge',
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
  {
    id: 'flame-burst',
    branch: 'flame',
    name: 'Flame Burst',
    nameZh: '烈焰迸发',
    kind: 'active',
    maxRank: 5,
    requiredLevel: 4,
    prereqGroups: [[{ nodeId: 'magma-bolt', minRank: 3 }]],
    grantsActive: 'flame-burst',
    formula: { kind: 'active-rank-damage', active: 'flame-burst', perRankAbove1: 0.10 },
  },
  {
    id: 'ember',
    branch: 'flame',
    name: 'Ember',
    nameZh: '余烬',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'scorch', minRank: 2 }]],
    formula: { kind: 'scorch-duration', perRankSec: 0.5 },
  },
  {
    id: 'searing',
    branch: 'flame',
    name: 'Searing',
    nameZh: '灼热',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'kindling', minRank: 2 }]],
    formula: { kind: 'burn-crit-chance', perRank: 0.05 },
  },
  {
    id: 'wildfire',
    branch: 'flame',
    name: 'Wildfire',
    nameZh: '野火',
    kind: 'modifier',
    maxRank: 2,
    requiredLevel: 4,
    prereqGroups: [[{ nodeId: 'volatile-core', minRank: 2 }]],
    formula: { kind: 'splash-scorch', fractions: [0.5, 1.0] },
  },
  {
    id: 'heat-shimmer',
    branch: 'flame',
    name: 'Heat Shimmer',
    nameZh: '热浪',
    kind: 'passive',
    maxRank: 2,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'volatile-core', minRank: 1 }]],
    formula: { kind: 'projectile-speed-mul', active: 'magma', perRank: 0.15 },
  },
  {
    id: 'furnace-heart',
    branch: 'flame',
    name: 'Furnace Heart',
    nameZh: '熔炉之心',
    kind: 'capstone',
    maxRank: 1,
    requiredLevel: 6,
    prereqGroups: [[{ nodeId: 'hellfire-catalyst', minRank: 1 }]],
    formula: { kind: 'burn-kill-detonate', ratio: 0.5, radius: 2 },
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
  {
    id: 'frost-nova',
    branch: 'frost',
    name: 'Frost Nova',
    nameZh: '寒冰新星',
    kind: 'active',
    maxRank: 5,
    requiredLevel: 4,
    prereqGroups: [[{ nodeId: 'frost-fang', minRank: 3 }]],
    grantsActive: 'frost-nova',
    formula: { kind: 'active-rank-damage', active: 'frost-nova', perRankAbove1: 0.10 },
  },
  {
    id: 'rime',
    branch: 'frost',
    name: 'Rime',
    nameZh: '霜雾',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'permafrost', minRank: 2 }]],
    formula: { kind: 'slow-magnitude', perRank: 0.05 },
  },
  {
    id: 'piercing-cold',
    branch: 'frost',
    name: 'Piercing Cold',
    nameZh: '寒穿',
    kind: 'modifier',
    maxRank: 1,
    requiredLevel: 4,
    prereqGroups: [[{ nodeId: 'piercing-ice', minRank: 1 }]],
    formula: { kind: 'pierce', pierceCount: 1 },
  },
  {
    id: 'glacier-shards',
    branch: 'frost',
    name: 'Glacier Shards',
    nameZh: '冰川碎片',
    kind: 'modifier',
    maxRank: 2,
    requiredLevel: 4,
    prereqGroups: [[{ nodeId: 'shatter', minRank: 3 }]],
    formula: { kind: 'shatter-count-bonus', perRank: 1 },
  },
  {
    id: 'frozen-focus',
    branch: 'frost',
    name: 'Frozen Focus',
    nameZh: '冰霜专注',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'frost-fang', minRank: 3 }]],
    formula: { kind: 'mana-cost', active: 'frost', perRank: -0.5 },
  },
  {
    id: 'deep-freeze',
    branch: 'frost',
    name: 'Deep Freeze',
    nameZh: '深度冻结',
    kind: 'capstone',
    maxRank: 1,
    requiredLevel: 6,
    prereqGroups: [[{ nodeId: 'winters-grasp', minRank: 1 }]],
    formula: { kind: 'deep-freeze', damageMul: 1.15, refreshSlowSec: 0.5 },
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
  {
    id: 'discharge',
    branch: 'arcane',
    name: 'Discharge',
    nameZh: '静电释放',
    kind: 'active',
    maxRank: 5,
    requiredLevel: 4,
    prereqGroups: [[{ nodeId: 'arc-surge', minRank: 3 }]],
    grantsActive: 'discharge',
    formula: {
      kind: 'discharge-burst',
      perRankAbove1: 0.10,
      baseBolts: 6,
      boltsPerRank: 1,
    },
  },
  {
    id: 'resonance',
    branch: 'arcane',
    name: 'Resonance',
    nameZh: '共鸣',
    kind: 'passive',
    maxRank: 3,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'arc-surge', minRank: 3 }]],
    formula: { kind: 'arc-damage-mul', perRank: 0.06 },
  },
  {
    id: 'swift-phases',
    branch: 'arcane',
    name: 'Swift Phases',
    nameZh: '迅捷相位',
    kind: 'passive',
    maxRank: 2,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'phase-step', minRank: 1 }]],
    formula: { kind: 'cooldown', active: 'blink', perRankSec: -0.5 },
  },
  {
    id: 'echo-mastery',
    branch: 'arcane',
    name: 'Echo Mastery',
    nameZh: '回响精通',
    kind: 'modifier',
    maxRank: 2,
    requiredLevel: 4,
    prereqGroups: [[{ nodeId: 'phase-echo', minRank: 2 }]],
    formula: { kind: 'echo-mastery', windowPerRankSec: 0.5, damagePerRank: 0.05 },
  },
  {
    id: 'overcast',
    branch: 'arcane',
    name: 'Overcast',
    nameZh: '超频',
    kind: 'passive',
    maxRank: 2,
    requiredLevel: 1,
    prereqGroups: [[{ nodeId: 'conduction', minRank: 1 }]],
    formula: { kind: 'cooldown-mul', active: 'arc', perRank: -0.08 },
  },
  {
    id: 'tempest-conduit',
    branch: 'arcane',
    name: 'Tempest Conduit',
    nameZh: '风暴导管',
    kind: 'capstone',
    maxRank: 1,
    requiredLevel: 6,
    prereqGroups: [[{ nodeId: 'overcharge', minRank: 1 }]],
    formula: { kind: 'tempest-conduit', overchargeCapSec: 2, appliesTo: 'discharge' },
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
  ranks['magma-bolt'] = FREE_MAGMA_BOLT_RANK;
  return ranks;
}

/** Paid ranks only — free starter ranks (Frost Fang / Magma Bolt) are never refunded. */
export function paidRankCount(nodeId: SkillNodeId, rank: number): number {
  if (nodeId === 'frost-fang') return Math.max(0, rank - FREE_FROST_FANG_RANK);
  if (nodeId === 'magma-bolt') return Math.max(0, rank - FREE_MAGMA_BOLT_RANK);
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

function hotbarSkillLearned(
  skill: ActiveSkillId,
  ranks: Readonly<Partial<Record<SkillNodeId, number>>>,
  level: number,
): boolean {
  const levelUnlock = LEVEL_UNLOCK_ACTIVE[skill];
  if (levelUnlock !== undefined) return level >= levelUnlock;
  const nodeId = SKILL_NODE_BY_ACTIVE[skill];
  if (!nodeId) return false;
  return (ranks[nodeId] ?? 0) > 0;
}

/** Drop hotbar entries whose granting active is unlearned; keep Frost/Magma starters. */
export function sanitizeHotbar(
  ranks: Readonly<Partial<Record<SkillNodeId, number>>>,
  hotbar: HotbarSlots,
  selectedHotbarSlot: 0 | 1 | 2 | 3,
  level: number = 1,
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
    if (!hotbarSkillLearned(skill, ranks, level)) next[i] = null;
  }
  // Ensure free starter actives remain assignable after respec.
  if ((ranks['frost-fang'] ?? 0) > 0 && !next.some((s) => s === 'frost')) {
    const empty = next.findIndex((s) => s === null);
    if (empty >= 0) next[empty] = 'frost';
    else next[0] = 'frost';
  }
  if ((ranks['magma-bolt'] ?? 0) > 0 && !next.some((s) => s === 'magma')) {
    const empty = next.findIndex((s) => s === null);
    if (empty >= 0) next[empty] = 'magma';
  }
  let selected = selectedHotbarSlot;
  const selectedSkill = next[selected];
  if (!selectedSkill || !hotbarSkillLearned(selectedSkill, ranks, level)) {
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
 * Camp-only respec: refund paid ranks, keep free Frost Fang + Magma Bolt
 * starter ranks, clear unlearned hotbar actives, select a valid Frost slot.
 */
export function respecInCamp(state: SkillTreeState, areaId: AreaId): SkillTreeResult {
  if (areaId !== 'cinderwatch') return { ok: false, reason: 'not-in-camp' };

  const refund = totalPaidRanks(state.skillRanks);
  const ranks = emptySkillRanks();
  const sanitized = sanitizeHotbar(ranks, state.hotbar, state.selectedHotbarSlot, state.level);
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

/** Clamp persisted ranks to tree max + enforce free starter ranks. */
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
  ranks['magma-bolt'] = Math.max(FREE_MAGMA_BOLT_RANK, ranks['magma-bolt']);
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
  const level = Math.max(1, input.level);
  const sanitized = sanitizeHotbar(ranks, input.hotbar, input.selectedHotbarSlot, level);
  return {
    level,
    unspentSkillPoints: Math.max(0, input.unspentSkillPoints),
    skillRanks: ranks,
    hotbar: sanitized.hotbar,
    selectedHotbarSlot: sanitized.selectedHotbarSlot,
  };
}
