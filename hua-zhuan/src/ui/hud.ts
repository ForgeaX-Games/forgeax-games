import { COLOR_INFO, ROW_CAPACITIES } from '../core/constants';
import { getAvailableColorsFromSource, getValidTargetRows } from '../core/rules';
import type { GameState, TakeAction, TakeSource, TileColor } from '../core/types';
import { effectiveTakeSelection } from './take-interaction';
import { PLAY_TILE, tileImageUrl } from './game-assets';
import type { TakeSelectionStore } from './take-selection';

const HUD_ID = 'hua-zhuan-hud';
const PANEL_W = 320;

export interface HudApi {
  bind(state: GameState, selection: TakeSelectionStore, autoAiEnabled?: () => boolean): void;
  refresh(): void;
  onNextPhase(fn: () => void): void;
  onHumanTake(fn: (action: TakeAction) => void): void;
  onSelectionChange(fn: (source: TakeSource, color: TileColor) => void): void;
  onRowPick(fn: (row: number) => void): void;
  dispose(): void;
}

export function installHud(): HudApi {
  document.getElementById(HUD_ID)?.remove();

  const root = document.createElement('div');
  root.id = HUD_ID;
  root.style.cssText =
    `position:fixed;top:0;right:0;width:${PANEL_W}px;height:100%;z-index:9999;` +
    'font-family:system-ui,sans-serif;color:#f1f5f9;pointer-events:none;';

  const panel = document.createElement('div');
  panel.style.cssText =
    'box-sizing:border-box;width:100%;height:100%;padding:14px 12px;' +
    'background:rgba(15,20,35,0.94);border-left:1px solid rgba(255,255,255,0.1);' +
    'display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;';
  root.appendChild(panel);

  const title = document.createElement('div');
  title.textContent = '花砖物语';
  title.style.cssText = 'font-size:18px;font-weight:800;margin-bottom:8px;';
  panel.appendChild(title);

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:12px;line-height:1.5;margin-bottom:8px;opacity:0.9;';
  panel.appendChild(statusEl);

  const scoresEl = document.createElement('div');
  scoresEl.style.cssText =
    'font-size:11px;line-height:1.6;margin-bottom:8px;padding:8px;' +
    'background:rgba(255,255,255,0.05);border-radius:8px;';
  panel.appendChild(scoresEl);

  const takePanel = document.createElement('div');
  takePanel.style.cssText =
    'font-size:11px;margin-bottom:8px;padding:8px;border-radius:8px;' +
    'background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);display:none;';
  panel.appendChild(takePanel);

  const logEl = document.createElement('div');
  logEl.style.cssText =
    'flex:1;overflow-y:auto;font-size:11px;line-height:1.55;padding:8px;' +
    'background:rgba(0,0,0,0.25);border-radius:8px;margin-bottom:10px;' +
    'font-family:ui-monospace,monospace;white-space:pre-wrap;';
  panel.appendChild(logEl);

  const nextBtn = document.createElement('button');
  nextBtn.style.cssText =
    'padding:10px 0;border-radius:8px;border:none;background:#3b82f6;color:#fff;' +
    'font-size:13px;font-weight:700;cursor:pointer;width:100%;';
  panel.appendChild(nextBtn);

  document.body.appendChild(root);

  let stateRef: GameState | null = null;
  let selectionRef: TakeSelectionStore | null = null;
  let autoAiFn: (() => boolean) | null = null;
  let nextFn: (() => void) | null = null;
  let takeFn: ((a: TakeAction) => void) | null = null;
  let selChangeFn: ((source: TakeSource, color: TileColor) => void) | null = null;
  let rowPickFn: ((row: number) => void) | null = null;

  function refresh(): void {
    if (!stateRef) return;
    const s = stateRef;
    statusEl.innerHTML =
      `第 <b>${s.round}</b> 轮 · 阶段：<b>${phaseLabel(s.phase)}</b><br/>` +
      (s.phase === 'take_turn' ? `当前：<b>${s.players[s.currentPlayer]!.name}</b>` : '') +
      (s.hasPlusOneInCenter ? '<br/>中央有 <b>+1</b> 标记' : '');
    scoresEl.innerHTML = s.players
      .map((p, i) => {
        const cur = s.currentPlayer === i && s.phase === 'take_turn' ? ' ◀' : '';
        return `${p.name}：${p.score} 分${cur}`;
      })
      .join('<br/>');
    logEl.textContent = s.log.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
    nextBtn.textContent = s.nextButtonLabel;
    const p = s.players[s.currentPlayer]!;
    const aiAuto = s.phase === 'take_turn' && !p.isHuman && (autoAiFn?.() ?? false);
    nextBtn.disabled =
      aiAuto ||
      (s.phase === 'take_turn' && p.isHuman && !s.pendingAction);
    nextBtn.style.opacity = nextBtn.disabled ? '0.45' : '1';
    nextBtn.style.display = aiAuto ? 'none' : 'block';
    renderTakePanel(s);
  }

  function renderTakePanel(s: GameState): void {
    takePanel.innerHTML = '';
    const p = s.players[s.currentPlayer]!;
    if (s.phase !== 'take_turn' || !p.isHuman || !selectionRef) {
      takePanel.style.display = 'none';
      return;
    }
    takePanel.style.display = 'block';
    takePanel.appendChild(
      mk('div', '拿取：点击工厂/中央花砖 → 点击图案行（自动执行）', 'font-weight:700;margin-bottom:6px;line-height:1.4;'),
    );

    const eff = effectiveTakeSelection(s, selectionRef);
    const selSource = eff?.source ?? selectionRef.get().source;
    const selColor = eff?.color ?? selectionRef.get().color;
    const selRow = eff?.targetRow ?? selectionRef.get().targetRow;

    const srcLabel = document.createElement('div');
    srcLabel.style.cssText = 'margin-bottom:4px;opacity:0.85;';
    if (!selSource || selColor === null) {
      srcLabel.textContent = '来源：未选择（点击棋盘上的花砖）';
    } else {
      const srcName = selSource.kind === 'factory' ? `工厂盘 ${selSource.index + 1}` : '中央区域';
      srcLabel.textContent = `来源：${srcName} · ${COLOR_INFO[selColor]!.name}色`;
    }
    takePanel.appendChild(srcLabel);

    const rowLabel = document.createElement('div');
    rowLabel.style.cssText = 'margin-bottom:6px;opacity:0.85;';
    if (selRow === null || selRow === undefined) {
      rowLabel.textContent = '图案行：未选择（点击你的收集盘图案行）';
    } else {
      rowLabel.textContent = `图案行：第 ${selRow + 1} 行`;
    }
    takePanel.appendChild(rowLabel);

    // HUD shortcuts (optional mirror of board clicks)
    if (selSource) {
      const colors = getAvailableColorsFromSource(s, selSource);
      const colorRow = document.createElement('div');
      colorRow.style.cssText = 'margin-bottom:6px;display:flex;gap:4px;flex-wrap:wrap;';
      for (const c of colors) {
        colorRow.appendChild(
          mkColorBtn(c, selColor === c, () => selChangeFn?.(selSource, c)),
        );
      }
      takePanel.appendChild(colorRow);
    }

    if (selColor !== null) {
      const rows = getValidTargetRows(p, selColor);
      const rowRow = document.createElement('div');
      rowRow.style.cssText = 'margin-bottom:6px;display:flex;gap:4px;flex-wrap:wrap;';
      if (rows.length === 0) {
        rowRow.appendChild(mk('span', '（此花色只能进扣分区）', 'opacity:0.7;'));
      } else {
        for (const r of rows) {
          const cap = ROW_CAPACITIES[r]!;
          const filled = p.patternRows[r]!.tiles.length;
          rowRow.appendChild(
            mkBtn(`行${r + 1} (${filled}/${cap})`, selRow === r, () => rowPickFn?.(r)),
          );
        }
      }
      takePanel.appendChild(rowRow);
    }

    if (selSource && selColor !== null && selRow !== null) {
      takePanel.appendChild(mk('div', '已预选 — 将自动执行拿取', 'color:#93c5fd;font-size:10px;'));
    }
  }

  function mk(tag: string, text: string, style: string): HTMLElement {
    const el = document.createElement(tag);
    el.textContent = text;
    el.style.cssText = style;
    return el;
  }

  function mkBtn(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `padding:4px 8px;border-radius:6px;font-size:10px;cursor:pointer;border:1px solid ` +
      `${active ? '#60a5fa' : 'rgba(255,255,255,0.2)'};background:${active ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.06)'};color:#fff;`;
    b.onclick = onClick;
    return b;
  }

  function mkColorBtn(color: TileColor, active: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.style.cssText =
      `padding:2px;border-radius:6px;cursor:pointer;border:2px solid ` +
      `${active ? '#60a5fa' : 'rgba(255,255,255,0.2)'};background:${active ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.06)'};`;
    const im = document.createElement('img');
    im.src = tileImageUrl(color);
    im.width = PLAY_TILE;
    im.height = PLAY_TILE;
    im.draggable = false;
    im.title = COLOR_INFO[color]!.name;
    im.alt = COLOR_INFO[color]!.name;
    b.appendChild(im);
    b.onclick = onClick;
    return b;
  }

  const api: HudApi = {
    bind(state, selection, autoAiEnabled) {
      stateRef = state;
      selectionRef = selection;
      autoAiFn = autoAiEnabled ?? null;
    },
    refresh,
    onNextPhase(fn) { nextFn = fn; },
    onHumanTake(fn) { takeFn = fn; },
    onSelectionChange(fn) { selChangeFn = fn; },
    onRowPick(fn) { rowPickFn = fn; },
    dispose() { root.remove(); },
  };

  nextBtn.onclick = () => nextFn?.();

  return api;
}

function phaseLabel(phase: GameState['phase']): string {
  const map: Record<GameState['phase'], string> = {
    init: '准备',
    round_start: '轮次开始',
    take_turn: '拿取阶段',
    take_resolve: '拿取确认',
    scoring_preview: '待计分',
    scoring: '计分中',
    round_end: '轮间',
    game_over: '终局',
  };
  return map[phase] ?? phase;
}
