// CharSelect — fixed Emberwalker create (N1).
// DOM chrome only: centre stays transparent so main.ts hero-preview (idle +
// 360° yaw) shows through on the WebGPU canvas beneath.
// Product: one playable hero (classId sorceress). Companions are narrative-only.

import { getClassDef, type CharacterRecord, type ClassId } from './classes';
import { DEFAULT_HERO_ID } from './heroes';
import { createCharacter, listCharacters, MAX_CHARACTERS } from './save';
import { FONT_UI, Ui } from './ui-theme';
import { classEmblemSvg } from './ui-icons';

/** Product-facing name for the fixed create path (enum stays sorceress). */
export const EMBERWALKER_DISPLAY_NAME = '烬行者';
export const EMBERWALKER_CLASS_ID: ClassId = DEFAULT_HERO_ID;

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

export function installCharSelect(mount: HTMLElement, cb: CharSelectCallbacks): CharSelectHandle {
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

  const backBtn = document.createElement('button');
  backBtn.textContent = '← 返回';
  backBtn.style.cssText = 'position:absolute;left:20px;top:18px;pointer-events:auto;cursor:pointer;' +
    `background:rgba(20,15,12,0.7);border:1px solid ${Ui.goldLineSoft};border-radius:6px;` +
    `color:${Ui.textMuted};font:600 13px inherit;padding:7px 14px;letter-spacing:1px;transition:all 0.2s;`;
  backBtn.addEventListener('mouseenter', () => { backBtn.style.color = Ui.goldBright; backBtn.style.borderColor = Ui.goldLine; });
  backBtn.addEventListener('mouseleave', () => { backBtn.style.color = Ui.textMuted; backBtn.style.borderColor = Ui.goldLineSoft; });
  backBtn.addEventListener('click', () => cb.onBack());

  const heading = document.createElement('div');
  heading.textContent = '创建烬行者';
  heading.style.cssText = 'font:900 22px inherit;letter-spacing:8px;' +
    `background:linear-gradient(180deg,#fff8e0 0%,${Ui.goldBright} 30%,${Ui.goldDeep} 70%,${Ui.gold} 100%);` +
    '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;' +
    'filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));user-select:none;';

  topBar.append(backBtn, heading);
  root.appendChild(topBar);

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;left:50%;bottom:28px;transform:translateX(-50%);' +
    'width:min(560px,94vw);pointer-events:auto;padding:18px 24px;border-radius:10px;' +
    `background:linear-gradient(180deg,${Ui.inkPanelHi} 0%,${Ui.inkPanel} 100%);` +
    `border:2px solid ${Ui.goldLineSoft};box-shadow:0 0 40px rgba(0,0,0,0.7),inset 0 1px 0 ${Ui.goldLineSoft};` +
    'display:flex;flex-direction:column;gap:12px;';

  const heroCard = document.createElement('div');
  heroCard.style.cssText = 'display:flex;gap:14px;align-items:flex-start;padding:12px;' +
    'border-radius:8px;' +
    'background:linear-gradient(180deg,rgba(70,48,22,0.55),rgba(40,28,14,0.75));' +
    `border:2px solid ${Ui.goldLine};box-shadow:0 0 18px rgba(200,140,50,0.25);`;

  const emblem = document.createElement('div');
  emblem.innerHTML = classEmblemSvg(selectedId, 52);
  emblem.style.cssText = 'flex:none;line-height:1;';

  const heroCopy = document.createElement('div');
  heroCopy.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;';
  heroCopy.innerHTML =
    `<div style="font:700 16px inherit;letter-spacing:3px;color:${Ui.goldBright}">${EMBERWALKER_DISPLAY_NAME}</div>` +
    `<div style="font:600 11px inherit;letter-spacing:2px;color:${Ui.textDim}">暗法师</div>` +
    `<div style="font:400 13px ${FONT_UI};color:${Ui.textMuted};line-height:1.5;margin-top:4px">${def.description}</div>` +
    `<div style="font:400 12px ${FONT_UI};color:${Ui.textDim};line-height:1.5;margin-top:2px">` +
    `<b style="color:${Ui.textMuted}">${def.coreMechanic}</b> — ${def.coreMechanicDesc}</div>`;

  heroCard.append(emblem, heroCopy);

  const companionsNote = document.createElement('div');
  companionsNote.textContent = '同行者将在旅途中汇合（叙事同伴，非可选职业）';
  companionsNote.style.cssText =
    `font:600 12px ${FONT_UI};color:${Ui.textDim};letter-spacing:1px;line-height:1.4;text-align:center;`;

  const divider = document.createElement('div');
  divider.style.cssText = `height:1px;background:linear-gradient(90deg,transparent,${Ui.goldLineSoft} 20%,${Ui.goldLineSoft} 80%,transparent);`;

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
  diceBtn.style.cssText = 'flex:none;width:36px;height:36px;font-size:17px;cursor:pointer;border-radius:6px;' +
    `background:rgba(20,15,12,0.7);border:1px solid ${Ui.goldLineSoft};transition:all 0.2s;`;
  diceBtn.addEventListener('mouseenter', () => { diceBtn.style.borderColor = Ui.gold; });
  diceBtn.addEventListener('mouseleave', () => { diceBtn.style.borderColor = Ui.goldLineSoft; });
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

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '确认出战';
  confirmBtn.style.cssText = 'position:relative;padding:12px 0;font:700 16px inherit;letter-spacing:4px;' +
    `cursor:pointer;color:${Ui.goldBright};text-shadow:0 1px 3px rgba(0,0,0,0.9);border:none;border-radius:6px;` +
    'background:linear-gradient(180deg,rgba(60,42,20,0.92) 0%,rgba(40,25,12,0.95) 100%);' +
    `box-shadow:inset 0 1px 0 ${Ui.goldLineSoft},inset 0 -1px 0 rgba(0,0,0,0.5),0 0 0 1px ${Ui.goldLine},0 4px 12px rgba(0,0,0,0.5);` +
    'transition:all 0.2s;';
  confirmBtn.addEventListener('mouseenter', () => {
    confirmBtn.style.color = '#fff';
    confirmBtn.style.background = 'linear-gradient(180deg,rgba(75,55,28,0.95) 0%,rgba(55,38,18,0.98) 100%)';
    confirmBtn.style.transform = 'scale(1.01)';
  });
  confirmBtn.addEventListener('mouseleave', () => {
    confirmBtn.style.color = Ui.goldBright;
    confirmBtn.style.background = 'linear-gradient(180deg,rgba(60,42,20,0.92) 0%,rgba(40,25,12,0.95) 100%)';
    confirmBtn.style.transform = 'scale(1)';
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
      confirmBtn.textContent = '正在进入…';
      cb.onConfirm(rec);
    } catch {
      showError(`角色数量已达上限（${MAX_CHARACTERS}）`);
    }
  });

  panel.append(heroCard, companionsNote, divider, nameRow, errorEl, confirmBtn);
  root.appendChild(panel);
  mount.appendChild(root);

  function show(): void {
    root.style.display = '';
    submitted = false;
    confirmBtn.disabled = false;
    confirmBtn.textContent = '确认出战';
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
