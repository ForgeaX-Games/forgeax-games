import type { IMinigame, MinigameTags } from '../IMinigame';
import type { MinigameType } from '../../shared/types';

/**
 * Library entry — metadata for the expandable minigame pool.
 * Runtime factory is optional until status === 'shipped' | 'stub'.
 */
export type MinigameStatus = 'planned' | 'stub' | 'shipped';

export interface MinigameLibraryEntry {
  id: string;
  /** Display title (zh) */
  title: string;
  chapterIds: string[];
  /** Demo node id like M1 — optional */
  nodeId?: string;
  tags: MinigameTags;
  status: MinigameStatus;
  /** One-line rule shown before Start */
  oneLiner: string;
  /** content/minigames/<id> */
  contentRoot: string;
  /** Soft target duration; hard cap still GAME_CONFIG.minigameHardCapSec */
  targetDurationSec: number;
  /** Demo priority */
  priority: 'P0' | 'P1' | 'P2';
  /** Factory — required for stub/shipped to be playable */
  create?: () => IMinigame;
}

export function tags(
  type: MinigameType,
  scene: string[],
  mech: string[],
): MinigameTags {
  return { type, scene, mech };
}
