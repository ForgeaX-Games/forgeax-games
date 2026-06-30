import { appendLog, allFactoriesEmpty, createGameState, refillFactories } from '../core/game-state';
import {
  advanceToNextPlayer,
  anyValidTakeExists,
  executeTake,
  findWinner,
  isValidTake,
  runEndgameScoring,
  runScoringPhase,
  skipPlayerTurn,
} from '../core/rules';
import type { GameState, TakeAction } from '../core/types';
import { pickAiAction } from './ai';

export function startGame(state: GameState): void {
  state.phase = 'round_start';
  state.nextButtonLabel = '开始拿取阶段';
  appendLog(state, `—— 第 ${state.round} 轮开始 ——`);
  appendLog(
    state,
    `起始玩家：${state.players[state.firstPlayer]!.name}` +
      (state.plusOneHolder !== null ? `（上轮拿到 +1 标记）` : '（随机决定）'),
  );
  state.currentPlayer = state.firstPlayer;
}

export function beginTakePhase(state: GameState): void {
  state.phase = 'take_turn';
  state.pendingAction = null;
  updateTakeButton(state);
  appendLog(state, `拿取阶段：轮到 ${state.players[state.currentPlayer]!.name}`);
}

function updateTakeButton(state: GameState): void {
  const p = state.players[state.currentPlayer]!;
  if (p.isHuman) {
    state.nextButtonLabel = state.pendingAction ? '确认拿取' : '（点击棋盘预选）';
  } else {
    state.nextButtonLabel = '执行 AI 拿取';
  }
}

export function queueHumanAction(state: GameState, action: TakeAction): boolean {
  const check = isValidTake(state, action);
  if (!check.ok) {
    appendLog(state, `无效操作：${check.reason}`);
    return false;
  }
  state.pendingAction = action;
  state.nextButtonLabel = '确认拿取';
  const src = action.source.kind === 'factory' ? `工厂盘 ${action.source.index + 1}` : '中央区域';
  const cname = ['蓝', '黄', '红', '黑', '白'][action.color]!;
  appendLog(state, `预选：从${src}拿${cname} → 图案行 ${action.targetRow + 1}`);
  return true;
}

export type TakePrepareResult = 'pending' | 'human_wait' | 'skipped';

/** Pick AI action into pendingAction, or skip turn when AI cannot move */
export function prepareTakeTurn(state: GameState): TakePrepareResult {
  if (state.pendingAction) return 'pending';
  const p = state.players[state.currentPlayer]!;
  if (p.isHuman) return 'human_wait';
  const action = pickAiAction(state);
  if (!action) {
    skipPlayerTurn(state);
    afterTakeResolved(state);
    return 'skipped';
  }
  state.pendingAction = action;
  return 'pending';
}

/** Apply pendingAction after flight animation (human or AI) */
export function finalizePendingTake(state: GameState): boolean {
  if (!state.pendingAction) return false;

  const check = isValidTake(state, state.pendingAction);
  if (!check.ok) {
    appendLog(state, `无法执行：${check.reason}`);
    state.pendingAction = null;
    updateTakeButton(state);
    return false;
  }

  executeTake(state, state.pendingAction);
  state.pendingAction = null;
  return afterTakeResolved(state);
}

export function resolveCurrentTake(state: GameState): boolean {
  const prep = prepareTakeTurn(state);
  if (prep === 'skipped') return true;
  if (prep === 'human_wait' || !state.pendingAction) return false;
  return finalizePendingTake(state);
}

function afterTakeResolved(state: GameState): boolean {
  if (allFactoriesEmpty(state)) {
    state.phase = 'scoring_preview';
    state.nextButtonLabel = '进入计分阶段';
    appendLog(state, '所有花砖已拿完，准备计分。');
    return true;
  }

  advanceToNextPlayer(state);

  // Skip players with no valid moves
  let guard = 0;
  while (!anyValidTakeExists(state) && guard < state.players.length) {
    skipPlayerTurn(state);
    advanceToNextPlayer(state);
    guard++;
  }

  if (allFactoriesEmpty(state)) {
    state.phase = 'scoring_preview';
    state.nextButtonLabel = '进入计分阶段';
    return true;
  }

  state.phase = 'take_turn';
  updateTakeButton(state);
  appendLog(state, `轮到 ${state.players[state.currentPlayer]!.name}`);
  return true;
}

export function runScoring(state: GameState): void {
  state.phase = 'scoring';
  const ended = runScoringPhase(state);

  if (ended) {
    runEndgameScoring(state);
    state.gameEnded = true;
    state.winnerId = findWinner(state);
    state.phase = 'game_over';
    const w = state.players[state.winnerId]!;
    appendLog(state, `游戏结束！${w.name} 获胜，${w.score} 分`);
    state.nextButtonLabel = '重新开始';
    return;
  }

  state.phase = 'round_end';
  state.nextButtonLabel = '开始下一轮';
  appendLog(state, `第 ${state.round} 轮结束，无人完成整行墙。`);
}

export function startNextRound(state: GameState): void {
  state.round++;
  if (state.plusOneHolder !== null) {
    state.firstPlayer = state.plusOneHolder;
    state.plusOneHolder = null;
  } else {
    state.firstPlayer = Math.floor(Math.random() * state.players.length);
  }
  state.currentPlayer = state.firstPlayer;
  refillFactories(state);
  state.phase = 'round_start';
  state.nextButtonLabel = '开始拿取阶段';
  appendLog(state, `—— 第 ${state.round} 轮开始 ——`);
  appendLog(state, `起始玩家：${state.players[state.firstPlayer]!.name}`);
}

/** Main advance handler for the next-phase button */
export function advancePhase(state: GameState): void {
  switch (state.phase) {
    case 'init':
      startGame(state);
      break;
    case 'round_start':
      beginTakePhase(state);
      break;
    case 'take_turn':
      // Resolved in main.ts: prepareTakeTurn → flight animation → finalizePendingTake
      break;
    case 'take_resolve':
      finalizePendingTake(state);
      break;
    case 'scoring_preview':
      runScoring(state);
      break;
    case 'round_end':
      startNextRound(state);
      break;
    case 'game_over': {
      const fresh = createGameState();
      Object.assign(state, fresh);
      break;
    }
    default:
      break;
  }
}
