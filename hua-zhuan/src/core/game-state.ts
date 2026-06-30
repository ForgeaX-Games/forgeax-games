import { HUMAN_PLAYER, NUM_PLAYERS, ROW_CAPACITIES, WALL_COLS, WALL_ROWS } from './constants';
import { createBag, dealFactoriesWithRecycle } from './bag';
import type { GameState, PatternRow, PlayerState, TileColor } from './types';

function emptyPatternRows(): PatternRow[] {
  return ROW_CAPACITIES.map((cap) => ({ color: null, tiles: [] }));
}

function emptyWall(): boolean[][] {
  return Array.from({ length: WALL_ROWS }, () => Array(WALL_COLS).fill(false));
}

const SCREEN_NAMES = ['左上', '右上', '左下', '右下'] as const;

function createPlayer(id: number): PlayerState {
  const isHuman = id === HUMAN_PLAYER;
  return {
    id,
    name: isHuman ? `你（${SCREEN_NAMES[id]}）` : `${SCREEN_NAMES[id]} · AI`,
    isHuman,
    patternRows: emptyPatternRows(),
    wall: emptyWall(),
    floorLine: [],
    plusOneOnFloor: false,
    plusOneFloorSlot: 0,
    score: 0,
  };
}

export function createGameState(): GameState {
  const bag = createBag();
  const { bag: remaining, factories } = dealFactoriesWithRecycle(bag, []);
  const firstPlayer = Math.floor(Math.random() * NUM_PLAYERS);
  return {
    phase: 'init',
    round: 1,
    bag: remaining,
    discard: [],
    factories,
    center: [],
    hasPlusOneInCenter: true,
    players: Array.from({ length: NUM_PLAYERS }, (_, i) => createPlayer(i)),
    currentPlayer: firstPlayer,
    firstPlayer,
    plusOneHolder: null,
    log: ['欢迎来到花砖物语！点击「开始游戏」发牌并开始第 1 轮。'],
    pendingAction: null,
    gameEnded: false,
    winnerId: null,
    nextButtonLabel: '开始游戏',
    endgameSummary: null,
  };
}

export function appendLog(state: GameState, line: string): void {
  state.log.push(line);
  if (state.log.length > 200) state.log.shift();
}

export function refillFactories(state: GameState): void {
  const { bag, discard, factories, recycled } = dealFactoriesWithRecycle(state.bag, state.discard);
  state.bag = bag;
  state.discard = discard;
  state.factories = factories;
  state.center = [];
  state.hasPlusOneInCenter = true;

  const dealt = factories.reduce((n, f) => n + f.length, 0);
  if (recycled > 0) {
    appendLog(state, `布袋不足，从弃砖堆洗入 ${recycled} 块`);
  }
  appendLog(state, `工厂盘补充 ${dealt} 块花砖（布袋剩余 ${bag.length}，弃砖堆 ${discard.length}）`);
  if (dealt === 0) {
    appendLog(state, '⚠ 无砖可发，请检查弃砖回收');
  }
}

export function tilesRemaining(state: GameState): number {
  let n = state.center.length;
  for (const f of state.factories) n += f.length;
  return n;
}

export function allFactoriesEmpty(state: GameState): boolean {
  return state.factories.every((f) => f.length === 0) && state.center.length === 0;
}

export function factoryHasColor(factory: TileColor[], color: number): boolean {
  return factory.some((t) => t === color);
}
