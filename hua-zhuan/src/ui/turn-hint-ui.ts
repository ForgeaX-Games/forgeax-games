import type { GameState } from '../core/types';

const BANNER_ID = 'hua-zhuan-turn-banner';
const TOGGLE_ID = 'hua-zhuan-auto-ai-toggle';

const HUD_W = 320;

export interface TurnHintUiApi {
  refresh(state: GameState): void;
  isAutoAiEnabled(): boolean;
  onAutoAiChange(fn: (enabled: boolean) => void): void;
  dispose(): void;
}

export function turnHintMessage(state: GameState, autoAi: boolean): string {
  switch (state.phase) {
    case 'init':
      return '准备开始 — 点击右侧「开始游戏」';
    case 'round_start':
      return `第 ${state.round} 轮 · 点击右侧「开始拿取阶段」`;
    case 'take_turn': {
      const p = state.players[state.currentPlayer]!;
      if (p.isHuman) {
        if (state.pendingAction) return '轮到你了 · 正在执行拿取…';
        return '轮到你了 · 点击工厂/中央花砖选色，再点你的图案行';
      }
      if (autoAi) return `${p.name} 行动中…`;
      return `${p.name} · 点击右下角「执行 AI 拿取」或右侧按钮`;
    }
    case 'scoring_preview':
      return '本轮回合砖已拿完 · 点击右侧进入计分';
    case 'scoring':
      return '计分中…';
    case 'round_end':
      return `第 ${state.round} 轮结束 · 点击右侧开始下一轮`;
    case 'game_over': {
      const w = state.winnerId !== null ? state.players[state.winnerId]! : null;
      return w ? `游戏结束 · ${w.name} 获胜` : '游戏结束';
    }
    default:
      return '';
  }
}

export function installTurnHintUi(): TurnHintUiApi {
  document.getElementById(BANNER_ID)?.remove();
  document.getElementById(TOGGLE_ID)?.remove();

  let autoAi = true;
  let changeFn: ((enabled: boolean) => void) | null = null;

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.style.cssText =
    `position:fixed;top:12px;left:50%;transform:translateX(calc(-50% - ${HUD_W / 2}px));` +
    'z-index:200;max-width:min(560px,calc(100vw - 360px));pointer-events:none;' +
    'padding:10px 18px;border-radius:10px;' +
    'background:rgba(12,10,8,0.78);border:1px solid rgba(255,235,200,0.18);' +
    'color:#f8f4ec;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;' +
    'line-height:1.45;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.35);' +
    'backdrop-filter:blur(6px);';
  document.body.appendChild(banner);

  const toggleWrap = document.createElement('div');
  toggleWrap.id = TOGGLE_ID;
  toggleWrap.style.cssText =
    `position:fixed;right:${HUD_W + 12}px;bottom:14px;z-index:200;` +
    'pointer-events:auto;font-family:system-ui,sans-serif;';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;' +
    'border:1px solid rgba(255,235,200,0.22);cursor:pointer;font-size:12px;font-weight:600;' +
    'color:#f8f4ec;transition:background 0.15s,border-color 0.15s;';

  toggleWrap.appendChild(toggleBtn);
  document.body.appendChild(toggleWrap);

  function paintToggle(): void {
    if (autoAi) {
      toggleBtn.style.background = 'rgba(34,197,94,0.22)';
      toggleBtn.style.borderColor = 'rgba(74,222,128,0.45)';
      toggleBtn.innerHTML =
        '<span style="width:8px;height:8px;border-radius:50%;background:#4ade80;flex-shrink:0"></span>' +
        'AI 自动拿取 · 开';
    } else {
      toggleBtn.style.background = 'rgba(255,255,255,0.08)';
      toggleBtn.style.borderColor = 'rgba(255,255,255,0.2)';
      toggleBtn.innerHTML =
        '<span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;flex-shrink:0"></span>' +
        'AI 自动拿取 · 关';
    }
    toggleBtn.title = autoAi
      ? '已跳过 AI 确认，AI 回合自动拿砖'
      : '关闭后需手动点击执行 AI 拿取';
  }

  toggleBtn.onclick = () => {
    autoAi = !autoAi;
    paintToggle();
    changeFn?.(autoAi);
  };

  paintToggle();

  const api: TurnHintUiApi = {
    refresh(state) {
      banner.textContent = turnHintMessage(state, autoAi);
      const showToggle = state.phase === 'take_turn' || state.phase === 'round_start';
      toggleWrap.style.display = showToggle ? 'block' : 'none';
    },
    isAutoAiEnabled() {
      return autoAi;
    },
    onAutoAiChange(fn) {
      changeFn = fn;
    },
    dispose() {
      banner.remove();
      toggleWrap.remove();
    },
  };

  return api;
}
