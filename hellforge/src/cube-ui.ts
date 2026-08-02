// Forge cube — 熔炉方块 (N2 dual-column + reveal state machine).
// Domain owns recipes (crafting.ts) and bag/material mutations; this panel
// enables buttons, previews yield/cost, and presents idle→resolving→reveal.

import {
  canFuse,
  canReroll,
  canSalvage,
  rarityStepUp,
  rerollCost,
  salvageYield,
  type MaterialCounts,
  type MaterialTier,
} from './crafting';
import { RARITY_META, type Item } from './items';
import type { BagAnchor } from './bag-grid';
import { FONT_DISPLAY, FONT_UI, goldDividerHtml, titleBandCss, Ui, Z } from './ui-theme';
import { HudArt } from './hud-art';
import { slotIconUrl } from './ui-icons';
import {
  assertForgeRevealDuration,
  FORGE_REVEAL_MS_MAX,
  FORGE_REVEAL_MS_MIN,
  forgePhaseAfterRevealAck,
  forgePhaseAfterRevealTimer,
  forgePhaseAfterSettlement,
  type ForgeActionKind,
  type ForgeVisualPhase,
} from './visual-polish-contracts';

const CUBE_COLS = 3;
const CUBE_ROWS = 4;
const CUBE_SLOTS = CUBE_COLS * CUBE_ROWS;
const CELL_SIZE = 48;
const PANEL_ID = 'hellforge-cube';
/** Mid-band reveal duration (contract: 1200–1800ms). */
export const FORGE_REVEAL_MS = 1500;

const TIER_LABEL: Readonly<Record<MaterialTier, string>> = {
  common: '白',
  magic: '蓝',
  rare: '黄',
};

export type ForgeLockReason = 'legendary' | 'wrong-recipe' | 'insufficient-shards';

export type ForgePresentPayload = {
  banner: string;
  color: string;
  sfx: 'pickup' | 'equip';
};

export type ForgeClickResult =
  | { ok: false }
  | { ok: true; present: ForgePresentPayload };

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
      hint: '配方不符：拆解/重铸需 1 件；合成需 3 件同稀有度（部位不限，黄×3→传奇）',
    };
  }
  return { salvage, reroll, fuse, lockReason: null, hint: null };
}

/** Pure preview copy for the right column (no RNG resolve). */
export function forgePreviewLines(
  items: readonly Readonly<Item>[],
  materials: MaterialCounts,
): { recipe: string; output: string; delta: string } {
  const actions = resolveForgeActions(items, materials);
  if (items.length === 0) {
    return {
      recipe: '投入装备后显示配方',
      output: '—',
      delta: '材料变化：—',
    };
  }
  if (actions.lockReason === 'legendary') {
    return { recipe: '传奇锁定', output: '不可锻造', delta: '材料变化：—' };
  }
  if (actions.salvage && items.length === 1) {
    const y = salvageYield(items[0]!);
    const tier = items[0]!.rarity as MaterialTier;
    const n = y?.[tier] ?? 0;
    return {
      recipe: '拆解：1 件非传奇 → 同色碎片',
      output: `产出预览：+${n} ${TIER_LABEL[tier]}色碎片`,
      delta: `材料变化：${TIER_LABEL[tier]} +${n}`,
    };
  }
  if (items.length === 1 && canReroll(items[0]!)) {
    const cost = rerollCost(items[0]!);
    const tier = items[0]!.rarity as MaterialTier;
    const n = cost?.[tier] ?? 0;
    return {
      recipe: '重铸：消耗同色碎片，刷新词缀',
      output: `产出预览：同部位「${items[0]!.name}」新词缀`,
      delta: actions.reroll
        ? `材料变化：${TIER_LABEL[tier]} −${n}`
        : `材料变化：需 ${TIER_LABEL[tier]} ×${n}（不足）`,
    };
  }
  if (canFuse(items)) {
    const head = items[0]!;
    if (head.rarity === 'rare') {
      return {
        recipe: '合成：黄×3 → 传奇',
        output: '产出预览：随机传奇',
        delta: '材料变化：无碎片消耗',
      };
    }
    const next = rarityStepUp(head.rarity as MaterialTier);
    const label = next ? TIER_LABEL[next] : '?';
    return {
      recipe: `合成：同稀有度×3 → ${label}色`,
      output: `产出预览：升阶装备（部位随机）`,
      delta: '材料变化：无碎片消耗',
    };
  }
  return {
    recipe: actions.hint ?? '配方不符',
    output: '—',
    delta: '材料变化：—',
  };
}

export interface CubeUICallbacks {
  getBag: () => readonly BagAnchor[];
  getMaterials: () => MaterialCounts;
  /** Domain settle first; return present payload only on success (no SFX yet). */
  onSalvage: (bagIndex: number) => ForgeClickResult;
  onReroll: (bagIndex: number) => ForgeClickResult;
  onFuse: (bagIndices: readonly [number, number, number]) => ForgeClickResult;
  /** Fire after reveal timer — SFX + banner (never during resolving). */
  onPresent: (payload: ForgePresentPayload) => void;
  showNotification: (text: string, color?: string) => void;
  onClose: () => void;
}

export interface CubeUIHandle {
  isOpen(): boolean;
  toggle(): void;
  open(): void;
  close(): void;
  getCubeIndices(): number[];
  clearItems(): void;
  /** Test/observability */
  phase(): ForgeVisualPhase;
  dispose(): void;
}

if (!assertForgeRevealDuration(FORGE_REVEAL_MS)) {
  throw new Error(`FORGE_REVEAL_MS ${FORGE_REVEAL_MS} outside ${FORGE_REVEAL_MS_MIN}-${FORGE_REVEAL_MS_MAX}`);
}

export function installCubeUI(cb: CubeUICallbacks, mount: HTMLElement = document.body): CubeUIHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;

  let visible = false;
  let cubeIdx: number[] = [];
  let phase: ForgeVisualPhase = 'idle';
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPresent: ForgePresentPayload | null = null;
  let lastAction: ForgeActionKind | null = null;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = `
    position: ${scoped ? 'absolute' : 'fixed'}; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(640px, calc(100% - 48px));
    max-height: min(720px, calc(100% - 48px));
    padding: 22px 24px 16px;
    font-family: ${FONT_UI}; color: ${Ui.text}; z-index: ${Z.cube};
    background:url('${HudArt.panelInventory()}') center/100% 100% no-repeat,${Ui.inkPanel};
    box-shadow:0 18px 50px rgba(0,0,0,0.8);
    display: none; flex-direction: column; gap: 8px;
    pointer-events: auto; box-sizing: border-box; overflow: hidden;
  `;
  mount.appendChild(panel);

  const pill = (inner: string): string =>
    `<span style="padding:2px 8px;background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};` +
    `display:inline-flex;align-items:center;gap:4px;font-size:12px;">${inner}</span>`;

  function actionBtn(id: string, label: string, enabled: boolean): string {
    const locked = phase !== 'idle';
    const on = enabled && !locked;
    return `<div id="${id}" style="
      flex:1;padding:8px 0;text-align:center;
      background:${on ? `linear-gradient(180deg,${Ui.goldFill},rgba(28,20,10,0.95))` : 'rgba(16,12,8,0.6)'};
      border:2px solid ${on ? Ui.gold : '#3a3228'};border-radius:2px;
      color:${on ? Ui.goldBright : Ui.textDim};font-size:13px;font-weight:bold;font-family:${FONT_DISPLAY};
      letter-spacing:2px;text-shadow:${on ? `0 1px 0 ${Ui.goldDeep}` : 'none'};
      cursor:${on ? 'pointer' : 'not-allowed'};user-select:none;opacity:${locked ? '0.55' : '1'};">${label}</div>`;
  }

  function clearRevealTimer(): void {
    if (revealTimer !== undefined) {
      clearTimeout(revealTimer);
      revealTimer = undefined;
    }
  }

  function beginReveal(action: ForgeActionKind, present: ForgePresentPayload, afterSettle: () => void): void {
    lastAction = action;
    pendingPresent = present;
    phase = forgePhaseAfterSettlement(true);
    afterSettle();
    render();
    clearRevealTimer();
    revealTimer = setTimeout(() => {
      phase = forgePhaseAfterRevealTimer();
      if (pendingPresent) {
        cb.onPresent(pendingPresent);
        pendingPresent = null;
      }
      render();
      clearRevealTimer();
      revealTimer = setTimeout(() => {
        phase = forgePhaseAfterRevealAck();
        lastAction = null;
        render();
      }, 700);
    }, FORGE_REVEAL_MS);
  }

  function render(): void {
    const bag = cb.getBag();
    const materials = cb.getMaterials();
    const cubeItems: Array<{ idx: number; item: Item }> = [];
    for (const idx of cubeIdx) {
      const item = bag[idx]?.item;
      if (item) cubeItems.push({ idx, item });
    }
    if (cubeItems.length !== cubeIdx.length) {
      cubeIdx = cubeItems.map((c) => c.idx);
    }
    const cubeSet = new Set(cubeItems.map((c) => c.idx));
    const placed = cubeItems.map((c) => c.item);
    const actions = resolveForgeActions(placed, materials);
    const preview = forgePreviewLines(placed, materials);
    const locked = phase !== 'idle';

    const gridW = CUBE_COLS * CELL_SIZE;
    const gridH = CUBE_ROWS * CELL_SIZE;

    const phaseLabel = phase === 'resolving'
      ? `锻造中…（${lastAction ?? ''}）`
      : phase === 'reveal'
        ? '结果揭示'
        : '';

    let left = `
      <div style="color:${Ui.textDim};font-size:11px;margin-bottom:4px;">点击背包物品放入方块</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
        ${pill(`<span style="color:${RARITY_META.common.color};font-weight:bold;">${materials.common}</span><span style="color:${Ui.textDim};font-size:10px;">白</span>`)}
        ${pill(`<span style="color:${RARITY_META.magic.color};font-weight:bold;">${materials.magic}</span><span style="color:${Ui.textDim};font-size:10px;">蓝</span>`)}
        ${pill(`<span style="color:${RARITY_META.rare.color};font-weight:bold;">${materials.rare}</span><span style="color:${Ui.textDim};font-size:10px;">黄</span>`)}
      </div>
      <div style="position:relative;width:${gridW}px;height:${gridH}px;margin:0 auto;
        background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};">`;
    for (let y = 0; y < CUBE_ROWS; y++) {
      for (let x = 0; x < CUBE_COLS; x++) {
        left += `<div style="position:absolute;left:${x * CELL_SIZE}px;top:${y * CELL_SIZE}px;
          width:${CELL_SIZE}px;height:${CELL_SIZE}px;box-sizing:border-box;
          background:url('${HudArt.bagSlot()}') center/100% 100% no-repeat;"></div>`;
      }
    }
    cubeItems.forEach(({ idx, item }, i) => {
      const x = i % CUBE_COLS;
      const y = Math.floor(i / CUBE_COLS);
      const color = RARITY_META[item.rarity].color;
      left += `<div data-bag-idx="${idx}" style="position:absolute;left:${x * CELL_SIZE}px;top:${y * CELL_SIZE}px;
        width:${CELL_SIZE}px;height:${CELL_SIZE}px;
        border:1px solid ${color}88;background:radial-gradient(ellipse at center,${color}18 0%,rgba(15,10,5,0.7) 80%);
        display:flex;align-items:center;justify-content:center;cursor:${locked ? 'default' : 'pointer'};z-index:1;box-sizing:border-box;"
        title="点击移出：${item.name}">
        <img src="${slotIconUrl(item.slot)}" alt="" draggable="false"
          style="width:${CELL_SIZE - 10}px;height:${CELL_SIZE - 10}px;object-fit:contain;pointer-events:none;">
      </div>`;
    });
    left += `</div>
      <div style="display:flex;gap:6px;width:100%;margin-top:8px;">
        ${actionBtn('cube-salvage', '拆解', actions.salvage)}
        ${actionBtn('cube-reroll', '重铸', actions.reroll)}
        ${actionBtn('cube-fuse', '合成', actions.fuse)}
      </div>`;
    if (actions.hint) {
      left += `<div style="color:${Ui.danger};font-size:11px;text-align:center;margin-top:4px;">${actions.hint}</div>`;
    }

    let right = `
      <div style="font:700 12px ${FONT_DISPLAY};color:${Ui.goldBright};letter-spacing:2px;margin-bottom:6px;">配方与预览</div>
      <div style="font:600 12px ${FONT_UI};color:${Ui.textMuted};line-height:1.5;margin-bottom:8px;">${preview.recipe}</div>
      <div style="font:600 12px ${FONT_UI};color:${Ui.gold};line-height:1.5;margin-bottom:6px;">${preview.output}</div>
      <div style="font:600 12px ${FONT_UI};color:${Ui.textDim};line-height:1.5;margin-bottom:10px;">${preview.delta}</div>
      ${goldDividerHtml(2)}
      <div style="color:${Ui.textDim};font-size:11px;margin:8px 0 4px;">背包候选 ${cubeItems.length >= CUBE_SLOTS ? '（方块已满）' : `（已放入 ${cubeItems.length}/${CUBE_SLOTS}）`}</div>
      <div style="flex:1;min-height:0;max-height:220px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px;align-content:flex-start;">`;
    if (!locked && cubeItems.length < CUBE_SLOTS) {
      bag.forEach((anchor, idx) => {
        if (cubeSet.has(idx)) return;
        const item = anchor.item;
        const color = RARITY_META[item.rarity].color;
        right += `<div data-add-idx="${idx}" style="
          width:${CELL_SIZE - 4}px;height:${CELL_SIZE - 4}px;
          border:1px solid ${color}44;background:rgba(15,12,8,0.6);
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;border-radius:2px;"
          title="${item.name}">
          <img src="${slotIconUrl(item.slot)}" alt="" draggable="false"
            style="width:${CELL_SIZE - 12}px;height:${CELL_SIZE - 12}px;object-fit:contain;pointer-events:none;">
        </div>`;
      });
    }
    right += `</div>`;
    if (phaseLabel) {
      right += `<div style="margin-top:8px;padding:8px;text-align:center;font:700 13px ${FONT_DISPLAY};
        color:${Ui.goldBright};letter-spacing:3px;border:1px solid ${Ui.goldLineSoft};
        background:rgba(40,28,12,0.65);">${phaseLabel}</div>`;
    }

    panel.innerHTML = `
      <div style="position:relative;width:100%;flex:none;">
        <div style="${titleBandCss()}padding:4px 0;">熔炉方块</div>
        <div style="position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;color:${Ui.textDim};font-size:16px;padding:0 4px;" id="cube-close">✕</div>
      </div>
      ${goldDividerHtml(2)}
      <div style="display:flex;gap:16px;width:100%;min-height:0;flex:1;align-items:stretch;">
        <div style="flex:0 0 220px;display:flex;flex-direction:column;">${left}</div>
        <div style="width:1px;background:linear-gradient(180deg,transparent,${Ui.goldLineSoft},transparent);"></div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;">${right}</div>
      </div>
    `;
    bindEvents(actions, locked);
  }

  function bindEvents(actions: ReturnType<typeof resolveForgeActions>, locked: boolean): void {
    panel.querySelector('#cube-close')?.addEventListener('click', () => {
      cb.onClose();
    });

    if (locked) return;

    panel.querySelector('#cube-salvage')?.addEventListener('click', () => {
      if (!actions.salvage || cubeIdx.length !== 1 || phase !== 'idle') return;
      const idx = cubeIdx[0]!;
      const res = cb.onSalvage(idx);
      if (!res.ok) return;
      beginReveal('salvage', res.present, () => { cubeIdx = []; });
    });

    panel.querySelector('#cube-reroll')?.addEventListener('click', () => {
      if (!actions.reroll || cubeIdx.length !== 1 || phase !== 'idle') return;
      const idx = cubeIdx[0]!;
      const res = cb.onReroll(idx);
      if (!res.ok) return;
      beginReveal('reroll', res.present, () => { /* keep placement */ });
    });

    panel.querySelector('#cube-fuse')?.addEventListener('click', () => {
      if (!actions.fuse || cubeIdx.length !== 3 || phase !== 'idle') return;
      const indices = cubeIdx.slice(0, 3) as [number, number, number];
      const res = cb.onFuse(indices);
      if (!res.ok) return;
      beginReveal('fuse', res.present, () => {
        const dest = Math.min(indices[0], indices[1], indices[2]);
        cubeIdx = [dest];
      });
    });

    panel.querySelectorAll<HTMLElement>('[data-add-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        if (phase !== 'idle') return;
        const idx = parseInt(el.dataset.addIdx!, 10);
        if (cubeIdx.length >= CUBE_SLOTS) {
          cb.showNotification('方块已满', '#ff4444');
          return;
        }
        const bag = cb.getBag();
        if (bag[idx]?.item && !cubeIdx.includes(idx)) {
          cubeIdx.push(idx);
          render();
        }
      });
    });

    panel.querySelectorAll<HTMLElement>('[data-bag-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        if (phase !== 'idle') return;
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
    // If closed mid-reveal, still flush deferred present once so SFX/banner aren't lost.
    clearRevealTimer();
    if (pendingPresent) {
      cb.onPresent(pendingPresent);
      pendingPresent = null;
    }
    phase = 'idle';
    lastAction = null;
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
    phase: () => phase,
    dispose() {
      clearRevealTimer();
      pendingPresent = null;
      panel.remove();
    },
  };
}
