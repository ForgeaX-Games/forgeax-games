import type { PortKind, ResourceType, TerrainType } from './constants';

export type GamePhase =
  | 'init'
  | 'map_ready'
  | 'setup_village'
  | 'setup_road'
  | 'turn_roll'
  | 'turn_harvest'
  | 'turn_robber_discard'
  | 'turn_robber_move'
  | 'turn_robber_steal'
  | 'turn_develop'
  | 'game_over';

export type BuildingKind = 'road' | 'village' | 'town';

export type DevCardKind = 'knight' | 'university' | 'monopoly';

export interface BoardTile {
  id: number;
  q: number;
  r: number;
  terrain: TerrainType;
  number: number | null;
}

export interface Vertex {
  id: string;
  x: number;
  y: number;
  tileIds: number[];
  port: PortKind | null;
}

export interface Edge {
  id: string;
  v1: string;
  v2: string;
  tileIds: number[];
}

export interface BoardGraph {
  tiles: BoardTile[];
  vertices: Map<string, Vertex>;
  edges: Map<string, Edge>;
  robberTileId: number;
}

export interface ResourceBag {
  wood: number;
  brick: number;
  ore: number;
  wheat: number;
  sheep: number;
}

export interface DevCard {
  kind: DevCardKind;
  played: boolean;
}

export interface PlayerState {
  id: number;
  name: string;
  isHuman: boolean;
  resources: ResourceBag;
  roadsLeft: number;
  villagesLeft: number;
  townsLeft: number;
  devCards: DevCard[];
  knightsPlayed: number;
  /** Displayed dev cards (played) */
  shownCards: DevCardKind[];
  buildingVp: number;
  devVp: number;
  achievementVp: number;
}

export interface Placements {
  villages: Map<string, number>;
  towns: Set<string>;
  roads: Set<string>;
  roadOwners: Map<string, number>;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  board: BoardGraph;
  players: PlayerState[];
  placements: Placements;
  currentPlayer: number;
  setupPlayerIndex: number;
  /** 当前玩家开局第几轮（1 或 2）：每轮 1 村庄 + 1 道路 */
  setupPlacementRound: 1 | 2;
  setupVillageVertex: string | null;
  lastDice: [number, number] | null;
  diceSum: number;
  robberTileId: number;
  blockedTileId: number | null;
  devDeck: DevCardKind[];
  longestRoadPlayer: number | null;
  largestArmyPlayer: number | null;
  pendingDiscard: number[];
  log: string[];
  nextButtonLabel: string;
  gameEnded: boolean;
  winnerId: number | null;
  /** Human selection during setup / build */
  selectedVertex: string | null;
  selectedEdge: string | null;
  selectedTileId: number | null;
  /** Human develop sub-mode */
  humanDevelopMode: 'idle' | 'road' | 'village' | 'upgrade' | 'trade' | 'knight' | 'monopoly';
  /** 待完成的垄断卡索引 */
  pendingDevCardIndex: number | null;
  /** 为 true 时地图选点即确认，并自动推进无需点选的步骤 */
  skipConfirm: boolean;
  /** 最近一次收割明细（UI 跳动用） */
  lastHarvestGains: HarvestGainEvent[];
}

export type ResourceKey = keyof ResourceBag;

/** 单次骰子收割产出（供 UI 动画） */
export interface HarvestGainEvent {
  playerId: number;
  resource: ResourceKey;
  amount: number;
}
