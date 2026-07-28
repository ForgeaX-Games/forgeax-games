// Forge cube — 熔炉方块. 3×4 placement grid + 拆解 / 重铸 / 合成 verbs.
// Domain owns recipes (crafting.ts) and bag/material mutations
// (character-domain salvage-bag / reroll-bag / fuse-bag); this panel only
// enables buttons from validators + shard affordability and reports clicks.
//
// Factory shape matches inventory-ui.ts: installXxx(cb, mount) → Handle with
// open/close for UiLayerManager.register('craft'). Bag indices (not item
// copies) are tracked and re-read live via getBag() each render.

import {
  canFuse,
  canReroll,
  canSalvage,
  rerollCost,
  type MaterialCounts,
  type MaterialTier,
} from './crafting';
import { RARITY_META, type Item } from './items';
import { FONT_UI, Z } from './ui-theme';
import { slotIconUrl } from './ui-icons';

const CUBE_COLS = 3;
const CUBE_ROWS = 4;
const CUBE_SLOTS = CUBE_COLS * CUBE_ROWS;
const CELL_SIZE = 52;
const PANEL_ID = 'hellforge-cube';

const TIER_LABEL: Readonly<Record<MaterialTier, string>> = {
  common: '白',
  magic: '蓝',
  rare: '黄',
};

export type ForgeLockReason = 'legendary' | 'wrong-recipe' | 'insufficient-shards';

/** Pure enablement + hint — UI + tests share this (validators stay in crafting.ts). */
export function resolveForgeActions(
  items: readonly Readonly<Item>[],
  materials: MaterialCounts,
): {
  salvage: boolean;
  reroll: boolean;
  fuse: boolean;
  lockReason: ForgeLockReason | null;
  hint: string | null;
} {
  const salvage = items.length === 1 && canSalvage(items[0]!);
  const cost = items.length === 1 ? rerollCost(items[0]!) : null;
  const affordable = !!cost
    && materials.common >= cost.common
    && materials.magic >= cost.magic
    && materials.rare >= cost.rare;
  const reroll = items.length === 1 && canReroll(items[0]!) && affordable;
  const fuse = canFuse(items);

  if (items.length === 0) {
    return { salvage, reroll, fuse, lockReason: null, hint: null };
  }
  if (items.some((it) => it.rarity === 'legendary')) {
    return {
      salvage: false,
      reroll: false,
      fuse: false,
      lockReason: 'legendary',
      hint: '传奇不可拆解 / 重铸 / 合成',
    };
  }
  if (items.length === 1 && canReroll(items[0]!) && !affordable && cost) {
    const tier = items[0]!.rarity as MaterialTier;
    const need = cost[tier];
    return {
      salvage,
      reroll: false,
      fuse: false,
      lockReason: 'insufficient-shards',
      hint: `材料不足：重铸需 ${need} 片${TIER_LABEL[tier]}色碎片`,
    };
  }
  if (!salvage && !reroll && !fuse) {
    return {
      salvage: false,
      reroll: false,
      fuse: false,
      lockReason: 'wrong-recipe',
      hint: '配方不符：拆解/重铸需 1 件；合成需 3 件同部位同稀有度（白/蓝）',
    };
  }
  return { salvage, reroll, fuse, lockReason: null, hint: null };
}

export interface CubeUICallbacks {
  /** Live bag snapshot — same fixed-size Array<Item|null> as inventory-ui.ts. */
  getBag: () => Array<Item | null>;
  getMaterials: () => MaterialCounts;
  /** Return true when the domain accepted the verb (cube clears placement). */
  onSalvage: (bagIndex: number) => boolean;
  onReroll: (bagIndex: number) => boolean;
  onFuse: (bagIndices: readonly [number, number, number]) => boolean;
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
  /** Caller / UI clears placement after a consuming craft. */
  clearItems(): void;
  dispose(): void;
}

export function installCubeUI(cb: CubeUICallbacks, mount: HTMLElement = document.body): CubeUIHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;

  let visible = false;
  let cubeIdx: number[] = [];

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

  const pill = (inner: string): string =>
    `<span style="padding:2px 8px;background:rgba(20,16,12,0.7);border:1px solid #4a4038;` +
    `display:inline-flex;align-items:center;gap:4px;font-size:12px;">${inner}</span>`;

  function actionBtn(id: string, label: string, enabled: boolean): string {
    return `<div id="${id}" style="
      flex:1;padding:8px 0;text-align:center;
      background:${enabled ? 'linear-gradient(180deg,#5a4a20,#3a2a10)' : 'rgba(30,25,18,0.6)'};
      border:2px solid ${enabled ? '#c8a84e' : '#3a3228'};border-radius:4px;
      color:${enabled ? '#ffd700' : '#5a4a3a'};font-size:13px;font-weight:bold;
      cursor:${enabled ? 'pointer' : 'not-allowed'};user-select:none;">${label}</div>`;
  }

  function render(): void {
    const bag = cb.getBag();
    const materials = cb.getMaterials();
    const cubeItems: Array<{ idx: number; item: Item }> = [];
    for (const idx of cubeIdx) {
      const item = bag[idx];
      if (item) cubeItems.push({ idx, item });
    }
    // Drop stale indices whose bag slot emptied under us.
    if (cubeItems.length !== cubeIdx.length) {
      cubeIdx = cubeItems.map((c) => c.idx);
    }
    const cubeSet = new Set(cubeItems.map((c) => c.idx));
    const placed = cubeItems.map((c) => c.item);
    const actions = resolveForgeActions(placed, materials);

    const gridW = CUBE_COLS * CELL_SIZE;
    const gridH = CUBE_ROWS * CELL_SIZE;

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:4px;">
        <div style="color:#c8a84e;font-size:16px;font-weight:bold;">🔥 熔炉方块</div>
        <div style="cursor:pointer;color:#888;font-size:18px;padding:0 4px;" id="cube-close">✕</div>
      </div>
      <div style="color:#5a4a3a;font-size:11px;margin-bottom:4px;">点击背包物品放入方块，选择拆解 / 重铸 / 合成</div>
      <div style="display:flex;gap:6px;width:100%;justify-content:center;margin-bottom:2px;">
        ${pill(`<span style="color:${RARITY_META.common.color};font-weight:bold;">${materials.common}</span><span style="color:#8a7a58;font-size:10px;">白</span>`)}
        ${pill(`<span style="color:${RARITY_META.magic.color};font-weight:bold;">${materials.magic}</span><span style="color:#8a7a58;font-size:10px;">蓝</span>`)}
        ${pill(`<span style="color:${RARITY_META.rare.color};font-weight:bold;">${materials.rare}</span><span style="color:#8a7a58;font-size:10px;">黄</span>`)}
      </div>
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

    html += `<div style="display:flex;gap:6px;width:100%;margin-top:4px;">
      ${actionBtn('cube-salvage', '拆解', actions.salvage)}
      ${actionBtn('cube-reroll', '重铸', actions.reroll)}
      ${actionBtn('cube-fuse', '合成', actions.fuse)}
    </div>`;

    if (actions.hint) {
      html += `<div style="color:#ff8866;font-size:11px;width:100%;text-align:center;">${actions.hint}</div>`;
    }

    html += `<div style="color:#5a4a3a;font-size:11px;margin-top:2px;width:100%;border-top:1px solid #3a2a18;padding-top:6px;">
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
    bindEvents(actions);
  }

  function bindEvents(actions: ReturnType<typeof resolveForgeActions>): void {
    panel.querySelector('#cube-close')?.addEventListener('click', () => {
      cb.onClose();
    });

    panel.querySelector('#cube-salvage')?.addEventListener('click', () => {
      if (!actions.salvage || cubeIdx.length !== 1) return;
      const idx = cubeIdx[0]!;
      if (cb.onSalvage(idx)) {
        cubeIdx = [];
        render();
      }
    });

    panel.querySelector('#cube-reroll')?.addEventListener('click', () => {
      if (!actions.reroll || cubeIdx.length !== 1) return;
      const idx = cubeIdx[0]!;
      if (cb.onReroll(idx)) {
        // Item stays in the same bag slot with new affixes — keep placement.
        render();
      }
    });

    panel.querySelector('#cube-fuse')?.addEventListener('click', () => {
      if (!actions.fuse || cubeIdx.length !== 3) return;
      const indices = cubeIdx.slice(0, 3) as [number, number, number];
      if (cb.onFuse(indices)) {
        // Fused result lands in the lowest index — keep that cell selected.
        const dest = Math.min(indices[0], indices[1], indices[2]);
        cubeIdx = [dest];
        render();
      }
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
    dispose() {
      panel.remove();
    },
  };
}
