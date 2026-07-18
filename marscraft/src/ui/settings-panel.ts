/**
 * MarsCraft -> forgeax-engine — SettingsPanel (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/SettingsPanel.ts`: a modal with the
 * settings a CLIENT-ONLY forgeax game can actually apply — master/BGM volume
 * (→ AudioManager), edge-scroll on/off (→ input), and an FPS overlay toggle —
 * plus the source's hotkey reference list. Persisted to localStorage; opened with
 * F10 (or `open()`); `onChange` applies live. The source's renderer-detail
 * options (graphicsQuality / uiScale / minimapSize) are intentionally omitted —
 * a game doesn't own the render pipeline, so they'd be no-op stubs.
 */

import { resolveUiHost } from './ui-host';

export interface GameSettings {
  masterVolume: number; // 0..1
  bgmVolume: number;    // 0..1
  edgeScroll: boolean;
  showFPS: boolean;
}

const DEFAULTS: GameSettings = { masterVolume: 0.8, bgmVolume: 0.6, edgeScroll: true, showFPS: false };
const LS_KEY = 'marscraft.settings';

const HOTKEYS: Array<[string, string]> = [
  ['Arrows / WASD', 'Pan camera'], ['Wheel', 'Zoom'], ['Middle-drag', 'Grab-pan'],
  ['Left-click', 'Select'], ['Shift+Left', 'Add to selection'], ['Right-click', 'Move / Attack / Gather'],
  ['Ctrl+0-9', 'Set control group'], ['0-9', 'Select group (twice = center)'], ['Esc', 'Cancel'], ['F10', 'Settings'],
];

export interface SettingsPanelHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  get(): GameSettings;
  dispose(): void;
}

export interface SettingsPanelDeps {
  onChange: (s: GameSettings) => void;
}

function load(): GameSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS };
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch { return { ...DEFAULTS }; }
}
function save(s: GameSettings): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const STYLE_ID = 'mc-set-style';
const CSS = `
.mc-set-ov { position:absolute; inset:0; display:none; align-items:safe center; justify-content:center;
  overflow:auto; background:rgba(6,4,10,0.6); z-index:70; font-family:'Segoe UI',system-ui,sans-serif; }
.mc-set { background:linear-gradient(160deg,#1a1220,#0d0912); border:1px solid #4a3a5a; border-radius:12px;
  padding:22px 28px; min-width:420px; max-height:100%; overflow-y:auto; color:#d8c8e8; box-shadow:0 12px 48px rgba(0,0,0,0.6); }
.mc-set h2 { margin:0 0 14px; font-size:22px; color:#ffd24a; }
.mc-set-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 0; font-size:14px; }
.mc-set-row input[type=range] { width:180px; }
.mc-set-hk { margin-top:14px; border-top:1px solid #33283f; padding-top:10px; }
.mc-set-hk-row { display:flex; justify-content:space-between; font-size:12px; color:#a898c0; padding:1px 0; }
.mc-set-hk-key { color:#e8dcf4; font-weight:600; }
.mc-set-close { margin-top:16px; width:100%; background:linear-gradient(180deg,#6a4a8a,#4a2f6a); color:#fff;
  border:1px solid #7a5a9a; border-radius:8px; padding:9px; font-size:15px; font-weight:700; cursor:pointer; }
.mc-fps { position:absolute; top:8px; left:96px; z-index:53; background:rgba(12,8,16,0.7); border-radius:5px;
  padding:2px 8px; font:12px 'Segoe UI',monospace; color:#6ee06e; display:none; }
`;

export function installSettingsPanel(deps: SettingsPanelDeps): SettingsPanelHandle {
  const settings = load();

  if (typeof document === 'undefined') {
    deps.onChange(settings);
    return { open: () => {}, close: () => {}, toggle: () => {}, isOpen: () => false, get: () => settings, dispose: () => {} };
  }
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
  }
  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const host = resolveUiHost();

  // FPS overlay (toggled by showFPS).
  const fpsEl = document.createElement('div'); fpsEl.className = 'mc-fps'; host.appendChild(fpsEl);
  let frames = 0, fpsAcc = 0, fpsLast = performance.now(), fpsRaf = 0;
  const fpsTick = (): void => {
    frames++; const t = performance.now(); fpsAcc += t - fpsLast; fpsLast = t;
    if (fpsAcc >= 500) { fpsEl.textContent = `${Math.round((frames * 1000) / fpsAcc)} FPS`; frames = 0; fpsAcc = 0; }
    fpsRaf = requestAnimationFrame(fpsTick);
  };
  fpsRaf = requestAnimationFrame(fpsTick);

  const overlay = document.createElement('div'); overlay.className = 'mc-set-ov';
  const panel = document.createElement('div'); panel.className = 'mc-set';
  overlay.appendChild(panel); host.appendChild(overlay);

  const apply = (): void => {
    save(settings);
    fpsEl.style.display = settings.showFPS ? 'block' : 'none';
    deps.onChange(settings);
  };

  function render(): void {
    panel.innerHTML = `
      <h2>⚙ Settings</h2>
      <div class="mc-set-row"><span>Master volume</span><input type="range" id="mcs-master" min="0" max="1" step="0.05" value="${settings.masterVolume}"></div>
      <div class="mc-set-row"><span>Music volume</span><input type="range" id="mcs-bgm" min="0" max="1" step="0.05" value="${settings.bgmVolume}"></div>
      <div class="mc-set-row"><span>Edge scroll</span><input type="checkbox" id="mcs-edge" ${settings.edgeScroll ? 'checked' : ''}></div>
      <div class="mc-set-row"><span>Show FPS</span><input type="checkbox" id="mcs-fps" ${settings.showFPS ? 'checked' : ''}></div>
      <div class="mc-set-hk">${HOTKEYS.map(([k, d]) => `<div class="mc-set-hk-row"><span class="mc-set-hk-key">${k}</span><span>${d}</span></div>`).join('')}</div>
      <button class="mc-set-close" id="mcs-close">Close</button>`;
    (panel.querySelector('#mcs-master') as HTMLInputElement).addEventListener('input', (e) => { settings.masterVolume = parseFloat((e.target as HTMLInputElement).value); apply(); });
    (panel.querySelector('#mcs-bgm') as HTMLInputElement).addEventListener('input', (e) => { settings.bgmVolume = parseFloat((e.target as HTMLInputElement).value); apply(); });
    (panel.querySelector('#mcs-edge') as HTMLInputElement).addEventListener('change', (e) => { settings.edgeScroll = (e.target as HTMLInputElement).checked; apply(); });
    (panel.querySelector('#mcs-fps') as HTMLInputElement).addEventListener('change', (e) => { settings.showFPS = (e.target as HTMLInputElement).checked; apply(); });
    (panel.querySelector('#mcs-close') as HTMLElement).addEventListener('click', () => close());
  }

  const open = (): void => { render(); overlay.style.display = 'flex'; };
  const close = (): void => { overlay.style.display = 'none'; };
  const toggle = (): void => { overlay.style.display === 'flex' ? close() : open(); };

  const onKey = (e: KeyboardEvent): void => { if (e.code === 'F10') { e.preventDefault(); toggle(); } };
  window.addEventListener('keydown', onKey);

  apply(); // apply persisted settings on load

  return {
    open, close, toggle, isOpen: () => overlay.style.display === 'flex', get: () => settings,
    dispose: () => { window.removeEventListener('keydown', onKey); if (fpsRaf) cancelAnimationFrame(fpsRaf); overlay.remove(); fpsEl.remove(); },
  };
}
