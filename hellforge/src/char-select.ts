// CharSelect — fixed Emberwalker create (N1).
// DOM chrome only: centre stays transparent so main.ts hero-preview (idle +
// 360° yaw) shows through on the WebGPU canvas beneath.
// Product: one playable hero (classId sorceress). Companions are narrative-only.
//
// Chrome (frozen UI contract, docs/handoff/2026-08-01-hellforge-ui-chrome-contract.md):
// - Bottom plaque rides a wide bar that is NEVER a stretched portrait frame.
//   Its parchment bed is HudArt.automapParchment() center/cover (crops, never
//   squashes — hud.ts quest-banner precedent); a dedicated wide-plaque plate
//   asset is missing, so parchment-cover is FALLBACK≠FINISH. Thin gold rim via
//   box-shadow, not a flat grey hairline. Corner ornaments live on the
//   non-scrolling wrap so they stay pinned when the .hf-scroll panel scrolls
//   (inline 100vh-based max-height caps it at 720p — a % base is indefinite
//   inside the height:auto wrap and Chrome drops the min()).
// - Hero card is the real panel-frame-character plate: height-driven 3:4
//   (aspect-ratio locks width, so center/100% 100% is zero-distortion —
//   inventory-ui.ts:354-377 recipe), content lands on the parchment core via
//   px padding (58px top / 26px sides / 28px bottom — % padding on a flex
//   item resolves against the flex line width, not the card; values sampled
//   from the plate art, see the heroCard comment), overflow:hidden guards the
//   painted edge. classEmblemSvg keeps its own goldMetal bezel on the
//   parchment.
// - Companion roster is DISPLAY ONLY: pointer-events:none, zero listeners, no
//   hover/cursor affordance. Three mini panel-frame-inventory 3:4 cards (the
//   same zero-distortion recipe at ~96px wide), never selectable class cards.
// - Buttons share shell.ts's ornate rim recipe (double gold ring + corner Ls);
//   interaction transitions stay on transform/opacity/color (no glow anims).

import { getClassDef, type CharacterRecord, type ClassId } from './classes';
import { createCharacter, listCharacters, MAX_CHARACTERS } from './save';
import { HudArt } from './hud-art';
import { ShellArt } from './shell-art';
import {
  FONT_DISPLAY,
  FONT_UI,
  Ui,
  cornerOrnamentsHtml,
  goldDividerHtml,
  metalGoldTextStyle,
} from './ui-theme';
import { ensureUiStyles } from './ui-styles';
import { classEmblemSvg } from './ui-icons';

/** Product-facing name for the fixed create path (enum stays sorceress). */
export const EMBERWALKER_DISPLAY_NAME = '烬行者';
/**
 * Fixed create class — bound to the literal, not heroes.ts DEFAULT_HERO_ID:
 * the Emberwalker IS sorceress regardless of which hero becomes the default,
 * and heroes.ts (GLB/asset glue) is mock.module'd away in hero-preview tests.
 */
export const EMBERWALKER_CLASS_ID: ClassId = 'sorceress';

export interface CharSelectCallbacks {
  /** Character record persisted (via save.ts) — caller transitions to inGame. */
  onConfirm: (rec: CharacterRecord) => void;
  /** Player backed out to Title. */
  onBack: () => void;
  /** Selected class changed — caller swaps the 3D idle preview. */
  onClassChange?: (classId: ClassId) => void;
}

export interface CharSelectHandle {
  show(): void;
  hide(): void;
  dispose(): void;
  /** Currently highlighted class (for preview sync). */
  selectedClassId(): ClassId;
}

const NAME_PREFIXES = ['灰烬', '余烬', '熔炎', '暗焰', '寒霜', '星焱', '夜影', '炽风'];
const NAME_SUFFIXES = ['娅', '丝', '薇', '娜', '依', '璃', '烁', '央'];

function generateRandomName(): string {
  const p = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)]!;
  const s = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)]!;
  const n = Math.floor(Math.random() * 100);
  return `${p}${s}${n}`;
}

/** Narrative companions — roster display data only, NOT class defs. */
interface CompanionDef {
  nameCn: string;
  titleCn: string;
  nameEn: string;
  titleEn: string;
  blurb: string;
  sigil: 'flame' | 'frost' | 'rune';
}

const COMPANIONS: readonly CompanionDef[] = [
  {
    nameCn: '薪火嬷嬷', titleCn: '守火者', nameEn: 'MATRON PYRA', titleEn: 'FIREKEEPER', sigil: 'flame',
    blurb: '守着哨站最后那盆不熄的火，替远行者把汤温在锅边。',
  },
  {
    nameCn: '玻璃刃薇丝', titleCn: '霜刃决斗者', nameEn: 'VEX GLASSWYN', titleEn: 'FROST DUELIST', sigil: 'frost',
    blurb: '剑快得像冬日的薄冰——出鞘一次，酒馆就安静一晚。',
  },
  {
    nameCn: '石守埃尔德林', titleCn: '符文守卫', nameEn: 'STONEWARD ELDRIN', titleEn: 'RUNE KEEPER', sigil: 'rune',
    blurb: '认得每块界石上的刻痕，也只对刻着符文的石头多话。',
  },
];

/** Small static companion sigil (gold stroke + one token accent, no glow). */
function companionSigilSvg(kind: CompanionDef['sigil'], sizePx: number): string {
  const stroke = `stroke="${Ui.gold}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  let body = '';
  switch (kind) {
    case 'flame':
      body =
        `<path d="M12 3.5 C14.5 6.5 16.5 8.5 16.5 12 A4.5 4.5 0 0 1 7.5 12 C7.5 9.5 9 8 10 6.5 C10.2 8 10.8 8.8 12 9.5 C11.4 7 11.5 5 12 3.5 Z" ${stroke}/>` +
        `<circle cx="12" cy="13" r="1.6" fill="${Ui.crimson}"/>`;
      break;
    case 'frost':
      body =
        `<path d="M12 3.5 L12 20.5 M4.5 7.5 L19.5 16.5 M19.5 7.5 L4.5 16.5" ${stroke}/>` +
        `<circle cx="12" cy="12" r="1.6" fill="${Ui.mp}"/>`;
      break;
    case 'rune':
      body =
        `<rect x="6" y="4.5" width="12" height="15" rx="1.5" ${stroke}/>` +
        `<path d="M9.5 8 L14.5 8 M12 8 L12 16 M9.5 16 L14.5 16" stroke="${Ui.goldDim}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`;
      break;
  }
  return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true">${body}</svg>`;
}

export function installCharSelect(mount: HTMLElement, cb: CharSelectCallbacks): CharSelectHandle {
  ensureUiStyles();
  const scoped = mount !== document.body;
  const selectedId: ClassId = EMBERWALKER_CLASS_ID;
  const def = getClassDef(selectedId);

  const root = document.createElement('div');
  root.id = 'hellforge-char-select';
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;pointer-events:none;` +
    `font-family:${FONT_UI};`;

  const topFade = document.createElement('div');
  topFade.style.cssText = 'position:absolute;top:0;left:0;right:0;height:18%;pointer-events:none;' +
    'background:linear-gradient(180deg,rgba(5,4,4,0.65) 0%,transparent 100%);';
  const bottomFade = document.createElement('div');
  bottomFade.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:48%;pointer-events:none;' +
    'background:linear-gradient(0deg,rgba(5,4,4,0.8) 0%,transparent 100%);';
  root.append(topFade, bottomFade);

  const topBar = document.createElement('div');
  topBar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:64px;display:flex;' +
    'align-items:center;justify-content:center;pointer-events:none;';

  // shell.ts ornate secondary rim (double gold ring, no flat grey hairline).
  const backRestBg = 'linear-gradient(180deg,rgba(28,22,16,0.94) 0%,rgba(14,11,8,0.96) 100%)';
  const backHoverBg = 'linear-gradient(180deg,rgba(40,32,22,0.96) 0%,rgba(22,16,12,0.98) 100%)';
  const backRestShadow = `inset 0 1px 0 rgba(168,132,64,0.28),inset 0 -1px 0 rgba(0,0,0,0.5),` +
    `0 0 0 1px ${Ui.goldLineSoft},0 0 0 2px ${Ui.goldDeep},0 4px 12px rgba(0,0,0,0.55)`;
  const backHoverShadow = `inset 0 1px 0 rgba(168,132,64,0.28),inset 0 -1px 0 rgba(0,0,0,0.5),` +
    `0 0 0 1px ${Ui.gold},0 0 0 2px ${Ui.goldDeep},0 4px 12px rgba(0,0,0,0.55),0 0 14px ${Ui.crimsonGlow}`;
  const backBtn = document.createElement('button');
  backBtn.textContent = '← 返回';
  backBtn.style.cssText = 'position:absolute;left:20px;top:18px;pointer-events:auto;cursor:pointer;' +
    `padding:8px 16px;font:600 13px inherit;letter-spacing:2px;border:none;color:${Ui.textMuted};` +
    `background:${backRestBg};box-shadow:${backRestShadow};transition:all 0.2s;`;
  backBtn.addEventListener('mouseenter', () => {
    backBtn.style.color = Ui.goldBright;
    backBtn.style.background = backHoverBg;
    backBtn.style.boxShadow = backHoverShadow;
  });
  backBtn.addEventListener('mouseleave', () => {
    backBtn.style.color = Ui.textMuted;
    backBtn.style.background = backRestBg;
    backBtn.style.boxShadow = backRestShadow;
  });
  backBtn.addEventListener('click', () => cb.onBack());

  const heading = document.createElement('div');
  heading.textContent = '创建烬行者';
  heading.style.cssText = metalGoldTextStyle('clamp(19px,2.4vw,23px)');

  topBar.append(backBtn, heading);
  root.appendChild(topBar);

  // Wide bottom plaque: positioning + corner ornaments on the wrap (static);
  // the panel itself is the .hf-scroll carved well.
  const panelWrap = document.createElement('div');
  panelWrap.style.cssText = 'position:absolute;left:50%;bottom:28px;transform:translateX(-50%);' +
    'width:min(640px,94vw);pointer-events:none;';

  const panel = document.createElement('div');
  panel.className = 'hf-scroll';
  // vh, not %: panelWrap is height:auto, so a percentage max-height base is
  // indefinite here and Chrome resolves the whole min() as none (Q1).
  // 112px = bottom:28 + topBar:64 + breathing room.
  panel.style.cssText = 'pointer-events:auto;box-sizing:border-box;padding:14px 20px 12px;' +
    'display:flex;flex-direction:row;align-items:flex-start;gap:14px;' +
    'max-height:min(540px,calc(100vh - 112px));' +
    'overflow-x:hidden;overflow-y:auto;' +
    'overscroll-behavior:contain;-webkit-overflow-scrolling:touch;' +
    // S5 wide plaque only — no ink letterbox behind the painted frame.
    `background:url('${ShellArt.plaqueWide()}') center/100% 100% no-repeat;` +
    'background-color:transparent;box-shadow:0 12px 40px rgba(0,0,0,0.55);';

  // ── hero card: real panel-frame-character plate, height-driven 3:4 ───────
  // Zero distortion: aspect-ratio:3/4 derives width (225px) from the fixed
  // height, so center/100% 100% paints the plate's own 3:4 canvas untouched
  // (inventory-ui.ts:354-377 recipe). Padding is px, NOT % — percentage
  // padding on a flex item resolves against the flex line width (600px here),
  // not the card, which would shove the copy off the parchment core (measured
  // in-browser). Values derive from the plate art: top 58px clears the frame's
  // emblem band (art band ends ~12.5% of height), sides 26px clear the stone
  // edges (~11-12% of width), bottom 28px clears the lower rim (~10%).
  // overflow:hidden is the hard guard — copy never paints over the rim.
  const heroCard = document.createElement('div');
  heroCard.style.cssText = 'flex:none;' +
    'height:300px;aspect-ratio:3/4;width:auto;box-sizing:border-box;' +
    'padding:58px 26px 28px;overflow:hidden;' +
    'display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;' +
    `background:url('${HudArt.panelCharacter()}') center/100% 100% no-repeat;` +
    'box-shadow:0 6px 18px rgba(0,0,0,0.55);';

  const emblem = document.createElement('div');
  emblem.innerHTML = classEmblemSvg(selectedId, 48);
  emblem.style.cssText = 'flex:none;line-height:1;padding:4px;border-radius:50%;' +
    `border:1px solid ${Ui.goldMetal};` +
    'background:radial-gradient(circle at 40% 35%,rgba(48,36,14,0.9) 0%,rgba(10,7,5,0.95) 70%);' +
    'box-shadow:inset 0 1px 4px rgba(0,0,0,0.6);';

  const heroCopy = document.createElement('div');
  heroCopy.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;' +
    'align-items:center;gap:3px;';
  heroCopy.innerHTML =
    `<div style="font:800 18px ${FONT_DISPLAY};letter-spacing:4px;color:#1a1208;` +
    `text-shadow:0 1px 0 rgba(255,244,210,0.5)">${EMBERWALKER_DISPLAY_NAME}</div>` +
    `<div style="font:700 12px ${FONT_DISPLAY};letter-spacing:3px;color:#3a2810">暗法师 · SORCERESS</div>` +
    `<div style="font:500 13px ${FONT_UI};color:#2a1c10;line-height:1.45;margin-top:4px">${def.description}</div>` +
    `<div style="font:500 12px ${FONT_UI};color:#3a2a14;line-height:1.45;margin-top:2px">` +
    `<b style="color:#1a1208">${def.coreMechanic}</b> — ${def.coreMechanicDesc}</div>`;

  heroCard.append(emblem, heroCopy);

  // ── companion roster: DISPLAY ONLY (no listeners, no pointer affordance) ──
  const companions = document.createElement('div');
  companions.style.cssText = 'pointer-events:none;user-select:none;display:flex;flex-direction:column;';

  const compHeader = document.createElement('div');
  compHeader.style.cssText = 'display:flex;align-items:baseline;justify-content:center;gap:8px;padding-bottom:2px;';
  compHeader.innerHTML =
    `<span style="font:700 12px ${FONT_UI};letter-spacing:3px;color:${Ui.goldDim}">旅途中汇合的同行者</span>` +
    `<span style="font:400 10px ${FONT_UI};letter-spacing:1px;color:${Ui.textDim}">（叙事同伴，非可选职业）</span>`;
  companions.appendChild(compHeader);

  const compStrip = document.createElement('div');
  compStrip.style.cssText = 'display:flex;justify-content:center;gap:10px;';

  COMPANIONS.forEach((c) => {
    // Mini portrait card: panel-frame-inventory at ~96px wide — same 3:4
    // zero-distortion recipe (aspect-ratio locks height from width, then
    // center/100% 100%). Padding is px, not % — same flex-line resolution
    // trap as the hero card; values derive from the plate art (top clears
    // the emblem band, sides the stone edges). overflow:hidden guards the
    // painted edge. DISPLAY ONLY: no listeners, no hover/cursor — an exhibit,
    // never a picker.
    const col = document.createElement('div');
    col.title = c.blurb;
    col.style.cssText = 'pointer-events:none;flex:0 1 96px;min-width:0;box-sizing:border-box;' +
      'width:96px;aspect-ratio:3/4;overflow:hidden;' +
      'padding:16px 10px 12px;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:3px;text-align:center;' +
      // Dark underlay masks jagged parchment fringe; plate paints on top.
      `background:url('${HudArt.panelInventory()}') center/100% 100% no-repeat,#1a120c;`;

    const sig = document.createElement('div');
    sig.innerHTML = companionSigilSvg(c.sigil, 20);
    sig.style.cssText = 'line-height:1;';

    const txt = document.createElement('div');
    txt.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
    txt.innerHTML =
      `<div style="font:800 11px/1.25 ${FONT_UI};letter-spacing:1px;color:#1a1208;white-space:nowrap">` +
      `${c.nameCn}</div>` +
      `<div style="font:700 9px/1.25 ${FONT_UI};letter-spacing:1px;color:#3a2810;white-space:nowrap">` +
      `${c.titleCn}</div>` +
      `<div style="font:600 7px/1.2 ${FONT_DISPLAY};letter-spacing:0.5px;color:#5a4020;white-space:nowrap">` +
      `${c.nameEn}</div>` +
      `<div style="font:600 7px/1.2 ${FONT_DISPLAY};letter-spacing:0.5px;color:#5a4020;white-space:nowrap">` +
      `${c.titleEn}</div>`;

    col.append(sig, txt);
    compStrip.appendChild(col);
  });
  companions.appendChild(compStrip);

  const divider = document.createElement('div');
  divider.innerHTML = goldDividerHtml(6);

  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

  const nameLabel = document.createElement('div');
  nameLabel.textContent = '姓名';
  nameLabel.style.cssText = `font:600 13px ${FONT_UI};color:${Ui.textMuted};letter-spacing:2px;flex:none;`;

  let characterName = generateRandomName();
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.value = characterName;
  nameInput.style.cssText = `flex:1;min-width:0;padding:8px 12px;font:600 14px ${FONT_UI};` +
    `color:${Ui.text};background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};border-radius:6px;` +
    'outline:none;letter-spacing:1px;transition:border-color 0.2s;';
  nameInput.addEventListener('focus', () => { nameInput.style.borderColor = Ui.gold; });
  nameInput.addEventListener('blur', () => { nameInput.style.borderColor = Ui.goldLineSoft; });
  nameInput.addEventListener('input', () => { characterName = nameInput.value; clearError(); });

  const diceBtn = document.createElement('button');
  diceBtn.textContent = '🎲';
  diceBtn.title = '随机姓名';
  diceBtn.style.cssText = 'flex:none;width:38px;height:38px;font-size:17px;cursor:pointer;border:none;' +
    `background:${backRestBg};box-shadow:${backRestShadow};transition:all 0.2s;`;
  diceBtn.addEventListener('mouseenter', () => {
    diceBtn.style.background = backHoverBg;
    diceBtn.style.boxShadow = backHoverShadow;
  });
  diceBtn.addEventListener('mouseleave', () => {
    diceBtn.style.background = backRestBg;
    diceBtn.style.boxShadow = backRestShadow;
  });
  diceBtn.addEventListener('click', () => {
    characterName = generateRandomName();
    nameInput.value = characterName;
    clearError();
  });

  nameRow.append(nameLabel, nameInput, diceBtn);

  const errorEl = document.createElement('div');
  errorEl.style.cssText = `font:600 12px ${FONT_UI};color:${Ui.danger};min-height:16px;` +
    'text-shadow:0 1px 2px #000;';
  function showError(msg: string): void { errorEl.textContent = msg; }
  function clearError(): void { errorEl.textContent = ''; }

  // S1–S3 primary plate — ink label on parchment (matches title / continue).
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  const plate = (state: 'idle' | 'hover' | 'pressed') =>
    state === 'hover' ? ShellArt.btnHover()
      : state === 'pressed' ? ShellArt.btnPressed()
        : ShellArt.btnIdle();
  confirmBtn.style.cssText = 'position:relative;width:100%;height:52px;padding:0;box-sizing:border-box;' +
    `font:800 18px ${FONT_DISPLAY};letter-spacing:6px;cursor:pointer;border:none;` +
    'color:#1a1208;text-shadow:0 1px 0 rgba(255,244,210,0.55);' +
    `background:url('${plate('idle')}') center/100% 100% no-repeat;background-color:transparent;` +
    'transition:filter 0.15s ease;';

  const confirmLabel = document.createElement('span');
  confirmLabel.textContent = '确认出战';
  confirmBtn.appendChild(confirmLabel);

  confirmBtn.addEventListener('mouseenter', () => {
    if (confirmBtn.disabled) return;
    confirmBtn.style.backgroundImage = `url('${plate('hover')}')`;
  });
  confirmBtn.addEventListener('mouseleave', () => {
    confirmBtn.style.backgroundImage = `url('${plate('idle')}')`;
    confirmBtn.style.transform = '';
  });
  confirmBtn.addEventListener('mousedown', () => {
    if (!confirmBtn.disabled) {
      confirmBtn.style.backgroundImage = `url('${plate('pressed')}')`;
      confirmBtn.style.transform = 'scale(0.985)';
    }
  });
  confirmBtn.addEventListener('mouseup', () => {
    if (!confirmBtn.disabled) {
      confirmBtn.style.backgroundImage = `url('${plate('hover')}')`;
      confirmBtn.style.transform = '';
    }
  });
  let submitted = false;
  confirmBtn.addEventListener('click', () => {
    if (submitted) return;
    const name = nameInput.value.trim() || characterName;
    if (name.length < 2) {
      showError('姓名至少需要 2 个字符');
      return;
    }
    if (listCharacters().length >= MAX_CHARACTERS) {
      showError(`角色数量已达上限（${MAX_CHARACTERS}）`);
      return;
    }
    clearError();
    try {
      const rec = createCharacter(name, selectedId);
      submitted = true;
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.65';
      confirmBtn.style.cursor = 'default';
      confirmLabel.textContent = '正在进入…';
      cb.onConfirm(rec);
    } catch {
      showError(`角色数量已达上限（${MAX_CHARACTERS}）`);
    }
  });

  // Right column: companion card row + create form. Its height (companion row
  // ~128 + name row ~38 + confirm ~48 + gaps ≈ 295px) stays under the 300px
  // hero card, so the plaque reads as one clean row at 720p.
  const rightCol = document.createElement('div');
  rightCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;';
  rightCol.append(companions, divider, nameRow, errorEl, confirmBtn);
  panel.append(heroCard, rightCol);
  panelWrap.appendChild(panel);
  // Ornaments after the panel so they paint over the carved rim; siblings of
  // the scroller, so they stay pinned when the well scrolls.
  panelWrap.insertAdjacentHTML('beforeend', cornerOrnamentsHtml(5, 20));
  root.appendChild(panelWrap);
  mount.appendChild(root);

  function show(): void {
    root.style.display = '';
    submitted = false;
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    confirmBtn.style.cursor = 'pointer';
    confirmLabel.textContent = '确认出战';
    characterName = generateRandomName();
    nameInput.value = characterName;
    clearError();
    cb.onClassChange?.(selectedId);
  }
  function hide(): void { root.style.display = 'none'; }

  return {
    show,
    hide,
    dispose: () => root.remove(),
    selectedClassId: () => selectedId,
  };
}
