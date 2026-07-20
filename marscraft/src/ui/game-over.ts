/**
 * MarsCraft -> forgeax-engine — GameOverScreen (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/GameOverScreen.ts`. A DOM overlay shown
 * when the match ends (one side eliminated): a VICTORY / DEFEAT title, the reason,
 * the game time, a two-column kills/losses/trained stat table, and a Return-to-Menu
 * button (reloads to the pre-game MainMenu). DOM-guarded (no-ops headless; the
 * `victory-system` still resolves + `gameOverState()` still reports for verify).
 */

import { resolveUiHost } from './ui-host';

export interface PlayerGameStats {
  name: string;
  unitsKilled: number;
  unitsLost: number;
  unitsProduced: number;
}

export interface GameOverData {
  isVictory: boolean;
  reason: string;
  /** Formatted mm:ss. */
  gameTime: string;
  local: PlayerGameStats;
  enemy: PlayerGameStats;
}

export interface GameOverHandle {
  show(data: GameOverData): void;
  hide(): void;
  isVisible(): boolean;
}

const STYLE_ID = 'mc-gameover-style';
const CSS = `
.mc-go-overlay { position:absolute; inset:0; display:none; align-items:safe center; justify-content:center;
  overflow:auto; background:rgba(6,4,10,0.72); z-index:60; font-family:'Segoe UI',system-ui,sans-serif; }
.mc-go-panel { background:linear-gradient(160deg,#1a1220,#0d0912); border:1px solid #4a3a5a;
  border-radius:14px; padding:28px 36px; min-width:520px; max-height:100%; overflow-y:auto; box-shadow:0 12px 48px rgba(0,0,0,0.6); text-align:center; }
.mc-go-title { font-size:52px; font-weight:800; letter-spacing:2px; margin:0 0 6px;
  transition:all .6s cubic-bezier(0.34,1.56,0.64,1); }
.mc-go-victory { color:#ffd24a; text-shadow:0 0 24px rgba(255,200,60,0.6); }
.mc-go-defeat { color:#ff5a5a; text-shadow:0 0 24px rgba(255,60,60,0.5); }
.mc-go-reason { color:#c9b8d8; font-size:15px; margin-bottom:4px; }
.mc-go-time { color:#8a7a9a; font-size:13px; margin-bottom:18px; }
.mc-go-cols { display:flex; gap:18px; justify-content:center; margin-bottom:22px; }
.mc-go-col { flex:1; background:rgba(255,255,255,0.03); border-radius:10px; padding:12px 14px; }
.mc-go-col-head { font-weight:700; font-size:15px; margin-bottom:10px; }
.mc-go-local { color:#5cc8ff; } .mc-go-enemy { color:#ff8a6a; }
.mc-go-row { display:flex; justify-content:space-between; font-size:13px; color:#b8a8c8; padding:3px 0; }
.mc-go-val { font-weight:700; color:#e8dcf4; }
.mc-go-pos { color:#6ee06e; } .mc-go-neg { color:#ff7a7a; }
.mc-go-btn { margin-top:4px; background:linear-gradient(180deg,#6a4a8a,#4a2f6a); color:#fff; border:1px solid #7a5a9a;
  border-radius:8px; padding:10px 28px; font-size:15px; font-weight:700; cursor:pointer; }
.mc-go-btn:hover { filter:brightness(1.15); }
`;

/** Install the game-over overlay over `#app` (or a provided root). */
export function installGameOver(onReturnToMenu?: () => void): GameOverHandle {
  if (typeof document === 'undefined') {
    // headless: inert handle (victory-system still runs; gameOverState() reports).
    let vis = false;
    return { show: () => { vis = true; }, hide: () => { vis = false; }, isVisible: () => vis };
  }
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
  }
  // Mount into the host's disposable `#game-ui-root` (removed on ■ Stop) — not the
  // `#app` canvas (invalid DOM child + stranded after Stop). See ui-host.ts.
  const host = resolveUiHost();
  const overlay = document.createElement('div');
  overlay.className = 'mc-go-overlay';
  host.appendChild(overlay);

  const statCol = (s: PlayerGameStats, cls: string, tag: string): string => `
    <div class="mc-go-col">
      <div class="mc-go-col-head ${cls}">${esc(s.name)} · ${tag}</div>
      <div class="mc-go-row"><span>Kills</span><span class="mc-go-val mc-go-pos">${s.unitsKilled}</span></div>
      <div class="mc-go-row"><span>Losses</span><span class="mc-go-val mc-go-neg">${s.unitsLost}</span></div>
      <div class="mc-go-row"><span>Trained</span><span class="mc-go-val">${s.unitsProduced}</span></div>
    </div>`;

  return {
    show(data: GameOverData): void {
      const titleCls = data.isVictory ? 'mc-go-victory' : 'mc-go-defeat';
      overlay.innerHTML = `
        <div class="mc-go-panel">
          <div class="mc-go-title ${titleCls}" style="transform:scale(0.5);opacity:0;">${data.isVictory ? 'VICTORY' : 'DEFEAT'}</div>
          <div class="mc-go-reason">${esc(data.reason)}</div>
          <div class="mc-go-time">⏱ ${esc(data.gameTime)}</div>
          <div class="mc-go-cols">
            ${statCol(data.local, 'mc-go-local', data.isVictory ? 'WIN' : 'LOSE')}
            ${statCol(data.enemy, 'mc-go-enemy', data.isVictory ? 'LOSE' : 'WIN')}
          </div>
          <button class="mc-go-btn" id="mc-go-menu">🏠 Return to Menu</button>
        </div>`;
      overlay.style.display = 'flex';
      const btn = overlay.querySelector('#mc-go-menu');
      btn?.addEventListener('click', () => {
        if (onReturnToMenu) onReturnToMenu();
        else if (typeof location !== 'undefined') location.href = `${location.pathname}?game=marscraft`;
      });
      // title entrance
      requestAnimationFrame(() => {
        const tl = overlay.querySelector('.mc-go-title') as HTMLElement | null;
        if (tl) { tl.style.transition = 'all .6s cubic-bezier(0.34,1.56,0.64,1)'; tl.style.transform = 'scale(1)'; tl.style.opacity = '1'; }
      });
    },
    hide(): void { overlay.style.display = 'none'; overlay.innerHTML = ''; },
    isVisible(): boolean { return overlay.style.display === 'flex'; },
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
