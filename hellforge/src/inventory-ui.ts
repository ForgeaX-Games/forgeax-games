// Hellforge inventory panel — right-dock PORTRAIT framed slab (I; camp B = stash pair).
// N3R-R2: the painted 3:4 frame is back — the dock box itself is locked to the
// art's native ratio (aspect-ratio:3/4), so `background center/100% 100%` stays
// zero-distortion at every size. Emberwalker paper doll on top, 10-cell
// flat-stone equip wells around the silhouette, 12×5 multi-size bag grid below
// (Diablo-style item footprints — one tile per item spanning w×h cells),
// gold footer, drag-drop.
// Interactions:
//   • click a bag item  → equip (swaps the current piece back into the bag)
//   • click an equipped slot → unequip into the bag (firstFit; no fit = stays on)
//   • drag bag item → matching doll slot = equip (passes EquipSlot target); drag equipped → bag = unequip
//   • right-click a bag item → melt confirm → melt to gold (legendary: no confirm)
//   • hover → global tooltip with equipped-vs-candidate StatDelta comparison
// Mutations stay in main.ts via callbacks — this file only renders and reports.

import type { MaterialCounts, MaterialTier } from './crafting';
import {
  RARITY_META, SLOT_META, compareItems, equipSlotsFor, itemFootprint, itemSlotForEquip,
  itemTooltipLines, meltGoldValue,
  type Equipment, type EquipSlot, type Item, type ItemInstance, type ItemSlot, type StatDelta,
} from './items';
import {
  BAG_CELLS, BAG_COLS, BAG_ROWS, occupiedCellCount, type BagAnchor,
} from './bag-grid';
import {
  FONT_UI, FONT_DISPLAY, Ui, Z, deltaColor,
  goldDividerHtml, panelChrome,
} from './ui-theme';
import { itemWellCss, itemWellShadow } from './item-well';
import { HudArt } from './hud-art';
import { materialShardSvg, potionIconSvg, slotIconImg, slotSilhouetteSvg } from './ui-icons';
import { installUiTooltip, type UiTooltipHandle } from './ui-tooltip';

export interface InventoryCallbacks {
  /** Equip bag[index]; optional doll target (ring1/ring2 drag). Return false to reject. */
  onEquipFromBag(index: number, target?: EquipSlot): boolean;
  onUnequip(slot: EquipSlot): boolean;
  onMelt(index: number): void;
  /** N-Stash dual-open drop target — move bag[index] into the camp stash. */
  onStashFromBag?(index: number): boolean;
  /** Close through UiLayerManager so ownership and world input stay in sync. */
  onClose: () => void;
}

/** Display-only inventory snapshot — never feed mutated copies back as authority. */
export type InventoryEquipmentView = Readonly<Equipment>;
/** Anchor-list bag view (list indices — equip/melt callbacks address this array). */
export type InventoryBagView = readonly BagAnchor[];
/** Belt potion stock (save `progression.potions`) — display only, never bag cells. */
export interface InventoryPotionView {
  readonly life: number;
  readonly mana: number;
}

export interface InventoryHandle {
  /** Re-render from a deep-readonly domain snapshot (cheap full rebuild — 30 nodes). */
  update(
    eq: InventoryEquipmentView,
    bag: InventoryBagView,
    playerLevel: number,
    gold: number,
    materials: MaterialCounts,
    /** N3R G4 consumables tab; optional until main.ts wires snapshot potions. */
    potions?: InventoryPotionView,
  ): void;
  /** Surface API for UiLayerManager.register — prefer manager.open/close in main. */
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface InventoryDeps {
  /**
   * Global tooltip (ui-tooltip.ts). In-game main.ts always passes the shared
   * one; standalone preview falls back to installing a panel-local instance.
   */
  tooltip?: UiTooltipHandle;
}

/**
 * Teardown must not depend on the manager being initialized. Stop/HMR can
 * dispose a panel during bootstrap's await window, so a failing close callback
 * is contained while the owned-resource cleanup always runs.
 */
export function disposeInventorySurface(
  close: () => void,
  cleanup: () => void,
): void {
  try {
    close();
  } catch {
    // Early teardown is best-effort; cleanup below is the invariant.
  } finally {
    cleanup();
  }
}

const PANEL_ID = 'hellforge-inventory';

/**
 * Paper-doll cells — grid-area names are EquipSlot keys. N3R-R3 S1: multi-size
 * wells wrap the figure (uneven 6-col × 5-row tracks) instead of a uniform
 * 4×4 table — each part sizes to its body region. Layout:
 *   `. . helm helm . .`
 *   `weapon . helm helm amulet offhand`
 *   `weapon . armor armor . offhand`
 *   `weapon gloves armor armor boots offhand`
 *   `ring1 gloves belt belt boots ring2`
 */
const DOLL_LAYOUT: ReadonlyArray<{ slot: EquipSlot; area: EquipSlot }> = [
  { slot: 'helm', area: 'helm' },
  { slot: 'weapon', area: 'weapon' },
  { slot: 'armor', area: 'armor' },
  { slot: 'amulet', area: 'amulet' },
  { slot: 'offhand', area: 'offhand' },
  { slot: 'gloves', area: 'gloves' },
  { slot: 'belt', area: 'belt' },
  { slot: 'ring1', area: 'ring1' },
  { slot: 'boots', area: 'boots' },
  { slot: 'ring2', area: 'ring2' },
];

/**
 * Well outer sizes per slot (px) — mirrors the doll grid tracks (cols
 * 64/56/84/84/56/64, rows 46/40/53/53/52, gap 6). N3R v1.1: gloves/boots
 * climb into row 4 (56×111) so their icons reach ~44px; the column widths
 * rebalance 44→56/88→84 so the total stays 408px. Kept beside DOLL_LAYOUT so
 * icon scaling and the grid template stay in sync.
 */
export const DOLL_WELL_SIZE: Readonly<Record<EquipSlot, { w: number; h: number }>> = {
  helm: { w: 174, h: 92 }, // rows 1-2
  weapon: { w: 64, h: 158 }, // rows 2-4
  armor: { w: 174, h: 112 }, // rows 3-4
  amulet: { w: 44, h: 40 }, // row 2
  offhand: { w: 64, h: 158 }, // rows 2-4
  gloves: { w: 56, h: 111 }, // rows 4-5
  belt: { w: 174, h: 52 }, // row 5
  ring1: { w: 64, h: 52 }, // row 5
  boots: { w: 56, h: 111 }, // rows 4-5
  ring2: { w: 64, h: 52 }, // row 5
};

/** N3R-N3 F1: icon edge ≈ 85% of the well's smaller usable edge (2px border +
 * 2px inset breathing room), clamped to 28-96px — wells scale icons instead of
 * one fixed 34px chip. */
const WELL_ICON_FACTOR = 0.85;
const WELL_ICON_MIN_PX = 28;
const WELL_ICON_MAX_PX = 96;

/** F1: per-slot icon size slotCell renders (empty wells use the same size for
 * the slot silhouette). */
export const INVENTORY_SLOT_ICON_PX: Readonly<Record<EquipSlot, number>> = (() => {
  const map = {} as Record<EquipSlot, number>;
  for (const { slot } of DOLL_LAYOUT) {
    const { w, h } = DOLL_WELL_SIZE[slot];
    const inner = Math.min(w, h) - 4;
    map[slot] = Math.min(WELL_ICON_MAX_PX, Math.max(WELL_ICON_MIN_PX, Math.round(inner * WELL_ICON_FACTOR)));
  }
  return Object.freeze(map);
})();

/** Stable paper-doll order used by the UI; exactly ten visible equipment slots. */
export const INVENTORY_EQUIPMENT_SLOTS: readonly EquipSlot[] = Object.freeze(
  DOLL_LAYOUT.map(({ slot }) => slot),
);

/** BAG_COLS/BAG_ROWS (SSOT bag-grid.ts) keep the existing multi-cell footprint.
 * N3R-N3 F4: default cell 40→38px — 12×5 spans untouched, only the pixel pitch
 * shrinks so the whole column fits the parchment core at 1080p. */
const BAG_CELL_PX = 38;
const BAG_GAP_PX = 4;

/** Render geometry for the existing 12×5 multi-cell bag. */
export const INVENTORY_BAG_GEOMETRY = Object.freeze({
  cols: BAG_COLS,
  rows: BAG_ROWS,
  cellPx: BAG_CELL_PX,
  gapPx: BAG_GAP_PX,
});

/** N3R G4 bag tabs — equipment grid / potion stock / forge materials. */
export type InventoryBagTab = 'equipment' | 'consumables' | 'materials';
const BAG_TABS: ReadonlyArray<{ id: InventoryBagTab; label: string }> = [
  { id: 'equipment', label: '装备' },
  { id: 'consumables', label: '消耗' },
  { id: 'materials', label: '材料' },
];

/**
 * Doll slot to compare a bag candidate against: prefer an empty dual slot
 * (ring1/ring2), else the weaker filled piece by item score.
 */
export function wornSlotForCompare(
  eq: InventoryEquipmentView,
  itemSlot: ItemSlot,
): EquipSlot {
  const slots = equipSlotsFor(itemSlot);
  const empty = slots.find((s) => !eq[s]);
  if (empty) return empty;
  let weakest = slots[0]!;
  for (const s of slots) {
    const cur = eq[s];
    const best = eq[weakest];
    if (!cur) continue;
    if (!best || cur.score < best.score) weakest = s;
  }
  return weakest;
}

/** Equip target for an immediate bag click; it must match detail comparison. */
export function bagClickEquipTarget(
  eq: InventoryEquipmentView,
  itemSlot: ItemSlot,
): EquipSlot {
  return wornSlotForCompare(eq, itemSlot);
}

export type InventorySelectionSource = 'bag' | 'equipment';

/**
 * A resolved selection is derived from the latest snapshot. The UI stores only
 * `instanceId`; bag/equipment positions are returned solely for an immediate
 * action callback boundary.
 */
export interface ResolvedInventorySelection {
  readonly instanceId: string;
  readonly item: Readonly<ItemInstance>;
  readonly source: InventorySelectionSource;
  readonly bagIndex: number | null;
  readonly equipSlot: EquipSlot | null;
}

export function resolveInventorySelection(
  selectedInstanceId: string | null,
  eq: InventoryEquipmentView | null,
  bag: InventoryBagView,
): ResolvedInventorySelection | null {
  if (selectedInstanceId === null) return null;
  if (eq) {
    for (const { slot } of DOLL_LAYOUT) {
      const item = eq[slot];
      if (item?.instanceId === selectedInstanceId) {
        return {
          instanceId: item.instanceId,
          item,
          source: 'equipment',
          bagIndex: null,
          equipSlot: slot,
        };
      }
    }
  }
  const bagIndex = bag.findIndex((anchor) => anchor.item.instanceId === selectedInstanceId);
  if (bagIndex < 0) return null;
  const item = bag[bagIndex]!.item;
  return {
    instanceId: item.instanceId,
    item,
    source: 'bag',
    bagIndex,
    equipSlot: null,
  };
}

/** Keep an id only while the same instance remains in the latest snapshot. */
export function normalizeInventorySelection(
  selectedInstanceId: string | null,
  eq: InventoryEquipmentView | null,
  bag: InventoryBagView,
): string | null {
  return resolveInventorySelection(selectedInstanceId, eq, bag)?.instanceId ?? null;
}

export interface InventoryDetailView {
  readonly selection: ResolvedInventorySelection;
  readonly rarityLabel: string;
  readonly rarityColor: string;
  readonly tooltipLines: ReturnType<typeof itemTooltipLines>;
  readonly compareTarget: Readonly<ItemInstance> | null;
  readonly comparison: readonly StatDelta[];
}

/**
 * Build the persistent panel detail from the latest snapshot. Bag items
 * compare against the current weakest/empty legal equipment slot; equipped
 * items remain inspectable without inventing a reverse comparison target.
 */
export function resolveInventoryDetail(
  selectedInstanceId: string | null,
  eq: InventoryEquipmentView | null,
  bag: InventoryBagView,
  playerLevel: number,
): InventoryDetailView | null {
  const selection = resolveInventorySelection(selectedInstanceId, eq, bag);
  if (!selection) return null;
  const meta = RARITY_META[selection.item.rarity];
  const compareTarget =
    selection.source === 'bag' && eq
      ? eq[wornSlotForCompare(eq, selection.item.slot)]
      : null;
  return {
    selection,
    rarityLabel: meta.label,
    rarityColor: meta.color,
    tooltipLines: itemTooltipLines(selection.item, playerLevel),
    compareTarget,
    comparison: compareItems(selection.item, compareTarget ?? null),
  };
}

/**
 * N3R-R: flat D2 stone well (no painted gem-frame art — 10 gem frames in a row
 * read as a "jewel wall"). N3R-N4 k3: the bezel is a real metal edge now —
 * quality stays an overlay channel (thin inner ring), never replacing it.
 * The well recipe itself lives in item-well.ts (`itemWellCss`), shared with
 * the forge cube and later stash surfaces.
 */

/**
 * Minimal Emberwalker fallback when no portrait asset is available. Rendered
 * at the viewBox's native 96:160 aspect (height-driven) — never squashed
 * square. N3R-R3 S2: engraved-sketch material — bone-white parchment carved
 * lines over a low-alpha parchment fill plus faint torso hatching, so the
 * figure reads as an engraving on the frame core. N3R-N3 F5: stroke α 0.9→1.0
 * and fill 0.13→0.16 so the figure still reads through the translucent wells.
 */
function emberwalkerSilhouetteSvg(heightPx: number): string {
  const widthPx = Math.round((heightPx * 96) / 160);
  return (
    `<svg viewBox="0 0 96 160" width="${widthPx}" height="${heightPx}" ` +
    'aria-hidden="true" fill="rgba(201,184,150,0.16)" stroke="rgba(201,184,150,1.0)" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="48" cy="22" r="13" stroke-width="1.8"/>' +
    '<path d="M39 37 Q48 32 57 37 L67 68 L60 84 L58 125 L38 125 L36 84 L29 68 Z" stroke-width="1.8"/>' +
    '<path d="M30 54 L13 85 M66 54 L83 85 M38 125 L28 153 M58 125 L68 153" stroke-width="2.6"/>' +
    '<path d="M35 42 Q48 50 61 42" stroke-width="1.2" opacity="0.75"/>' +
    // engraved hatching across the torso — sketch texture, no glow
    '<path d="M41 58 L55 62 M40 70 L54 74 M40 82 L53 86 M41 94 L52 98 M42 106 L51 110" ' +
    'stroke-width="1" opacity="0.4"/>' +
    '</svg>'
  );
}

export function installInventory(
  cb: InventoryCallbacks,
  mount: HTMLElement = document.body,
  deps?: InventoryDeps,
): InventoryHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText =
    // N3R-R2: geometry locked to the frame art's native 3:4 — width derives
    // from height via aspect-ratio, so `center/100% 100%` never stretches the
    // painted border. 1080p → 675×900, 720p → 504×672; right dock, top gutter
    // matches the bottom-bar gutter so the slab floats clear of the HUD.
    `position:${posKind};right:0;top:24px;height:min(calc(100% - 48px),900px);` +
    `aspect-ratio:3/4;width:auto;max-width:96vw;` +
    `z-index:${Z.inventory};display:none;pointer-events:auto;user-select:none;` +
    `font:600 13px ${FONT_UI};color:#e0d8cc;` +
    `background:url('${HudArt.panelInventory()}') center/100% 100% no-repeat;` +
    'box-shadow:-10px 0 30px rgba(0,0,0,0.7);' +
    'overflow:hidden;overscroll-behavior:contain;';

  const body = document.createElement('div');
  // N3R-R2: percentage inset — content sits inside the parchment core of the
  // frame (top padding clears the anvil emblem band; sides clear the lava-stone
  // edges). The grid well keeps a translucent fill so the parchment shows through.
  // N3R-N3 F4: overflow:hidden is the hard guard — content can never paint over
  // the frame's lava edge / anvil emblem, whatever happens in the column.
  body.style.cssText =
    'display:flex;flex-direction:column;gap:4px;padding:11.5% 10.5% 10%;' +
    'height:100%;min-height:0;overflow:hidden;box-sizing:border-box;';

  // N3R-N3 去字: the big「背包与装备」title band is gone — the panel leads
  // straight with the Emberwalker stage, and the gold hairline that used to
  // underline the title row goes with it (the stage's own divider still splits
  // the two zones). Close is a small corner button on the frame — absolute,
  // top-right, never a title-bar member.
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', '关闭背包');
  closeButton.dataset.closeButton = '1';
  closeButton.style.cssText =
    `position:absolute;top:10px;right:10px;z-index:1;` +
    `flex:none;cursor:pointer;width:28px;height:28px;padding:0;font:700 22px ${FONT_UI};` +
    `line-height:24px;color:${Ui.textMuted};background:rgba(18,12,6,0.72);` +
    `border:1px solid ${Ui.goldLineSoft};border-radius:2px;`;

  const content = document.createElement('div');
  content.dataset.inventoryLayout = '1';
  // N3R v1.1: the 720p media query turns this column into a scroll surface
  // (overflow-y:auto) — carry hf-scroll so short viewports never show the
  // native white-gray scrollbar (inert otherwise: overflow:hidden below).
  content.className = 'hf-scroll';
  // N3R-R: single vertical column — paper doll on top (full width, centered),
  // bag below. Short viewports scroll this column (see responsiveStyle).
  // N3R-N3 F4: gap 8px→6px, min-height:0 so the flex chain can hand the detail
  // card exactly the space it gets without leaking into the frame art.
  content.style.cssText =
    'display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:0;overflow:hidden;';

  // ── top: Emberwalker paper doll (flat stone wells around the silhouette) ──
  const dollPane = document.createElement('div');
  dollPane.dataset.stagePane = '1';
  // N3R-R3 S3: the doll section is the "equip stage" — a faint warm-dark
  // stage floor (lighter than the bag zone below) with a restrained edge.
  // N3R-N3 F4: padding 8px 10px 6px→6px 10px 4px — stage budget trim.
  dollPane.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:4px;' +
    'padding:6px 10px 4px;border-radius:4px;' +
    'border:1px solid rgba(138,122,90,0.22);' +
    'background:linear-gradient(180deg,rgba(52,40,26,0.55) 0%,rgba(20,14,9,0.25) 100%);' +
    'min-width:0;min-height:0;flex:none;';
  // N3R-N3 去字: the stage title「烬行者 · 装备」is gone — the engraved figure
  // speaks for itself; the stage floor and hairline carry the hierarchy.
  const dollBody = document.createElement('div');
  dollBody.dataset.dollBody = '1';
  // N3R-R3 S1: D2-style multi-size well array — uneven 6-col × 5-row tracks
  // (64/56/84/84/56/64 columns, 46/40/53/53/52 rows, gap 6). Wells size to
  // their body region: helm 174×92 top-center, weapon/offhand 64×158 tall
  // side wells, armor 174×112 center (largest), amulet 44×40 small, belt
  // 174×52 flat plate bottom-center, gloves/boots 56×111 (rows 4-5 — N3R
  // v1.1: they climb a row so their icons reach ~44px), rings 64×52.
  // N3R-N3 F1: bottom row 38px→52px (helm row 106px→92px rebalances the same
  // 244px of tracks) so the bottom-row wells can carry ~40px icons.
  dollBody.style.cssText =
    'position:relative;display:grid;' +
    'grid-template-columns:64px 56px 84px 84px 56px 64px;' +
    'grid-template-rows:46px 40px 53px 53px 52px;gap:6px;' +
    'justify-content:center;padding:4px 6px 4px;' +
    "grid-template-areas:'. . helm helm . .' 'weapon . helm helm amulet offhand' " +
    "'weapon . armor armor . offhand' 'weapon gloves armor armor boots offhand' " +
    "'ring1 gloves belt belt boots ring2';";
  // ── N3R G8: paper-doll visual (fallback ≠ visual finish, pending A7).
  // hud-art.ts has no A7 portrait hook yet, so the refined vector silhouette
  // carries the doll — now the panel's main subject: 220px tall at the native
  // 96:160 aspect. N3R-R3 S2: engraved-sketch material — one crisp bone-white
  // layer, no drop-shadow aura, no breathing pulse, no blurred under-layer.
  // Slot cells stay above (z-index:1); every layer here is pointer-events:none at z-index:0.
  const dollGlow = document.createElement('div');
  dollGlow.dataset.paperDollGlow = 'emberwalker';
  // S2: no more golden aura — only a weak dark-warm stage-floor pool (alpha
  // ≤0.10) so the figure reads as standing on the stage, not lit by it.
  dollGlow.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:280px;height:200px;' +
    'z-index:0;pointer-events:none;border-radius:50%;' +
    'background:radial-gradient(ellipse 60% 42% at 50% 82%,' +
    'rgba(64,46,26,0.10) 0%,rgba(26,18,10,0.06) 55%,rgba(0,0,0,0) 78%);';
  const silhouette = document.createElement('div');
  silhouette.dataset.paperDollSilhouette = 'emberwalker';
  silhouette.innerHTML = emberwalkerSilhouetteSvg(220);
  // N3R-N3 F5: opacity 0.9→1.0 (配套校准) — the engraving now carries its
  // full stroke α; faintness comes from the translucent well floors instead.
  silhouette.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:132px;height:220px;' +
    'z-index:0;pointer-events:none;opacity:1.0;line-height:0;';
  dollBody.append(dollGlow, silhouette);
  dollPane.append(dollBody);

  // ── bottom: existing bag grid + persistent detail + footer ──────────────
  const bagPane = document.createElement('div');
  // N3R-N3 F3: tabs/grid share one center axis — the grid was already
  // centered, so the whole pane centers its children; full-width children
  // (detail, footer, tab panes) re-declare their width explicitly.
  bagPane.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;min-height:0;flex:1 1 auto;';

  // ── N3R G4 bag tabs: 装备 / 消耗 / 材料 (stone buttons, gold active band).
  // Listeners hang on the buttons themselves — never on mount (dispose contract).
  const bagTabsRow = document.createElement('div');
  bagTabsRow.dataset.bagTabsRow = '1';
  bagTabsRow.style.cssText = 'display:flex;gap:6px;flex:none;';
  const tabButtonCss = (active: boolean): string =>
    // N3R-N3 F4: button padding 4px→2px — tab row trim toward ~30px.
    `cursor:pointer;padding:2px 14px;font:700 12px ${FONT_DISPLAY};letter-spacing:2px;` +
    'border-radius:2px;' +
    (active
      ? `color:#1a120a;background:linear-gradient(180deg,${Ui.goldBright},${Ui.goldDeep});` +
        `border:1px solid ${Ui.gold};text-shadow:none;`
      : `color:${Ui.goldDim};background:${Ui.inkPanel};border:1px solid ${Ui.goldDim};`);
  const tabButtons = new Map<InventoryBagTab, HTMLButtonElement>();
  for (const { id, label } of BAG_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.bagTab = id;
    btn.style.cssText = tabButtonCss(id === 'equipment');
    btn.addEventListener('click', () => setBagTab(id));
    tabButtons.set(id, btn);
    bagTabsRow.appendChild(btn);
  }

  const grid = document.createElement('div');
  grid.dataset.bagGrid = '1';
  grid.style.cssText =
    // N3R-R2: cell size flows through CSS vars (--hf-bag-cell / --hf-bag-gap) —
    // the max-height:800px media query tightens them for 720p. Row/col counts
    // and w×h span logic are untouched (12×5 footprint frozen). N3R-N3 F4:
    // default cell 40px→38px so the full grid (504px) fits the 1080p parchment
    // core (≈533px) alongside the expanded detail card.
    `display:grid;grid-template-columns:repeat(${BAG_COLS},var(--hf-bag-cell,${BAG_CELL_PX}px));` +
    `grid-auto-rows:var(--hf-bag-cell,${BAG_CELL_PX}px);gap:var(--hf-bag-gap,${BAG_GAP_PX}px);` +
    'justify-content:center;padding:2px;' +
    'border:0;background:rgba(8,6,4,0.35);';
  // Non-equipment tab panes share the grid's visual well (same min height so
  // tab switches don't reflow the panel). Content is list-only — potions and
  // materials are currency-like stock, never bag-grid items. F3: inset 6px
  // from the core edges like the detail card.
  const tabPaneCss =
    'flex-direction:column;gap:6px;padding:8px;min-height:216px;' +
    'width:calc(100% - 12px);box-sizing:border-box;' +
    'border:0;background:rgba(8,6,4,0.35);';
  const consumablesPane = document.createElement('div');
  consumablesPane.dataset.bagTabPane = 'consumables';
  consumablesPane.style.cssText = `display:none;${tabPaneCss}`;
  const materialsPane = document.createElement('div');
  materialsPane.dataset.bagTabPane = 'materials';
  materialsPane.style.cssText = `display:none;${tabPaneCss}`;
  // N3R-R3 S4: the detail card folds into a thin strip while nothing is
  // selected and expands once an item is — style-level only, the
  // resolveInventoryDetail data flow stays untouched.
  // N3R-N3 F4: expanded card is capped at 96px with in-card scrolling
  // (flex:0 1 auto — it absorbs any leftover squeeze instead of pushing the
  // footer out of the parchment core); collapsed strip 30px→26px. Both keep
  // a 6px inset from the core edges (F3).
  const detailExpandedCss =
    `flex:0 1 auto;min-height:0;max-height:96px;overflow:auto;` +
    `width:calc(100% - 12px);box-sizing:border-box;padding:8px 10px;` +
    `background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};` +
    'box-shadow:inset 0 0 14px rgba(0,0,0,0.55);';
  const detailCollapsedCss =
    `flex:0 1 auto;min-height:26px;min-width:0;` +
    `width:calc(100% - 12px);box-sizing:border-box;padding:0 10px;` +
    `background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};` +
    'box-shadow:inset 0 0 14px rgba(0,0,0,0.55);overflow:hidden;';
  const detail = document.createElement('div');
  detail.dataset.inventoryDetail = '1';
  // N3R v1.1: forged scrollbar chrome (ui-styles.ts .hf-scroll) — the expanded
  // card's overflow:auto must never fall back to the native white-gray bar.
  detail.className = 'hf-scroll';
  detail.style.cssText = detailExpandedCss;

  const footer = document.createElement('div');
  // N3R-N3 F3/F4: 6px side inset like the detail card; margin-top 2px→0.
  footer.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;gap:10px;' +
    'width:calc(100% - 12px);flex:none;';
  const currencyRow = document.createElement('div');
  currencyRow.dataset.inventoryCurrency = '1';
  currencyRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
  // N3R G4: materials pills migrated to the 材料 tab — footer keeps gold only.
  // N3R-N3 去字: bag/tab counts degrade to a tiny dim label beside the gold
  // plaque (10px) — the count never owns a title row.
  const goldEl = document.createElement('span');
  const bagCountEl = document.createElement('span');
  bagCountEl.dataset.bagCount = '1';
  bagCountEl.style.cssText = `font:600 10px ${FONT_UI};color:#8a7a58;`;
  currencyRow.append(goldEl, bagCountEl);
  const hintEl = document.createElement('span');
  hintEl.style.cssText = `font:600 10px ${FONT_UI};color:#8a7a5a;flex-shrink:0;`;
  hintEl.textContent = '左键 穿戴 · 右键 熔毁 · 拖拽换装 · I 关闭';
  footer.append(currencyRow, hintEl);
  bagPane.append(bagTabsRow, grid, consumablesPane, materialsPane, detail, footer);
  // N3R-R3 S3: gold hairline between the equip stage and the bag zone; the
  // tab row sits right below it (DOM order untouched).
  const stageDivider = document.createElement('div');
  stageDivider.dataset.stageDivider = '1';
  stageDivider.innerHTML = goldDividerHtml(2);
  content.append(dollPane, stageDivider, bagPane);
  body.appendChild(content);
  root.appendChild(body);

  // N3R-R2: the root's max-width:96vw covers narrow screens (aspect-ratio keeps
  // the frame undistorted — no width override allowed). Short viewports (720p)
  // shrink bag cells via CSS vars, scale the multi-size doll grid down, and
  // scroll the single column at natural height. The silhouette keeps its full
  // engraving opacity (1.0) at every size. N3R-N3 F4: the detail card's
  // expanded cap drops to 72px on short viewports.
  const responsiveStyle = document.createElement('style');
  responsiveStyle.textContent =
    `@media (max-height:800px){#${PANEL_ID}{--hf-bag-cell:28px;--hf-bag-gap:3px;}` +
    `#${PANEL_ID} [data-inventory-layout]{overflow-y:auto;}` +
    `#${PANEL_ID} [data-inventory-layout]>*{flex:none;}` +
    `#${PANEL_ID} [data-inventory-detail]{flex:none;max-height:72px;}` +
    `#${PANEL_ID} [data-doll-body]{transform:scale(0.85);transform-origin:top center;}` +
    `#${PANEL_ID} [data-paper-doll-silhouette]{transform:translate(-50%,-50%) scale(0.82);}` +
    `#${PANEL_ID} [data-paper-doll-glow]{width:224px;height:160px;}}`;
  root.appendChild(responsiveStyle);
  // N3R-N3 去字: close is a corner button on the frame, not a title-bar member.
  root.appendChild(closeButton);

  // Global tooltip singleton (see InventoryDeps) — replaces the old panel-local tip.
  const ownsTooltip = deps?.tooltip === undefined;
  const tip = deps?.tooltip ?? installUiTooltip(mount);
  // N3R G1: column shell — item columns on top, the diff bar spans full width
  // at the bottom (no third vertical column to clip at the screen edge).
  const showTip = (e: MouseEvent, cols: string[], footerBar?: string): void =>
    tip.show(
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
        `<div style="display:flex;flex-wrap:wrap;gap:16px;">${cols.join('')}</div>` +
        (footerBar ?? '') +
        '</div>',
      e.clientX,
      e.clientY,
    );
  const hideTip = (): void => tip.hide();

  let curEq: InventoryEquipmentView | null = null;
  let curBag: InventoryBagView = [];
  let curLevel = 1;
  let curPotions: InventoryPotionView = { life: 0, mana: 0 };
  let curMaterials: MaterialCounts = { common: 0, magic: 0, rare: 0 };
  let bagTab: InventoryBagTab = 'equipment';
  let selectedInstanceId: string | null = null;

  // ── melt confirmation overlay (panel-local) ──────────────────────────────
  const confirm = document.createElement('div');
  confirm.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'background:rgba(6,4,3,0.72);z-index:2;';
  const confirmBox = document.createElement('div');
  // N2: shared carved chrome (same family as loot/forge popups).
  confirmBox.style.cssText = 'min-width:220px;max-width:280px;padding:14px 16px;text-align:center;' +
    panelChrome();
  const confirmText = document.createElement('div');
  confirmText.style.cssText = `font:700 13px ${FONT_UI};color:#e0d8cc;margin-bottom:6px;line-height:1.5;`;
  const confirmSub = document.createElement('div');
  confirmSub.style.cssText = `font:600 11px ${FONT_UI};color:#a09070;margin-bottom:12px;`;
  const confirmRow = document.createElement('div');
  confirmRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';
  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.textContent = '取消';
  btnCancel.style.cssText =
    `cursor:pointer;padding:6px 14px;border-radius:3px;font:700 12px ${FONT_UI};` +
    `color:#e0d8cc;background:rgba(18,12,6,0.85);border:1px solid #4a3a2a;`;
  const btnOk = document.createElement('button');
  btnOk.type = 'button';
  btnOk.textContent = '熔毁';
  btnOk.style.cssText =
    `cursor:pointer;padding:6px 14px;border-radius:3px;font:700 12px ${FONT_UI};` +
    `color:#1a120a;background:linear-gradient(180deg,#c8a84e,#8a6828);border:1px solid #e0b84a;`;
  confirmRow.append(btnCancel, btnOk);
  confirmBox.append(confirmText, confirmSub, confirmRow);
  confirm.appendChild(confirmBox);
  root.appendChild(confirm);

  let pendingMeltInstanceId: string | null = null;
  const hideConfirm = (): void => {
    pendingMeltInstanceId = null;
    confirm.style.display = 'none';
  };
  const showConfirm = (instanceId: string, item: Readonly<Item>): void => {
    pendingMeltInstanceId = instanceId;
    confirmText.textContent = `确定熔毁「${item.name}」？`;
    confirmSub.textContent = `获得 ${meltGoldValue(item)} 金币 · 不可撤销`;
    confirm.style.display = 'flex';
  };
  btnCancel.addEventListener('click', hideConfirm);
  btnOk.addEventListener('click', () => {
    const instanceId = pendingMeltInstanceId;
    hideConfirm();
    if (instanceId === null) return;
    const resolved = resolveInventorySelection(instanceId, curEq, curBag);
    if (resolved?.source === 'bag' && resolved.bagIndex !== null) {
      cb.onMelt(resolved.bagIndex);
    }
  });

  const renderTipCol = (lines: Array<[string, string, string?]>, header?: string): string => {
    const rows = lines.map(([t, c, dim], i) => {
      const suffix = dim ? `<span style="color:#8a8580;"> (${escapeHtml(dim)})</span>` : '';
      if (i === 0) {
        // name — centered bold, quality color
        return `<div style="text-align:center;font-size:15px;font-weight:bold;color:${c};">${escapeHtml(t)}</div>`;
      }
      if (i === 1) {
        // base type line — centered, dim, bottom hairline (Exile-UI section split)
        return `<div style="text-align:center;font-size:11px;color:${c};border-bottom:1px solid #4a3a2a;padding-bottom:5px;margin-bottom:6px;">${escapeHtml(t)}</div>`;
      }
      return `<div style="color:${c};">${escapeHtml(t)}${suffix}</div>`;
    }).join('');
    return `<div style="min-width:200px;">${header ? `<div style="color:${Ui.textDim};font-size:10px;letter-spacing:2px;margin-bottom:3px;font-family:${FONT_DISPLAY};">${header}</div>` : ''}${rows}</div>`;
  };

  // N3R G1: diff is a full-width bottom bar (horizontal, wrapping) — never a
  // third vertical column. Green+/red- keep deltaColor / Ui.deltaUp/deltaDown.
  const renderDeltaBar = (deltas: readonly StatDelta[]): string => {
    const header =
      `<span style="color:${Ui.textDim};font-size:10px;letter-spacing:2px;` +
      `font-family:${FONT_DISPLAY};flex:none;">对比</span>`;
    const rows = deltas.length === 0
      ? `<span style="color:${Ui.deltaFlat};">无属性变化</span>`
      : deltas.map((d) =>
        `<span style="color:${deltaColor(d.polarity)};">${escapeHtml(d.label)}</span>`).join('');
    return (
      '<div style="width:100%;box-sizing:border-box;display:flex;flex-wrap:wrap;' +
      'align-items:baseline;gap:2px 14px;border-top:1px solid #4a3a2a;padding-top:6px;">' +
      `${header}${rows}</div>`
    );
  };

  // ── mouse drag (D2 pick-up-and-place) ────────────────────────────────────
  // Click stays the primary verb; a press that travels >DRAG_PX becomes a
  // drag: ghost follows the cursor, drop target glows green(valid)/red(invalid).
  type DragSrc =
    | { kind: 'bag'; instanceId: string }
    | { kind: 'slot'; slot: EquipSlot; instanceId: string };
  const DRAG_PX = 6;
  let drag: { src: DragSrc; ghost: HTMLDivElement; moved: boolean; x0: number; y0: number } | null = null;
  let suppressClick = false;
  let dropGlow: { el: HTMLElement; ok: boolean } | null = null;

  const clearDropGlow = (): void => {
    if (dropGlow) {
      dropGlow.el.style.boxShadow = '';
      dropGlow.el.style.background = '';
      dropGlow = null;
    }
  };
  const setDropGlow = (el: HTMLElement, ok: boolean): void => {
    clearDropGlow();
    dropGlow = { el, ok };
    el.style.boxShadow = ok ? '0 0 10px rgba(80,200,80,0.6),inset 0 0 8px rgba(80,200,80,0.25)'
      : '0 0 10px rgba(200,60,60,0.5),inset 0 0 8px rgba(200,60,60,0.2)';
    el.style.background = ok ? 'rgba(80,200,80,0.18)' : 'rgba(200,60,60,0.18)';
  };
  let dragOwner: HTMLDivElement | null = null;
  let dragPointerId: number | null = null;
  const endDrag = (): void => {
    // Pointer listeners belong to the captured source element for the active
    // drag. Idempotent cleanup keeps hide/dispose/close safe.
    dragOwner?.removeEventListener('pointermove', onDragMove);
    dragOwner?.removeEventListener('pointerup', onDragUp);
    dragOwner?.removeEventListener('pointercancel', onDragCancel);
    if (dragOwner !== null && dragPointerId !== null) {
      dragOwner.releasePointerCapture?.(dragPointerId);
    }
    dragOwner = null;
    dragPointerId = null;
    drag?.ghost.remove();
    drag = null;
    clearDropGlow();
  };
  const dropTargetAt = (
    clientX: number,
    clientY: number,
  ): { el: HTMLElement; ok: boolean; target?: EquipSlot; stash?: boolean } | null => {
    if (!drag) return null;
    const under = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!under) return null;
    if (drag.src.kind === 'bag') {
      const slotEl = under.closest<HTMLElement>('[data-slot]');
      if (slotEl?.dataset.slot) {
        const target = slotEl.dataset.slot as EquipSlot;
        const resolved = resolveInventorySelection(drag.src.instanceId, curEq, curBag);
        if (!resolved || resolved.source !== 'bag') return null;
        const ok = equipSlotsFor(resolved.item.slot).includes(target);
        return { el: slotEl, ok, target };
      }
      // N-Stash dual-open drop target: bag item → stash grid (only wired while
      // the optional callback is present). When the stash panel is hidden its
      // grid is display:none, so elementFromPoint never returns it — no extra
      // visibility flag needed.
      const stashGrid = under.closest<HTMLElement>('[data-stash-grid]');
      if (stashGrid && cb.onStashFromBag) return { el: stashGrid, ok: true, stash: true };
      return null;
    }
    const bagEl = under.closest<HTMLElement>('[data-bag-grid]');
    return bagEl ? { el: bagEl, ok: true } : null;
  };
  const onDragMove = (e: PointerEvent): void => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
      drag.moved = true;
      hideTip();
      hideConfirm();
      // Ghost renders on mount (uiRoot) above the canvas; mousemove/mouseup
      // tracking is document-scoped for the active drag (see startDrag), so
      // moves over the sibling canvas still follow the cursor.
      mount.appendChild(drag.ghost);
    }
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    const t = dropTargetAt(e.clientX, e.clientY);
    if (t) setDropGlow(t.el, t.ok);
    else clearDropGlow();
  };
  const onDragUp = (e: PointerEvent): void => {
    if (!drag) return;
    if (drag.moved) {
      const t = dropTargetAt(e.clientX, e.clientY);
      // Arm the click-swallow only when this mouseup lands inside mount: the
      // click that follows a panel release bubbles through mount and would
      // otherwise reach world input. A release over the world (sibling canvas)
      // fires no click through mount, so arming it there would poison the
      // next panel click.
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (t || (under && mount.contains(under))) suppressClick = true;
      if (t?.ok) {
        hideConfirm();
        if (drag.src.kind === 'bag') {
          const resolved = resolveInventorySelection(drag.src.instanceId, curEq, curBag);
          if (resolved?.source === 'bag' && resolved.bagIndex !== null) {
            if (t.stash) {
              // N-Stash: dual-open pair — bag → stash grid (dropTargetAt only
              // offers the stash grid while onStashFromBag is wired).
              cb.onStashFromBag?.(resolved.bagIndex);
            } else {
              cb.onEquipFromBag(resolved.bagIndex, t.target);
            }
          }
        } else {
          const resolved = resolveInventorySelection(drag.src.instanceId, curEq, curBag);
          if (resolved?.source === 'equipment' && resolved.equipSlot === drag.src.slot) {
            cb.onUnequip(drag.src.slot);
          }
        }
      }
    }
    endDrag();
  };
  const onDragCancel = (): void => endDrag();
  const onClickCapture = (e: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault?.();
  };
  // Real browsers dispatch NO click after a cross-element drag, so a swallow
  // armed on commit would otherwise eat the user's next deliberate click. The
  // next real press (mousedown, capture) disarms it first; environments that
  // DO fire a trailing click (with no intervening mousedown) still swallow it.
  // The flag only gates clicks and is armed later at mouseup, so this never
  // interferes with startDrag on the same press.
  const onMousedownCapture = (): void => {
    suppressClick = false;
  };
  // Pointer capture keeps active drag events on the source element; the
  // click-swallow stays mount-level (panel clicks only).
  mount.addEventListener('click', onClickCapture, true);
  mount.addEventListener('pointerdown', onMousedownCapture, true);

  const startDrag = (src: DragSrc, e: PointerEvent, owner: HTMLDivElement): void => {
    if (e.button !== 0) return;
    const resolved = resolveInventorySelection(src.instanceId, curEq, curBag);
    if (!resolved) return;
    selectedInstanceId = resolved.instanceId;
    renderDetail();
    endDrag();
    const ghost = document.createElement('div');
    // k3: drag ghost reads over the near-black scene — warm lifted backdrop,
    // 2px rarity border + matching outer glow, icon nudged brighter.
    ghost.style.cssText =
      'position:fixed;z-index:240;transform:translate(-50%,-50%);pointer-events:none;' +
      `background:rgba(52,36,18,0.92);border:2px solid ${RARITY_META[resolved.item.rarity].color};` +
      `border-radius:3px;padding:3px;box-shadow:0 0 10px 2px color-mix(in srgb, ${RARITY_META[resolved.item.rarity].color} 55%, transparent);`;
    ghost.appendChild(
      slotIconImg(resolved.item.slot, 36, { alt: resolved.item.name, extraCss: 'filter:brightness(1.15)' }),
    );
    drag = { src, ghost, moved: false, x0: e.clientX, y0: e.clientY };
    dragOwner = owner;
    dragPointerId = e.pointerId;
    owner.setPointerCapture?.(e.pointerId);
    owner.addEventListener('pointermove', onDragMove);
    owner.addEventListener('pointerup', onDragUp);
    owner.addEventListener('pointercancel', onDragCancel);
    e.preventDefault?.();
  };

  // ── cells ────────────────────────────────────────────────────────────────
  const slotCell = (
    item: Readonly<ItemInstance> | null,
    slot: EquipSlot,
    area: EquipSlot,
  ): HTMLDivElement => {
    const itemSlot = itemSlotForEquip(slot);
    const el = document.createElement('div');
    const qCol = item ? RARITY_META[item.rarity].color : null;
    const baseShadow = itemWellShadow(item ? item.rarity : null);
    el.style.cssText =
      `grid-area:${area};position:relative;z-index:1;display:flex;flex-direction:column;` +
      'align-items:center;justify-content:center;cursor:pointer;' +
      itemWellCss({ rarity: item ? item.rarity : null, filled: item !== null });
    if (!item) {
      // Empty well: slot silhouette scales with the well (F1) at ~0.3 (k3 #4:
      // 0.5→0.3) so it never upstages loot — the empty hole reads as a black
      // pit. F2: no persistent 9px label — the slot name is hover-only so the
      // engraving/silhouette stays clean.
      const sil = document.createElement('div');
      sil.innerHTML = slotSilhouetteSvg(itemSlot, INVENTORY_SLOT_ICON_PX[slot]);
      sil.style.cssText = 'opacity:0.3;line-height:0;';
      el.appendChild(sil);
      el.addEventListener('mousemove', (e) => {
        showTip(e, [renderTipCol([[SLOT_META[itemSlot].label, Ui.textDim]])]);
      });
      el.addEventListener('mouseleave', hideTip);
    } else {
      // F1: icon edge follows the well's size map (75-85% of its small side).
      // F2: equipped well = icon + quality inset ring only — the item name
      // lives in the G1 tooltip and the detail card, never on the figure.
      // k3 #3: dark drop-shadow seats the icon in the recess — dark only, no
      // gold/colored glow.
      el.appendChild(
        slotIconImg(itemSlot, INVENTORY_SLOT_ICON_PX[slot], {
          alt: item.name,
          extraCss: 'filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6));',
        }),
      );
      el.addEventListener('mouseenter', () => {
        el.style.boxShadow = `0 0 10px ${qCol}55,${baseShadow}`;
      });
      el.addEventListener('mouseleave', () => { el.style.boxShadow = baseShadow; });
    }
    return el;
  };

  /**
   * Background grid socket (the stone cell an item tile can cover).
   * N3R-R: light hairline cell — clearly lighter than the equip wells.
   */
  const bagCell = (): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.cssText =
      'border:1px solid rgba(138,122,90,0.18);background:rgba(8,6,4,0.4);' +
      `width:var(--hf-bag-cell,${BAG_CELL_PX}px);height:var(--hf-bag-cell,${BAG_CELL_PX}px);` +
      'box-sizing:border-box;';
    return el;
  };

  /** One item tile spanning w×h cells (explicit grid-column/row placement). */
  const bagTile = (item: Readonly<ItemInstance>, w: number, h: number): HTMLDivElement => {
    const el = document.createElement('div');
    const qCol = RARITY_META[item.rarity].color;
    el.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'cursor:pointer;position:relative;z-index:1;background-color:rgba(12,8,4,0.88);' +
      `border:1px solid ${qCol}aa;box-shadow:inset 0 0 10px ${qCol}33;` +
      'box-sizing:border-box;overflow:hidden;';
    // Icon scales with the tile's short edge (1×1 → 30px with the 38px cell);
    // the max-width/height caps keep it inside the 28px 720p cells.
    const iconPx = Math.min(w, h) * (BAG_CELL_PX + BAG_GAP_PX) - BAG_GAP_PX - 8;
    const icon = slotIconImg(item.slot, iconPx, { alt: item.name });
    icon.style.maxWidth = '92%';
    icon.style.maxHeight = '92%';
    el.appendChild(icon);
    return el;
  };

  const renderDetail = (): void => {
    const view = resolveInventoryDetail(selectedInstanceId, curEq, curBag, curLevel);
    if (!view) {
      // S4: nothing selected → the card folds to a thin strip with a hint;
      // it expands only while an item is selected.
      detail.style.cssText = detailCollapsedCss;
      detail.innerHTML =
        `<div style="display:flex;align-items:center;gap:6px;` +
        `color:${Ui.textDim};font:600 10px ${FONT_UI};letter-spacing:1px;` +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        `<span style="color:${Ui.goldDim};">◆</span>详情 · 点击物品查看</div>`;
      return;
    }
    detail.style.cssText = detailExpandedCss;
    const item = view.selection.item;
    const sourceLabel = view.selection.source === 'bag' ? '背包物品' : '已装备';
    const detailLines = view.tooltipLines.slice(2);
    const affixes = detailLines.length > 0
      ? detailLines.map(([text, color, dim]) =>
        `<div style="color:${color};line-height:1.45;">${escapeHtml(text)}` +
        `${dim ? ` <span style="color:${Ui.textDim};">(${escapeHtml(dim)})</span>` : ''}</div>`).join('')
      : `<div style="color:${Ui.textDim};">无额外属性</div>`;
    // N3R G1: tradeoffs leave the right column and become a full-width bar at
    // the bottom of the card (after the two-column grid). The right column
    // keeps the compare-target identity; green/red keep deltaColor.
    const tradeoffs = view.comparison.length > 0
      ? view.comparison.map((d) => {
        const label =
          d.polarity === 'positive' ? '优势'
          : d.polarity === 'negative' ? '代价'
          : '持平';
        return `<span style="display:inline-flex;gap:6px;line-height:1.45;color:${deltaColor(d.polarity)};">` +
          `<span style="font-size:10px;letter-spacing:1px;">${label}</span>` +
          `<span>${escapeHtml(d.label)}</span></span>`;
      }).join('')
      : `<span style="color:${Ui.deltaFlat};">无属性变化</span>`;
    const compareLabel = view.compareTarget
      ? `对比：${escapeHtml(view.compareTarget.name)}`
      : view.selection.source === 'bag' ? '对比：空装备槽' : '当前装备';
    const compareMeta = view.compareTarget
      ? `<div style="font:600 10px ${FONT_UI};color:${RARITY_META[view.compareTarget.rarity].color};margin-top:2px;">` +
        `${escapeHtml(RARITY_META[view.compareTarget.rarity].label)} · ` +
        `${escapeHtml(SLOT_META[view.compareTarget.slot].label)} · 装等 ${view.compareTarget.ilvl}</div>`
      : '';
    detail.innerHTML =
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,0.78fr);` +
      'gap:12px;align-items:start;">' +
      `<div><div style="font:700 14px ${FONT_UI};color:${view.rarityColor};white-space:nowrap;` +
      `overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>` +
      `<div style="font:600 10px ${FONT_UI};color:${view.rarityColor};margin:2px 0 5px;">` +
      `${escapeHtml(view.rarityLabel)} · ${escapeHtml(SLOT_META[item.slot].label)} · 装等 ${item.ilvl} · ${sourceLabel}</div>` +
      `${affixes}</div>` +
      `<div><div style="font:700 10px ${FONT_DISPLAY};letter-spacing:1px;color:${Ui.textDim};` +
      `margin-bottom:3px;">${compareLabel}</div>${compareMeta}</div></div>` +
      '<div style="width:100%;box-sizing:border-box;margin-top:8px;padding-top:6px;' +
      'border-top:1px solid #4a3a2a;display:flex;flex-wrap:wrap;gap:2px 14px;">' +
      `${tradeoffs}</div>`;
  };

  const selectInstance = (instanceId: string): void => {
    selectedInstanceId = normalizeInventorySelection(instanceId, curEq, curBag);
    renderDetail();
  };

  // ── N3R G4 bag tabs ──────────────────────────────────────────────────────
  const setBagTab = (tab: InventoryBagTab): void => {
    if (bagTab === tab) return;
    bagTab = tab;
    // A selection filtered out by the tab switch clears through the same
    // normalization path as any other snapshot change.
    selectedInstanceId = normalizeInventorySelection(selectedInstanceId, curEq, curBag);
    render();
  };

  const renderConsumables = (): void => {
    // N3R-R G4: icon row cards — potion art | name | ×n | use hint.
    const row = (icon: string, name: string, count: number, keyHint: string): string =>
      '<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;min-height:40px;' +
      `box-sizing:border-box;background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};">` +
      `<span style="flex:none;line-height:0;">${icon}</span>` +
      `<span style="flex:1;color:#e0d8cc;">${name}</span>` +
      `<span style="color:${Ui.goldBright};font-weight:bold;">×${count}</span>` +
      `<span style="color:${Ui.textDim};font-size:10px;">${keyHint}</span></div>`;
    consumablesPane.innerHTML =
      row(potionIconSvg('life', 28), '生命药水', curPotions.life, '按 5 使用') +
      row(potionIconSvg('mana', 28), '法力药水', curPotions.mana, '按 6 使用') +
      `<div style="color:${Ui.textDim};font-size:10px;line-height:1.6;">` +
      '药水存放在腰带上，不占背包格。战斗中按 5 / 6 键立即使用。' +
      (curPotions.life + curPotions.mana === 0
        ? '<br>当前没有药水 — 击杀怪物或开启宝箱可获得。'
        : '') +
      '</div>';
  };

  const renderMaterials = (): void => {
    // N3R-R G4: icon row cards — shard art | name | ×n | forge-use hint.
    // Names follow the forge's 白/蓝/黄色碎片 wording (cube-ui TIER_LABEL).
    const row = (tier: MaterialTier, name: string, count: number, hint: string): string =>
      '<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;min-height:40px;' +
      `box-sizing:border-box;background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};">` +
      `<span style="flex:none;line-height:0;">${materialShardSvg(tier, 26)}</span>` +
      `<span style="flex:1;color:#e0d8cc;">${name}</span>` +
      `<span style="color:${Ui.goldBright};font-weight:bold;">×${count}</span>` +
      `<span style="color:${Ui.textDim};font-size:10px;">${hint}</span></div>`;
    materialsPane.innerHTML =
      row('common', '白色碎片', curMaterials.common, '普通装备 · 熔炉拆解 / 重铸') +
      row('magic', '蓝色碎片', curMaterials.magic, '魔法装备 · 熔炉拆解 / 重铸') +
      row('rare', '黄色碎片', curMaterials.rare, '稀有装备 · 拆解 / 重铸 / 合成') +
      `<div style="color:${Ui.textDim};font-size:10px;line-height:1.6;">` +
      '材料不占背包格。在熔炉（F）分解装备获得材料，重铸词条消耗对应品质材料。' +
      '</div>';
  };

  /** Tab chrome: button states, pane visibility, footer count, list content. */
  const renderBagChrome = (): void => {
    for (const { id } of BAG_TABS) {
      tabButtons.get(id)!.style.cssText = tabButtonCss(id === bagTab);
    }
    grid.style.display = bagTab === 'equipment' ? 'grid' : 'none';
    consumablesPane.style.display = bagTab === 'consumables' ? 'flex' : 'none';
    materialsPane.style.display = bagTab === 'materials' ? 'flex' : 'none';
    // N3R-N3 去字: the count no longer occupies a title row — it lives as a
    // tiny dim label beside the footer gold plaque (and mirrors into the
    // grid's aria-label for screen readers).
    let countText = '';
    if (bagTab === 'equipment') {
      const usedCells = occupiedCellCount(curBag);
      const full = usedCells >= BAG_CELLS;
      countText = full ? `背包 ${usedCells}/${BAG_CELLS} · 已满` : `背包 ${usedCells}/${BAG_CELLS}`;
      bagCountEl.style.color = full ? '#ff6a6a' : '#8a7a58';
    } else if (bagTab === 'consumables') {
      countText = `消耗 ${curPotions.life + curPotions.mana}`;
      bagCountEl.style.color = '#8a7a58';
      renderConsumables();
    } else {
      countText = `材料 ${curMaterials.common + curMaterials.magic + curMaterials.rare}`;
      bagCountEl.style.color = '#8a7a58';
      renderMaterials();
    }
    bagCountEl.textContent = countText;
    grid.setAttribute('aria-label', countText);
  };

  closeButton.addEventListener('click', () => {
    endDrag();
    hideTip();
    hideConfirm();
    cb.onClose();
  });

  const render = (): void => {
    selectedInstanceId = normalizeInventorySelection(selectedInstanceId, curEq, curBag);
    renderDetail();
    renderBagChrome();
    if (!curEq) return;
    // paper doll
    dollBody.querySelectorAll('[data-slot]').forEach((n) => n.remove());
    for (const { slot, area } of DOLL_LAYOUT) {
      const item = curEq[slot];
      const el = slotCell(item, slot, area);
      el.dataset.slot = slot;
      if (item) el.dataset.instanceId = item.instanceId;
      if (item?.instanceId === selectedInstanceId) {
        el.style.outline = `1px solid ${Ui.goldBright}`;
        el.style.outlineOffset = '-2px';
      }
      if (item) {
        const instanceId = item.instanceId;
        el.addEventListener('mousemove', (e) => {
          const resolved = resolveInventorySelection(instanceId, curEq, curBag);
          if (resolved?.source === 'equipment') {
            showTip(e, [renderTipCol(itemTooltipLines(resolved.item, curLevel), '已装备')]);
          }
        });
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', () => {
          selectInstance(instanceId);
          hideTip();
          hideConfirm();
          const resolved = resolveInventorySelection(instanceId, curEq, curBag);
          if (resolved?.source === 'equipment' && resolved.equipSlot === slot) cb.onUnequip(slot);
        });
        el.addEventListener('pointerdown', (e) => startDrag({ kind: 'slot', slot, instanceId }, e, el));
      }
      dollBody.appendChild(el);
    }
    // bag — 12×5 background sockets + one w×h tile per anchored item.
    // G4: only the 装备 tab owns the grid; other tabs leave it hidden as-is.
    if (bagTab === 'equipment') {
      grid.innerHTML = '';
      for (let y = 0; y < BAG_ROWS; y++) {
        for (let x = 0; x < BAG_COLS; x++) {
          const cell = bagCell();
          cell.style.gridColumn = `${x + 1}`;
          cell.style.gridRow = `${y + 1}`;
          grid.appendChild(cell);
        }
      }
      curBag.forEach((anchor) => {
        const item = anchor.item;
        const { w, h } = itemFootprint(item);
        const el = bagTile(item, w, h);
        el.style.gridColumn = `${anchor.x + 1} / span ${w}`;
        el.style.gridRow = `${anchor.y + 1} / span ${h}`;
        el.dataset.instanceId = item.instanceId;
        if (item.instanceId === selectedInstanceId) {
          el.style.outline = `1px solid ${Ui.goldBright}`;
          el.style.outlineOffset = '-2px';
        }
        // Dense tile: icon only — the name lives in the hover tooltip.
        const instanceId = item.instanceId;
        el.addEventListener('mousemove', (e) => {
          const resolved = resolveInventorySelection(instanceId, curEq, curBag);
          if (resolved?.source !== 'bag' || !curEq) return;
          const wornSlot = wornSlotForCompare(curEq, resolved.item.slot);
          const worn = curEq[wornSlot];
          // G1: item columns side-by-side up top; diff is a full-width bottom bar.
          const cols = [renderTipCol(itemTooltipLines(resolved.item, curLevel), '背包')];
          if (worn) cols.push(renderTipCol(itemTooltipLines(worn, curLevel), '已装备'));
          showTip(e, cols, renderDeltaBar(compareItems(resolved.item, worn ?? null)));
        });
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', () => {
          selectInstance(instanceId);
          hideTip();
          hideConfirm();
          const resolved = resolveInventorySelection(instanceId, curEq, curBag);
          if (resolved?.source === 'bag' && resolved.bagIndex !== null) {
            cb.onEquipFromBag(
              resolved.bagIndex,
              curEq ? bagClickEquipTarget(curEq, resolved.item.slot) : undefined,
            );
          }
        });
        el.addEventListener('pointerdown', (e) => startDrag({ kind: 'bag', instanceId }, e, el));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          selectInstance(instanceId);
          hideTip();
          // L3 — legendary equip/store only; no melt confirm dialog.
          const resolved = resolveInventorySelection(instanceId, curEq, curBag);
          if (!resolved || resolved.source !== 'bag' || resolved.item.rarity === 'legendary') return;
          showConfirm(instanceId, resolved.item);
        });
        grid.appendChild(el);
      });
    }
  };

  mount.appendChild(root);

  // N3R-R3 S5: the gold count lives in a small gold-rimmed plaque (coin icon +
  // count) — D2R-style plate at the footer's left; hints stay on the right.
  const coinIconSvg =
    '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" style="flex:none;">' +
    '<defs><radialGradient id="hf-coin" cx="38%" cy="32%" r="75%">' +
    '<stop offset="0%" stop-color="#ffe9a0"/><stop offset="45%" stop-color="#e8b84a"/>' +
    '<stop offset="100%" stop-color="#8a5e18"/></radialGradient></defs>' +
    '<circle cx="10" cy="10" r="8.5" fill="url(#hf-coin)" stroke="#5a4018" stroke-width="1"/>' +
    '<circle cx="10" cy="10" r="5.5" fill="none" stroke="rgba(90,64,24,0.8)" stroke-width="0.8"/>' +
    '</svg>';
  const currencyPill = (inner: string): string =>
    `<span style="padding:2px 10px;display:inline-flex;align-items:center;gap:6px;` +
    `border-radius:2px;background:linear-gradient(180deg,rgba(44,34,20,0.9),rgba(26,18,10,0.95));` +
    `border:1px solid ${Ui.gold};box-shadow:0 0 0 1px rgba(224,184,74,0.25),` +
    'inset 0 1px 0 rgba(224,184,74,0.3),inset 0 0 8px rgba(224,184,74,0.12);' +
    `">${inner}</span>`;

  return {
    update(eq, bag, playerLevel, gold, materials, potions) {
      curEq = eq; curBag = bag; curLevel = playerLevel;
      curMaterials = materials;
      curPotions = potions ?? { life: 0, mana: 0 };
      selectedInstanceId = normalizeInventorySelection(selectedInstanceId, curEq, curBag);
      if (
        pendingMeltInstanceId !== null
        && resolveInventorySelection(pendingMeltInstanceId, curEq, curBag)?.source !== 'bag'
      ) {
        hideConfirm();
      }
      // N3R-N3 去字: bag/tab counters land in the footer's tiny count label
      // (renderBagChrome) — materials pills stay in the 材料 tab.
      goldEl.innerHTML = currencyPill(
        coinIconSvg +
        `<span style="color:#f0c840;font-weight:bold;">${gold}</span>` +
        `<span style="color:#8a7a58;font-size:10px;">金币</span>`,
      );
      if (root.style.display !== 'none') render();
    },
    show() {
      root.style.display = 'block';
      render();
    },
    hide() {
      root.style.display = 'none';
      endDrag();
      hideTip();
      hideConfirm();
    },
    toggle() {
      if (root.style.display !== 'none') this.hide();
      else this.show();
    },
    isOpen: () => root.style.display !== 'none',
    dispose() {
      // Release the manager owner before removing the surface from the DOM.
      disposeInventorySurface(cb.onClose, () => {
        endDrag();
        mount.removeEventListener('click', onClickCapture, true);
        mount.removeEventListener('pointerdown', onMousedownCapture, true);
        root.remove();
        if (ownsTooltip) tip.dispose();
      });
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
