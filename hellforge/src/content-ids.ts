// Stable content IDs for the Sorceress Act-1 vertical slice.
// Import these rather than redeclaring string unions in save/skill/quest modules.

export type ActiveSkillId = 'magma' | 'frost' | 'arc' | 'blink';

/** Four saved RMB hotbar slots (null = empty). */
export type HotbarSlots = readonly [
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
];

export type SkillNodeId =
  | 'magma-bolt' | 'kindling' | 'scorch' | 'volatile-core' | 'hellfire-catalyst'
  | 'frost-fang' | 'permafrost' | 'piercing-ice' | 'shatter' | 'winters-grasp'
  | 'arc-surge' | 'conduction' | 'phase-step' | 'phase-echo' | 'overcharge';

export const SKILL_NODE_IDS: readonly SkillNodeId[] = [
  'magma-bolt', 'kindling', 'scorch', 'volatile-core', 'hellfire-catalyst',
  'frost-fang', 'permafrost', 'piercing-ice', 'shatter', 'winters-grasp',
  'arc-surge', 'conduction', 'phase-step', 'phase-echo', 'overcharge',
] as const;

export type QuestId = 'purge-slagdeep-hollow';
export type QuestStatus = 'available' | 'active' | 'ready' | 'completed';

export type AreaId = 'cinderwatch' | 'ashen-reach' | 'slagdeep-hollow';
export type AreaExitId =
  | 'cinderwatch-to-reach' | 'reach-to-cinderwatch'
  | 'reach-to-slagdeep' | 'slagdeep-to-reach';

export type NpcId = 'npc-cinderwarden-veyra';

export type InteractionRef =
  | { kind: 'monster'; id: string }
  | { kind: 'npc'; id: NpcId }
  | { kind: 'loot'; id: string }
  | { kind: 'exit'; id: AreaExitId };

export interface QuestSave {
  readonly status: QuestStatus;
}

/** Sole playable class for this slice. */
export const PLAYABLE_CLASS_ID = 'sorceress' as const;
export type PlayableClassId = typeof PLAYABLE_CLASS_ID;
