// Stable content IDs for the Sorceress Act-1 vertical slice.
// Import these rather than redeclaring string unions in save/skill/quest modules.

export type ActiveSkillId =
  | 'magma' | 'frost' | 'arc' | 'blink' | 'inferno-nova'
  | 'flame-burst' | 'frost-nova' | 'discharge';

/** Four saved RMB hotbar slots (null = empty). */
export type HotbarSlots = readonly [
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
  ActiveSkillId | null,
];

export type SkillNodeId =
  | 'magma-bolt' | 'kindling' | 'scorch' | 'volatile-core' | 'hellfire-catalyst'
  | 'flame-burst' | 'ember' | 'searing' | 'wildfire' | 'heat-shimmer' | 'furnace-heart'
  | 'frost-fang' | 'permafrost' | 'piercing-ice' | 'shatter' | 'winters-grasp'
  | 'frost-nova' | 'rime' | 'piercing-cold' | 'glacier-shards' | 'frozen-focus' | 'deep-freeze'
  | 'arc-surge' | 'conduction' | 'phase-step' | 'phase-echo' | 'overcharge'
  | 'discharge' | 'resonance' | 'swift-phases' | 'echo-mastery' | 'overcast' | 'tempest-conduit';

export const SKILL_NODE_IDS: readonly SkillNodeId[] = [
  'magma-bolt', 'kindling', 'scorch', 'volatile-core', 'hellfire-catalyst',
  'flame-burst', 'ember', 'searing', 'wildfire', 'heat-shimmer', 'furnace-heart',
  'frost-fang', 'permafrost', 'piercing-ice', 'shatter', 'winters-grasp',
  'frost-nova', 'rime', 'piercing-cold', 'glacier-shards', 'frozen-focus', 'deep-freeze',
  'arc-surge', 'conduction', 'phase-step', 'phase-echo', 'overcharge',
  'discharge', 'resonance', 'swift-phases', 'echo-mastery', 'overcast', 'tempest-conduit',
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
