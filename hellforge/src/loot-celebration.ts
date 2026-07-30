// Hellforge rare-drop celebration — gacha-style "you got a great drop" card
// for rare/legendary pickups. Fullscreen radial darkening backdrop + centered
// chrome card: rarity label, slot icon, rarity-colored name, affix lines
// (itemTooltipLines SSOT — same builder as the inventory tooltip).
// Latest show() wins — replace, never queue. Auto-dismiss ~2.5s or click
// anywhere. Pure DOM/CSS (no engine imports); safe to install and never
// show: root starts display:none, so it never intercepts input.
// z-index 150 sits above cube (ui-theme Z.cube 135) and below cutscene
// chrome (Z.cutsceneChrome 170) — literal here; this layer has no Z token.

import { itemTooltipLines, RARITY_META, type ItemInstance } from './items';
import { FONT_DISPLAY, FONT_UI, Ui, goldDividerHtml, panelChrome } from './ui-theme';
import { slotIconImg } from './ui-icons';

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

  // Keyframes (hud.ts hf-banner idiom): scale-up pop + sustained glow pulse.
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes hf-loot-pop {
      0% { opacity:0; transform:scale(0.6); }
      55% { opacity:1; transform:scale(1.06); }
      100% { opacity:1; transform:scale(1); }
    }
    @keyframes hf-loot-glow {
      0%,100% { filter:brightness(1); }
      50% { filter:brightness(1.35); }
    }
  `;
  document.head.appendChild(style);

  const scoped = uiMount !== document.body;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.style.cssText =
    `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:150;display:none;` +
    'align-items:center;justify-content:center;pointer-events:auto;user-select:none;' +
    'background:radial-gradient(ellipse at center,rgba(0,0,0,0.3) 0%,rgba(0,0,0,0.82) 100%);' +
    `font:600 13px ${FONT_UI};color:${Ui.text};`;

  const card = document.createElement('div');
  card.style.cssText =
    panelChrome() +
    'min-width:280px;max-width:min(360px,86%);padding:18px 26px 14px;text-align:center;' +
    'display:flex;flex-direction:column;align-items:center;gap:6px;';
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
  root.addEventListener('click', hide);

  const show = (item: ItemInstance): void => {
    clearTimer(); // latest wins: cancel the previous card's pending dismiss
    const meta = RARITY_META[item.rarity];

    const rarityEl = document.createElement('div');
    rarityEl.textContent = meta.label;
    rarityEl.style.cssText =
      `font:700 13px ${FONT_DISPLAY};color:${meta.color};letter-spacing:8px;` +
      `text-shadow:0 0 10px ${meta.color}66;`;

    const iconBox = document.createElement('div');
    iconBox.style.cssText =
      'width:72px;height:72px;display:flex;align-items:center;justify-content:center;' +
      'background-color:rgba(12,8,4,0.85);border:0;border-radius:3px;' +
      `box-shadow:inset 0 0 0 2px ${meta.color}aa,inset 0 0 14px ${meta.color}44,0 0 22px ${meta.color}55;`;
    iconBox.appendChild(slotIconImg(item.slot, 52, { alt: item.name }));

    const nameEl = document.createElement('div');
    nameEl.textContent = item.name;
    nameEl.style.cssText =
      `font:800 22px ${FONT_DISPLAY};color:${meta.color};letter-spacing:2px;` +
      'text-shadow:0 2px 4px #000,0 0 16px rgba(255,150,50,0.35);';

    const divider = document.createElement('div');
    divider.style.cssText = 'width:100%;';
    divider.innerHTML = goldDividerHtml(4);

    const affixBox = document.createElement('div');
    affixBox.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
    // itemTooltipLines rows 0/1 (name + base type) are already the card
    // header — keep the rest: reqLevel / affixes (with roll ranges) /
    // legendary flavor. playerLevel := reqLevel so the req line reads as met.
    for (const [text, color, dim] of itemTooltipLines(item, item.reqLevel).slice(2)) {
      const row = document.createElement('div');
      row.style.cssText = `font:600 13px ${FONT_UI};color:${color};`;
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
    hint.textContent = '点击任意处继续';
    hint.style.cssText = `font:600 10px ${FONT_UI};color:${Ui.textDim};margin-top:4px;letter-spacing:2px;`;

    card.replaceChildren(rarityEl, iconBox, nameEl, divider, affixBox, hint);
    root.style.display = 'flex';
    // Retrigger the entrance animation on replace (reflow restart idiom).
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation =
      'hf-loot-pop 0.45s cubic-bezier(.2,.9,.25,1.2) both,hf-loot-glow 1.6s ease-in-out 0.45s infinite';
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
