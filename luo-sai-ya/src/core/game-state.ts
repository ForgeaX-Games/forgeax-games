import {
  DEV_DECK,
  HUMAN_PLAYER,
  MAX_ROADS,
  NUM_PLAYERS,
} from './constants';
import { buildBoardGraph, formatBoardSummary } from './map';
import type { DevCard, GameState, HarvestGainEvent, PlayerState, ResourceBag } from './types';

function emptyResources(): ResourceBag {
  return { wood: 0, brick: 0, ore: 0, wheat: 0, sheep: 0 };
}

function createPlayer(id: number): PlayerState {
  return {
    id,
    name: id === HUMAN_PLAYER ? '玩家 1（你）' : `玩家 ${id + 1}`,
    isHuman: id === HUMAN_PLAYER,
    resources: emptyResources(),
    roadsLeft: MAX_ROADS,
    villagesLeft: 5,
    townsLeft: 5,
    devCards: [],
    knightsPlayed: 0,
    shownCards: [],
    buildingVp: 0,
    devVp: 0,
    achievementVp: 0,
  };
}

function shuffleDeck<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function createGameState(): GameState {
  const board = buildBoardGraph();
  return {
    phase: 'init',
    round: 0,
    board,
    players: Array.from({ length: NUM_PLAYERS }, (_, i) => createPlayer(i)),
    placements: { villages: new Map(), towns: new Set(), roads: new Set(), roadOwners: new Map() },
    currentPlayer: 0,
    setupPlayerIndex: 0,
    setupPlacementRound: 1,
    setupVillageVertex: null,
    lastDice: null,
    diceSum: 0,
    robberTileId: board.robberTileId,
    blockedTileId: null,
    devDeck: shuffleDeck([...DEV_DECK]),
    longestRoadPlayer: null,
    largestArmyPlayer: null,
    pendingDiscard: [],
    log: ['欢迎来到洛塞娅！'],
    nextButtonLabel: '确认放置村庄（1/2）',
    gameEnded: false,
    winnerId: null,
    selectedVertex: null,
    selectedEdge: null,
    selectedTileId: null,
    humanDevelopMode: 'idle',
    pendingDevCardIndex: null,
    skipConfirm: true,
    lastHarvestGains: [],
  };
}

export function appendLog(state: GameState, line: string): void {
  state.log.push(line);
  console.log(`[洛塞娅] ${line}`);
  if (state.log.length > 300) state.log.shift();
}

export function emitStage(state: GameState, title: string, lines: string[]): void {
  appendLog(state, `━━ ${title} ━━`);
  for (const l of lines) appendLog(state, l);
}

export function totalResources(r: ResourceBag): number {
  return r.wood + r.brick + r.ore + r.wheat + r.sheep;
}

export function playerTotalVp(p: PlayerState): number {
  return p.buildingVp + p.devVp + p.achievementVp;
}

export function generateMap(state: GameState): void {
  state.board = buildBoardGraph();
  state.robberTileId = state.board.robberTileId;
  state.phase = 'map_ready';
  state.nextButtonLabel = '开始开局（轮流空降）';
  emitStage(state, '地图生成完成', formatBoardSummary(state.board));
}

export function drawDevCard(state: GameState, player: PlayerState): DevCard | null {
  const kind = state.devDeck.pop();
  if (!kind) {
    appendLog(state, '发展卡牌库已空');
    return null;
  }
  const card: DevCard = { kind, played: false };
  player.devCards.push(card);
  return card;
}
