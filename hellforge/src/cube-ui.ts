// Forge cube — direct port of aidiablo's ui/CubeUI.ts. 3×4 grid + Transmute
// button; a caller pushes bag items in and gets a list of bag indices back
// via sendTransmute — the cube holds no crafting logic of its own, matching
// the SPEC's framing of this component as orphan-until-wired.
//
// Deviations from source:
// - Factory shape: aidiablo's CubeUI is a bare `new CubeUI(callbacks)` that
//   always appends to document.body (web-only). hellforge's panels can also
//   live inside an in-editor preview iframe, so this follows inventory-ui.ts's
//   `installXxx(cb, mount) -> Handle` factory + fixed/absolute dual-mode
//   positioning instead.
// - Item identity: aidiablo's `ItemInstance` carries a stable `.id`; hellforge's
//   `Item` (./items) has none — bags are fixed-size `Array<Item|null>` slots
//   addressed by index (see inventory-ui.ts). The cube tracks bag INDICES,
//   not item copies, and re-reads `getBag()` live on every render — so a slot
//   that emptied out from under the cube (melted/equipped elsewhere) just
//   quietly drops out next render. No separate `syncWithInventory` call
//   needed; aidiablo needed one only because it cached item copies.
// - Icons: aidiablo's `getItemIconHtml(item, sizePx)` callback existed for
//   items with a custom `iconImg`; hellforge maps ItemSlot → PNG art via
//   ui-icons.slotIconUrl (see inventory-ui.ts), inlined as <img> tags.
// - Audio: aidiablo emitted UI_CUBE_OPEN/CLOSE/TRANSMUTE on its own audio
//   bus. hellforge's inventory-ui.ts never plays sfx from inside a UI
//   component — main.ts plays Sfx from inside callback implementations
//   instead — so those three emit() calls are dropped, not replaced.
// - Socketables: aidiablo badges rune/gem/jewel bag items with a 符/石/珠
//   label via `item.socketableType`; hellforge has no socketable items, so
//   that badge is gone.
// - Naming: "赫拉迪克方块" is Diablo 2's Horadrim lore; hellforge's own lore
//   is the Great Forge (see items.ts's legendary flavor text), so the panel
//   is renamed "熔炉方块" (Forge Cube) rather than carried over verbatim.
// - Two copy-paste inaccuracies in the source text are fixed in the port:
//   the top hint said "拖入" (drag in) though the mechanic is click-to-add
//   (the OTHER hint six lines down already said "点击"/click correctly);
//   and a cube-item's title said "右键移出" (right-click to remove) though
//   the bound handler is a plain click, never contextmenu.
//
// `sendTransmute`'s 3s "did the caller ever call setTransmuting(false)"
// timeout is kept as-is — a UI safety net, not a network wait, and works
// the same whether transmute resolves sync or async. hellforge has no
// crafting mechanic yet; this stays unwired until one exists, same status
// BuffDisplay accepts until a buff-granting source lands.

import { RARITY_META, type Item } from './items';
import { FONT_UI, Z } from './ui-theme';
import { slotIconUrl } from './ui-icons';

const CUBE_COLS = 3;
const CUBE_ROWS = 4;
const CUBE_SLOTS = CUBE_COLS * CUBE_ROWS;
const CELL_SIZE = 52;
const PANEL_ID = 'hellforge-cube';

export interface CubeUICallbacks {
  /** Live bag snapshot — same fixed-size Array<Item|null> as inventory-ui.ts. */
  getBag: () => Array<Item | null>;
  /** Caller resolves (or defers) the craft; call setTransmuting(false) + clearItems() when done. */
  sendTransmute: (bagIndices: number[]) => void;
  showNotification: (text: string, color?: string) => void;
  onClose: () => void;
}

export interface CubeUIHandle {
  isOpen(): boolean;
  toggle(): void;
  open(): void;
  close(): void;
  /** Bag indices currently placed in the cube. */
  getCubeIndices(): number[];
  /** Caller calls this after a successful transmute to empty the cube. */
  clearItems(): void;
  setTransmuting(val: boolean): void;
  dispose(): void;
}

export function installCubeUI(cb: CubeUICallbacks, mount: HTMLElement = document.body): CubeUIHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;

  let visible = false;
  let cubeIdx: number[] = [];
  let transmuting = false;
  let transmuteTimer: ReturnType<typeof setTimeout> | null = null;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = `
    position: ${scoped ? 'absolute' : 'fixed'}; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: ${CUBE_COLS * CELL_SIZE + 48}px;
    background:
      repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(25,18,10,0.04) 2px, rgba(25,18,10,0.04) 4px),
      linear-gradient(180deg, #3e3632 0%, #342c26 40%, #2c2622 100%);
    border: 6px solid;
    border-image: linear-gradient(180deg, #5a4a30 0%, #3a2a18 50%, #5a4a30 100%) 1;
    padding: 16px 20px;
    font-family: ${FONT_UI}; color: #ddd; z-index: ${Z.cube};
    box-shadow: 0 0 60px rgba(0,0,0,0.95), inset 0 0 60px rgba(0,0,0,0.3);
    display: none; flex-direction: column; align-items: center; gap: 10px;
    pointer-events: auto;
  `;
  mount.appendChild(panel);

  function render(): void {
    const bag = cb.getBag();
    const cubeItems: Array<{ idx: number; item: Item }> = [];
    for (const idx of cubeIdx) {
      const item = bag[idx];
      if (item) cubeItems.push({ idx, item });
    }
    const cubeSet = new Set(cubeItems.map((c) => c.idx));

    const gridW = CUBE_COLS * CELL_SIZE;
    const gridH = CUBE_ROWS * CELL_SIZE;

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:4px;">
        <div style="color:#c8a84e;font-size:16px;font-weight:bold;">🔥 熔炉方块</div>
        <div style="cursor:pointer;color:#888;font-size:18px;padding:0 4px;" id="cube-close">✕</div>
      </div>
      <div style="color:#5a4a3a;font-size:11px;margin-bottom:6px;">点击背包物品放入方块，凑齐后点击合成</div>
    `;

    html += `<div style="position:relative;width:${gridW}px;height:${gridH}px;
      background:rgba(8,6,4,0.6);border:2px solid #3a3228;border-radius:3px;">`;
    for (let y = 0; y < CUBE_ROWS; y++) {
      for (let x = 0; x < CUBE_COLS; x++) {
        html += `<div style="position:absolute;left:${x * CELL_SIZE}px;top:${y * CELL_SIZE}px;
          width:${CELL_SIZE - 1}px;height:${CELL_SIZE - 1}px;
          border:1px solid #2a2420;background:rgba(15,12,8,0.5);box-sizing:border-box;"></div>`;
      }
    }
    cubeItems.forEach(({ idx, item }, i) => {
      const x = i % CUBE_COLS;
      const y = Math.floor(i / CUBE_COLS);
      const color = RARITY_META[item.rarity].color;
      html += `<div data-bag-idx="${idx}" style="position:absolute;left:${x * CELL_SIZE}px;top:${y * CELL_SIZE}px;
        width:${CELL_SIZE}px;height:${CELL_SIZE}px;
        border:1px solid ${color}88;background:radial-gradient(ellipse at center,${color}18 0%,rgba(15,10,5,0.7) 80%);
        display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1;box-sizing:border-box;font-size:26px;"
        title="点击移出：${item.name}">
        <img src="${slotIconUrl(item.slot)}" alt="" draggable="false"
          style="width:${CELL_SIZE - 10}px;height:${CELL_SIZE - 10}px;object-fit:contain;pointer-events:none;">
      </div>`;
    });
    html += `</div>`;

    const canTransmute = cubeItems.length > 0 && !transmuting;
    html += `<div id="cube-transmute" style="
      width:100%;padding:8px 0;margin-top:4px;text-align:center;
      background:${canTransmute ? 'linear-gradient(180deg,#5a4a20,#3a2a10)' : 'rgba(30,25,18,0.6)'};
      border:2px solid ${canTransmute ? '#c8a84e' : '#3a3228'};border-radius:4px;
      color:${canTransmute ? '#ffd700' : '#5a4a3a'};font-size:14px;font-weight:bold;
      cursor:${canTransmute ? 'pointer' : 'not-allowed'};
      transition:all 0.15s;">
      ${transmuting ? '⏳ 合成中...' : '✨ 转化 (Transmute)'}
    </div>`;

    html += `<div style="color:#5a4a3a;font-size:11px;margin-top:6px;width:100%;border-top:1px solid #3a2a18;padding-top:6px;">
      ${cubeItems.length >= CUBE_SLOTS ? '方块已满' : `点击背包物品放入方块（已放入 ${cubeItems.length}/${CUBE_SLOTS}）`}
    </div>`;
    if (cubeItems.length < CUBE_SLOTS) {
      html += `<div style="width:100%;max-height:180px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px;">`;
      bag.forEach((item, idx) => {
        if (!item || cubeSet.has(idx)) return;
        const color = RARITY_META[item.rarity].color;
        html += `<div data-add-idx="${idx}" style="
          width:${CELL_SIZE - 4}px;height:${CELL_SIZE - 4}px;
          border:1px solid ${color}44;background:rgba(15,12,8,0.6);
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;border-radius:2px;font-size:22px;"
          title="${item.name}"
          onmouseover="this.style.borderColor='${color}'"
          onmouseout="this.style.borderColor='${color}44'">
          <img src="${slotIconUrl(item.slot)}" alt="" draggable="false"
            style="width:${CELL_SIZE - 12}px;height:${CELL_SIZE - 12}px;object-fit:contain;pointer-events:none;">
        </div>`;
      });
      html += `</div>`;
    }

    panel.innerHTML = html;
    bindEvents();
  }

  function bindEvents(): void {
    panel.querySelector('#cube-close')?.addEventListener('click', () => {
      close();
      cb.onClose();
    });

    panel.querySelector('#cube-transmute')?.addEventListener('click', () => {
      if (cubeIdx.length === 0 || transmuting) return;
      transmuting = true;
      render();
      cb.sendTransmute(cubeIdx.slice());
      if (transmuteTimer) clearTimeout(transmuteTimer);
      transmuteTimer = setTimeout(() => {
        if (transmuting) {
          transmuting = false;
          cb.showNotification('合成超时，请重试', '#ff8800');
          if (visible) render();
        }
        transmuteTimer = null;
      }, 3000);
    });

    panel.querySelectorAll<HTMLElement>('[data-add-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.addIdx!, 10);
        if (cubeIdx.length >= CUBE_SLOTS) {
          cb.showNotification('方块已满', '#ff4444');
          return;
        }
        const bag = cb.getBag();
        if (bag[idx] && !cubeIdx.includes(idx)) {
          cubeIdx.push(idx);
          render();
        }
      });
    });

    panel.querySelectorAll<HTMLElement>('[data-bag-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.bagIdx!, 10);
        const pos = cubeIdx.indexOf(idx);
        if (pos >= 0) {
          cubeIdx.splice(pos, 1);
          render();
        }
      });
    });
  }

  function open(): void {
    visible = true;
    panel.style.display = 'flex';
    render();
  }

  function close(): void {
    visible = false;
    panel.style.display = 'none';
  }

  return {
    isOpen: () => visible,
    toggle() { if (visible) close(); else open(); },
    open,
    close,
    getCubeIndices: () => cubeIdx.slice(),
    clearItems() {
      cubeIdx = [];
      if (visible) render();
    },
    setTransmuting(val: boolean) {
      transmuting = val;
      if (!val && transmuteTimer) {
        clearTimeout(transmuteTimer);
        transmuteTimer = null;
      }
      if (visible) render();
    },
    dispose() {
      if (transmuteTimer) clearTimeout(transmuteTimer);
      panel.remove();
    },
  };
}
