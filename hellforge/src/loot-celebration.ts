// Hellforge rare-drop celebration — non-blocking side card (N2).
// Root pointer-events:none; only the card steals clicks. Latest show() wins.

import { itemTooltipLines, RARITY_META, type ItemInstance } from './items';
import { FONT_DISPLAY, FONT_UI, Ui, goldDividerHtml } from './ui-theme';
import { slotIconImg } from './ui-icons';
import { popupChromeStyles } from './ui-popup-chrome';

export interface LootCelebrationHandle {
  /** Show the drop card; a show during show replaces content (latest wins). */
  show(item: ItemInstance): void;
  dispose(): void;
}

const ROOT_ID = 'hellforge-loot-celebration';
const STYLE_ID = 'hellforge-loot-celebration-style';
const AUTO_DISMISS_MS = 2500;

export function installLootCelebration(
  uiMount: HTMLElement,
  opts?: { autoDismissMs?: number },
): LootCelebrationHandle {
  const autoDismissMs = opts?.autoDismissMs ?? AUTO_DISMISS_MS;
  document.getElementById(ROOT_ID)?.remove();

  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes hf-loot-pop {
      0% { opacity:0; transform:translateX(24px) scale(0.92); }
      55% { opacity:1; transform:translateX(0) scale(1.02); }
      100% { opacity:1; transform:translateX(0) scale(1); }
    }
    @keyframes hf-loot-glow {
      0%,100% { filter:brightness(1); }
      50% { filter:brightness(1.25); }
    }
  `;
  document.head.appendChild(style);

  const scoped = uiMount !== document.body;
  const chrome = popupChromeStyles('lootCelebration', { scoped, side: 'right' });

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.style.cssText = chrome.rootCss;

  const card = document.createElement('div');
  card.style.cssText = chrome.cardCss + 'align-items:center;text-align:center;';
  root.appendChild(card);
  uiMount.appendChild(root);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const hide = (): void => {
    clearTimer();
    root.style.display = 'none';
  };
  card.addEventListener('click', hide);

  const show = (item: ItemInstance): void => {
    clearTimer();
    const meta = RARITY_META[item.rarity];

    const rarityEl = document.createElement('div');
    rarityEl.textContent = meta.label;
    rarityEl.style.cssText =
      `font:700 13px ${FONT_DISPLAY};color:${meta.color};letter-spacing:8px;` +
      `text-shadow:0 0 10px ${meta.color}66;`;

    const iconBox = document.createElement('div');
    iconBox.style.cssText =
      'width:64px;height:64px;display:flex;align-items:center;justify-content:center;' +
      'background-color:rgba(12,8,4,0.85);border:0;border-radius:3px;' +
      `box-shadow:inset 0 0 0 2px ${meta.color}aa,inset 0 0 14px ${meta.color}44,0 0 22px ${meta.color}55;`;
    iconBox.appendChild(slotIconImg(item.slot, 48, { alt: item.name }));

    const nameEl = document.createElement('div');
    nameEl.textContent = item.name;
    nameEl.style.cssText =
      `font:800 18px ${FONT_DISPLAY};color:${meta.color};letter-spacing:2px;` +
      'text-shadow:0 2px 4px #000,0 0 16px rgba(255,150,50,0.35);';

    const divider = document.createElement('div');
    divider.style.cssText = 'width:100%;';
    divider.innerHTML = goldDividerHtml(4);

    const affixBox = document.createElement('div');
    affixBox.style.cssText = 'display:flex;flex-direction:column;gap:2px;width:100%;';
    for (const [text, color, dim] of itemTooltipLines(item, item.reqLevel).slice(2)) {
      const row = document.createElement('div');
      row.style.cssText = `font:600 12px ${FONT_UI};color:${color};`;
      row.textContent = text;
      if (dim) {
        const d = document.createElement('span');
        d.style.cssText = 'color:#8a8580;';
        d.textContent = ` (${dim})`;
        row.appendChild(d);
      }
      affixBox.appendChild(row);
    }

    const hint = document.createElement('div');
    hint.textContent = '点击卡片关闭';
    hint.style.cssText = `font:600 10px ${FONT_UI};color:${Ui.textDim};margin-top:4px;letter-spacing:2px;`;

    card.replaceChildren(rarityEl, iconBox, nameEl, divider, affixBox, hint);
    root.style.display = 'flex';
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation =
      'hf-loot-pop 0.4s cubic-bezier(.2,.9,.25,1.2) both,hf-loot-glow 1.6s ease-in-out 0.4s infinite';
    timer = setTimeout(hide, autoDismissMs);
  };

  return {
    show,
    dispose() {
      clearTimer();
      root.remove();
      style.remove();
    },
  };
}
