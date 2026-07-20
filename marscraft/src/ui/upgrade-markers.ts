/**
 * MarsCraft -> forgeax-engine — UpgradeMarkerDisplay (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/UpgradeMarkerDisplay.ts`: small badges
 * showing the LOCAL player's researched MULTI-LEVEL upgrades (weapon/armor tiers
 * — maxLevel > 1; the one-shot maxLevel-1 tech unlocks are omitted, as in the
 * source) with their current level. Reads `getLevel(upgradeId)` each (throttled)
 * frame. DOM-guarded; `probe()` reports for verify.
 */

import { ALL_UPGRADES, getUpgradeDef } from '../data/upgrades';
import { resolveUiHost } from './ui-host';

/** Upgrade-id → emoji (weapon/armor/shield tiers). Fallback ⬆. */
const UPGRADE_ICONS: Record<string, string> = {
  infantry_weapons: '🔫', infantry_armor: '🛡️', vehicle_weapons: '🚀', vehicle_armor: '🔩',
  ship_weapons: '✈️', ship_armor: '🛰️', melee_attacks: '⚔️', missile_attacks: '🎯',
  ground_carapace: '🐚', flyer_attacks: '🦇', flyer_carapace: '🪶',
  ground_weapons: '⚔️', ground_armor: '🛡️', air_weapons: '✈️', air_armor: '🛰️',
  shields: '🔷',
};

export interface UpgradeMarkersHandle {
  active(): boolean;
  probe(): Array<{ id: string; level: number }>;
  dispose(): void;
}

const STYLE_ID = 'mc-um-style';
const CSS = `
.mc-um { position:absolute; top:44px; right:12px; z-index:53; display:flex; gap:5px; flex-wrap:wrap;
  max-width:260px; justify-content:flex-end; font-family:'Segoe UI',system-ui,sans-serif; }
.mc-um-badge { display:flex; align-items:center; gap:3px; background:rgba(12,8,16,0.78); border:1px solid #4a3a5a;
  border-radius:5px; padding:2px 6px; font-size:12px; color:#d8c8e8; }
.mc-um-lvl { font-weight:700; color:#ffd24a; }
`;

export interface UpgradeMarkersDeps {
  /** Current level of an upgrade for the LOCAL player (0 = not researched). */
  getLevel: (upgradeId: string) => number;
}

/** The multi-level upgrades to show (maxLevel > 1), computed once. */
const MULTI = ALL_UPGRADES.filter((u) => u.maxLevel > 1);

export function installUpgradeMarkers(deps: UpgradeMarkersDeps): UpgradeMarkersHandle {
  const snapshot = (): Array<{ id: string; level: number }> =>
    MULTI.map((u) => ({ id: u.upgradeId, level: deps.getLevel(u.upgradeId) })).filter((e) => e.level > 0);

  if (typeof document === 'undefined') {
    return { active: () => false, probe: snapshot, dispose: () => {} };
  }
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
  }
  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const host = resolveUiHost();
  const box = document.createElement('div'); box.className = 'mc-um'; host.appendChild(box);

  let lastSig = '';
  function update(): void {
    const list = snapshot();
    const sig = list.map((e) => `${e.id}:${e.level}`).join(',');
    if (sig === lastSig) return;
    lastSig = sig;
    if (list.length === 0) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'flex';
    box.innerHTML = list.map((e) => {
      const icon = UPGRADE_ICONS[e.id] ?? '⬆';
      const name = getUpgradeDef(e.id)?.displayName ?? e.id;
      return `<div class="mc-um-badge" title="${name} Lv.${e.level}"><span>${icon}</span><span class="mc-um-lvl">${e.level}</span></div>`;
    }).join('');
  }

  let raf = 0, alive = true, acc = 0, last = performance.now();
  const tick = (): void => {
    if (!alive) return;
    const t = performance.now(); acc += t - last; last = t;
    if (acc >= 400) { acc = 0; update(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  update();

  return { active: () => alive, probe: snapshot, dispose: () => { alive = false; if (raf) cancelAnimationFrame(raf); box.remove(); } };
}
