// Hellforge inventory panel — D2R-inspired paper doll + 24 single-cell bag (B/I).
//
// DOM overlay: dark parchment panel, pointer-events enabled.
// Interactions:
//   • click a bag item  → equip (swaps the current piece back into the bag)
//   • click an equipped slot → unequip into the bag
//   • right-click a bag item → melt confirm → melt to gold
//   • hover bag item → tooltip + equipped-vs-candidate StatDelta comparison
// Mutations stay in main.ts via callbacks — this file only renders and reports.

import {
  RARITY_META, SLOT_META, SLOT_ORDER, compareItems, itemTooltipLines, meltGoldValue,
  type Equipment, type Item, type ItemInstance, type ItemSlot, type StatDelta,
} from './items';
import {
  FONT_UI, FONT_DISPLAY, Ui, deltaColor, panelChrome, panelScrollShellCss, panelTitleStyle,
} from './ui-theme';

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

const PANEL_ID = 'hellforge-inventory';

/** Paper-doll grid areas — silhouette body, not a flat list. */
const DOLL_LAYOUT: ReadonlyArray<{ slot: ItemSlot; area: string }> = [
  { slot: 'helm', area: 'helm' },
  { slot: 'weapon', area: 'weapon' },
  { slot: 'armor', area: 'armor' },
  { slot: 'amulet', area: 'amulet' },
  { slot: 'boots', area: 'boots' },
  { slot: 'ring', area: 'ring' },
];

export function installInventory(cb: InventoryCallbacks, mount: HTMLElement = document.body): InventoryHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText = `position:${posKind};right:14px;top:50%;transform:translateY(-50%);z-index:60;display:none;` +
    `font:600 13px ${FONT_UI};color:${Ui.text};user-select:none;pointer-events:auto;` +
    panelScrollShellCss(620, 40);

  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;gap:16px;padding:14px 16px;border-radius:10px;' +
    panelChrome();

  // left: paper doll
  const doll = document.createElement('div');
  doll.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:168px;';
  const dollTitle = document.createElement('div');
  dollTitle.textContent = '装备';
  dollTitle.style.cssText = panelTitleStyle() + 'font-size:13px;margin-bottom:0;';
  const dollBody = document.createElement('div');
  dollBody.style.cssText =
    'position:relative;display:grid;' +
    'grid-template-columns:48px 48px 48px;grid-template-rows:48px 48px 48px 48px;gap:6px;' +
    'justify-content:center;padding:10px 6px 8px;' +
    `background:radial-gradient(ellipse at 50% 42%,rgba(60,40,20,0.35) 0%,${Ui.inkWell} 72%);` +
    `border:1px solid ${Ui.goldLineSoft};border-radius:8px;` +
    "grid-template-areas:'. helm .' 'weapon armor amulet' '. boots .' '. ring .';";
  // faint body silhouette behind slots
  const silhouette = document.createElement('div');
  silhouette.setAttribute('aria-hidden', 'true');
  silhouette.style.cssText =
    'position:absolute;inset:14px 28px 18px;pointer-events:none;opacity:0.22;' +
    'background:linear-gradient(180deg,rgba(224,184,74,0.35) 0%,rgba(80,50,20,0.15) 100%);' +
    'clip-path:polygon(50% 0%,68% 14%,72% 38%,88% 52%,78% 100%,22% 100%,12% 52%,28% 38%,32% 14%);';
  dollBody.appendChild(silhouette);
  doll.append(dollTitle, dollBody);

  // right: bag grid + footer
  const bagCol = document.createElement('div');
  bagCol.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  const bagTitle = document.createElement('div');
  bagTitle.style.cssText = panelTitleStyle() + 'font-size:13px;margin-bottom:2px;';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,44px);grid-auto-rows:44px;gap:5px;';
  const footer = document.createElement('div');
  footer.style.cssText = `display:flex;justify-content:space-between;font:600 11px ${FONT_UI};color:${Ui.textMuted};margin-top:2px;`;
  const goldEl = document.createElement('span');
  const hintEl = document.createElement('span');
  hintEl.textContent = '左键 穿戴 · 右键 熔毁 · B 关闭';
  footer.append(goldEl, hintEl);
  bagCol.append(bagTitle, grid, footer);

  panel.append(doll, bagCol);
  root.appendChild(panel);

  // tooltip
  const tip = document.createElement('div');
  tip.style.cssText = `position:${posKind};z-index:61;display:none;max-width:520px;pointer-events:none;` +
    `padding:10px 12px;border-radius:8px;${panelChrome(`font:600 12px ${FONT_UI};line-height:1.65;`)}` +
    'display:none;gap:16px;';
  mount.appendChild(tip);

  // melt confirmation overlay (panel-local)
  const confirm = document.createElement('div');
  confirm.style.cssText =
    `position:absolute;inset:0;display:none;align-items:center;justify-content:center;` +
    `background:rgba(6,4,3,0.72);border-radius:10px;z-index:2;`;
  const confirmBox = document.createElement('div');
  confirmBox.style.cssText =
    'min-width:220px;max-width:280px;padding:14px 16px;border-radius:8px;text-align:center;' +
    panelChrome();
  const confirmText = document.createElement('div');
  confirmText.style.cssText = `font:700 13px ${FONT_UI};color:${Ui.text};margin-bottom:6px;line-height:1.5;`;
  const confirmSub = document.createElement('div');
  confirmSub.style.cssText = `font:600 11px ${FONT_UI};color:${Ui.textMuted};margin-bottom:12px;`;
  const confirmRow = document.createElement('div');
  confirmRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';
  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.textContent = '取消';
  btnCancel.style.cssText =
    `cursor:pointer;padding:6px 14px;border-radius:6px;font:700 12px ${FONT_UI};` +
    `color:${Ui.text};background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};`;
  const btnOk = document.createElement('button');
  btnOk.type = 'button';
  btnOk.textContent = '熔毁';
  btnOk.style.cssText =
    `cursor:pointer;padding:6px 14px;border-radius:6px;font:700 12px ${FONT_UI};` +
    `color:${Ui.ink};background:${Ui.gold};border:1px solid ${Ui.goldBright};`;
  confirmRow.append(btnCancel, btnOk);
  confirmBox.append(confirmText, confirmSub, confirmRow);
  confirm.appendChild(confirmBox);
  panel.style.position = 'relative';
  panel.appendChild(confirm);

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

  const renderTipCol = (lines: Array<[string, string]>, header?: string): string => {
    const rows = lines.map(([t, c], i) =>
      `<div style="color:${c};${i === 0 ? 'font-size:13px;font-weight:800;' : ''}">${escapeHtml(t)}</div>`).join('');
    return `<div style="min-width:170px;">${header ? `<div style="color:${Ui.textDim};font-size:10px;letter-spacing:2px;margin-bottom:3px;font-family:${FONT_DISPLAY};">${header}</div>` : ''}${rows}</div>`;
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

  const showTip = (e: MouseEvent, cols: string[]): void => {
    tip.innerHTML = cols.join('');
    tip.style.display = 'flex';
    const pad = 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const m = scoped ? mount.getBoundingClientRect() : { left: 0, top: 0, height: window.innerHeight };
    const localX = e.clientX - m.left, localY = e.clientY - m.top;
    let x = localX - w - pad;
    if (x < 8) x = localX + pad;
    const y = Math.min(localY, m.height - h - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hideTip = (): void => { tip.style.display = 'none'; };

  let curEq: InventoryEquipmentView | null = null;
  let curBag: InventoryBagView = [];
  let curLevel = 1;

  const slotCell = (item: Readonly<ItemInstance> | null, slot: ItemSlot): HTMLDivElement => {
    const el = document.createElement('div');
    const border = item ? RARITY_META[item.rarity].color : Ui.goldLineSoft;
    el.style.cssText =
      `grid-area:${slot};position:relative;z-index:1;display:flex;flex-direction:column;` +
      `align-items:center;justify-content:center;border-radius:6px;cursor:${item ? 'pointer' : 'default'};` +
      `background:${Ui.inkWell};border:2px solid ${border};width:48px;height:48px;` +
      (item ? '' : 'opacity:0.72;');
    const icon = document.createElement('span');
    icon.textContent = SLOT_META[slot].icon;
    icon.style.cssText = `font-size:${item ? '20px' : '16px'};line-height:1;` +
      (item ? '' : 'filter:grayscale(1) brightness(0.65);');
    el.appendChild(icon);
    if (!item) {
      const lab = document.createElement('span');
      lab.textContent = SLOT_META[slot].label;
      lab.style.cssText = `font-size:9px;color:${Ui.textDim};margin-top:2px;letter-spacing:0.5px;`;
      el.appendChild(lab);
    } else {
      el.title = item.name;
    }
    return el;
  };

  const bagCell = (item: Readonly<ItemInstance> | null): HTMLDivElement => {
    const el = document.createElement('div');
    const border = item ? RARITY_META[item.rarity].color : Ui.goldLineSoft;
    el.style.cssText =
      `display:flex;align-items:center;justify-content:center;border-radius:6px;` +
      `cursor:${item ? 'pointer' : 'default'};background:${Ui.inkWell};border:2px solid ${border};` +
      `font-size:19px;width:44px;height:44px;` +
      (item ? '' : 'opacity:0.4;');
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
      }
      dollBody.appendChild(el);
    }
    // bag — single-cell only (no item dimensions)
    grid.innerHTML = '';
    curBag.forEach((item, i) => {
      const el = bagCell(item);
      if (item) {
        el.textContent = SLOT_META[item.slot].icon;
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
      bagTitle.style.color = full ? Ui.danger : Ui.goldBright;
      goldEl.textContent = `💰 ${gold}`;
      if (root.style.display !== 'none') render();
    },
    show() {
      root.style.display = 'block';
      render();
    },
    hide() {
      root.style.display = 'none';
      hideTip();
      hideConfirm();
    },
    toggle() {
      if (root.style.display !== 'none') this.hide();
      else this.show();
    },
    isOpen: () => root.style.display !== 'none',
    dispose() { root.remove(); tip.remove(); },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
