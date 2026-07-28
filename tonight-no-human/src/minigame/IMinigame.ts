import type { MatchContext } from '../session/MatchContext';
import type { MinigameResult, MinigameType, PlayerInput } from '../shared/types';

export interface MinigameTags {
  type: MinigameType;
  scene: string[];
  mech: string[];
}

/**
 * Plugin contract — architecture §5.1.
 * settle() is Host-only; result is broadcast.
 */
export interface IMinigame {
  id: string;
  tags: MinigameTags;
  load(ctx: MatchContext): Promise<void>;
  start(seed: number): void;
  tick(dt: number, inputs: PlayerInput[]): void;
  settle(): MinigameResult;
  dispose?(): void;
}
