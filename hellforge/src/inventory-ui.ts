// Hellforge inventory panel — 1:1 aidiablo right-dock stone slab (B/I).
// 560px full-height stone panel: pillar at the free edge, amber-gem corner
// ornaments, stone-inset paper doll, 8×3 bag grid, gold pill, drag-drop.
// Interactions (unchanged semantics):
//   • click a bag item  → equip (swaps the current piece back into the bag)
//   • click an equipped slot → unequip into the bag
//   • drag bag item → matching doll slot = equip; drag equipped → bag = unequip
//   • right-click a bag item → melt confirm → melt to gold
//   • hover → global tooltip with equipped-vs-candidate StatDelta comparison
// Mutations stay in main.ts via callbacks — this file only renders and reports.

import {
  RARITY_META, SLOT_META, SLOT_ORDER, compareItems, itemTooltipLines, meltGoldValue,
  type Equipment, type Item, type ItemInstance, type ItemSlot, type StatDelta,
} from './items';
import { HudArt } from './hud-art';
import {
  FONT_UI, FONT_DISPLAY, Ui, Z, deltaColor,
  d2StonePanelCss, goldDividerHtml, titleBandCss,
} from './ui-theme';
import { slotIconImg, slotSilhouetteSvg } from './ui-icons';
import { installUiTooltip, type UiTooltipHandle } from './ui-tooltip';

export interface InventoryCallbacks {
  /** Equip bag[index]; return false to reject (e.g. level requirement). */
  onEquipFromBag(index: number): boolean;
  onUnequip(slot: ItemSlot): boolean;
  onMelt(index: number): void;
}

/** Display-only inventory snapshot — never feed mutated copies back as authority. */
export type InventoryEquipmentView = Readonly<Equipment>;
export type InventoryBagView = readonly (Readonly<ItemInstance> | null)[];

export interface InventoryHandle {
  /** Re-render from a deep-readonly domain snapshot (cheap full rebuild — 30 nodes). */
  update(eq: InventoryEquipmentView, bag: InventoryBagView, playerLevel: number, gold: number): void;
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

const PANEL_ID = 'hellforge-inventory';

/** Paper-doll grid areas — hellforge's 6 slots (aidiablo layout shapes kept). */
const DOLL_LAYOUT: ReadonlyArray<{ slot: ItemSlot; area: string }> = [
  { slot: 'helm', area: 'helm' },
  { slot: 'weapon', area: 'weapon' },
  { slot: 'armor', area: 'armor' },
  { slot: 'amulet', area: 'amulet' },
  { slot: 'boots', area: 'boots' },
  { slot: 'ring', area: 'ring' },
];

const BAG_COLS = 8;

/** PR6 painted equip-slot plate. Quality color uses inset ring (not border — border:0). */
function stoneInsetCss(qCol: string | null): string {
  const rarityRing = qCol
    ? `box-shadow:inset 0 0 0 2px ${qCol}aa,inset 0 0 12px ${qCol}33,inset 0 0 10px rgba(0,0,0,0.45);`
    : 'box-shadow:inset 0 0 10px rgba(0,0,0,0.55);';
  return (
    `background-image:url('${HudArt.equipSlot()}');background-size:100% 100%;background-repeat:no-repeat;` +
    'background-color:rgba(12,8,4,0.85);border:0;border-radius:2px;' +
    rarityRing
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
    `position:${posKind};right:0;top:0;width:min(560px,94%);height:calc(100% - 150px);` +
    `z-index:${Z.inventory};display:none;pointer-events:auto;user-select:none;` +
    `font:600 13px ${FONT_UI};color:#e0d8cc;` +
    `background:url('${HudArt.panelInventory()}') center/100% 100% no-repeat,rgba(12,8,4,0.96);` +
    'border:0;box-shadow:-10px 0 30px rgba(0,0,0,0.7);' +
    'overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;';

  const body = document.createElement('div');
  // Extra inset so content sits inside the painted frame bezel.
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:28px 28px 24px 32px;height:100%;box-sizing:border-box;';
  const title = document.createElement('div');
  title.textContent = '背包与装备';
  title.style.cssText = titleBandCss() + 'padding:4px 0;';
  const divider = document.createElement('div');
  divider.innerHTML = goldDividerHtml(2);
  body.append(title, divider);

  // ── paper doll (stone-inset slots) ──────────────────────────────────────
  const dollBody = document.createElement('div');
  dollBody.style.cssText =
    'position:relative;display:grid;' +
    'grid-template-columns:64px 64px 64px;grid-template-rows:repeat(4,64px);gap:8px;' +
    'justify-content:center;padding:12px 6px 10px;' +
    "grid-template-areas:'. helm .' 'weapon armor amulet' '. boots .' '. ring .';";
  body.appendChild(dollBody);

  // ── bag grid + gold row ──────────────────────────────────────────────────
  const bagTitle = document.createElement('div');
  bagTitle.style.cssText = `font:700 13px ${FONT_DISPLAY};color:#d4b05a;letter-spacing:2px;`;
  const grid = document.createElement('div');
  grid.dataset.bagGrid = '1';
  grid.style.cssText = `display:grid;grid-template-columns:repeat(${BAG_COLS},52px);grid-auto-rows:52px;gap:5px;` +
    'justify-content:center;padding:6px;' +
    'border:0;background:rgba(8,6,4,0.35);';

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:2px;';
  const goldEl = document.createElement('span');
  const hintEl = document.createElement('span');
  hintEl.style.cssText = `font:600 10px ${FONT_UI};color:#8a7a5a;`;
  hintEl.textContent = '左键 穿戴 · 右键 熔毁 · 拖拽换装 · B 关闭';
  footer.append(goldEl, hintEl);
  body.append(bagTitle, grid, footer);
  root.appendChild(body);

  // Global tooltip singleton (see InventoryDeps) — replaces the old panel-local tip.
  const tip = deps?.tooltip ?? installUiTooltip(mount);
  const showTip = (e: MouseEvent, cols: string[]): void =>
    tip.show(`<div style="display:flex;gap:16px;">${cols.join('')}</div>`, e.clientX, e.clientY);
  const hideTip = (): void => tip.hide();

  // ── melt confirmation overlay (panel-local) ──────────────────────────────
  const confirm = document.createElement('div');
  confirm.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'background:rgba(6,4,3,0.72);z-index:2;';
  const confirmBox = document.createElement('div');
  confirmBox.style.cssText = 'min-width:220px;max-width:280px;padding:14px 16px;text-align:center;' +
    d2StonePanelCss() + 'border:2px solid #5a3a1a;box-shadow:0 8px 28px rgba(0,0,0,0.8);';
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

  let pendingMeltIndex: number | null = null;
  const hideConfirm = (): void => {
    pendingMeltIndex = null;
    confirm.style.display = 'none';
  };
  const showConfirm = (index: number, item: Readonly<Item>): void => {
    pendingMeltIndex = index;
    confirmText.textContent = `确定熔毁「${item.name}」？`;
    confirmSub.textContent = `获得 ${meltGoldValue(item)} 金币 · 不可撤销`;
    confirm.style.display = 'flex';
  };
  btnCancel.addEventListener('click', hideConfirm);
  btnOk.addEventListener('click', () => {
    const idx = pendingMeltIndex;
    hideConfirm();
    if (idx !== null) cb.onMelt(idx);
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

  const renderDeltaCol = (deltas: readonly StatDelta[]): string => {
    if (deltas.length === 0) {
      return `<div style="min-width:140px;"><div style="color:${Ui.textDim};font-size:10px;letter-spacing:2px;margin-bottom:3px;font-family:${FONT_DISPLAY};">对比</div>` +
        `<div style="color:${Ui.deltaFlat};">无属性变化</div></div>`;
    }
    const rows = deltas.map((d) =>
      `<div style="color:${deltaColor(d.polarity)};">${escapeHtml(d.label)}</div>`).join('');
    return `<div style="min-width:140px;"><div style="color:${Ui.textDim};font-size:10px;letter-spacing:2px;margin-bottom:3px;font-family:${FONT_DISPLAY};">对比</div>${rows}</div>`;
  };

  let curEq: InventoryEquipmentView | null = null;
  let curBag: InventoryBagView = [];
  let curLevel = 1;

  // ── mouse drag (D2 pick-up-and-place) ────────────────────────────────────
  // Click stays the primary verb; a press that travels >DRAG_PX becomes a
  // drag: ghost follows the cursor, drop target glows green(valid)/red(invalid).
  type DragSrc =
    | { kind: 'bag'; index: number; item: Readonly<ItemInstance> }
    | { kind: 'slot'; slot: ItemSlot; item: Readonly<ItemInstance> };
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
  const endDrag = (): void => {
    drag?.ghost.remove();
    drag = null;
    clearDropGlow();
  };
  const dropTargetAt = (clientX: number, clientY: number): { el: HTMLElement; ok: boolean } | null => {
    if (!drag) return null;
    const under = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!under) return null;
    if (drag.src.kind === 'bag') {
      const slotEl = under.closest<HTMLElement>('[data-slot]');
      if (slotEl && slotEl.dataset.slot === drag.src.item.slot) return { el: slotEl, ok: true };
      return slotEl ? { el: slotEl, ok: false } : null;
    }
    const bagEl = under.closest<HTMLElement>('[data-bag-grid]');
    return bagEl ? { el: bagEl, ok: true } : null;
  };
  const onDragMove = (e: MouseEvent): void => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
      drag.moved = true;
      hideTip();
      hideConfirm();
      // Ghost lives on mount (uiRoot), not document.body — input-contract forbids
      // global document listeners; mount covers the viewport so drag still tracks.
      mount.appendChild(drag.ghost);
    }
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    const t = dropTargetAt(e.clientX, e.clientY);
    if (t) setDropGlow(t.el, t.ok);
    else clearDropGlow();
  };
  const onDragUp = (e: MouseEvent): void => {
    if (!drag) return;
    if (drag.moved) {
      suppressClick = true; // swallow the click that follows this mouseup
      const t = dropTargetAt(e.clientX, e.clientY);
      if (t?.ok) {
        hideConfirm();
        if (drag.src.kind === 'bag') cb.onEquipFromBag(drag.src.index);
        else cb.onUnequip(drag.src.slot);
      }
    }
    endDrag();
  };
  const onClickCapture = (e: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  };
  mount.addEventListener('mousemove', onDragMove);
  mount.addEventListener('mouseup', onDragUp);
  mount.addEventListener('click', onClickCapture, true);

  const startDrag = (src: DragSrc, e: MouseEvent): void => {
    if (e.button !== 0) return;
    endDrag();
    const ghost = document.createElement('div');
    ghost.style.cssText =
      'position:fixed;z-index:240;transform:translate(-50%,-50%);pointer-events:none;' +
      `background:rgba(18,12,6,0.85);border:1px solid ${RARITY_META[src.item.rarity].color};border-radius:3px;padding:3px;`;
    ghost.appendChild(slotIconImg(src.item.slot, 36, { alt: src.item.name }));
    drag = { src, ghost, moved: false, x0: e.clientX, y0: e.clientY };
  };

  // ── cells ────────────────────────────────────────────────────────────────
  const slotCell = (item: Readonly<ItemInstance> | null, slot: ItemSlot): HTMLDivElement => {
    const el = document.createElement('div');
    const qCol = item ? RARITY_META[item.rarity].color : null;
    const baseShadow = qCol
      ? `inset 0 0 0 2px ${qCol}aa,inset 0 0 12px ${qCol}33,inset 0 0 10px rgba(0,0,0,0.45)`
      : 'inset 0 0 10px rgba(0,0,0,0.55)';
    el.style.cssText =
      `grid-area:${slot};position:relative;z-index:1;display:flex;flex-direction:column;` +
      'align-items:center;justify-content:center;cursor:pointer;' +
      stoneInsetCss(qCol);
    if (!item) {
      const sil = document.createElement('div');
      sil.innerHTML = slotSilhouetteSvg(slot, 34);
      sil.style.cssText = 'opacity:0.14;line-height:0;';
      el.appendChild(sil);
      const lab = document.createElement('span');
      lab.textContent = SLOT_META[slot].label;
      lab.style.cssText = 'font-size:9px;color:#6a6058;margin-top:2px;letter-spacing:0.5px;';
      el.appendChild(lab);
    } else {
      el.appendChild(slotIconImg(slot, 34, { alt: item.name }));
      const lab = document.createElement('span');
      lab.textContent = item.name;
      lab.style.cssText =
        `font-size:9px;color:${qCol};margin-top:1px;max-width:92%;overflow:hidden;` +
        'white-space:nowrap;text-overflow:ellipsis;';
      el.appendChild(lab);
      el.addEventListener('mouseenter', () => {
        el.style.boxShadow = `0 0 10px ${qCol}55,${baseShadow}`;
      });
      el.addEventListener('mouseleave', () => { el.style.boxShadow = baseShadow; });
    }
    return el;
  };

  const bagCell = (item: Readonly<ItemInstance> | null): HTMLDivElement => {
    const el = document.createElement('div');
    const qCol = item ? RARITY_META[item.rarity].color : null;
    el.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      `cursor:${item ? 'pointer' : 'default'};` +
      `background-image:url('${HudArt.bagSlot()}');background-size:100% 100%;background-repeat:no-repeat;` +
      (item
        ? `border:1px solid ${qCol}aa;box-shadow:inset 0 0 10px ${qCol}33;`
        : 'border:0;') +
      'width:52px;height:52px;box-sizing:border-box;overflow:hidden;';
    return el;
  };

  const render = (): void => {
    if (!curEq) return;
    // paper doll
    dollBody.querySelectorAll('[data-slot]').forEach((n) => n.remove());
    for (const { slot } of DOLL_LAYOUT) {
      const item = curEq[slot];
      const el = slotCell(item, slot);
      el.dataset.slot = slot;
      if (item) {
        el.addEventListener('mousemove', (e) => showTip(e, [renderTipCol(itemTooltipLines(item, curLevel), '已装备')]));
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', () => { hideTip(); hideConfirm(); cb.onUnequip(slot); });
        el.addEventListener('mousedown', (e) => startDrag({ kind: 'slot', slot, item }, e));
      }
      dollBody.appendChild(el);
    }
    // bag — single-cell only (no item dimensions)
    grid.innerHTML = '';
    curBag.forEach((item, i) => {
      const el = bagCell(item);
      if (item) {
        el.appendChild(slotIconImg(item.slot, 28, { alt: item.name }));
        const lab = document.createElement('span');
        lab.textContent = item.name;
        lab.style.cssText =
          `font-size:8px;color:${RARITY_META[item.rarity].color};max-width:95%;overflow:hidden;` +
          'white-space:nowrap;text-overflow:ellipsis;';
        el.appendChild(lab);
        el.addEventListener('mousemove', (e) => {
          const worn = curEq![item.slot];
          const cols = [
            renderTipCol(itemTooltipLines(item, curLevel), '背包'),
            renderDeltaCol(compareItems(item, worn ?? null)),
          ];
          if (worn) cols.splice(1, 0, renderTipCol(itemTooltipLines(worn, curLevel), '已装备'));
          showTip(e, cols);
        });
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', () => { hideTip(); hideConfirm(); cb.onEquipFromBag(i); });
        el.addEventListener('mousedown', (e) => startDrag({ kind: 'bag', index: i, item }, e));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          hideTip();
          showConfirm(i, item);
        });
      }
      grid.appendChild(el);
    });
  };

  mount.appendChild(root);

  return {
    update(eq, bag, playerLevel, gold) {
      curEq = eq; curBag = bag; curLevel = playerLevel;
      const used = bag.filter(Boolean).length;
      const full = used >= bag.length && bag.length > 0;
      bagTitle.textContent = full ? `背包 ${used}/${bag.length} · 已满` : `背包 ${used}/${bag.length}`;
      bagTitle.style.color = full ? '#ff6a6a' : '#d4b05a';
      goldEl.innerHTML =
        `<span style="padding:3px 14px;background:linear-gradient(180deg,rgba(40,34,26,0.8),rgba(28,24,18,0.9));` +
        `border:1px solid #4a4038;display:inline-flex;align-items:center;gap:6px;">` +
        `<span style="color:#ffd700;font-size:14px;">★</span>` +
        `<span style="color:#f0c840;font-weight:bold;">${gold}</span>` +
        `<span style="color:#8a7a58;font-size:10px;">金币</span></span>`;
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
      endDrag();
      mount.removeEventListener('mousemove', onDragMove);
      mount.removeEventListener('mouseup', onDragUp);
      mount.removeEventListener('click', onClickCapture, true);
      root.remove();
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
