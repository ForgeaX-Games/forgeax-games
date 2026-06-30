import {
  appendLog,
  createGameState,
  emitStage,
  generateMap,
} from '../core/game-state';
import {
  canHumanBuildRoad,
  canHumanBuildVillage,
  canHumanUpgradeTown,
  devCardLabel,
  formatPlayerStatus,
  formatResources,
  harvestForDice,
  isValidRobberTile,
  moveRobber,
  pickRobberVictim,
  playKnight,
  playMonopoly,
  playUniversity,
  placeSetupRoad,
  placeSetupVillage,
  rollDice,
  runRobberDiscard,
  setupHarvest,
  stealFrom,
  tryBankTrade,
  tryBuildRoad,
  tryBuildVillage,
  playDevCardUniversity,
  startDevCardKnight,
  startDevCardMonopoly,
  completeDevCardKnight,
  completeDevCardMonopoly,
  tryBuyDevCard,
  tryPlayerTrade,
  tryUpgradeTown,
  checkWin,
} from '../core/rules';
import type { GameState, ResourceBag, ResourceKey, GamePhase } from '../core/types';
import {
  aiAcceptsTrade,
  pickDevelopAction,
  pickRobberTile,
  pickRoadForPlayer,
  pickSetupRoad,
  pickSetupVillage,
} from './ai';

export function isHumanActive(state: GameState): boolean {
  if (state.phase.startsWith('setup')) {
    return state.players[state.setupPlayerIndex]?.isHuman ?? false;
  }
  return state.players[state.currentPlayer]?.isHuman ?? false;
}

function clearHumanSelection(state: GameState): void {
  state.selectedVertex = null;
  state.selectedEdge = null;
  state.selectedTileId = null;
  state.humanDevelopMode = 'idle';
  state.pendingDevCardIndex = null;
}

function advanceSetupPlayer(state: GameState): void {
  clearHumanSelection(state);
  state.setupPlayerIndex++;
  state.setupPlacementRound = 1;
  if (state.setupPlayerIndex >= state.players.length) {
    state.phase = 'turn_roll';
    state.round = 1;
    state.currentPlayer = 0;
    state.nextButtonLabel = '掷骰子（第 1 轮）';
    emitStage(state, '开局完成', [
      '四名玩家均已空降 2 村庄 + 2 道路',
      ...state.players.map((_, i) => formatPlayerStatus(state, i)),
    ]);
    return;
  }
  state.phase = 'setup_village';
  state.currentPlayer = state.setupPlayerIndex;
  state.setupVillageVertex = null;
  const p = state.players[state.setupPlayerIndex]!;
  state.nextButtonLabel = p.isHuman ? '确认放置村庄（1/2）' : `玩家 ${state.setupPlayerIndex + 1} 空降村庄（1/2）`;
  appendLog(state, `—— 轮到 ${p.name} 开局 ——`);
}

/** 新游戏进入后自动完成地图生成并进入开局阶段（跳过手动点「生成地图」） */
export function bootstrapNewGame(state: GameState): void {
  if (state.phase !== 'init') return;
  generateMap(state);
  beginSetup(state);
}

export function beginSetup(state: GameState): void {
  state.phase = 'setup_village';
  state.setupPlayerIndex = 0;
  state.setupPlacementRound = 1;
  state.currentPlayer = 0;
  state.nextButtonLabel = '确认放置村庄（1/2）';
  emitStage(state, '开局阶段', [
    '四名玩家轮流：每轮空降 1 村庄 + 1 道路，共两轮（合计 2 村庄 + 2 道路）',
    '道路须与己方村庄或已有道路相邻，可沿道路延伸',
    '你的回合：点击地图顶点选位置，再点确认',
  ]);
}

function resolveSetupVillage(state: GameState): void {
  const pid = state.setupPlayerIndex;
  const p = state.players[pid]!;
  let vtx = state.selectedVertex;

  if (p.isHuman) {
    if (!vtx) {
      appendLog(state, '请先在地图上点击选择村庄位置');
      return;
    }
    if (!placeSetupVillage(state, pid, vtx)) return;
  } else {
    vtx = pickSetupVillage(state, pid);
    if (!vtx || !placeSetupVillage(state, pid, vtx)) {
      appendLog(state, '无法放置村庄，跳过');
      advanceSetupPlayer(state);
      return;
    }
  }

  setupHarvest(state, pid, vtx);
  state.selectedVertex = null;
  state.phase = 'setup_road';
  const round = state.setupPlacementRound;
  state.nextButtonLabel = p.isHuman
    ? `确认放置道路（${round}/2）`
    : `${p.name} 放置道路（${round}/2）`;
}

function resolveSetupRoad(state: GameState): void {
  const pid = state.setupPlayerIndex;
  const p = state.players[pid]!;
  let edge = state.selectedEdge;

  if (p.isHuman) {
    if (!edge) {
      appendLog(state, '请先在地图上点击选择道路（须与己方村庄或道路相邻的黄线）');
      return;
    }
    if (!placeSetupRoad(state, pid, edge)) return;
  } else {
    edge = pickSetupRoad(state, pid);
    if (!edge || !placeSetupRoad(state, pid, edge)) {
      appendLog(state, '无法放置道路');
    }
  }

  state.selectedEdge = null;
  const round = state.setupPlacementRound;
  if (round === 1) {
    state.setupPlacementRound = 2;
    state.phase = 'setup_village';
    state.nextButtonLabel = p.isHuman ? '确认放置村庄（2/2）' : `${p.name} 空降村庄（2/2）`;
  } else {
    advanceSetupPlayer(state);
  }
}

function resolveRoll(state: GameState): void {
  const p = state.players[state.currentPlayer]!;
  const [d1, d2] = rollDice(state);
  emitStage(state, `第 ${state.round} 轮 · ${p.name} 掷骰`, [
    `骰子：${d1} + ${d2} = ${state.diceSum}`,
  ]);

  if (state.diceSum === 7) {
    state.phase = 'turn_robber_discard';
    state.nextButtonLabel = '强盗事件：弃牌判定';
    appendLog(state, '掷出 7 → 强盗事件！');
    return;
  }

  state.phase = 'turn_harvest';
  state.nextButtonLabel = '收割资源';
}

function resolveHarvest(state: GameState): void {
  harvestForDice(state, state.diceSum);
  enterDevelopPhase(state);
}

function enterDevelopPhase(state: GameState): void {
  const p = state.players[state.currentPlayer]!;
  state.phase = 'turn_develop';
  state.humanDevelopMode = 'idle';
  clearHumanSelection(state);
  if (p.isHuman) {
    state.nextButtonLabel = '结束回合';
    appendLog(state, `${p.name} 自由发展：可交易 / 建道路 / 建村庄 / 升级城镇 / 买发展卡`);
  } else {
    state.nextButtonLabel = 'AI 行动';
  }
}

function resolveRobberDiscard(state: GameState): void {
  runRobberDiscard(state);
  state.phase = 'turn_robber_move';
  const p = state.players[state.currentPlayer]!;
  state.nextButtonLabel = p.isHuman ? '确认移动强盗' : '移动强盗';
  if (p.isHuman) appendLog(state, '点击地图上的资源格移动强盗（沙漠除外）');
}

function resolveRobberMove(state: GameState): void {
  const thief = state.currentPlayer;
  const p = state.players[thief]!;
  let tile: number;

  if (p.isHuman) {
    if (state.selectedTileId === null || !isValidRobberTile(state, state.selectedTileId)) {
      appendLog(state, '请先点击地图选择强盗目标格');
      return;
    }
    tile = state.selectedTileId;
  } else {
    tile = pickRobberTile(state);
  }

  moveRobber(state, tile);
  state.selectedTileId = null;
  state.phase = 'turn_robber_steal';
  state.nextButtonLabel = '掠夺资源';
}

function resolveRobberSteal(state: GameState): void {
  const thief = state.currentPlayer;
  const victim = pickRobberVictim(state, thief);
  if (victim !== null) stealFrom(state, thief, victim);
  else appendLog(state, '强盗格旁无其他玩家村庄，跳过掠夺');
  enterDevelopPhase(state);
}

function resolveDevelopAi(state: GameState): void {
  const pid = state.currentPlayer;
  const p = state.players[pid]!;
  const lines: string[] = [`${p.name} 资源：${formatResources(p.resources)}`];

  const action = pickDevelopAction(state, pid);
  if (action === 'road') {
    const eid = pickRoadForPlayer(state, pid);
    if (eid && tryBuildRoad(state, pid, eid)) lines.push(`  → 建造道路 ${eid}`);
  } else if (action === 'dev') {
    if (tryBuyDevCard(state, pid)) {
      const card = p.devCards[p.devCards.length - 1];
      if (card && !card.played) {
        card.played = true;
        if (card.kind === 'university') playUniversity(state, pid);
        else if (card.kind === 'knight') playKnight(state, pid);
        else if (card.kind === 'monopoly') {
          const kinds = ['wood', 'brick', 'ore', 'wheat', 'sheep'] as const;
          playMonopoly(state, pid, kinds[Math.floor(Math.random() * kinds.length)]!);
        }
        lines.push(`  → 购买并打出 ${devCardLabel(card.kind)}`);
      }
    }
  } else {
    lines.push('  → 跳过建造/购买');
  }

  emitStage(state, '自由发展阶段', lines);
  finishTurn(state);
}

function finishTurn(state: GameState): void {
  if (checkWin(state)) return;

  clearHumanSelection(state);
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  if (state.currentPlayer === 0) state.round++;
  state.phase = 'turn_roll';
  const next = state.players[state.currentPlayer]!;
  state.nextButtonLabel = next.isHuman
    ? `掷骰子（第 ${state.round} 轮 · 你的回合）`
    : `掷骰子（第 ${state.round} 轮 · ${next.name}）`;
  appendLog(state, `—— 轮到 ${next.name} ——`);
}

export function humanEndTurn(state: GameState): void {
  const p = state.players[state.currentPlayer]!;
  emitStage(state, '自由发展阶段', [`${p.name} 结束回合`]);
  finishTurn(state);
}

export function humanBuyDevCard(state: GameState): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  if (!tryBuyDevCard(state, pid)) {
    appendLog(state, '资源不足，无法购买发展卡');
    return false;
  }
  state.humanDevelopMode = 'idle';
  return true;
}

export function humanStartRoadMode(state: GameState): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  if (!canHumanBuildRoad(state, pid)) {
    appendLog(state, '无法建道路（资源不足、配额用尽或无可连边）');
    return false;
  }
  state.humanDevelopMode = 'road';
  state.selectedEdge = null;
  appendLog(state, '建道路：点击地图黄线放置');
  return true;
}

export function humanStartVillageMode(state: GameState): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  if (!canHumanBuildVillage(state, pid)) {
    appendLog(state, '无法建村庄（资源不足、配额用尽或无可建点）');
    return false;
  }
  state.humanDevelopMode = 'village';
  state.selectedVertex = null;
  appendLog(state, '建村庄：点击地图绿点放置');
  return true;
}

export function humanStartUpgradeMode(state: GameState): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  if (!canHumanUpgradeTown(state, pid)) {
    appendLog(state, '无法升城镇（资源不足、配额用尽或无可升级村庄）');
    return false;
  }
  state.humanDevelopMode = 'upgrade';
  state.selectedVertex = null;
  appendLog(state, '升城镇：点击自己的村庄（绿圈）');
  return true;
}

export function humanStartTradeMode(state: GameState): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  state.humanDevelopMode = 'trade';
  appendLog(state, '交易面板已打开：可与银行或其他玩家交换资源');
  return true;
}

export function humanCancelDevelopMode(state: GameState): void {
  if (state.humanDevelopMode === 'monopoly' || state.humanDevelopMode === 'knight') {
    appendLog(state, '已取消打出发展卡');
  }
  state.humanDevelopMode = 'idle';
  state.selectedVertex = null;
  state.selectedEdge = null;
  state.selectedTileId = null;
  state.pendingDevCardIndex = null;
}

export function humanPlayDevCard(
  state: GameState,
  cardIndex: number,
): 'done' | 'knight' | 'monopoly' | false {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  if (state.humanDevelopMode !== 'idle') {
    appendLog(state, '请先完成当前操作或点取消');
    return false;
  }
  const card = state.players[pid]!.devCards[cardIndex];
  if (!card || card.played) return false;

  if (card.kind === 'university') {
    return playDevCardUniversity(state, pid, cardIndex) ? 'done' : false;
  }
  if (card.kind === 'knight') {
    if (!startDevCardKnight(state, pid, cardIndex)) return false;
    state.humanDevelopMode = 'knight';
    return 'knight';
  }
  if (card.kind === 'monopoly') {
    if (!startDevCardMonopoly(state, pid, cardIndex)) return false;
    state.humanDevelopMode = 'monopoly';
    return 'monopoly';
  }
  return false;
}

export function humanCompleteKnightRobber(state: GameState, tileId: number): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  if (state.humanDevelopMode !== 'knight') return false;
  if (!completeDevCardKnight(state, pid, tileId)) {
    appendLog(state, '请选择有效资源格（沙漠除外，且不能停在当前强盗格）');
    return false;
  }
  state.humanDevelopMode = 'idle';
  state.selectedTileId = null;
  return true;
}

export function humanCompleteMonopoly(state: GameState, resource: ResourceKey): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  if (state.humanDevelopMode !== 'monopoly') return false;
  if (!completeDevCardMonopoly(state, pid, resource)) return false;
  state.humanDevelopMode = 'idle';
  return true;
}

export function humanBankTrade(state: GameState, give: ResourceKey, receive: ResourceKey): boolean {
  const pid = state.currentPlayer;
  if (!state.players[pid]?.isHuman || state.phase !== 'turn_develop') return false;
  return tryBankTrade(state, pid, give, receive);
}

export function humanPlayerTrade(
  state: GameState,
  toId: number,
  offer: Partial<ResourceBag>,
  request: Partial<ResourceBag>,
): boolean {
  const fromId = state.currentPlayer;
  if (!state.players[fromId]?.isHuman || state.phase !== 'turn_develop') return false;
  const to = state.players[toId];
  if (!to || toId === fromId) return false;

  if (!to.isHuman) {
    if (!aiAcceptsTrade(state, offer, request)) {
      appendLog(state, `${to.name} 拒绝了交易（需给出不少于所得的资源）`);
      return false;
    }
  }

  return tryPlayerTrade(state, fromId, toId, offer, request);
}

export function humanBuildAtVertex(state: GameState, vertexId: string): boolean {
  const pid = state.currentPlayer;
  if (state.phase !== 'turn_develop' || !state.players[pid]?.isHuman) return false;
  if (state.humanDevelopMode === 'village') {
    const ok = tryBuildVillage(state, pid, vertexId);
    if (ok) state.humanDevelopMode = 'idle';
    return ok;
  }
  if (state.humanDevelopMode === 'upgrade') {
    const ok = tryUpgradeTown(state, pid, vertexId);
    if (ok) state.humanDevelopMode = 'idle';
    return ok;
  }
  return false;
}

export function advancePhase(state: GameState): void {
  switch (state.phase) {
    case 'init':
      generateMap(state);
      break;
    case 'map_ready':
      beginSetup(state);
      break;
    case 'setup_village':
      resolveSetupVillage(state);
      break;
    case 'setup_road':
      resolveSetupRoad(state);
      break;
    case 'turn_roll':
      resolveRoll(state);
      break;
    case 'turn_harvest':
      resolveHarvest(state);
      break;
    case 'turn_robber_discard':
      resolveRobberDiscard(state);
      break;
    case 'turn_robber_move':
      resolveRobberMove(state);
      break;
    case 'turn_robber_steal':
      resolveRobberSteal(state);
      break;
    case 'turn_develop':
      if (isHumanActive(state)) humanEndTurn(state);
      else resolveDevelopAi(state);
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

export function setHumanSelection(state: GameState, vertex: string | null, edge: string | null): void {
  state.selectedVertex = vertex;
  state.selectedEdge = edge;
}

export function setHumanTile(state: GameState, tileId: number | null): void {
  state.selectedTileId = tileId;
}

function needsHumanMapInput(state: GameState): boolean {
  if (!isHumanActive(state)) return false;
  switch (state.phase) {
    case 'setup_village':
    case 'setup_road':
    case 'turn_robber_move':
      return true;
    default:
      return false;
  }
}

/** 地图选点后若开启跳过确认，立即执行当前阶段 */
export function humanConfirmSelectionIfReady(state: GameState): boolean {
  if (!state.skipConfirm || !isHumanActive(state)) return false;
  switch (state.phase) {
    case 'setup_village':
      if (!state.selectedVertex) return false;
      resolveSetupVillage(state);
      return true;
    case 'setup_road':
      if (!state.selectedEdge) return false;
      resolveSetupRoad(state);
      return true;
    case 'turn_robber_move':
      if (state.selectedTileId === null) return false;
      resolveRobberMove(state);
      return true;
    default:
      return false;
  }
}

const AUTO_ADVANCE_LIMIT = 64;

let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelScheduledAutoAdvance(): void {
  if (autoAdvanceTimer !== null) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}

function isAutoAdvanceBlocked(state: GameState): boolean {
  if (state.gameEnded) return true;
  if (needsHumanMapInput(state)) return true;
  if (state.phase === 'turn_develop' && isHumanActive(state)) return true;
  return false;
}

/** 每步自动推进前的展示时长（毫秒） */
export function autoAdvanceDelayMs(phaseBefore: GamePhase): number {
  switch (phaseBefore) {
    case 'setup_village':
    case 'setup_road':
      return 1200;
    case 'turn_roll':
      return 1000;
    case 'turn_harvest':
      return 1400;
    case 'turn_robber_discard':
    case 'turn_robber_move':
    case 'turn_robber_steal':
      return 900;
    case 'turn_develop':
      return 1100;
    case 'map_ready':
      return 600;
    default:
      return 800;
  }
}

export interface AutoAdvanceHooks {
  onStep?: (phaseBefore: GamePhase) => void;
  onRefresh?: () => void;
}

export interface ScheduleAutoAdvanceOptions {
  /** 首次推进前的等待（让人类操作或当前阶段先展示一会儿） */
  initialDelayMs?: number;
}

/**
 * 跳过确认开启时，分步定时推进（每步之间留展示时间），
 * 直到需要人类点地图或进入己方自由发展。
 */
export function scheduleAutoAdvanceUntilBlocked(
  state: GameState,
  hooks: AutoAdvanceHooks = {},
  options: ScheduleAutoAdvanceOptions = {},
): void {
  cancelScheduledAutoAdvance();
  if (!state.skipConfirm || state.gameEnded || isAutoAdvanceBlocked(state)) return;

  const initialDelay = options.initialDelayMs ?? 500;
  let steps = 0;

  const tick = () => {
    autoAdvanceTimer = null;
    if (!state.skipConfirm || state.gameEnded || isAutoAdvanceBlocked(state)) return;
    if (steps >= AUTO_ADVANCE_LIMIT) return;

    const before = state.phase;
    advancePhase(state);
    steps++;
    hooks.onStep?.(before);
    hooks.onRefresh?.();

    if (state.gameEnded || isAutoAdvanceBlocked(state)) return;
    if (state.phase === before) return;

    autoAdvanceTimer = setTimeout(tick, autoAdvanceDelayMs(before));
  };

  autoAdvanceTimer = setTimeout(tick, initialDelay);
}

/** @deprecated 使用 scheduleAutoAdvanceUntilBlocked；保留别名避免遗漏调用点 */
export function runAutoAdvanceUntilBlocked(
  state: GameState,
  onStep?: (phaseBefore: GamePhase) => void,
): void {
  scheduleAutoAdvanceUntilBlocked(state, { onStep }, { initialDelayMs: 500 });
}

export function toggleSkipConfirm(
  state: GameState,
  hooks: AutoAdvanceHooks = {},
): void {
  if (state.skipConfirm) cancelScheduledAutoAdvance();
  state.skipConfirm = !state.skipConfirm;
  appendLog(
    state,
    state.skipConfirm
      ? '已开启跳过确认：选点即放置，步骤分步自动推进'
      : '已关闭跳过确认',
  );
  if (state.skipConfirm) {
    scheduleAutoAdvanceUntilBlocked(state, hooks, { initialDelayMs: 600 });
  }
}
