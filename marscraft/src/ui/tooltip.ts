/**
 * MarsCraft -> forgeax-engine — hover TooltipSystem (Milestone M17 chunk C.1)
 * =============================================================================
 * Faithful port of the Three.js source `web/ui/TooltipSystem.ts`: an absolutely-
 * positioned floating panel that shows a rich SC2-style stat card when the mouse
 * hovers a command-card button. It replaces the M12 command card's inline `title=`
 * attribute with a proper panel (name + hotkey / cost / build time / core stats /
 * weapon line / description / tech requirement).
 *
 * ── Adaptations vs source ────────────────────────────────────────────────────
 *   - The source read `data-typeId / data-upgradeId / data-abilityId / data-
 *     morphTargetId` off `.cmd-btn`. This port drives the SAME idea with a single
 *     typed pair on each `.mc-cmd-btn`: `data-tt-kind` (unit|building|research|
 *     ability) + `data-tt-id` (the typeId / upgradeId / abilityId). The HUD
 *     (`hud.ts`) stamps these when it renders the card. `data-tt-locked="1"` marks
 *     a prereq-locked entry so the tech-requirement block shows.
 *   - The source split "unit" vs "building" tooltips by whether a BuildingDef
 *     exists for the typeId; this port keeps that (getBuildingDef(typeId)).
 *   - Names/descriptions: the source used an i18nHelper (getUnitName/getUnitDesc/…)
 *     that this port dropped (§data/units header) — displayName + description live
 *     on the data defs, so we read those directly and use `t()` only for the UI
 *     chrome labels (HP:/Damage:/…), matching how `hud.ts` does it.
 *   - Everything is DOM-guarded: with no `document` (headless), `installTooltip`
 *     returns a no-op handle and never touches the DOM.
 *
 * ── Not faked (documented seams vs the full source card) ──────────────────────
 *   The source card also rendered attack-orb / sustained-channel / morph-source
 *   sub-sections and a "unlocked-by-this-building" reverse index. Those extra
 *   sub-blocks are omitted here (this chunk's card covers name/cost/time/core
 *   stats/weapon/description/tech-req — the buttons the M12 card actually shows:
 *   train / build / research / ability). They are additive, not load-bearing for
 *   the command-card hover.
 */

import { getUnitDef, type UnitDef } from '../data/units';
import { getBuildingDef } from '../data/buildings';
import { getUpgradeDef } from '../data/upgrades';
import { getAbilityDef } from '../data/abilities';
import { getWeaponDef } from '../data/weapons';
import { t } from '../i18n';
import { resolveUiHost } from './ui-host';

// =============================================================================
// Handle
// =============================================================================

export interface TooltipHandle {
  /** True if the DOM tooltip element was created (document present). */
  active(): boolean;
  /**
   * Attach the tooltip to a command-card container (delegated hover). Idempotent:
   * a second call with the same element is a no-op. Buttons inside must carry
   * `data-tt-kind` + `data-tt-id` (see header).
   */
  bindToContainer(container: HTMLElement): void;
  /** Hide the tooltip (e.g. when the command card is rebuilt). */
  hide(): void;
  /**
   * Build the tooltip HTML for a kind+id WITHOUT touching the DOM (headless
   * verify): returns the inner HTML string, or '' if the id resolves to nothing.
   */
  renderFor(kind: TooltipKind, id: string, opts?: { locked?: boolean }): string;
  /** Remove the DOM element + listeners. */
  dispose(): void;
}

export type TooltipKind = 'unit' | 'building' | 'research' | 'ability';

// =============================================================================
// Style
// =============================================================================

const TT_STYLE_ID = 'marscraft-tooltip-style';
const TT_CSS = `
#marscraft-tooltip { position: absolute; z-index: 90; max-width: 260px; min-width: 150px;
  padding: 8px 10px; background: rgba(10,12,18,0.95); color: #e8e8ec;
  border: 1px solid rgba(255,102,51,0.45); border-radius: 6px; pointer-events: none;
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 12px;
  line-height: 1.35; box-shadow: 0 6px 20px rgba(0,0,0,0.5); display: none; }
#marscraft-tooltip.tt-show { display: block; }
#marscraft-tooltip .tt-title { font-size: 13px; font-weight: 800; color: #ffcc88; margin-bottom: 3px; }
#marscraft-tooltip .tt-combat-type { display: inline-block; font-size: 9px; font-weight: 700;
  padding: 1px 6px; border-radius: 3px; margin-bottom: 4px; letter-spacing: 0.5px; }
#marscraft-tooltip .tt-ct-bio { background: rgba(76,175,80,0.25); color: #9fe6a2; }
#marscraft-tooltip .tt-ct-armored { background: rgba(120,150,200,0.25); color: #a9c4ff; }
#marscraft-tooltip .tt-ct-psionic { background: rgba(178,102,255,0.25); color: #d3b0ff; }
#marscraft-tooltip .tt-type-tag { display: inline-block; font-size: 9px; font-weight: 700;
  padding: 1px 6px; border-radius: 3px; margin-bottom: 4px; background: rgba(255,180,90,0.2); color: #ffcc88; }
#marscraft-tooltip .tt-cost-row { display: flex; gap: 12px; font-weight: 700; margin: 3px 0; }
#marscraft-tooltip .tt-mineral { color: #66ccff; }
#marscraft-tooltip .tt-gas { color: #66ff88; }
#marscraft-tooltip .tt-supply { color: #ffcc44; }
#marscraft-tooltip .tt-energy { color: #b266ff; }
#marscraft-tooltip .tt-stat-row { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; }
#marscraft-tooltip .tt-stat-label { color: #a8adba; }
#marscraft-tooltip .tt-stat-val { color: #e8e8ec; font-weight: 600; }
#marscraft-tooltip .tt-shield { color: #4aa3ff; }
#marscraft-tooltip .tt-divider { height: 1px; margin: 5px 0;
  background: linear-gradient(90deg, transparent, rgba(255,102,51,0.35), transparent); }
#marscraft-tooltip .tt-desc { color: #c8ccd6; font-size: 11px; font-style: italic; }
#marscraft-tooltip .tt-attack-type { color: #cfd2da; font-size: 10px; margin-top: 3px; }
#marscraft-tooltip .tt-no-attack { color: #ff9a8a; }
#marscraft-tooltip .tt-section-label { color: rgba(255,180,120,0.7); font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1px; margin-top: 3px; }
#marscraft-tooltip .tt-prereq-item, #marscraft-tooltip .tt-unlock-item { color: #c8ccd6; font-size: 10px; }
#marscraft-tooltip .tt-tech-req { color: #ffb37a; font-size: 10px; margin-top: 3px; }
#marscraft-tooltip .tt-flavor { color: #a8adba; font-size: 10px; margin-top: 3px; }
`;

// =============================================================================
// Installer
// =============================================================================

export function installTooltip(): TooltipHandle {
  // ── headless guard ─────────────────────────────────────────────────────────
  if (typeof document === 'undefined') {
    return {
      active: () => false,
      bindToContainer: () => {},
      hide: () => {},
      renderFor: (kind, id, opts) => buildHtml(kind, id, !!opts?.locked),
      dispose: () => {},
    };
  }

  if (!document.getElementById(TT_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = TT_STYLE_ID;
    style.textContent = TT_CSS;
    document.head.appendChild(style);
  }

  // Remove a stale element from a prior bootstrap (HMR).
  document.getElementById('marscraft-tooltip')?.remove();

  const el = document.createElement('div');
  el.id = 'marscraft-tooltip';
  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const parent = resolveUiHost();
  parent.appendChild(el);

  let visible = false;
  let currentBtn: HTMLElement | null = null;
  const boundContainers = new Set<HTMLElement>();

  function positionAt(mx: number, my: number): void {
    const rect = parent.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer above-and-right of the cursor; flip when it would clip the viewport.
    let x = mx + 14;
    let y = my - h - 10;
    if (x + w > vw - 8) x = mx - w - 14;
    if (x < 8) x = 8;
    if (y < 8) y = my + 22;
    if (y + h > vh - 8) y = vh - h - 8;
    // Convert viewport coords to parent-relative (the panel is absolute in parent).
    el.style.left = `${x - rect.left}px`;
    el.style.top = `${y - rect.top}px`;
  }

  function showForButton(btn: HTMLElement, mx: number, my: number): void {
    const kind = btn.dataset.ttKind as TooltipKind | undefined;
    const id = btn.dataset.ttId;
    if (!kind || !id) { hide(); return; }
    const locked = btn.dataset.ttLocked === '1';
    const html = buildHtml(kind, id, locked);
    if (!html) { hide(); return; }
    currentBtn = btn;
    el.innerHTML = html;
    el.classList.add('tt-show');
    visible = true;
    positionAt(mx, my);
  }

  function hide(): void {
    if (!visible && !currentBtn) return;
    visible = false;
    currentBtn = null;
    el.classList.remove('tt-show');
  }

  function onOver(ev: MouseEvent): void {
    const btn = (ev.target as HTMLElement)?.closest<HTMLElement>('.mc-cmd-btn');
    if (!btn) return;
    if (btn === currentBtn) return;
    showForButton(btn, ev.clientX, ev.clientY);
  }

  function onMove(ev: MouseEvent): void {
    if (!visible) return;
    const btn = (ev.target as HTMLElement)?.closest<HTMLElement>('.mc-cmd-btn');
    if (!btn) { hide(); return; }
    if (btn !== currentBtn) { showForButton(btn, ev.clientX, ev.clientY); return; }
    positionAt(ev.clientX, ev.clientY);
  }

  function onLeave(): void { hide(); }

  return {
    active: () => true,
    bindToContainer: (container: HTMLElement) => {
      if (boundContainers.has(container)) return;
      boundContainers.add(container);
      container.addEventListener('mouseover', onOver);
      container.addEventListener('mousemove', onMove);
      container.addEventListener('mouseleave', onLeave);
    },
    hide,
    renderFor: (kind, id, opts) => buildHtml(kind, id, !!opts?.locked),
    dispose: () => {
      for (const c of boundContainers) {
        c.removeEventListener('mouseover', onOver);
        c.removeEventListener('mousemove', onMove);
        c.removeEventListener('mouseleave', onLeave);
      }
      boundContainers.clear();
      el.remove();
    },
  };
}

// =============================================================================
// HTML builders (pure — shared by DOM + headless renderFor)
// =============================================================================

function buildHtml(kind: TooltipKind, id: string, locked: boolean): string {
  switch (kind) {
    case 'unit':
    case 'building':
      return unitHtml(id, locked);
    case 'research':
      return upgradeHtml(id);
    case 'ability':
      return abilityHtml(id);
    default:
      return '';
  }
}

const COMBAT_TYPE_CSS: Record<string, string> = {
  bio: 'tt-ct-bio',
  armored: 'tt-ct-armored',
  psionic: 'tt-ct-psionic',
};

function combatTypeTag(def: UnitDef): string {
  const cls = COMBAT_TYPE_CSS[def.combatType];
  if (!cls) return '';
  return `<div class="tt-combat-type ${cls}">${escapeHtml(t(`combat_type.${def.combatType}`))}</div>`;
}

function costRow(mineral: number, gas: number, supply: number): string {
  const parts: string[] = [`<span class="tt-mineral">◆ ${mineral}</span>`];
  if (gas > 0) parts.push(`<span class="tt-gas">♦ ${gas}</span>`);
  if (supply > 0) parts.push(`<span class="tt-supply">▣ ${supply}</span>`);
  return `<div class="tt-cost-row">${parts.join('')}</div>`;
}

function statRow(label: string, val: string, valClass = ''): string {
  return `<div class="tt-stat-row"><span class="tt-stat-label">${escapeHtml(label)}</span><span class="tt-stat-val ${valClass}">${escapeHtml(val)}</span></div>`;
}

/** Unit OR building card (the source split on BuildingDef existence). */
function unitHtml(typeId: string, locked: boolean): string {
  const def = getUnitDef(typeId);
  if (!def) return '';
  const bDef = getBuildingDef(typeId);
  const isBuilding = !!bDef || def.category === 'building';
  const hotkey = bDef?.hotkey ?? '';
  const hk = hotkey ? ` (${hotkey.toUpperCase()})` : '';
  const verb = isBuilding ? t('tooltip.build') : t('tooltip.train');

  let html = `<div class="tt-title">${escapeHtml(verb + def.displayName + hk)}</div>`;
  html += combatTypeTag(def);
  html += costRow(def.mineralCost, def.gasCost, def.supplyCost);
  html += `<div class="tt-stat-row"><span class="tt-stat-label">⏱</span><span class="tt-stat-val">${def.buildTime}s</span></div>`;

  if (def.description) {
    html += '<div class="tt-divider"></div>';
    html += `<div class="tt-desc">${escapeHtml(def.description)}</div>`;
  }

  html += '<div class="tt-divider"></div>';
  html += statRow(t('tooltip.hp'), String(def.hp));
  if (def.shield > 0) html += statRow(t('tooltip.shield'), String(def.shield), 'tt-shield');
  html += statRow(t('tooltip.armor'), String(def.armor));
  if (def.energyMax && def.energyMax > 0) html += statRow(t('tooltip.energy'), String(def.energyMax), 'tt-energy');

  // Weapon line.
  if (def.weaponId) {
    const wpn = getWeaponDef(def.weaponId);
    if (wpn) {
      html += '<div class="tt-divider"></div>';
      html += statRow(t('tooltip.damage'), `${wpn.damage}${wpn.damageCount > 1 ? ` x${wpn.damageCount}` : ''}`);
      html += statRow(t('tooltip.range'), String(wpn.rangeGrid));
      html += statRow(t('tooltip.attack_speed'), `${wpn.cooldown}s`);
      if (wpn.splashRadius > 0) html += statRow(t('tooltip.splash'), wpn.splashRadius.toFixed(1));
      const targets: string[] = [];
      if (wpn.canAttackGround) targets.push(t('tooltip.can_attack_ground'));
      if (wpn.canAttackAir) targets.push(t('tooltip.can_attack_air'));
      if (targets.length) html += `<div class="tt-attack-type">${escapeHtml(t('tooltip.can') + targets.join(' / '))}</div>`;
    }
  } else if (!isBuilding) {
    html += `<div class="tt-attack-type tt-no-attack">${escapeHtml(t('tooltip.cannot_attack'))}</div>`;
  }

  if (!isBuilding && def.speed > 0) html += statRow(t('tooltip.move_speed'), String(def.speed));

  // Building-specific: what it unlocks.
  if (bDef) {
    const unlocks: string[] = [];
    for (const pid of bDef.canProduce) {
      const ud = getUnitDef(pid);
      if (ud) unlocks.push(t('tooltip.can_train') + ud.displayName);
    }
    for (const rid of bDef.canResearch) {
      const upg = getUpgradeDef(rid);
      if (upg) unlocks.push(t('tooltip.can_research') + upg.displayName);
    }
    if (unlocks.length) {
      html += '<div class="tt-divider"></div>';
      html += `<div class="tt-section-label">${escapeHtml(t('tooltip.unlocks'))}</div>`;
      for (const u of unlocks) html += `<div class="tt-unlock-item">- ${escapeHtml(u)}</div>`;
    }
    // Tech requirement (only when locked).
    if (locked && bDef.prerequisite.length) {
      html += '<div class="tt-divider"></div>';
      html += `<div class="tt-section-label">${escapeHtml(t('tooltip.tech_requirement'))}</div>`;
      for (const p of bDef.prerequisite) {
        const ud = getUnitDef(p);
        html += `<div class="tt-prereq-item">- ${escapeHtml(ud?.displayName ?? p)}</div>`;
      }
    }
  }

  // Unit train prerequisite (only when locked).
  if (locked && !isBuilding && def.trainPrerequisite && def.trainPrerequisite.length) {
    html += '<div class="tt-divider"></div>';
    html += `<div class="tt-section-label">${escapeHtml(t('tooltip.tech_requirement'))}</div>`;
    for (const p of def.trainPrerequisite) {
      const ud = getUnitDef(p);
      html += `<div class="tt-prereq-item">- ${escapeHtml(ud?.displayName ?? p)}</div>`;
    }
  }

  if (def.transportCapacity && def.transportCapacity > 0) {
    html += `<div class="tt-flavor">${escapeHtml(t('tooltip.loadable') + def.transportCapacity + t('tooltip.units_suffix'))}</div>`;
  }

  return html;
}

function upgradeHtml(upgradeId: string): string {
  const upg = getUpgradeDef(upgradeId);
  if (!upg) return '';
  const hk = upg.hotkey ? ` (${upg.hotkey.toUpperCase()})` : '';
  let html = `<div class="tt-title">${escapeHtml(t('tooltip.research') + upg.displayName + hk)}</div>`;
  html += costRow(upg.mineralCostPerLevel, upg.gasCostPerLevel, 0);
  html += `<div class="tt-stat-row"><span class="tt-stat-label">⏱</span><span class="tt-stat-val">${upg.researchTimePerLevel}s</span></div>`;
  if (upg.maxLevel > 1) html += statRow(t('tooltip.max_level'), String(upg.maxLevel));
  if (upg.description) {
    html += '<div class="tt-divider"></div>';
    html += `<div class="tt-desc">${escapeHtml(upg.description)}</div>`;
  }
  return html;
}

function abilityHtml(abilityId: string): string {
  const def = getAbilityDef(abilityId);
  if (!def) return '';
  const hk = def.hotkeyLabel ? ` (${def.hotkeyLabel})` : '';
  let html = `<div class="tt-title">${escapeHtml(def.displayName + hk)}</div>`;
  if (def.isPassive) html += `<div class="tt-type-tag">${escapeHtml(t('tooltip.passive_skill'))}</div>`;
  else if (def.isAutocast) html += `<div class="tt-type-tag">${escapeHtml(t('tooltip.autocast_hint'))}</div>`;

  const costs: string[] = [];
  if (def.energyCost > 0) costs.push(`<span class="tt-energy">⚡ ${def.energyCost}</span>`);
  if (costs.length) html += `<div class="tt-cost-row">${costs.join('')}</div>`;

  if (def.cooldown > 0) html += statRow(t('tooltip.cooldown'), `${def.cooldown}${t('tooltip.sec_suffix')}`);
  if (def.castRange > 0) html += statRow(t('tooltip.cast_range'), String(def.castRange));
  if (def.castTime && def.castTime > 0) html += statRow(t('tooltip.cast_time'), `${def.castTime}${t('tooltip.sec_suffix')}`);

  if (def.description) {
    html += '<div class="tt-divider"></div>';
    html += `<div class="tt-desc">${escapeHtml(def.description)}</div>`;
  }
  if (def.requiredUpgrade) {
    const upg = getUpgradeDef(def.requiredUpgrade);
    html += `<div class="tt-tech-req">${escapeHtml(t('tooltip.requires_research') + ' ' + (upg?.displayName ?? def.requiredUpgrade))}</div>`;
  }
  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
