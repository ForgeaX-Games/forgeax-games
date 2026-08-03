// Hellforge Personal Stash — left-dock PORTRAIT framed slab (camp-only).
// N-Stash: a pure 12×10 item grid — NO paper doll, NO tabs, NO melt. Opens as
// the left half of the dual-open pair with the right-docked inventory (wiring
// in main.ts); visual chrome mirrors the inventory panel exactly (same painted
// frame, same 3:4 aspect lock, same inset conventions, same close-button style,
// plus a small「仓库」text header badge — dedicated「箱」art comes later).
// Drag ownership is split by panel: this panel owns stash→bag moves; the
// bag→stash drop target lives in inventory-ui.ts.
// Interactions:
//   • drag stash item → bag grid = move to bag (onMoveToBag)
//   • hover → global tooltip (name/rarity/affixes)
//   • ✕ close → onClose (wiring closes the dual-open pair via UiLayerManager)
// Mutations stay in main.ts via callbacks — this file only renders and reports.

import { RARITY_META, itemFootprint, itemTooltipLines, type Item, type ItemInstance } from './items';
import { STASH_CELLS, STASH_COLS, STASH_ROWS, occupiedCellCount, type BagAnchor } from './bag-grid';
import { FONT_DISPLAY, FONT_UI, Ui, Z, panelTitleStyle } from './ui-theme';
import { HudArt } from './hud-art';
import { slotIconImg } from './ui-icons';
import { installUiTooltip, type UiTooltipHandle } from './ui-tooltip';
import type { DeepReadonly } from './deep-readonly';

export interface StashCallbacks {
  /** Move stash[index] into the bag. Return false to reject (bag full etc.). */
  onMoveToBag(index: number): boolean;
  /** Close through UiLayerManager so ownership and world input stay in sync. */
  onClose: () => void;
}

export interface StashHandle {
  /**
   * Re-render from a deep-readonly domain snapshot (cheap full rebuild — 120
   * nodes). playerLevel colors the tooltip 需求等级 line (defaults to 1).
   */
  update(stash: readonly DeepReadonly<BagAnchor>[], playerLevel?: number): void;
  /** Surface API for UiLayerManager.register — prefer manager.open/close in main. */
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

const PANEL_ID = 'hellforge-stash';

/** Same pixel pitch as the bag grid so tiles look identical across panels. */
const STASH_CELL_PX = 38;
const STASH_GAP_PX = 4;

export interface StashDeps {
  /**
   * Global tooltip (ui-tooltip.ts). In-game main.ts always passes the shared
   * one; standalone preview falls back to installing a panel-local instance.
   */
  tooltip?: UiTooltipHandle;
}

export function installStashPanel(
  cb: StashCallbacks,
  mount: HTMLElement = document.body,
  deps?: StashDeps,
): StashHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText =
    // N-Stash: left-dock mirror of the inventory slab — geometry locked to the
    // frame art's native 3:4 (width derives from height via aspect-ratio), so
    // `center/100% 100%` never stretches the painted border. Shadow flips to
    // the right, matching the inventory's floating offset.
    `position:${posKind};left:0;top:24px;height:min(calc(100% - 48px),900px);` +
    `aspect-ratio:3/4;width:auto;max-width:96vw;` +
    `z-index:${Z.stash};display:none;pointer-events:auto;user-select:none;` +
    `font:600 13px ${FONT_UI};color:#e0d8cc;` +
    `background:url('${HudArt.panelStash()}') center/100% 100% no-repeat;` +
    'box-shadow:10px 0 30px rgba(0,0,0,0.7);' +
    'overflow:hidden;overscroll-behavior:contain;';

  const body = document.createElement('div');
  // N-Stash: same percentage inset as the inventory body — content sits inside
  // the parchment core of the shared frame art. overflow:hidden is the hard
  // guard so content can never paint over the frame's lava edge.
  body.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:6px;' +
    'padding:11.5% 10.5% 10%;' +
    'height:100%;min-height:0;overflow:hidden;box-sizing:border-box;';

  // N-Stash: small centered「仓库」text badge near the top of the body inset —
  // gold display title style (dedicated「箱」art swaps in later, see HudArt).
  const header = document.createElement('div');
  header.dataset.stashHeader = '1';
  header.textContent = '仓库';
  header.style.cssText = panelTitleStyle() + 'text-align:center;letter-spacing:8px;flex:none;';

  const grid = document.createElement('div');
  grid.dataset.stashGrid = '1';
  grid.style.cssText =
    // N-Stash: 12×10 grid on the same CSS vars as the bag grid
    // (--hf-bag-cell / --hf-bag-gap) — the max-height:800px media query
    // tightens them for 720p; row/col counts and w×h span logic are untouched.
    `display:grid;grid-template-columns:repeat(${STASH_COLS},var(--hf-bag-cell,${STASH_CELL_PX}px));` +
    `grid-auto-rows:var(--hf-bag-cell,${STASH_CELL_PX}px);gap:var(--hf-bag-gap,${STASH_GAP_PX}px);` +
    'justify-content:center;padding:2px;' +
    'border:0;background:rgba(8,6,4,0.35);flex:none;';

  // N-Stash: the bag grid's 720p media query, scoped to this panel — 10 rows at
  // 28px+3px pitch (307px) still fit the 720p parchment core (≈528px content
  // height), so the grid only needs the shared cell tightening.
  const responsiveStyle = document.createElement('style');
  responsiveStyle.textContent =
    `@media (max-height:800px){#${PANEL_ID}{--hf-bag-cell:28px;--hf-bag-gap:3px;}}`;
  root.appendChild(responsiveStyle);

  // N-Stash: same close-button style as the inventory frame — mirrored to the
  // left corner (this slab docks left; the corner faces the screen center).
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', '关闭仓库');
  closeButton.dataset.closeButton = '1';
  closeButton.style.cssText =
    `position:absolute;top:10px;left:10px;z-index:1;` +
    `flex:none;cursor:pointer;width:28px;height:28px;padding:0;font:700 22px ${FONT_UI};` +
    `line-height:24px;color:${Ui.textMuted};background:rgba(18,12,6,0.72);` +
    `border:1px solid ${Ui.goldLineSoft};border-radius:2px;`;

  body.appendChild(header);
  body.appendChild(grid);

  // N-Stash: bottom footer line mirroring the inventory footer — usage hint on
  // the right, live occupied-cell count on the left (refreshed in render()).
  // flex:none + body overflow:hidden keep it inside the parchment core at both
  // 1080p and the tightened max-height:800px layout.
  const footer = document.createElement('div');
  footer.dataset.stashFooter = '1';
  footer.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;gap:10px;' +
    'width:calc(100% - 12px);flex:none;';
  const stashCountEl = document.createElement('span');
  stashCountEl.dataset.stashCount = '1';
  stashCountEl.style.cssText = `font:600 10px ${FONT_UI};color:#8a7a58;`;
  const hintEl = document.createElement('span');
  hintEl.style.cssText = `font:600 10px ${FONT_UI};color:#8a7a5a;flex-shrink:0;`;
  hintEl.textContent = '拖拽 ⇄ 背包转移 · B 关闭';
  footer.append(stashCountEl, hintEl);
  body.appendChild(footer);
  root.appendChild(body);
  root.appendChild(closeButton);

  // Global tooltip singleton (see StashDeps) — mirror of the inventory deps
  // injection so main.ts can share ONE tooltip handle across both panels.
  const ownsTooltip = deps?.tooltip === undefined;
  const tip = deps?.tooltip ?? installUiTooltip(mount);
  // N-Stash: same tooltip chrome as the inventory bag tiles — item columns
  // rendered from itemTooltipLines (name/rarity/affixes), no diff bar (stash
  // items have no equipment comparison target).
  const showTip = (e: MouseEvent, cols: string[]): void =>
    tip.show(
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
        `<div style="display:flex;flex-wrap:wrap;gap:16px;">${cols.join('')}</div>` +
        '</div>',
      e.clientX,
      e.clientY,
    );
  const hideTip = (): void => tip.hide();
  const renderTipCol = (lines: Array<[string, string, string?]>, headerText?: string): string => {
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
    return `<div style="min-width:200px;">${headerText ? `<div style="color:${Ui.textDim};font-size:10px;letter-spacing:2px;margin-bottom:3px;font-family:${FONT_DISPLAY};">${headerText}</div>` : ''}${rows}</div>`;
  };

  /**
   * Tooltip 需求等级 coloring — default 1 until main.ts re-renders with the real
   * player level via update(stash, playerLevel). Instance state: standalone
   * preview and in-game panels may coexist, so this never lives at module scope.
   */
  let curLevel = 1;
  let curStash: readonly DeepReadonly<BagAnchor>[] = [];

  // ── mouse drag (D2 pick-up-and-place) — mirror of the inventory system ────
  // A press that travels >DRAG_PX becomes a drag: ghost follows the cursor,
  // drop target glows green(valid)/red(invalid). Stash items move ONLY into
  // the bag grid — the bag grid is the single valid drop target; the reverse
  // bag→stash drop is owned by inventory-ui.ts.
  type DragSrc = { kind: 'stash'; instanceId: string };
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
  ): { el: HTMLElement; ok: boolean } | null => {
    if (!drag) return null;
    const under = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!under) return null;
    // Stash items accept ONLY the bag grid (ok: true when hit) — equip wells,
    // doll slots, and other stash cells are not valid targets.
    const bagEl = under.closest<HTMLElement>('[data-bag-grid]');
    return bagEl ? { el: bagEl, ok: true } : null;
  };
  const onDragMove = (e: PointerEvent): void => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
      drag.moved = true;
      hideTip();
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
        // Resolve the anchor by instance id at commit time — the stash array
        // may have shifted between press and release; a vanished item is a
        // no-op (the UI never mutates; main.ts owns the domain).
        const dragSrc = drag.src; // let-narrowing does not cross the callback
        const index = curStash.findIndex((a) => a.item.instanceId === dragSrc.instanceId);
        if (index >= 0) cb.onMoveToBag(index);
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
    const item = curStash.find((a) => a.item.instanceId === src.instanceId)?.item;
    if (!item) return;
    endDrag();
    const ghost = document.createElement('div');
    // k3: drag ghost reads over the near-black scene — warm lifted backdrop,
    // 2px rarity border + matching outer glow, icon nudged brighter (mirror of
    // the inventory ghost).
    ghost.style.cssText =
      'position:fixed;z-index:240;transform:translate(-50%,-50%);pointer-events:none;' +
      `background:rgba(52,36,18,0.92);border:2px solid ${RARITY_META[item.rarity].color};` +
      `border-radius:3px;padding:3px;box-shadow:0 0 10px 2px color-mix(in srgb, ${RARITY_META[item.rarity].color} 55%, transparent);`;
    ghost.appendChild(slotIconImg(item.slot, 36, { alt: item.name, extraCss: 'filter:brightness(1.15)' }));
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
  /**
   * DeepReadonly snapshot items are only MORE readonly than the item APIs'
   * Readonly<Item> views — TS refuses the structural assignment because
   * DeepReadonly deep-freezes the affixes array. The UI never mutates; bridge
   * once at the render boundary (same `as unknown as` snapshot idiom as
   * save-schema.ts / character-domain tests).
   */
  const readItem = (item: DeepReadonly<ItemInstance>): Readonly<Item> =>
    item as unknown as Readonly<Item>;

  /** Background grid socket — light hairline cell, same as the bag grid. */
  const stashCell = (): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.cssText =
      'border:1px solid rgba(138,122,90,0.18);background:rgba(8,6,4,0.4);' +
      `width:var(--hf-bag-cell,${STASH_CELL_PX}px);height:var(--hf-bag-cell,${STASH_CELL_PX}px);` +
      'box-sizing:border-box;';
    return el;
  };

  /** One item tile spanning w×h cells (explicit grid-column/row placement). */
  const stashTile = (item: Readonly<Item>, w: number, h: number): HTMLDivElement => {
    const el = document.createElement('div');
    const qCol = RARITY_META[item.rarity].color;
    el.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'cursor:pointer;position:relative;z-index:1;background-color:rgba(12,8,4,0.88);' +
      `border:1px solid ${qCol}aa;box-shadow:inset 0 0 10px ${qCol}33;` +
      'box-sizing:border-box;overflow:hidden;';
    // Icon scales with the tile's short edge (same formula as the bag tile).
    const iconPx = Math.min(w, h) * (STASH_CELL_PX + STASH_GAP_PX) - STASH_GAP_PX - 8;
    const icon = slotIconImg(item.slot, iconPx, { alt: item.name });
    icon.style.maxWidth = '92%';
    icon.style.maxHeight = '92%';
    el.appendChild(icon);
    return el;
  };

  const render = (): void => {
    grid.innerHTML = '';
    for (let y = 0; y < STASH_ROWS; y++) {
      for (let x = 0; x < STASH_COLS; x++) {
        const cell = stashCell();
        cell.style.gridColumn = `${x + 1}`;
        cell.style.gridRow = `${y + 1}`;
        grid.appendChild(cell);
      }
    }
    curStash.forEach((anchor, index) => {
      const item = anchor.item;
      const readable = readItem(item);
      const { w, h } = itemFootprint(readable);
      const el = stashTile(readable, w, h);
      el.style.gridColumn = `${anchor.x + 1} / span ${w}`;
      el.style.gridRow = `${anchor.y + 1} / span ${h}`;
      el.dataset.stashIdx = String(index);
      el.dataset.instanceId = item.instanceId;
      // Dense tile: icon only — the name lives in the hover tooltip.
      const instanceId = item.instanceId;
      el.addEventListener('mousemove', (e) => {
        // Re-resolve at hover time — the anchor may have moved between renders.
        const idx = curStash.findIndex((a) => a.item.instanceId === instanceId);
        if (idx < 0) return;
        showTip(e, [renderTipCol(itemTooltipLines(readable, curLevel), '仓库')]);
      });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('pointerdown', (e) => startDrag({ kind: 'stash', instanceId }, e, el));
      grid.appendChild(el);
    });
    // Live occupancy count — same「仓库 n/120」 idiom as the bag footer's
    //「背包 60/60」. Bridged through the established `as unknown as` snapshot
    // idiom (occupancy only reads itemFootprint; it never mutates).
    stashCountEl.textContent = `仓库 ${occupiedCellCount(curStash as unknown as readonly BagAnchor[], STASH_COLS, STASH_ROWS)}/${STASH_CELLS}`;
  };

  closeButton.addEventListener('click', () => {
    endDrag();
    hideTip();
    cb.onClose();
  });

  mount.appendChild(root);

  return {
    update(stash, playerLevel = 1) {
      curStash = stash;
      curLevel = playerLevel;
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
    },
    toggle() {
      if (root.style.display !== 'none') this.hide();
      else this.show();
    },
    isOpen: () => root.style.display !== 'none',
    dispose() {
      // Release the manager owner before removing the surface from the DOM.
      // (Mirror of disposeInventorySurface — a failing close callback is
      // contained while the owned-resource cleanup always runs.)
      try {
        cb.onClose();
      } catch {
        // Early teardown is best-effort; cleanup below is the invariant.
      } finally {
        endDrag();
        mount.removeEventListener('click', onClickCapture, true);
        mount.removeEventListener('pointerdown', onMousedownCapture, true);
        root.remove();
        if (ownsTooltip) tip.dispose();
      }
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
