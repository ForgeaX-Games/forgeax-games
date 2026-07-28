import type { PlayerId, PlayerInput } from '../shared/types';
import type { RoomState } from './RoomState';
import type { SeedService } from './SeedService';
import type { NetHost } from '../net/NetHost';
import type { ChapterDef, NodeDef } from '../shared/types';

/**
 * Shared runtime bag passed into cauldron / narrative / minigames.
 * Host owns authority; clients mostly read + submit inputs.
 */
export interface MatchContext {
  localPlayerId: PlayerId;
  isHost: boolean;
  room: RoomState;
  seed: SeedService;
  net: NetHost;
  chapter: ChapterDef;
  nodeIndex: number;
  currentNode: NodeDef | null;
  /** Latest inputs this frame (Host merges client reports). */
  inputs: PlayerInput[];
  nowMs: () => number;
}
