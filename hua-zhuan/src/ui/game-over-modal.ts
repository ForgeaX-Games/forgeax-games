import type { GameState } from '../core/types';
import {
  ENDGAME_COL_BONUS,
  ENDGAME_COLOR_BONUS,
  ENDGAME_ROW_BONUS,
} from '../core/scoring-reference';

const MODAL_ID = 'hua-zhuan-game-over-modal';

export interface GameOverModalApi {
  refresh(state: GameState): void;
  onRestart(fn: () => void): void;
  dispose(): void;
}

const RANK_LABEL = ['第 1 名', '第 2 名', '第 3 名', '第 4 名'] as const;

function buildRankRows(state: GameState): string {
  const summary = state.endgameSummary;
  const entries = state.players.map((p, id) => ({
    id,
    name: p.name,
    isHuman: p.isHuman,
    finalScore: summary?.find((s) => s.playerId === id)?.finalScore ?? p.score,
    before: summary?.find((s) => s.playerId === id)?.scoreBeforeEndgame ?? p.score,
    rows: summary?.find((s) => s.playerId === id)?.endgameRows ?? 0,
    cols: summary?.find((s) => s.playerId === id)?.endgameCols ?? 0,
    colors: summary?.find((s) => s.playerId === id)?.endgameColors ?? 0,
    bonus: summary?.find((s) => s.playerId === id)?.endgameBonus ?? 0,
  }));

  entries.sort((a, b) => b.finalScore - a.finalScore || a.id - b.id);

  return entries
    .map((e, rank) => {
      const label = RANK_LABEL[rank] ?? `第 ${rank + 1} 名`;
      const endgameLine =
        e.bonus > 0
          ? `<div style="font-size:11px;opacity:0.85;margin-top:4px;line-height:1.45">` +
            `终局：整行 ${e.rows}×${ENDGAME_ROW_BONUS} + 整列 ${e.cols}×${ENDGAME_COL_BONUS} + 同色 ${e.colors}×${ENDGAME_COLOR_BONUS} = <span style="color:#fde68a">+${e.bonus}</span>` +
            `</div>`
          : `<div style="font-size:11px;opacity:0.65;margin-top:4px">终局：无额外奖励</div>`;

      return (
        `<div style="padding:10px 12px;border-radius:8px;margin-bottom:8px;` +
        `${rank === 0 ? 'background:rgba(253,224,71,0.12);border:1px solid rgba(253,224,71,0.35)' : 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1)'}">` +
        `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">` +
        `<span style="font-size:15px;font-weight:800">${label} · ${e.name}${e.isHuman ? '（你）' : ''}</span>` +
        `<span style="font-size:20px;font-weight:800;color:#86efac">${e.finalScore}</span>` +
        `</div>` +
        `<div style="font-size:11px;opacity:0.8;margin-top:2px">轮内得分 ${e.before} → 终局后 ${e.finalScore}</div>` +
        endgameLine +
        `</div>`
      );
    })
    .join('');
}

export interface GameOverModalOptions {
  mount?: HTMLElement;
}

export function installGameOverModal(opts: GameOverModalOptions = {}): GameOverModalApi {
  const mount = opts.mount ?? document.body;
  document.getElementById(MODAL_ID)?.remove();

  const backdrop = document.createElement('div');
  backdrop.id = MODAL_ID;
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:8000;display:none;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.62);backdrop-filter:blur(4px);pointer-events:auto;' +
    'font-family:system-ui,sans-serif;padding:16px;box-sizing:border-box;';

  const card = document.createElement('div');
  card.style.cssText =
    'width:min(420px,100%);max-height:min(85vh,640px);overflow-y:auto;' +
    'background:linear-gradient(165deg,#1a1510,#2d2418);border:1px solid rgba(255,235,200,0.22);' +
    'border-radius:14px;padding:20px 18px;color:#f8f4ec;box-shadow:0 12px 48px rgba(0,0,0,0.5);';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:20px;font-weight:800;text-align:center;margin-bottom:4px;color:#fde68a;';
  title.textContent = '游戏结束';

  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'font-size:12px;text-align:center;opacity:0.75;margin-bottom:14px;';

  const list = document.createElement('div');

  const restartBtn = document.createElement('button');
  restartBtn.type = 'button';
  restartBtn.textContent = '重新开始';
  restartBtn.style.cssText =
    'margin-top:12px;width:100%;padding:11px 0;border:none;border-radius:8px;' +
    'background:#3b82f6;color:#fff;font-size:14px;font-weight:700;cursor:pointer;';

  card.append(title, subtitle, list, restartBtn);
  backdrop.appendChild(card);
  mount.appendChild(backdrop);

  let restartFn: (() => void) | null = null;

  restartBtn.onclick = () => restartFn?.();

  return {
    refresh(state) {
      if (state.phase !== 'game_over') {
        backdrop.style.display = 'none';
        return;
      }
      const winner = state.winnerId !== null ? state.players[state.winnerId]! : null;
      subtitle.textContent = winner ? `${winner.name} 获胜` : '按总分排名';
      list.innerHTML = buildRankRows(state);
      backdrop.style.display = 'flex';
    },
    onRestart(fn) {
      restartFn = fn;
    },
    dispose() {
      backdrop.remove();
    },
  };
}
