/**
 * MarsCraft -> forgeax-engine — in-game HUD (Milestone M12 chunk 1)
 * =============================================================================
 * The core SC-style in-game HUD as DOM overlays over the `#app` canvas — the
 * proven 2D-UI pattern in this port (the selection marquee + minimap use it too).
 * Faithful in spirit to the source `web/ui/{UnitPortraitPanel,CommandQueueRenderer}.ts`
 * + `web/index.html`'s HUD layout, condensed into one frame-driven installer.
 *
 * Panels (ALL real, driven from LIVE game state every update — no snapshots):
 *   - RESOURCE BAR (top-right): minerals / gas / supply(used/max), polled from
 *     `resourceManager.getResources(localPlayer)`; supply turns red when capped.
 *   - SELECTION PANEL (bottom-center): 1 unit -> portrait + name + hp/shield/
 *     energy bars + key stats (dmg/armor/range); N units -> a wrap grid of unit
 *     icons (click an icon = select just that unit).
 *   - COMMAND CARD (bottom-right, 3x5 like SC): for the selected unit, actionable
 *     buttons — a building's TRAIN options (-> buildingSystem.trainUnit) + research
 *     (-> buildingSystem.researchUpgrade); a worker's BUILD options (->
 *     placement.beginPlacement); a unit's ABILITIES (-> abilitySystem.castAbility).
 *     Buttons show cost + hotkey; greyed when unaffordable / prereq-missing / on
 *     cooldown. Clicking performs the real action.
 *   - PRODUCTION QUEUE strip: on a selected producing building, the queue items +
 *     the head's progress bar.
 *   - CURSOR (CursorManager): swaps the CSS cursor by interaction mode.
 *
 * Everything is DOM-guarded: with no `document` (headless) `installHud` returns a
 * no-op handle and never touches the DOM. The update loop reads LIVE handles each
 * tick (throttled ~18fps) so the HUD always reflects current state.
 *
 * ── Chunk-2 seam (marked, NOT faked) ─────────────────────────────────────────
 *   MainMenu, DebugPanel and the full hover TooltipSystem are M12 chunk 2. This
 *   chunk wires the in-game HUD only; command-card buttons carry their cost/hotkey
 *   inline (a lightweight title attr), not the rich tooltip panel.
 */

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import {
  Health, Energy, UnitType, Building, Attack,
  unitTypeId, unitDisplayName, buildingProductionQueue,
  BUILDING_STATE,
} from '../components';
import { getUnitDef, type UnitDef } from '../data/units';
import {
  getBuildingDef, getBuildingsForRaceAndTab, type BuildingDef, type BuildTab,
} from '../data/buildings';
import { getAbilitiesForUnit, type AbilityDef } from '../data/abilities';
import { getUpgradeDef } from '../data/upgrades';
import { t } from '../i18n';
import { CursorManager, type CursorState } from './cursor-manager';
import { installTooltip, type TooltipHandle } from './tooltip';

// =============================================================================
// Deps + handle
// =============================================================================

/** Resource manager subset the HUD reads. */
export interface HudResourceManager {
  getResources(playerId: number): { minerals: number; gas: number; supply: number; supplyMax: number } | undefined;
  getMineralRate?(playerId: number): number;
  canAfford?(playerId: number, minerals: number, gas: number, supply: number): boolean;
}

/** Selection handle subset the HUD reads + drives. */
export interface HudSelection {
  getSelected(): EntityHandle[];
  select(entities: EntityHandle[]): void;
}

/** Building system subset the HUD drives. */
export interface HudBuildingSystem {
  trainUnit(buildingEntity: EntityHandle, typeId: string): boolean;
  researchUpgrade(buildingEntity: EntityHandle, upgradeId: string): boolean;
  checkPrerequisites(playerId: number, buildingTypeId: string): boolean;
  getUpgradeLevel(playerId: number, upgradeId: string): number;
}

/** Placement handle subset the HUD drives. */
export interface HudPlacement {
  beginPlacement(typeId: string, builderEntity?: EntityHandle | null): boolean;
}

/** Ability system subset the HUD drives. */
export interface HudAbilitySystem {
  castAbility(caster: EntityHandle, abilityId: string, target?: { targetEntity?: EntityHandle; x?: number; z?: number }): boolean;
  canCast?(caster: EntityHandle, abilityId: string, target?: { targetEntity?: EntityHandle; x?: number; z?: number }): boolean;
}

export interface HudDeps {
  world: World;
  localPlayerId: number;
  resourceManager: HudResourceManager;
  selection: HudSelection;
  buildingSystem?: HudBuildingSystem | null;
  placement?: HudPlacement | null;
  abilitySystem?: HudAbilitySystem | null;
  /** Update rate (Hz). Default 18. */
  updateHz?: number;
}

/** A single command-card button's reportable state (for hudState()). */
export interface CommandButtonState {
  id: string;
  label: string;
  hotkey: string;
  kind: 'train' | 'research' | 'build' | 'ability' | 'nav';
  enabled: boolean;
  cost?: { minerals: number; gas: number; supply?: number };
  /**
   * Hover-tooltip metadata (M17 chunk C.1). `kind` selects the card type and `id`
   * the def to look up; `locked` is true when the entry is prereq-gated (shows the
   * tech-requirement block). The DOM stamps these as `data-tt-*` on the button so
   * the TooltipSystem (ui/tooltip.ts) renders a rich card on hover.
   */
  tt?: { kind: 'unit' | 'building' | 'research' | 'ability'; id: string; locked: boolean };
}

/** The whole-HUD reportable snapshot (for headless verify via hudState()). */
export interface HudStateSnapshot {
  resourceBar: { minerals: number; gas: number; supply: number; supplyMax: number; text: string };
  selection: {
    count: number;
    single: null | { typeId: string; name: string; hp: number; maxHp: number; shield: number; energy: number };
  };
  commandCard: CommandButtonState[];
  productionQueue: Array<{ itemId: string; progress: number; buildTime: number }>;
}

export interface HudHandle {
  /** True if the DOM HUD was actually created (document present). */
  active(): boolean;
  /** The cursor manager (mode/hover cursor control). */
  cursor: CursorManager;
  /** The hover tooltip system bound to the command card (M17 chunk C.1). */
  tooltip: TooltipHandle;
  /** Live HUD snapshot reflecting current game state (headless-safe). */
  hudState(): HudStateSnapshot;
  /** Simulate a command-card button click by id; returns true if performed. */
  clickCommand(buttonId: string): boolean;
  /** Remove the DOM + stop the update loop (HMR / teardown). */
  dispose(): void;
}

// =============================================================================
// Style (single injected <style>; plain CSS — this is a standalone game canvas
// page, the interface package's preflight/token issues don't apply).
// =============================================================================

const HUD_STYLE_ID = 'marscraft-hud-style';
const HUD_CSS = `
#marscraft-hud, #marscraft-hud * { box-sizing: border-box; }
#marscraft-hud { position: absolute; inset: 0; pointer-events: none; z-index: 60;
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #e8e8ec;
  user-select: none; }
#mc-resource-bar { position: absolute; top: 10px; right: 14px; display: flex; gap: 18px;
  padding: 6px 14px; background: rgba(12,14,20,0.78); border: 1px solid rgba(255,102,51,0.35);
  border-radius: 6px; font-size: 15px; font-weight: 600; pointer-events: auto; }
#mc-resource-bar .mc-res { display: flex; align-items: center; gap: 5px; }
#mc-resource-bar .mc-res-icon { font-size: 14px; }
.mc-res-min { color: #66ccff; }
.mc-res-gas { color: #66ff88; }
.mc-res-sup { color: #ffcc44; }
.mc-res-sup.mc-blocked { color: #ff4444; }
#mc-selection { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
  width: 360px; min-height: 96px; padding: 8px 10px; background: rgba(12,14,20,0.80);
  border: 1px solid rgba(255,102,51,0.30); border-radius: 6px; pointer-events: auto;
  display: none; }
#mc-selection.mc-show { display: block; }
.mc-sel-single { display: flex; gap: 10px; }
.mc-portrait { width: 76px; height: 76px; flex: 0 0 76px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center; font-size: 40px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18); }
.mc-sel-info { flex: 1; min-width: 0; }
.mc-sel-name { font-size: 15px; font-weight: 700; margin-bottom: 4px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.mc-bar { height: 9px; border-radius: 3px; background: rgba(255,255,255,0.12);
  overflow: hidden; margin: 3px 0; position: relative; }
.mc-bar > span { display: block; height: 100%; }
.mc-bar-hp > span { background: #4caf50; }
.mc-bar-shield > span { background: #4aa3ff; }
.mc-bar-energy > span { background: #b266ff; }
.mc-bar-label { font-size: 10px; color: #cfd2da; position: absolute; right: 4px; top: -1px;
  line-height: 9px; }
.mc-sel-stats { font-size: 11px; color: #c8ccd6; margin-top: 5px; display: flex;
  flex-wrap: wrap; gap: 8px; }
.mc-sel-grid { display: flex; flex-wrap: wrap; gap: 4px; max-height: 84px; overflow: hidden; }
.mc-sel-cell { width: 38px; height: 38px; border-radius: 4px; display: flex; align-items: center;
  justify-content: center; font-size: 18px; background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.18); cursor: pointer; position: relative; }
.mc-sel-cell .mc-cell-hp { position: absolute; bottom: 1px; left: 2px; right: 2px; height: 3px;
  border-radius: 2px; background: rgba(255,255,255,0.15); overflow: hidden; }
.mc-sel-cell .mc-cell-hp > span { display: block; height: 100%; background: #4caf50; }
#mc-command { position: absolute; bottom: 10px; right: 14px; width: 188px;
  display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(5, 34px);
  gap: 4px; pointer-events: auto; }
.mc-cmd-btn { background: rgba(20,24,34,0.85); border: 1px solid rgba(255,255,255,0.22);
  border-radius: 4px; color: #e8e8ec; font-size: 11px; font-weight: 600; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 2px; overflow: hidden; line-height: 1.05; }
.mc-cmd-btn:hover { border-color: rgba(255,180,90,0.8); }
.mc-cmd-btn .mc-cmd-hk { color: #ffcc44; font-size: 9px; }
.mc-cmd-btn .mc-cmd-cost { color: #66ccff; font-size: 8px; }
.mc-cmd-btn.mc-disabled { opacity: 0.42; cursor: not-allowed; border-color: rgba(255,255,255,0.10); }
.mc-cmd-btn.mc-kind-build { border-left: 2px solid #66ccff; }
.mc-cmd-btn.mc-kind-train { border-left: 2px solid #ffcc44; }
.mc-cmd-btn.mc-kind-research { border-left: 2px solid #b266ff; }
.mc-cmd-btn.mc-kind-ability { border-left: 2px solid #ff8866; }
#mc-prodqueue { position: absolute; bottom: 116px; right: 14px; width: 188px;
  display: none; pointer-events: auto; }
#mc-prodqueue.mc-show { display: block; }
.mc-pq-items { display: flex; gap: 3px; margin-bottom: 4px; }
.mc-pq-cell { width: 26px; height: 26px; border-radius: 3px; font-size: 14px;
  display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.2); }
.mc-pq-progress { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.12);
  overflow: hidden; }
.mc-pq-progress > span { display: block; height: 100%; background: #ffcc44; }
`;

// =============================================================================
// Helpers
// =============================================================================

/** Simple emoji portrait by category/race (chunk-2 = real portrait art). */
function portraitGlyph(def: UnitDef | undefined): string {
  if (!def) return '?';
  if (def.category === 'building') return '🏭';
  if (def.category === 'worker') return '🔧';
  if (def.category === 'vehicle') return '🛡️';
  if (def.race === 'zerg') return '🐛';
  if (def.race === 'protoss') return '🔱';
  return '🪖';
}

function combatTypeLabel(ct: string): string {
  return t(`combat_type.${ct}`);
}

// =============================================================================
// Installer
// =============================================================================

export function installHud(deps: HudDeps): HudHandle {
  const { world, localPlayerId, resourceManager, selection } = deps;
  const buildingSystem = deps.buildingSystem ?? null;
  const placement = deps.placement ?? null;
  const abilitySystem = deps.abilitySystem ?? null;
  const updateHz = deps.updateHz ?? 18;

  const cursor = new CursorManager();
  // Hover tooltip for the command card (M17 chunk C.1). Headless-safe (no-op).
  const tooltip = installTooltip();

  // The button registry built each refresh; `clickCommand` + DOM clicks resolve
  // a button id -> its action here. This is the SSOT for "what the card shows".
  let buttons: Array<CommandButtonState & { action: () => boolean }> = [];

  // ── headless guard ─────────────────────────────────────────────────────────
  if (typeof document === 'undefined') {
    return {
      active: () => false,
      cursor,
      tooltip,
      hudState: () => buildSnapshot(buttons),
      clickCommand: (id) => runButton(buttons, id),
      dispose: () => {},
    };
  }

  // ── DOM scaffold ─────────────────────────────────────────────────────────
  if (!document.getElementById(HUD_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = HUD_STYLE_ID;
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
  }

  const appCanvas = document.querySelector<HTMLCanvasElement>('#app');
  const parent = appCanvas?.parentElement ?? document.body;
  if (parent !== document.body && getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  // Remove a stale root from a prior bootstrap (HMR).
  document.getElementById('marscraft-hud')?.remove();

  const root = document.createElement('div');
  root.id = 'marscraft-hud';
  root.innerHTML = `
    <div id="mc-resource-bar">
      <div class="mc-res mc-res-min"><span class="mc-res-icon">◆</span><span id="mc-min">0</span></div>
      <div class="mc-res mc-res-gas"><span class="mc-res-icon">♦</span><span id="mc-gas">0</span></div>
      <div class="mc-res mc-res-sup" id="mc-sup-wrap"><span class="mc-res-icon">▣</span><span id="mc-sup">0/0</span></div>
    </div>
    <div id="mc-prodqueue"><div class="mc-pq-items" id="mc-pq-items"></div><div class="mc-pq-progress"><span id="mc-pq-fill"></span></div></div>
    <div id="mc-selection"></div>
    <div id="mc-command"></div>
  `;
  parent.appendChild(root);

  const elMin = root.querySelector<HTMLElement>('#mc-min')!;
  const elGas = root.querySelector<HTMLElement>('#mc-gas')!;
  const elSup = root.querySelector<HTMLElement>('#mc-sup')!;
  const elSupWrap = root.querySelector<HTMLElement>('#mc-sup-wrap')!;
  const elSelection = root.querySelector<HTMLElement>('#mc-selection')!;
  const elCommand = root.querySelector<HTMLElement>('#mc-command')!;
  const elProdQueue = root.querySelector<HTMLElement>('#mc-prodqueue')!;
  const elPqItems = root.querySelector<HTMLElement>('#mc-pq-items')!;
  const elPqFill = root.querySelector<HTMLElement>('#mc-pq-fill')!;

  // ── command-card click (delegated) ─────────────────────────────────────────
  elCommand.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement)?.closest<HTMLElement>('.mc-cmd-btn');
    if (!target) return;
    const id = target.dataset.id;
    if (!id) return;
    runButton(buttons, id);
  });

  // ── command-card hover tooltip (rich stat card, replaces the inline title) ──
  tooltip.bindToContainer(elCommand);

  // ── selection-grid click (select just that unit) ───────────────────────────
  elSelection.addEventListener('click', (ev) => {
    const cell = (ev.target as HTMLElement)?.closest<HTMLElement>('.mc-sel-cell');
    if (!cell || cell.dataset.idx === undefined) return;
    const idx = Number(cell.dataset.idx);
    const sel = selection.getSelected();
    if (idx >= 0 && idx < sel.length) selection.select([sel[idx]]);
  });

  // =============================================================================
  // Per-frame update (throttled). Reads LIVE handles each tick.
  // =============================================================================
  let raf = 0;
  let last = 0;
  const interval = 1000 / updateHz;

  function tick(now: number) {
    raf = requestAnimationFrame(tick);
    if (now - last < interval) return;
    last = now;
    update();
  }

  function update() {
    updateResourceBar();
    buttons = buildButtons();
    updateSelectionPanel();
    updateCommandCard();
    updateProductionQueue();
  }

  function updateResourceBar() {
    const r = resourceManager.getResources(localPlayerId);
    const minerals = r?.minerals ?? 0;
    const gas = r?.gas ?? 0;
    const supply = r?.supply ?? 0;
    const supplyMax = r?.supplyMax ?? 0;
    elMin.textContent = String(Math.floor(minerals));
    elGas.textContent = String(Math.floor(gas));
    elSup.textContent = `${Math.floor(supply)}/${Math.floor(supplyMax)}`;
    elSupWrap.classList.toggle('mc-blocked', supplyMax > 0 && supply >= supplyMax);
  }

  // ── selection ──────────────────────────────────────────────────────────────
  function updateSelectionPanel() {
    const sel = selection.getSelected();
    if (sel.length === 0) {
      elSelection.classList.remove('mc-show');
      elSelection.innerHTML = '';
      return;
    }
    elSelection.classList.add('mc-show');
    if (sel.length === 1) {
      elSelection.innerHTML = renderSingle(sel[0]);
    } else {
      elSelection.innerHTML = renderMulti(sel);
    }
  }

  function renderSingle(e: EntityHandle): string {
    const tid = unitTypeId.get(e) ?? '';
    const def = getUnitDef(tid);
    const name = unitDisplayName.get(e) ?? def?.displayName ?? tid;
    const h = world.get(e, Health);
    const en = world.get(e, Energy);
    const at = world.get(e, Attack);
    const ut = world.get(e, UnitType);

    const hp = h.ok ? h.value.hp : 0;
    const maxHp = h.ok ? Math.max(1, h.value.maxHp) : 1;
    const shield = h.ok ? h.value.shield : 0;
    const maxShield = h.ok ? h.value.maxShield : 0;
    const energy = en.ok ? en.value.energy : 0;
    const maxEnergy = en.ok ? en.value.maxEnergy : 0;

    const dmg = at.ok ? at.value.damage : 0;
    const range = at.ok ? at.value.range : 0;
    const armor = h.ok ? h.value.armor : 0;
    const ctIdx = ut.ok ? ut.value.combatType : -1;
    const ctName = ctIdx >= 0 ? combatTypeLabel(['bio', 'armored', 'psionic', 'void', 'structure'][ctIdx] ?? 'void') : '';

    const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    const shieldPct = maxShield > 0 ? Math.max(0, Math.min(100, (shield / maxShield) * 100)) : 0;
    const enPct = maxEnergy > 0 ? Math.max(0, Math.min(100, (energy / maxEnergy) * 100)) : 0;

    const stats: string[] = [];
    if (dmg > 0) stats.push(`${t('portrait.attack_power')} ${Math.round(dmg)}`);
    stats.push(`${t('portrait.armor_label')} ${Math.round(armor)}`);
    if (range > 0) stats.push(`${t('portrait.range_label')} ${range.toFixed(1)}`);
    if (ctName) stats.push(ctName);

    const shieldRow = maxShield > 0
      ? `<div class="mc-bar mc-bar-shield"><span style="width:${shieldPct}%"></span><span class="mc-bar-label">${Math.round(shield)}/${Math.round(maxShield)}</span></div>`
      : '';
    const energyRow = maxEnergy > 0
      ? `<div class="mc-bar mc-bar-energy"><span style="width:${enPct}%"></span><span class="mc-bar-label">${Math.round(energy)}/${Math.round(maxEnergy)}</span></div>`
      : '';

    return `<div class="mc-sel-single">
      <div class="mc-portrait">${portraitGlyph(def)}</div>
      <div class="mc-sel-info">
        <div class="mc-sel-name">${escapeHtml(name)}</div>
        <div class="mc-bar mc-bar-hp"><span style="width:${hpPct}%"></span><span class="mc-bar-label">${Math.round(hp)}/${Math.round(maxHp)}</span></div>
        ${shieldRow}
        ${energyRow}
        <div class="mc-sel-stats">${stats.map((s) => `<span>${escapeHtml(s)}</span>`).join('')}</div>
      </div>
    </div>`;
  }

  function renderMulti(sel: EntityHandle[]): string {
    const cells = sel.slice(0, 24).map((e, idx) => {
      const tid = unitTypeId.get(e) ?? '';
      const def = getUnitDef(tid);
      const h = world.get(e, Health);
      const hp = h.ok ? h.value.hp : 0;
      const maxHp = h.ok ? Math.max(1, h.value.maxHp) : 1;
      const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      return `<div class="mc-sel-cell" data-idx="${idx}" title="${escapeHtml(def?.displayName ?? tid)}">${portraitGlyph(def)}<div class="mc-cell-hp"><span style="width:${pct}%"></span></div></div>`;
    }).join('');
    return `<div class="mc-sel-name">${escapeHtml(t('portrait.selected_units', { count: sel.length }))}</div><div class="mc-sel-grid">${cells}</div>`;
  }

  // ── command card (build buttons from the selected unit) ──────────────────────
  function buildButtons(): Array<CommandButtonState & { action: () => boolean }> {
    const sel = selection.getSelected();
    if (sel.length === 0) return [];
    // The card reflects the FIRST selected unit (SC: the primary). Group casts of
    // abilities still target the whole selection (handled in ability actions).
    const primary = sel[0];
    const tid = unitTypeId.get(primary) ?? '';
    const def = getUnitDef(tid);
    if (!def) return [];

    if (def.category === 'building') return buildingButtons(primary, def);
    if (def.category === 'worker') return workerButtons(primary, def);
    return abilityButtons(sel);
  }

  function buildingButtons(building: EntityHandle, def: UnitDef): Array<CommandButtonState & { action: () => boolean }> {
    const out: Array<CommandButtonState & { action: () => boolean }> = [];
    const bd = getBuildingDef(def.typeId);
    if (!bd) return out;
    const b = world.get(building, Building);
    const isComplete = b.ok && b.value.state === BUILDING_STATE.COMPLETE;

    // TRAIN options.
    for (const unitId of bd.canProduce) {
      const udef = getUnitDef(unitId);
      if (!udef) continue;
      const affordable = canAfford(udef.mineralCost, udef.gasCost, udef.supplyCost);
      const enabled = !!buildingSystem && isComplete && affordable;
      out.push({
        id: `train_${unitId}`,
        label: udef.displayName,
        hotkey: '',
        kind: 'train',
        enabled,
        cost: { minerals: udef.mineralCost, gas: udef.gasCost, supply: udef.supplyCost },
        tt: { kind: 'unit', id: unitId, locked: false },
        action: () => (enabled && buildingSystem ? buildingSystem.trainUnit(building, unitId) : false),
      });
    }

    // RESEARCH options.
    for (const upgId of bd.canResearch) {
      const upg = getUpgradeDef(upgId);
      if (!upg) continue;
      const level = buildingSystem?.getUpgradeLevel(localPlayerId, upgId) ?? 0;
      const maxed = level >= upg.maxLevel;
      const affordable = canAfford(upg.mineralCostPerLevel, upg.gasCostPerLevel, 0);
      const enabled = !!buildingSystem && isComplete && !maxed && affordable;
      out.push({
        id: `research_${upgId}`,
        label: upg.displayName,
        hotkey: upg.hotkey,
        kind: 'research',
        enabled,
        cost: { minerals: upg.mineralCostPerLevel, gas: upg.gasCostPerLevel },
        tt: { kind: 'research', id: upgId, locked: false },
        action: () => (enabled && buildingSystem ? buildingSystem.researchUpgrade(building, upgId) : false),
      });
    }
    return out;
  }

  function workerButtons(worker: EntityHandle, def: UnitDef): Array<CommandButtonState & { action: () => boolean }> {
    const out: Array<CommandButtonState & { action: () => boolean }> = [];
    const tabs: BuildTab[] = ['basic', 'advanced'];
    for (const tab of tabs) {
      const blds: BuildingDef[] = getBuildingsForRaceAndTab(def.race, tab);
      for (const bd of blds) {
        const udef = getUnitDef(bd.typeId);
        if (!udef) continue;
        const prereqOk = buildingSystem?.checkPrerequisites(localPlayerId, bd.typeId) ?? true;
        const affordable = canAfford(udef.mineralCost, udef.gasCost, 0);
        const enabled = !!placement && prereqOk && affordable;
        out.push({
          id: `build_${bd.typeId}`,
          label: udef.displayName,
          hotkey: bd.hotkey,
          kind: 'build',
          enabled,
          cost: { minerals: udef.mineralCost, gas: udef.gasCost },
          tt: { kind: 'building', id: bd.typeId, locked: !prereqOk },
          action: () => (enabled && placement ? placement.beginPlacement(bd.typeId, worker) : false),
        });
      }
    }
    return out;
  }

  function abilityButtons(sel: EntityHandle[]): Array<CommandButtonState & { action: () => boolean }> {
    const out: Array<CommandButtonState & { action: () => boolean }> = [];
    const primary = sel[0];
    const tid = unitTypeId.get(primary) ?? '';
    const abilities: AbilityDef[] = getAbilitiesForUnit(tid);
    const en = world.get(primary, Energy);
    const energy = en.ok ? en.value.energy : 0;
    for (const ab of abilities) {
      if (ab.isPassive) continue;
      const affordable = energy >= ab.energyCost;
      // requiredUpgrade gating mirrors ability-system._validateCast.
      const upgOk = !ab.requiredUpgrade || (buildingSystem?.getUpgradeLevel(localPlayerId, ab.requiredUpgrade) ?? 0) >= 1;
      const enabled = !!abilitySystem && affordable && upgOk;
      out.push({
        id: `ability_${ab.id}`,
        label: ab.displayName,
        hotkey: ab.hotkeyLabel,
        kind: 'ability',
        enabled,
        tt: { kind: 'ability', id: ab.id, locked: !upgOk },
        action: () => {
          if (!enabled || !abilitySystem) return false;
          // none-target -> cast on each selected unit; unit/point -> needs a
          // target. With no UI target picker yet (chunk-2 target mode), a
          // none-target ability casts immediately on the whole group; targeted
          // abilities self-cast as a safe default (real target mode is chunk-2).
          let any = false;
          for (const e of sel) {
            const eid = unitTypeId.get(e);
            if (eid !== tid && ab.targetType === 'none') continue;
            if (abilitySystem.castAbility(e, ab.id, ab.targetType === 'unit' ? { targetEntity: e } : undefined)) any = true;
            if (ab.targetType !== 'none') break; // targeted: only the primary
          }
          return any;
        },
      });
    }
    return out;
  }

  function canAfford(minerals: number, gas: number, supply: number): boolean {
    if (resourceManager.canAfford) return resourceManager.canAfford(localPlayerId, minerals, gas, supply);
    const r = resourceManager.getResources(localPlayerId);
    if (!r) return false;
    const supplyOk = supply === 0 || r.supply + supply <= r.supplyMax;
    return r.minerals >= minerals && r.gas >= gas && supplyOk;
  }

  function updateCommandCard() {
    // The card's innerHTML is fully rebuilt each refresh; hide any open tooltip
    // first so it never points at a button that's about to be replaced.
    tooltip.hide();
    if (buttons.length === 0) {
      elCommand.innerHTML = '';
      return;
    }
    elCommand.innerHTML = buttons.map((btn) => {
      const costStr = btn.cost
        ? `<span class="mc-cmd-cost">${btn.cost.minerals}${btn.cost.gas ? '/' + btn.cost.gas : ''}</span>`
        : '';
      const hk = btn.hotkey ? `<span class="mc-cmd-hk">${escapeHtml(btn.hotkey)}</span>` : '';
      // The rich hover tooltip (ui/tooltip.ts) reads these data-tt-* attrs; the
      // plain `title` is kept as a graceful fallback (headless / no tooltip).
      const ttAttrs = btn.tt
        ? ` data-tt-kind="${escapeHtml(btn.tt.kind)}" data-tt-id="${escapeHtml(btn.tt.id)}"${btn.tt.locked ? ' data-tt-locked="1"' : ''}`
        : '';
      const titleParts = [btn.label];
      if (btn.cost) titleParts.push(`◆${btn.cost.minerals}${btn.cost.gas ? ' ♦' + btn.cost.gas : ''}${btn.cost.supply ? ' ▣' + btn.cost.supply : ''}`);
      return `<button class="mc-cmd-btn mc-kind-${btn.kind} ${btn.enabled ? '' : 'mc-disabled'}" data-id="${escapeHtml(btn.id)}"${ttAttrs} title="${escapeHtml(titleParts.join('  '))}">
        <span>${escapeHtml(shortLabel(btn.label))}</span>${hk}${costStr}
      </button>`;
    }).join('');
  }

  function updateProductionQueue() {
    const sel = selection.getSelected();
    if (sel.length !== 1) { elProdQueue.classList.remove('mc-show'); return; }
    const e = sel[0];
    const queue = buildingProductionQueue.get(e);
    if (!queue || queue.length === 0) { elProdQueue.classList.remove('mc-show'); return; }
    elProdQueue.classList.add('mc-show');
    elPqItems.innerHTML = queue.slice(0, 6).map((it) => {
      const udef = getUnitDef(it.itemId);
      const glyph = it.isUpgrade ? '⬆' : portraitGlyph(udef);
      return `<div class="mc-pq-cell" title="${escapeHtml(udef?.displayName ?? it.itemId)}">${glyph}</div>`;
    }).join('');
    const head = queue[0];
    const pct = head.buildTime > 0 ? Math.max(0, Math.min(100, (head.progress / head.buildTime) * 100)) : 0;
    elPqFill.style.width = `${pct}%`;
  }

  // ── headless-shared snapshot/click using the live `buttons` registry ─────────
  function buildSnapshot(btns: Array<CommandButtonState & { action: () => boolean }>): HudStateSnapshot {
    const r = resourceManager.getResources(localPlayerId);
    const minerals = Math.floor(r?.minerals ?? 0);
    const gas = Math.floor(r?.gas ?? 0);
    const supply = Math.floor(r?.supply ?? 0);
    const supplyMax = Math.floor(r?.supplyMax ?? 0);
    const sel = selection.getSelected();
    let single: HudStateSnapshot['selection']['single'] = null;
    if (sel.length === 1) {
      const e = sel[0];
      const tid = unitTypeId.get(e) ?? '';
      const def = getUnitDef(tid);
      const h = world.get(e, Health);
      const en = world.get(e, Energy);
      single = {
        typeId: tid,
        name: unitDisplayName.get(e) ?? def?.displayName ?? tid,
        hp: h.ok ? Math.round(h.value.hp) : 0,
        maxHp: h.ok ? Math.round(h.value.maxHp) : 0,
        shield: h.ok ? Math.round(h.value.shield) : 0,
        energy: en.ok ? Math.round(en.value.energy) : 0,
      };
    }
    let queueOut: HudStateSnapshot['productionQueue'] = [];
    if (sel.length === 1) {
      const q = buildingProductionQueue.get(sel[0]);
      if (q) queueOut = q.map((it) => ({ itemId: it.itemId, progress: Number(it.progress.toFixed(2)), buildTime: it.buildTime }));
    }
    return {
      resourceBar: { minerals, gas, supply, supplyMax, text: `◆${minerals} ♦${gas} ▣${supply}/${supplyMax}` },
      selection: { count: sel.length, single },
      commandCard: btns.map(({ id, label, hotkey, kind, enabled, cost }) => ({ id, label, hotkey, kind, enabled, cost })),
      productionQueue: queueOut,
    };
  }

  function runButton(btns: Array<CommandButtonState & { action: () => boolean }>, id: string): boolean {
    const btn = btns.find((b) => b.id === id);
    if (!btn) return false;
    return btn.action();
  }

  // Kick the loop.
  raf = requestAnimationFrame(tick);
  update(); // immediate first paint so hudState() is meaningful pre-first-frame

  return {
    active: () => true,
    cursor,
    tooltip,
    // hudState rebuilds the buttons from current state so a headless verify (which
    // may not have rAF firing) always sees a fresh snapshot.
    hudState: () => {
      buttons = buildButtons();
      return buildSnapshot(buttons);
    },
    clickCommand: (id) => {
      buttons = buildButtons();
      return runButton(buttons, id);
    },
    dispose: () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      cursor.dispose();
      tooltip.dispose();
      root.remove();
    },
  };
}

// =============================================================================
// Small utilities
// =============================================================================

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/** Trim long names for the small command-card buttons. */
function shortLabel(s: string): string {
  return s.length > 12 ? s.slice(0, 11) + '…' : s;
}
