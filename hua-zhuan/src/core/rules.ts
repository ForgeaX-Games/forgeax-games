import {
  ENDGAME_COL_BONUS,
  ENDGAME_COLOR_BONUS,
  ENDGAME_ROW_BONUS,
  floorCumulativePenalty,
  floorSlotMarginalPenalty,
  NUM_COLORS,
  ROW_CAPACITIES,
  WALL_COLS,
  WALL_PATTERN,
  WALL_ROWS,
} from './constants';
import type { GameState, PatternRow, PlayerState, TakeAction, TakeSource, TileColor } from './types';
import { appendLog } from './game-state';
import { recycleTiles } from './bag';

/** Target wall column for placing color on pattern row */
export function wallColForRowColor(row: number, color: TileColor): number {
  for (let c = 0; c < WALL_COLS; c++) {
    if (WALL_PATTERN[row]![c] === color) return c;
  }
  return -1;
}

export function canPlaceOnRow(row: PatternRow, color: TileColor, rowIndex: number, player: PlayerState): boolean {
  if (row.tiles.length >= ROW_CAPACITIES[rowIndex]!) return false;
  if (row.color !== null && row.color !== color) return false;
  const col = wallColForRowColor(rowIndex, color);
  if (col < 0) return false;
  if (row.tiles.length === 0 && player.wall[rowIndex]![col]) return false;
  return true;
}

/** Player cannot take color if every row blocks it */
export function canTakeColor(player: PlayerState, color: TileColor): boolean {
  for (let r = 0; r < ROW_CAPACITIES.length; r++) {
    if (canPlaceOnRow(player.patternRows[r]!, color, r, player)) return true;
  }
  return false;
}

export function getAvailableColorsFromSource(state: GameState, source: TakeSource): TileColor[] {
  const tiles =
    source.kind === 'factory'
      ? state.factories[source.index] ?? []
      : state.center;
  const set = new Set<TileColor>();
  for (const t of tiles) set.add(t);
  return [...set];
}

export function isValidTake(state: GameState, action: TakeAction): { ok: true } | { ok: false; reason: string } {
  const player = state.players[state.currentPlayer]!;
  const tiles =
    action.source.kind === 'factory'
      ? state.factories[action.source.index]
      : state.center;

  if (!tiles || tiles.length === 0) return { ok: false, reason: '来源为空' };
  if (!tiles.every((t) => t === action.color) && !tiles.some((t) => t === action.color)) {
    return { ok: false, reason: '该来源没有此花色' };
  }
  const picked = tiles.filter((t) => t === action.color);
  if (picked.length === 0) return { ok: false, reason: '必须拿取一种花色的全部砖' };

  const onlyColorLeft =
    action.source.kind === 'factory'
      ? state.factories[action.source.index]!.every((t) => t === action.color)
      : state.center.every((t) => t === action.color);

  if (!canTakeColor(player, action.color)) {
    if (!onlyColorLeft && tiles.some((t) => t !== action.color)) {
      return { ok: false, reason: '此花色无法放入任何图案行，请选择其他花色' };
    }
    // only this color remains — allowed but will all go to floor
  }

  const row = player.patternRows[action.targetRow];
  if (!row) return { ok: false, reason: '无效行' };
  if (row.color !== null && row.color !== action.color) {
    return { ok: false, reason: '该行已有其他花色' };
  }

  return { ok: true };
}

export function getValidTargetRows(player: PlayerState, color: TileColor): number[] {
  const rows: number[] = [];
  for (let r = 0; r < ROW_CAPACITIES.length; r++) {
    if (canPlaceOnRow(player.patternRows[r]!, color, r, player)) rows.push(r);
  }
  return rows;
}

/** Horizontal/vertical score when placing at (row,col) */
export function scorePlacementBreakdown(
  wall: boolean[][],
  row: number,
  col: number,
): { score: number; h: number; v: number } {
  if (!wall[row]![col]) return { score: 0, h: 0, v: 0 };
  let h = 1;
  for (let c = col - 1; c >= 0 && wall[row]![c]; c--) h++;
  for (let c = col + 1; c < WALL_COLS && wall[row]![c]; c++) h++;
  let v = 1;
  for (let r = row - 1; r >= 0 && wall[r]![col]; r--) v++;
  for (let r = row + 1; r < WALL_ROWS && wall[r]![col]; r++) v++;
  let score = 0;
  if (h >= 2) score += h;
  if (v >= 2) score += v;
  return { score, h, v };
}

export function scorePlacement(wall: boolean[][], row: number, col: number): number {
  return scorePlacementBreakdown(wall, row, col).score;
}

export function hasCompletedWallRow(player: PlayerState): boolean {
  return player.wall.some((row) => row.every(Boolean));
}

export function computeEndgameBonuses(player: PlayerState): { rows: number; cols: number; colors: number; total: number } {
  let rows = 0;
  let cols = 0;
  let colors = 0;
  for (let r = 0; r < WALL_ROWS; r++) {
    if (player.wall[r]!.every(Boolean)) rows++;
  }
  for (let c = 0; c < WALL_COLS; c++) {
    let full = true;
    for (let r = 0; r < WALL_ROWS; r++) {
      if (!player.wall[r]![c]) { full = false; break; }
    }
    if (full) cols++;
  }
  for (let color = 0; color < NUM_COLORS; color++) {
    let count = 0;
    for (let r = 0; r < WALL_ROWS; r++) {
      for (let c = 0; c < WALL_COLS; c++) {
        if (player.wall[r]![c] && WALL_PATTERN[r]![c] === color) count++;
      }
    }
    if (count >= 5) colors++;
  }
  const total = rows * ENDGAME_ROW_BONUS + cols * ENDGAME_COL_BONUS + colors * ENDGAME_COLOR_BONUS;
  return { rows, cols, colors, total };
}

export function executeTake(state: GameState, action: TakeAction): void {
  const player = state.players[state.currentPlayer]!;
  const colorName = ['蓝', '黄', '红', '黑', '白'][action.color]!;
  let picked: TileColor[] = [];

  if (action.source.kind === 'factory') {
    const factory = state.factories[action.source.index]!;
    picked = factory.filter((t) => t === action.color);
    const rest = factory.filter((t) => t !== action.color);
    state.factories[action.source.index] = [];
    state.center.push(...rest);
    appendLog(state, `${player.name} 从工厂盘 ${action.source.index + 1} 拿取 ${picked.length} 块${colorName}砖`);
    if (rest.length > 0) {
      appendLog(state, `  → 其余 ${rest.length} 块移入中央区域`);
    }
  } else {
    picked = state.center.filter((t) => t === action.color);
    const rest = state.center.filter((t) => t !== action.color);
    state.center = rest;
    appendLog(state, `${player.name} 从中央区域拿取 ${picked.length} 块${colorName}砖`);
    if (state.hasPlusOneInCenter && state.plusOneHolder === null) {
      state.hasPlusOneInCenter = false;
      state.plusOneHolder = state.currentPlayer;
      player.plusOneOnFloor = true;
      player.plusOneFloorSlot = player.floorLine.length;
      appendLog(state, `  → 首个拿中央砖，+1 标记放入扣分区（下轮该玩家先手拿取）`);
    }
  }

  const row = player.patternRows[action.targetRow]!;
  const cap = ROW_CAPACITIES[action.targetRow]!;
  let placed = 0;
  for (const tile of picked) {
    if (row.tiles.length < cap && (row.color === null || row.color === tile)) {
      if (row.color === null) row.color = tile;
      row.tiles.push(tile);
      placed++;
    } else {
      player.floorLine.push(tile);
    }
  }
  if (placed > 0) {
    appendLog(state, `  → 图案行 ${action.targetRow + 1} 放入 ${placed} 块`);
  }
  const overflow = picked.length - placed;
  if (overflow > 0) {
    appendLog(state, `  → 溢出 ${overflow} 块进入扣分区`);
  }
}

export function runScoringPhase(state: GameState): boolean {
  let someoneCompletedRow = false;
  appendLog(state, `—— 第 ${state.round} 轮 · 计分阶段 ——`);

  for (const player of state.players) {
    appendLog(state, `【${player.name}】结算图案行`);
    for (let r = 0; r < ROW_CAPACITIES.length; r++) {
      const row = player.patternRows[r]!;
      const cap = ROW_CAPACITIES[r]!;
      if (row.tiles.length < cap || row.color === null) {
        if (row.tiles.length > 0) {
          appendLog(state, `  行 ${r + 1}：未满（${row.tiles.length}/${cap}），保留到下一轮`);
        }
        continue;
      }
      const col = wallColForRowColor(r, row.color);
      if (col < 0 || player.wall[r]![col]) {
        appendLog(state, `  行 ${r + 1}：墙位已占用，砖作废`);
        state.discard = recycleTiles(state.discard, [...row.tiles]);
        row.tiles = [];
        row.color = null;
        continue;
      }
      player.wall[r]![col] = true;
      const { score: pts, h, v } = scorePlacementBreakdown(player.wall, r, col);
      player.score += pts;
      const cname = ['蓝', '黄', '红', '黑', '白'][row.color]!;
      const hv =
        pts === 0
          ? '（横纵均不足2格）'
          : `横${h}${h >= 2 ? '→+' + h : ''} 纵${v}${v >= 2 ? '→+' + v : ''}`;
      appendLog(state, `  行 ${r + 1} 满 → 推入墙 (${r + 1},${col + 1}) ${cname} ${hv} 合计 +${pts} 分`);
      // One tile stays on wall; the rest return to discard pile
      const returned = row.tiles.slice(0, -1);
      if (returned.length > 0) {
        state.discard = recycleTiles(state.discard, returned);
      }
      row.tiles = [];
      row.color = null;
      if (player.wall[r]!.every(Boolean)) someoneCompletedRow = true;
    }

    const floorCount = player.floorLine.length + (player.plusOneOnFloor ? 1 : 0);
    if (floorCount > 0) {
      const penalty = floorCumulativePenalty(floorCount);
      player.score += penalty;
      const slots = Array.from({ length: floorCount }, (_, i) =>
        `格${i + 1}(-${floorSlotMarginalPenalty(i)})`,
      ).join(' ');
      appendLog(
        state,
        `  扣分区 ${floorCount} 块${player.plusOneOnFloor ? '（含+1标记）' : ''}：${slots} → 合计 ${penalty} 分`,
      );
      if (player.floorLine.length > 0) {
        state.discard = recycleTiles(state.discard, [...player.floorLine]);
      }
      player.floorLine = [];
      player.plusOneOnFloor = false;
      player.plusOneFloorSlot = 0;
    }
    appendLog(state, `  当前总分：${player.score}`);
  }

  return someoneCompletedRow;
}

export function runEndgameScoring(state: GameState): void {
  appendLog(state, '—— 终局额外计分 ——');
  state.endgameSummary = state.players.map((player, playerId) => {
    const b = computeEndgameBonuses(player);
    const scoreBeforeEndgame = player.score;
    const endgameBonus = b.total;
    player.score += endgameBonus;
    if (endgameBonus > 0) {
      appendLog(
        state,
        `${player.name}：整行×${b.rows}(+${b.rows * ENDGAME_ROW_BONUS}) ` +
          `整列×${b.cols}(+${b.cols * ENDGAME_COL_BONUS}) ` +
          `同色×${b.colors}(+${b.colors * ENDGAME_COLOR_BONUS}) = +${endgameBonus}`,
      );
    }
    return {
      playerId,
      scoreBeforeEndgame,
      endgameRows: b.rows,
      endgameCols: b.cols,
      endgameColors: b.colors,
      endgameBonus,
      finalScore: player.score,
    };
  });
}

export function findWinner(state: GameState): number {
  let best = 0;
  for (let i = 1; i < state.players.length; i++) {
    if (state.players[i]!.score > state.players[best]!.score) best = i;
  }
  return best;
}

export function advanceToNextPlayer(state: GameState): void {
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
}

export function anyValidTakeExists(state: GameState): boolean {
  const player = state.players[state.currentPlayer]!;
  for (let fi = 0; fi < state.factories.length; fi++) {
    const f = state.factories[fi]!;
    if (f.length === 0) continue;
    const colors = new Set(f);
    for (const c of colors) {
      if (canTakeColor(player, c) || f.every((t) => t === c)) return true;
    }
  }
  if (state.center.length > 0) {
    const colors = new Set(state.center);
    for (const c of colors) {
      if (canTakeColor(player, c as TileColor) || state.center.every((t) => t === c)) return true;
    }
  }
  return false;
}

export function skipPlayerTurn(state: GameState): void {
  const player = state.players[state.currentPlayer]!;
  appendLog(state, `${player.name} 无法合法拿取，跳过回合`);
}
