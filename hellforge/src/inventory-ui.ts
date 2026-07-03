// Hellforge inventory panel — paper doll + 24-slot bag (B key).
//
// DOM overlay in the hud.ts style: dark parchment panel, pointer-events
// enabled (the ONLY large interactive HUD surface). Interactions:
//   • click a bag item  → equip (swaps the current piece back into the bag)
//   • click an equipped slot → unequip into the bag
//   • right-click a bag item → melt to gold (熔毁)
//   • hover anything → tooltip; when hovering a bag item the tooltip shows
//     the equipped piece beside it for comparison
// All state mutations happen in main.ts via the callbacks — this file only
// renders and reports clicks.

import {
  RARITY_META, SLOT_META, SLOT_ORDER, itemTooltipLines,
  type Equipment, type Item,
} from './items';

export interface InventoryCallbacks {
  /** Equip bag[index]; return false to reject (e.g. level requirement). */
  onEquipFromBag(index: number): boolean;
  onUnequip(slot: (typeof SLOT_ORDER)[number]): boolean;
  onMelt(index: number): void;
}

export interface InventoryHandle {
  /** Re-render with the current state (cheap full rebuild — 30 nodes). */
  update(eq: Equipment, bag: Array<Item | null>, playerLevel: number, gold: number): void;
  toggle(): void;
  isOpen(): boolean;
  hide(): void;
  dispose(): void;
}

const PANEL_ID = 'hellforge-inventory';

export function installInventory(cb: InventoryCallbacks, mount: HTMLElement = document.body): InventoryHandle {
  document.getElementById(PANEL_ID)?.remove();
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText = 'position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:60;display:none;' +
    "font:600 13px ui-sans-serif,system-ui,sans-serif;color:#e8dcc8;user-select:none;pointer-events:auto;";

  const panel = document.createElement('div');
  panel.style.cssText = 'display:flex;gap:14px;padding:14px 16px;border-radius:12px;' +
    'background:linear-gradient(180deg,rgba(24,16,12,0.96),rgba(14,9,7,0.96));' +
    'border:1px solid rgba(200,150,80,0.5);box-shadow:0 10px 40px rgba(0,0,0,0.7);';

  // left: paper doll
  const doll = document.createElement('div');
  doll.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:150px;';
  const dollTitle = document.createElement('div');
  dollTitle.textContent = '装备';
  dollTitle.style.cssText = 'font:800 13px ui-sans-serif;color:#e8cf9a;letter-spacing:3px;margin-bottom:2px;';
  doll.appendChild(dollTitle);
  const dollSlots = document.createElement('div');
  dollSlots.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
  doll.appendChild(dollSlots);

  // right: bag grid + footer
  const bagCol = document.createElement('div');
  bagCol.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  const bagTitle = document.createElement('div');
  bagTitle.style.cssText = 'font:800 13px ui-sans-serif;color:#e8cf9a;letter-spacing:3px;margin-bottom:2px;';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,44px);grid-auto-rows:44px;gap:5px;';
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:space-between;font:600 11px ui-sans-serif;color:#b9a888;margin-top:2px;';
  const goldEl = document.createElement('span');
  const hintEl = document.createElement('span');
  hintEl.textContent = '左键 穿戴 · 右键 熔毁 · B 关闭';
  footer.append(goldEl, hintEl);
  bagCol.append(bagTitle, grid, footer);

  panel.append(doll, bagCol);
  root.appendChild(panel);

  // tooltip (shared, follows the hovered element)
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:61;display:none;max-width:460px;pointer-events:none;' +
    'padding:10px 12px;border-radius:8px;background:rgba(10,7,5,0.96);border:1px solid rgba(200,150,80,0.55);' +
    'font:600 12px ui-sans-serif,system-ui;line-height:1.65;box-shadow:0 6px 24px rgba(0,0,0,0.7);' +
    'display:none;gap:16px;';
  mount.appendChild(tip);

  const renderTipCol = (lines: Array<[string, string]>, header?: string): string => {
    const rows = lines.map(([t, c], i) =>
      `<div style="color:${c};${i === 0 ? 'font-size:13px;font-weight:800;' : ''}">${t}</div>`).join('');
    return `<div style="min-width:170px;">${header ? `<div style="color:#8f8474;font-size:10px;letter-spacing:2px;margin-bottom:3px;">${header}</div>` : ''}${rows}</div>`;
  };
  const showTip = (e: MouseEvent, cols: string[]): void => {
    tip.innerHTML = cols.join('');
    tip.style.display = 'flex';
    const pad = 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX - w - pad;             // panel is on the right → tip left
    if (x < 8) x = e.clientX + pad;
    let y = Math.min(e.clientY, window.innerHeight - h - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hideTip = (): void => { tip.style.display = 'none'; };

  // state snapshot for rendering
  let curEq: Equipment | null = null;
  let curBag: Array<Item | null> = [];
  let curLevel = 1;

  const itemBox = (item: Item | null, size: 'slot' | 'cell'): HTMLDivElement => {
    const el = document.createElement('div');
    const border = item ? RARITY_META[item.rarity].color : 'rgba(90,80,70,0.4)';
    if (size === 'slot') {
      el.style.cssText = `display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:8px;cursor:${item ? 'pointer' : 'default'};` +
        `background:rgba(30,20,14,0.85);border:2px solid ${border};min-height:30px;`;
    } else {
      el.style.cssText = `display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:${item ? 'pointer' : 'default'};` +
        `background:rgba(30,20,14,0.85);border:2px solid ${border};font-size:19px;` +
        (item ? '' : 'opacity:0.45;');
    }
    return el;
  };

  const render = (): void => {
    if (!curEq) return;
    // paper doll
    dollSlots.innerHTML = '';
    for (const slot of SLOT_ORDER) {
      const item = curEq[slot];
      const el = itemBox(item, 'slot');
      const icon = document.createElement('span');
      icon.textContent = SLOT_META[slot].icon;
      icon.style.cssText = 'font-size:17px;';
      const label = document.createElement('span');
      if (item) {
        label.textContent = item.name;
        label.style.cssText = `color:${RARITY_META[item.rarity].color};font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;`;
      } else {
        label.textContent = SLOT_META[slot].label;
        label.style.cssText = 'color:#6f655a;font-size:12px;';
      }
      el.append(icon, label);
      if (item) {
        el.addEventListener('mousemove', (e) => showTip(e, [renderTipCol(itemTooltipLines(item, curLevel), '已装备')]));
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', () => { hideTip(); cb.onUnequip(slot); });
      }
      dollSlots.appendChild(el);
    }
    // bag
    grid.innerHTML = '';
    curBag.forEach((item, i) => {
      const el = itemBox(item, 'cell');
      if (item) {
        el.textContent = SLOT_META[item.slot].icon;
        el.addEventListener('mousemove', (e) => {
          const cols = [renderTipCol(itemTooltipLines(item, curLevel), '背包')];
          const worn = curEq![item.slot];
          if (worn) cols.push(renderTipCol(itemTooltipLines(worn, curLevel), '已装备'));
          showTip(e, cols);
        });
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', () => { hideTip(); cb.onEquipFromBag(i); });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); hideTip(); cb.onMelt(i); });
      }
      grid.appendChild(el);
    });
  };

  mount.appendChild(root);

  return {
    update(eq, bag, playerLevel, gold) {
      curEq = eq; curBag = bag; curLevel = playerLevel;
      const used = bag.filter(Boolean).length;
      bagTitle.textContent = `背包 ${used}/${bag.length}`;
      goldEl.textContent = `💰 ${gold}`;
      if (root.style.display !== 'none') render();
    },
    toggle() {
      const open = root.style.display !== 'none';
      root.style.display = open ? 'none' : 'block';
      if (!open) render();
      else hideTip();
    },
    isOpen: () => root.style.display !== 'none',
    hide() { root.style.display = 'none'; hideTip(); },
    dispose() { root.remove(); tip.remove(); },
  };
}
