/** Shared domain types for 《今晚别变回人》. */

export type PlayerId = string;
export type RoomCode = string; // 4-char

export type CandyRole = 'soft' | 'melt' | 'hard' | 'burst';

export type MinigameType = 'coop' | 'ffa' | '2v2' | '3v1';

export type ElementTag = 'glue' | 'fat' | 'crystal' | 'gas';

/** Match phase — mirrors architecture §4.4 session state machine. */
export type MatchPhase =
  | 'Lobby'
  | 'LoadingCutscene'
  | 'CauldronCasting'
  | 'RoleReveal'
  | 'NarrativePlay'
  | 'MinigameLoad'
  | 'MinigamePlay'
  | 'NodeSettle'
  | 'FinaleNarrative'
  | 'MatchResult';

export interface PlayerSlot {
  id: PlayerId;
  displayName: string;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
  /** Sugar coat remaining (0 = ghost). */
  sugarCoat: number;
  role?: CandyRole;
  isGhost: boolean;
}

export interface MaterialCard {
  id: string;
  name: string;
  element: ElementTag;
  rarity: 1 | 2 | 3;
  flavorTags: string[];
}

export interface CastSubmission {
  playerId: PlayerId;
  cardIds: [string, string, string];
  confirmedAt: number;
}

export interface RoleAssignment {
  /** Forced one-of-each mapping player → role. */
  mapping: Record<PlayerId, CandyRole>;
  seed: number;
}

export interface VoteBallot {
  playerId: PlayerId;
  optionId: string;
}

export interface VoteResult {
  winningOptionId: string;
  tallies: Record<string, number>;
  tieBrokenByDice: boolean;
}

export interface CluePayload {
  clueId: string;
  /** Only the target player may receive the body. */
  targetPlayerId: PlayerId;
  body: string;
}

export interface PlayerInput {
  playerId: PlayerId;
  frame: number;
  axes: { x: number; y: number };
  actions: Record<string, boolean>;
}

export interface MinigameResult {
  rankings: PlayerId[];
  survivors: PlayerId[];
  sugarDelta: Record<PlayerId, number>;
  titleEvents: string[];
}

export interface NodeDef {
  id: string;
  title: string;
  narrativeId?: string;
  minigameId: string;
  type: MinigameType;
}

export interface ChapterDef {
  id: string;
  title: string;
  unlocked: boolean;
  nodes: NodeDef[];
  materialTheme: string;
  dmSkinId: string;
}
