/**
 * MarsCraft -> forgeax-engine — ControlGroupBar (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/ControlGroupBar.ts`: a row of tabs (below
 * the resource bar) for each non-empty control group — number + a representative
 * unit-type icon + the live member count, the active group highlighted. Click a
 * tab → recall (select) the group; double-click → recall + centre the camera.
 * Reads the ControlGroupSystem (storage/hotkeys); DOM-guarded + throttled rAF.
 */

import type { EntityHandle } from '@forgeax/engine-ecs';
import { unitTypeId } from '../components';
import type { ControlGroupHandle } from '../systems/control-groups';
import { resolveUiHost } from './ui-host';

/** Unit-type → emoji icon (port of the source TYPE_ICONS, trimmed to shipped units). */
const TYPE_ICONS: Record<string, string> = {
  scv: '⛏️', marine: '🔫', firebat: '🔥', marauder: '🎯', tank: '🪖', goliath: '🤖', thor: '⚡', wraith: '✈️', medivac: '🚁', ghost: '👻', raider: '🏍️',
  drone: '🐛', zergling: '🦂', roach: '🪳', hydralisk: '🐍', lurker: '🕳️', baneling: '💣', ravager: '🌋', mutalisk: '🦇', corruptor: '👾', ultralisk: '🦏', overlord: '🎈', larva: '🥚',
  probe: '🔮', zealot: '⚔️', adept: '💫', dragoon: '🛡️', stalker: '🔮', colossus: '🦿', immortal: '🏛️', phoenix: '🕊️', void_ray: '🔆', dark_templar: '🗡️', sentry: '🔱',
};

export interface ControlGroupBarHandle {
  active(): boolean;
  dispose(): void;
}

const STYLE_ID = 'mc-cg-style';
const CSS = `
.mc-cg-bar { position:absolute; top:44px; left:50%; transform:translateX(-50%); z-index:54; display:flex; gap:5px;
  font-family:'Segoe UI',system-ui,sans-serif; pointer-events:none; }
.mc-cg-tab { pointer-events:auto; display:flex; align-items:center; gap:4px; background:rgba(12,8,16,0.8);
  border:1px solid #4a3a5a; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:13px; color:#d8c8e8; }
.mc-cg-tab:hover { filter:brightness(1.2); }
.mc-cg-active { border-color:#ffd24a; box-shadow:0 0 8px rgba(255,200,60,0.4); }
.mc-cg-num { font-weight:700; color:#9a8aba; } .mc-cg-count { font-weight:700; color:#e8dcf4; }
`;

export interface ControlGroupBarDeps {
  groups: ControlGroupHandle;
  onRecall: (n: number) => void;
  onCenter: (n: number) => void;
}

export function installControlGroupBar(deps: ControlGroupBarDeps): ControlGroupBarHandle {
  if (typeof document === 'undefined') return { active: () => false, dispose: () => {} };
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
  }
  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const host = resolveUiHost();
  const bar = document.createElement('div');
  bar.className = 'mc-cg-bar';
  host.appendChild(bar);

  const mainType = (members: EntityHandle[]): string => {
    const counts = new Map<string, number>();
    for (const e of members) {
      const tid = unitTypeId.get(e) ?? 'unknown';
      counts.set(tid, (counts.get(tid) ?? 0) + 1);
    }
    let best = '', bestC = 0;
    for (const [t, c] of counts) if (c > bestC) { best = t; bestC = c; }
    return best;
  };

  let lastSig = '';
  function update(): void {
    const p = deps.groups.probe();
    // signature: only rebuild the DOM when the group set/counts/active changed.
    const sig = `${p.active}|${Object.entries(p.groups).map(([n, c]) => `${n}:${c}`).join(',')}`;
    if (sig === lastSig) return;
    lastSig = sig;
    bar.innerHTML = '';
    for (let n = 0; n <= 9; n++) {
      const members = deps.groups.getGroup(n);
      if (members.length === 0) continue;
      const tab = document.createElement('div');
      tab.className = 'mc-cg-tab' + (p.active === n ? ' mc-cg-active' : '');
      const icon = TYPE_ICONS[mainType(members)] ?? '🔹';
      tab.innerHTML = `<span class="mc-cg-num">${n}</span><span>${icon}</span><span class="mc-cg-count">${members.length}</span>`;
      tab.addEventListener('click', (ev) => { ev.detail >= 2 ? deps.onCenter(n) : deps.onRecall(n); });
      bar.appendChild(tab);
    }
  }

  let raf = 0, alive = true;
  let acc = 0, last = performance.now();
  const tick = (): void => {
    if (!alive) return;
    const t = performance.now(); acc += t - last; last = t;
    if (acc >= 150) { acc = 0; update(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  update();

  return {
    active: () => alive && bar.children.length > 0,
    dispose: () => { alive = false; if (raf) cancelAnimationFrame(raf); bar.remove(); },
  };
}
