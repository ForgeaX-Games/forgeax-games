/**
 * MarsCraft -> forgeax-engine — GameTimeAPM (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/GameTimeAPM.ts`: a small top widget
 * showing elapsed game time (mm:ss) + live APM (actions in a 60s sliding window,
 * counting mousedown + keydown). DOM-guarded (no-ops headless; `probe()` reports).
 */

import { resolveUiHost } from './ui-host';

export interface GameTimeApmHandle {
  active(): boolean;
  probe(): { time: string; apm: number };
  dispose(): void;
}

const STYLE_ID = 'mc-gta-style';
const CSS = `
.mc-gta { position:absolute; top:8px; left:50%; transform:translateX(-50%); z-index:53;
  display:flex; gap:14px; align-items:center; background:rgba(12,8,16,0.72); border:1px solid #4a3a5a;
  border-radius:6px; padding:3px 12px; font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; color:#d8c8e8; }
.mc-gta-lbl { color:#8a7a9a; margin-right:3px; }
.mc-gta-val { font-weight:700; color:#e8dcf4; }
`;

const WINDOW_MS = 60000;

export function installGameTimeApm(): GameTimeApmHandle {
  const start = typeof performance !== 'undefined' ? performance.now() : 0;
  const actions: number[] = [];
  let time = '00:00';
  let apm = 0;

  const record = (): void => { actions.push(typeof performance !== 'undefined' ? performance.now() : 0); };

  const compute = (): void => {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const elapsed = (nowMs - start) / 1000;
    const mn = Math.floor(elapsed / 60), sc = Math.floor(elapsed % 60);
    time = `${String(mn).padStart(2, '0')}:${String(sc).padStart(2, '0')}`;
    const cutoff = nowMs - WINDOW_MS;
    while (actions.length > 0 && actions[0] < cutoff) actions.shift();
    apm = actions.length;
  };

  if (typeof document === 'undefined') {
    // headless: still count via no listeners; probe reports 00:00/0.
    return { active: () => false, probe: () => { compute(); return { time, apm }; }, dispose: () => {} };
  }
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
  }
  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const host = resolveUiHost();
  const el = document.createElement('div');
  el.className = 'mc-gta';
  const timeEl = document.createElement('span'); timeEl.className = 'mc-gta-val';
  const apmEl = document.createElement('span'); apmEl.className = 'mc-gta-val';
  el.innerHTML = '<span class="mc-gta-lbl">⏱</span>';
  el.appendChild(timeEl);
  const apmLbl = document.createElement('span'); apmLbl.className = 'mc-gta-lbl'; apmLbl.textContent = 'APM';
  el.appendChild(apmLbl); el.appendChild(apmEl);
  host.appendChild(el);

  window.addEventListener('mousedown', record);
  window.addEventListener('keydown', record);

  let raf = 0, alive = true, acc = 0, last = performance.now();
  const tick = (): void => {
    if (!alive) return;
    const t = performance.now(); acc += t - last; last = t;
    if (acc >= 250) { acc = 0; compute(); timeEl.textContent = time; apmEl.textContent = String(apm); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  compute(); timeEl.textContent = time; apmEl.textContent = String(apm);

  return {
    active: () => alive,
    probe: () => { compute(); return { time, apm }; },
    dispose: () => { alive = false; if (raf) cancelAnimationFrame(raf); window.removeEventListener('mousedown', record); window.removeEventListener('keydown', record); el.remove(); },
  };
}
