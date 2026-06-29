import type { COLOR_INFO } from './constants';

export type TileColor = 0 | 1 | 2 | 3 | 4;

export type GamePhase =
  | 'init'
  | 'round_start'      // show round info, wait next
  | 'take_turn'        // current player must take (human UI or AI pending)
  | 'take_resolve'     // AI/human action queued, wait confirm
  | 'scoring_preview'  // all tiles taken, show before scoring
  | 'scoring'          // run scoring animation/log
  | 'round_end'        // between rounds
  | 'game_over';

export type TakeSource =
  | { kind: 'factory'; index: number }
  | { kind: 'center' };

export interface TakeAction {
  source: TakeSource;
  color: TileColor;
  targetRow: number;
}

export interface PatternRow {
  color: TileColor | null;
  tiles: TileColor[];
}

export interface PlayerState {
  id: number;
  name: string;
  isHuman: boolean;
  patternRows: PatternRow[];
  /** wall[row][col] = placed */
  wall: boolean[][];
  floorLine: TileColor[];
  plusOneOnFloor: boolean;
  /** Visual floor slot index where +1 sits (after tiles present when it was claimed) */
  plusOneFloorSlot: number;
  score: number;
}

export interface PlayerEndgameSummary {
  playerId: number;
  scoreBeforeEndgame: number;
  endgameRows: number;
  endgameCols: number;
  endgameColors: number;
  endgameBonus: number;
  finalScore: number;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  bag: TileColor[];
  /** Used tiles returned after scoring — refills bag when empty */
  discard: TileColor[];
  factories: TileColor[][];
  center: TileColor[];
  hasPlusOneInCenter: boolean;
  players: PlayerState[];
  currentPlayer: number;
  firstPlayer: number;
  plusOneHolder: number | null;
  log: string[];
  pendingAction: TakeAction | null;
  gameEnded: boolean;
  winnerId: number | null;
  /** UI hint for next button */
  nextButtonLabel: string;
  /** Populated when endgame scoring runs — for results modal */
  endgameSummary: PlayerEndgameSummary[] | null;
}

export type ColorInfo = (typeof COLOR_INFO)[number];
