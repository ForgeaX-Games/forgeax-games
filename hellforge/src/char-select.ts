// CharSelect — three-class virtual picker + name entry (SPEC §4).
// DOM chrome only: centre stays transparent so main.ts hero-preview (idle +
// 360° yaw) shows through on the WebGPU canvas beneath.

import { getClassDef, SELECTABLE_CLASS_IDS, type CharacterRecord, type ClassId } from './classes';
import { isPlayableClass } from './character-domain';
import { DEFAULT_HERO_ID } from './heroes';
import { createCharacter, listCharacters, MAX_CHARACTERS } from './save';
import { FONT_UI } from './ui-theme';

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
  let selectedId: ClassId = DEFAULT_HERO_ID;

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
    'background:rgba(20,15,12,0.7);border:1px solid rgba(160,120,60,0.5);border-radius:6px;' +
    'color:#c8b088;font:600 13px inherit;padding:7px 14px;letter-spacing:1px;transition:all 0.2s;';
  backBtn.addEventListener('mouseenter', () => { backBtn.style.color = '#ffe8a0'; backBtn.style.borderColor = 'rgba(200,160,70,0.8)'; });
  backBtn.addEventListener('mouseleave', () => { backBtn.style.color = '#c8b088'; backBtn.style.borderColor = 'rgba(160,120,60,0.5)'; });
  backBtn.addEventListener('click', () => cb.onBack());

  const heading = document.createElement('div');
  heading.textContent = '选择你的英雄';
  heading.style.cssText = 'font:900 22px inherit;letter-spacing:8px;' +
    'background:linear-gradient(180deg,#fff8e0 0%,#ffd700 30%,#c07818 70%,#e8a820 100%);' +
    '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;' +
    'filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));user-select:none;';

  topBar.append(backBtn, heading);
  root.appendChild(topBar);

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;left:50%;bottom:28px;transform:translateX(-50%);' +
    'width:min(720px,94vw);pointer-events:auto;padding:18px 24px;border-radius:10px;' +
    'background:linear-gradient(180deg,rgba(46,38,30,0.92) 0%,rgba(28,22,18,0.95) 100%);' +
    'border:2px solid rgba(160,120,50,0.55);box-shadow:0 0 40px rgba(0,0,0,0.7),inset 0 1px 0 rgba(200,160,90,0.25);' +
    'display:flex;flex-direction:column;gap:12px;';

  // ── class strip (3 virtual slots) ────────────────────────────────────
  const strip = document.createElement('div');
  strip.style.cssText = 'display:flex;gap:10px;justify-content:center;';

  const classBtns = new Map<ClassId, HTMLButtonElement>();
  const styleClassBtn = (btn: HTMLButtonElement, id: ClassId, active: boolean): void => {
    const def = getClassDef(id);
    const playable = isPlayableClass(id);
    btn.innerHTML = `<div style="font-size:28px;line-height:1;opacity:${playable ? '1' : '0.45'}">${def.icon}</div>` +
      `<div style="font:700 13px inherit;letter-spacing:2px;margin-top:6px;opacity:${playable ? '1' : '0.55'}">${def.name}</div>` +
      (playable
        ? ''
        : `<div style="font:600 10px inherit;letter-spacing:1px;margin-top:6px;color:#8a7060">开发中</div>`);
    btn.disabled = !playable;
    btn.title = playable ? '' : 'In development';
    btn.style.cssText = 'flex:1;min-width:0;padding:12px 8px;border-radius:8px;' +
      `cursor:${playable ? 'pointer' : 'not-allowed'};` +
      `color:${active && playable ? '#ffe8a0' : '#b0a090'};text-align:center;transition:all 0.2s;` +
      `background:${active && playable
        ? 'linear-gradient(180deg,rgba(70,48,22,0.95),rgba(40,28,14,0.98))'
        : 'linear-gradient(180deg,rgba(35,28,22,0.85),rgba(18,14,12,0.9))'};` +
      `border:2px solid ${active && playable ? 'rgba(220,170,70,0.85)' : 'rgba(120,95,60,0.45)'};` +
      `box-shadow:${active && playable ? '0 0 18px rgba(200,140,50,0.35)' : 'none'};` +
      `opacity:${playable ? '1' : '0.72'};`;
  };

  for (const id of SELECTABLE_CLASS_IDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    styleClassBtn(btn, id, id === selectedId);
    btn.addEventListener('click', () => {
      if (!isPlayableClass(id)) return;
      if (selectedId === id) return;
      selectedId = id;
      for (const [cid, b] of classBtns) styleClassBtn(b, cid, cid === selectedId);
      refreshDetail();
      cb.onClassChange?.(selectedId);
    });
    classBtns.set(id, btn);
    strip.appendChild(btn);
  }

  const detail = document.createElement('div');
  detail.style.cssText = 'display:flex;flex-direction:column;gap:4px;min-height:72px;';
  const descEl = document.createElement('div');
  descEl.style.cssText = `font:400 13px ${FONT_UI};color:#c8b8a0;line-height:1.5;`;
  const mechanicEl = document.createElement('div');
  mechanicEl.style.cssText = `font:400 12px ${FONT_UI};color:#8a9bc0;line-height:1.5;`;
  detail.append(descEl, mechanicEl);

  function refreshDetail(): void {
    const def = getClassDef(selectedId);
    descEl.textContent = def.description;
    mechanicEl.innerHTML = `<b style="color:#a8bce8">${def.coreMechanic}</b> — ${def.coreMechanicDesc}`;
  }
  refreshDetail();

  const divider = document.createElement('div');
  divider.style.cssText = 'height:1px;background:linear-gradient(90deg,transparent,rgba(160,120,60,0.5) 20%,rgba(160,120,60,0.5) 80%,transparent);';

  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

  const nameLabel = document.createElement('div');
  nameLabel.textContent = '姓名';
  nameLabel.style.cssText = `font:600 13px ${FONT_UI};color:#c8b088;letter-spacing:2px;flex:none;`;

  let characterName = generateRandomName();
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.value = characterName;
  nameInput.style.cssText = `flex:1;min-width:0;padding:8px 12px;font:600 14px ${FONT_UI};` +
    'color:#f0e0c0;background:rgba(10,8,6,0.6);border:1px solid rgba(160,120,60,0.5);border-radius:6px;' +
    'outline:none;letter-spacing:1px;transition:border-color 0.2s;';
  nameInput.addEventListener('focus', () => { nameInput.style.borderColor = 'rgba(220,180,90,0.9)'; });
  nameInput.addEventListener('blur', () => { nameInput.style.borderColor = 'rgba(160,120,60,0.5)'; });
  nameInput.addEventListener('input', () => { characterName = nameInput.value; clearError(); });

  const diceBtn = document.createElement('button');
  diceBtn.textContent = '🎲';
  diceBtn.title = '随机姓名';
  diceBtn.style.cssText = 'flex:none;width:36px;height:36px;font-size:17px;cursor:pointer;border-radius:6px;' +
    'background:rgba(20,15,12,0.7);border:1px solid rgba(160,120,60,0.5);transition:all 0.2s;';
  diceBtn.addEventListener('mouseenter', () => { diceBtn.style.borderColor = 'rgba(220,180,90,0.9)'; });
  diceBtn.addEventListener('mouseleave', () => { diceBtn.style.borderColor = 'rgba(160,120,60,0.5)'; });
  diceBtn.addEventListener('click', () => {
    characterName = generateRandomName();
    nameInput.value = characterName;
    clearError();
  });

  nameRow.append(nameLabel, nameInput, diceBtn);

  const errorEl = document.createElement('div');
  errorEl.style.cssText = `font:600 12px ${FONT_UI};color:#ff6a5a;min-height:16px;` +
    'text-shadow:0 1px 2px #000;';
  function showError(msg: string): void { errorEl.textContent = msg; }
  function clearError(): void { errorEl.textContent = ''; }

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '确认出战';
  confirmBtn.style.cssText = 'position:relative;padding:12px 0;font:700 16px inherit;letter-spacing:4px;' +
    'cursor:pointer;color:#ffe8a0;text-shadow:0 1px 3px rgba(0,0,0,0.9);border:none;border-radius:6px;' +
    'background:linear-gradient(180deg,rgba(60,42,20,0.92) 0%,rgba(40,25,12,0.95) 100%);' +
    'box-shadow:inset 0 1px 0 rgba(200,160,70,0.5),inset 0 -1px 0 rgba(0,0,0,0.5),0 0 0 1px rgba(160,120,50,0.7),0 4px 12px rgba(0,0,0,0.5);' +
    'transition:all 0.2s;';
  confirmBtn.addEventListener('mouseenter', () => {
    confirmBtn.style.color = '#fff';
    confirmBtn.style.background = 'linear-gradient(180deg,rgba(75,55,28,0.95) 0%,rgba(55,38,18,0.98) 100%)';
    confirmBtn.style.transform = 'scale(1.01)';
  });
  confirmBtn.addEventListener('mouseleave', () => {
    confirmBtn.style.color = '#ffe8a0';
    confirmBtn.style.background = 'linear-gradient(180deg,rgba(60,42,20,0.92) 0%,rgba(40,25,12,0.95) 100%)';
    confirmBtn.style.transform = 'scale(1)';
  });
  let submitted = false;
  confirmBtn.addEventListener('click', () => {
    if (submitted) return;
    if (!isPlayableClass(selectedId)) {
      showError('该职业尚在开发中，请选择法师');
      return;
    }
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      showError(msg.includes('not playable') ? '该职业尚在开发中，请选择法师' : `角色数量已达上限（${MAX_CHARACTERS}）`);
    }
  });

  panel.append(strip, detail, divider, nameRow, errorEl, confirmBtn);
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
    for (const [cid, b] of classBtns) styleClassBtn(b, cid, cid === selectedId);
    refreshDetail();
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
