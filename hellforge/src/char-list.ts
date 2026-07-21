// CharList screen — saved-character list + continue flow (SPEC §4, aidiablo's
// CharListScene.ts DOM/interaction conventions ported — NOT its THREE.js
// preview renderer, per SPEC §4.3's CAUTION).
//
// Layout: WoW-style split (left preview / right list). The left side is
// transparent chrome + a name label; main.ts drives hero-preview (same idle
// GLB stage as CharSelect) while shellPhase==='charList'.
//
// Deviations from aidiablo's CharListScene.ts:
// - No THREE.WebGLRenderer preview / no campfire particle canvas — hero-preview
//   owns the 3D stage (see main.ts).
// - Class row icon/colour from classes.ts CLASS_DEFS (multi-class).
// - No i18n `t()` — strings are inlined Chinese (AGENTS.md language policy).
//   The delete-confirmation word itself is kept byte-for-byte from
//   aidiablo's zh.ts:36 (`charList.deleteConfirmWord` = '删除角色').
// - No onDeleteChar bubble-callback — save.ts already IS the save backend
//   (see its header comment), so this screen calls deleteCharacter()
//   directly, the same way char-select.ts calls createCharacter() directly
//   rather than asking a caller to persist on its behalf.
// - No "create at cap" toast — the create button just disables + gets a
//   title tooltip instead, reusing save.ts's MAX_CHARACTERS directly rather
//   than a duplicated local constant.
// - No audiobus click sfx (see shell.ts/char-select.ts's same note).

import { CLASS_DEFS, getClassDef, type CharacterRecord } from './classes';
import { isPlayableClass } from './character-domain';
import { listCharacters, deleteCharacter, MAX_CHARACTERS } from './save';
import { FONT_UI, Ui } from './ui-theme';
import { classEmblemSvg } from './ui-icons';

export interface CharListCallbacks {
  onEnterGame: (rec: CharacterRecord) => void;
  onNewChar: () => void;
  onBack: () => void;
  /** Highlighted save slot changed — caller swaps the 3D idle preview. */
  onSelectionChange?: (rec: CharacterRecord | null) => void;
}

export interface CharListHandle {
  show(): void;
  hide(): void;
  dispose(): void;
}

/** Kept byte-for-byte from aidiablo's zh.ts:36 `charList.deleteConfirmWord`. */
const DELETE_WORD = '删除角色';

export function installCharList(mount: HTMLElement, cb: CharListCallbacks): CharListHandle {
  const scoped = mount !== document.body;

  let characters: CharacterRecord[] = [];
  let selectedIndex = 0;

  const root = document.createElement('div');
  root.id = 'hellforge-char-list';
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;pointer-events:none;display:flex;` +
    `font-family:${FONT_UI};`;

  // ── left: transparent area, name label + enter/back ───────────────────
  const leftArea = document.createElement('div');
  leftArea.style.cssText = 'flex:1;position:relative;min-width:0;';

  const topFade = document.createElement('div');
  topFade.style.cssText = 'position:absolute;top:0;left:0;right:0;height:18%;pointer-events:none;' +
    'background:linear-gradient(180deg,rgba(5,4,4,0.6) 0%,transparent 100%);';
  const bottomFade = document.createElement('div');
  bottomFade.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:30%;pointer-events:none;' +
    'background:linear-gradient(0deg,rgba(5,4,4,0.7) 0%,transparent 100%);';
  leftArea.append(topFade, bottomFade);

  // Name + CTA sit on the FULL viewport horizontal center (same axis as the
  // 3D hero). leftArea is only the free column left of the 360px dock — its
  // 50% is left of the canvas center, so anchoring there never matches the
  // camera look-at (hero always framed at NDC x≈0).
  const charNameLabel = document.createElement('div');
  charNameLabel.style.cssText = 'position:absolute;top:14%;left:50%;transform:translateX(-50%);z-index:2;' +
    `font:800 24px inherit;letter-spacing:5px;color:${Ui.goldBright};` +
    'text-shadow:0 0 18px rgba(255,180,0,0.5),0 2px 4px #000;pointer-events:none;white-space:nowrap;';

  const backBtn = document.createElement('button');
  backBtn.textContent = '← 返回';
  backBtn.style.cssText = 'position:absolute;left:24px;bottom:24px;pointer-events:auto;cursor:pointer;' +
    `background:none;border:none;color:${Ui.textDim};font:600 13px inherit;letter-spacing:1px;padding:8px 4px;transition:color 0.2s;`;
  backBtn.addEventListener('mouseenter', () => { backBtn.style.color = Ui.goldBright; });
  backBtn.addEventListener('mouseleave', () => { backBtn.style.color = Ui.textDim; });
  backBtn.addEventListener('click', () => cb.onBack());
  leftArea.appendChild(backBtn);

  const enterBtn = document.createElement('button');
  enterBtn.textContent = '进入游戏';
  enterBtn.style.cssText = 'position:absolute;left:50%;bottom:6%;transform:translateX(-50%);z-index:2;' +
    'pointer-events:auto;cursor:pointer;padding:13px 56px;font:700 16px inherit;letter-spacing:5px;' +
    `border:2px solid ${Ui.goldDeep};background:linear-gradient(180deg,#3a2a18 0%,#2a1a10 100%);` +
    `color:${Ui.goldBright};text-shadow:0 1px 3px #000;border-radius:4px;transition:all 0.25s ease;`;
  function setEnterHover(on: boolean): void {
    if (enterBtn.disabled) return;
    enterBtn.style.background = on ? 'linear-gradient(180deg,#504028 0%,#3a2a18 100%)' : 'linear-gradient(180deg,#3a2a18 0%,#2a1a10 100%)';
    enterBtn.style.borderColor = on ? Ui.goldDim : Ui.goldDeep;
    enterBtn.style.boxShadow = on ? '0 0 20px rgba(255,200,0,0.2)' : 'none';
    enterBtn.style.transform = on ? 'translateX(-50%) scale(1.03)' : 'translateX(-50%) scale(1)';
  }
  enterBtn.addEventListener('mouseenter', () => setEnterHover(true));
  enterBtn.addEventListener('mouseleave', () => setEnterHover(false));
  let submitted = false;
  enterBtn.addEventListener('click', () => {
    if (submitted) return;
    const rec = characters[selectedIndex];
    if (!rec) return;
    if (!isPlayableClass(rec.classId)) {
      enterBtn.title = 'In development';
      return;
    }
    submitted = true;
    enterBtn.disabled = true;
    enterBtn.textContent = '正在进入…';
    cb.onEnterGame(rec);
  });

  // ── right: docked list panel ───────────────────────────────────────────
  const rightPanel = document.createElement('div');
  rightPanel.style.cssText = 'flex:0 0 360px;position:relative;display:flex;flex-direction:column;' +
    `pointer-events:auto;background:${Ui.inkWell};border-left:1px solid #3a2e1a;padding:0 20px 22px;`;

  const topDeco = document.createElement('div');
  topDeco.style.cssText = `height:2px;background:linear-gradient(90deg,transparent,${Ui.goldDeep},${Ui.goldDim},${Ui.goldDeep},transparent);`;
  rightPanel.appendChild(topDeco);

  const header = document.createElement('div');
  header.style.cssText = 'text-align:center;padding:18px 0 14px;';
  const headerText = document.createElement('div');
  headerText.textContent = '选择角色';
  headerText.style.cssText = `font:700 16px inherit;letter-spacing:6px;color:${Ui.gold};` +
    'text-shadow:0 0 12px rgba(200,140,40,0.4),0 1px 3px #000;';
  const headerLine = document.createElement('div');
  headerLine.style.cssText = `margin-top:11px;height:1px;background:linear-gradient(90deg,transparent,${Ui.goldDeep},${Ui.goldDim},${Ui.goldDeep},transparent);`;
  header.append(headerText, headerLine);
  rightPanel.appendChild(header);

  const charCountEl = document.createElement('div');
  charCountEl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 2px 10px;' +
    `font:400 11px ${FONT_UI};letter-spacing:2px;color:${Ui.goldDeep};` +
    'border-bottom:1px solid #1e180a;margin-bottom:6px;flex:none;';
  rightPanel.appendChild(charCountEl);

  const listContainer = document.createElement('div');
  listContainer.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;padding-right:4px;min-height:0;';
  rightPanel.appendChild(listContainer);

  const btnArea = document.createElement('div');
  btnArea.style.cssText = 'padding-top:14px;display:flex;flex-direction:column;gap:9px;' +
    'border-top:1px solid #2a2010;flex:none;';

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '删除角色';
  deleteBtn.style.cssText = `width:100%;padding:10px 0;font:600 13px ${FONT_UI};letter-spacing:3px;` +
    `background:rgba(55,12,8,0.9);border:1px solid ${Ui.crimsonSoft};color:${Ui.crimson};cursor:pointer;border-radius:4px;transition:all 0.2s;`;
  deleteBtn.addEventListener('mouseenter', () => {
    if (deleteBtn.disabled) return;
    deleteBtn.style.background = 'rgba(85,18,12,0.9)'; deleteBtn.style.borderColor = Ui.crimson; deleteBtn.style.color = Ui.danger;
  });
  deleteBtn.addEventListener('mouseleave', () => {
    deleteBtn.style.background = 'rgba(55,12,8,0.9)'; deleteBtn.style.borderColor = Ui.crimsonSoft; deleteBtn.style.color = Ui.crimson;
  });
  deleteBtn.addEventListener('click', () => showDeleteModal());
  btnArea.appendChild(deleteBtn);

  const createBtn = document.createElement('button');
  createBtn.style.cssText = `width:100%;padding:10px 0;font:600 13px ${FONT_UI};letter-spacing:3px;` +
    `background:rgba(20,16,10,0.9);border:1px solid ${Ui.goldLineSoft};color:${Ui.textMuted};cursor:pointer;border-radius:4px;` +
    'display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.2s;';
  createBtn.innerHTML = `<span style="font-size:16px;line-height:1;color:${Ui.goldDim};">+</span><span>创建新角色</span>`;
  createBtn.addEventListener('mouseenter', () => {
    if (createBtn.disabled) return;
    createBtn.style.background = 'rgba(32,26,16,0.9)'; createBtn.style.borderColor = Ui.goldDeep; createBtn.style.color = Ui.goldDim;
  });
  createBtn.addEventListener('mouseleave', () => {
    createBtn.style.background = 'rgba(20,16,10,0.9)'; createBtn.style.borderColor = Ui.goldLineSoft; createBtn.style.color = Ui.textMuted;
  });
  createBtn.addEventListener('click', () => cb.onNewChar());
  btnArea.appendChild(createBtn);

  rightPanel.appendChild(btnArea);
  root.append(leftArea, rightPanel, charNameLabel, enterBtn);

  // ── delete-confirmation modal (typed-word gate) ────────────────────────
  const modalOverlay = document.createElement('div');
  modalOverlay.style.cssText = 'display:none;position:absolute;inset:0;z-index:10;pointer-events:auto;' +
    'background:rgba(0,0,0,0.78);align-items:center;justify-content:center;';

  const modalBox = document.createElement('div');
  modalBox.style.cssText = `width:380px;background:${Ui.inkPanel};border:1px solid ${Ui.crimsonSoft};` +
    `border-top:2px solid ${Ui.crimson};padding:26px 30px 22px;border-radius:4px;box-shadow:0 0 50px rgba(0,0,0,0.9);`;

  const warnTitle = document.createElement('div');
  warnTitle.textContent = '⚠ 警告';
  warnTitle.style.cssText = `font:700 15px inherit;letter-spacing:5px;color:${Ui.crimson};text-align:center;` +
    'margin-bottom:10px;text-shadow:0 0 12px rgba(200,50,50,0.3);';
  const warnText = document.createElement('div');
  warnText.textContent = '此操作不可撤销，角色数据将永久删除。';
  warnText.style.cssText = `font:400 13px ${FONT_UI};color:${Ui.textDim};text-align:center;` +
    'margin-bottom:20px;line-height:1.7;';
  const inputLabel = document.createElement('div');
  inputLabel.textContent = `请输入"${DELETE_WORD}"以确认：`;
  inputLabel.style.cssText = `font:400 12px ${FONT_UI};color:${Ui.textDim};margin-bottom:9px;letter-spacing:1px;`;

  const deleteInput = document.createElement('input');
  deleteInput.type = 'text';
  deleteInput.placeholder = DELETE_WORD;
  deleteInput.autocomplete = 'off';
  deleteInput.style.cssText = `width:100%;box-sizing:border-box;padding:10px 14px;font:500 15px ${FONT_UI};` +
    `background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};border-bottom:2px solid ${Ui.goldDeep};` +
    `color:${Ui.text};outline:none;letter-spacing:2px;border-radius:3px;transition:border-color 0.2s,box-shadow 0.2s;`;
  deleteInput.addEventListener('focus', () => { deleteInput.style.borderColor = Ui.goldDeep; deleteInput.style.boxShadow = '0 0 8px rgba(180,80,50,0.15)'; });
  deleteInput.addEventListener('blur', () => { deleteInput.style.borderColor = Ui.goldLineSoft; deleteInput.style.boxShadow = 'none'; });
  deleteInput.addEventListener('input', () => updateDeleteConfirmState());

  const modalBtnRow = document.createElement('div');
  modalBtnRow.style.cssText = 'display:flex;gap:12px;margin-top:18px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = `flex:1;padding:10px 0;font:600 13px ${FONT_UI};letter-spacing:3px;` +
    `background:rgba(22,18,10,0.9);border:1px solid ${Ui.goldLineSoft};color:${Ui.textDim};cursor:pointer;border-radius:4px;transition:all 0.2s;`;
  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.borderColor = Ui.goldDeep; cancelBtn.style.color = Ui.textMuted; });
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.borderColor = Ui.goldLineSoft; cancelBtn.style.color = Ui.textDim; });
  cancelBtn.addEventListener('click', () => hideDeleteModal());

  const deleteConfirmBtn = document.createElement('button');
  deleteConfirmBtn.textContent = '确认删除';
  deleteConfirmBtn.disabled = true;
  deleteConfirmBtn.style.borderRadius = '4px';
  applyConfirmBtnStyle(false);
  deleteConfirmBtn.addEventListener('click', () => confirmDelete());

  modalBtnRow.append(cancelBtn, deleteConfirmBtn);
  modalBox.append(warnTitle, warnText, inputLabel, deleteInput, modalBtnRow);
  modalOverlay.appendChild(modalBox);
  root.appendChild(modalOverlay);
  mount.appendChild(root);

  function applyConfirmBtnStyle(active: boolean): void {
    deleteConfirmBtn.style.cssText = `flex:1;padding:10px 0;font:600 13px ${FONT_UI};letter-spacing:3px;border-radius:4px;` +
      `background:${active ? 'rgba(90,12,8,0.95)' : 'rgba(38,8,6,0.9)'};` +
      `border:1px solid ${active ? Ui.crimson : '#4a1818'};` +
      `color:${active ? Ui.danger : '#664444'};` +
      `cursor:${active ? 'pointer' : 'not-allowed'};transition:all 0.2s;opacity:${active ? '1' : '0.5'};`;
  }

  function updateDeleteConfirmState(): void {
    const match = deleteInput.value === DELETE_WORD;
    deleteConfirmBtn.disabled = !match;
    applyConfirmBtnStyle(match);
  }

  function showDeleteModal(): void {
    if (characters.length === 0) return;
    modalOverlay.style.display = 'flex';
    deleteInput.value = '';
    updateDeleteConfirmState();
    setTimeout(() => deleteInput.focus(), 60);
  }
  function hideDeleteModal(): void {
    modalOverlay.style.display = 'none';
    deleteInput.value = '';
    updateDeleteConfirmState();
  }
  function confirmDelete(): void {
    const rec = characters[selectedIndex];
    if (!rec) return;
    hideDeleteModal();
    deleteCharacter(rec.id);
    characters.splice(selectedIndex, 1);
    selectedIndex = Math.min(selectedIndex, Math.max(0, characters.length - 1));
    rebuildList();
  }

  // ── list rendering ──────────────────────────────────────────────────────
  function updateCharCount(): void {
    const count = characters.length;
    const full = count >= MAX_CHARACTERS;
    charCountEl.innerHTML = `<span style="color:${Ui.goldDeep}">已创建角色</span>` +
      `<span style="font:700 13px ${FONT_UI};letter-spacing:1px;` +
      `color:${full ? '#cc6622' : Ui.goldDim};${full ? 'text-shadow:0 0 8px rgba(200,80,20,0.3);' : ''}">${count} / ${MAX_CHARACTERS}</span>`;
  }

  function setActionBtnsEnabled(hasChars: boolean): void {
    deleteBtn.disabled = !hasChars;
    deleteBtn.style.opacity = hasChars ? '1' : '0.35';
    deleteBtn.style.cursor = hasChars ? 'pointer' : 'not-allowed';
    const rec = characters[selectedIndex];
    const canEnter = hasChars && !!rec && isPlayableClass(rec.classId);
    enterBtn.disabled = !canEnter;
    enterBtn.style.opacity = canEnter ? '1' : '0.35';
    enterBtn.style.cursor = canEnter ? 'pointer' : 'not-allowed';
    enterBtn.title = hasChars && rec && !isPlayableClass(rec.classId)
      ? 'In development'
      : '';
    enterBtn.textContent = hasChars && rec && !isPlayableClass(rec.classId)
      ? '开发中'
      : '进入游戏';
  }

  function updateCreateBtnState(): void {
    const full = characters.length >= MAX_CHARACTERS;
    createBtn.disabled = full;
    createBtn.style.opacity = full ? '0.4' : '1';
    createBtn.style.cursor = full ? 'not-allowed' : 'pointer';
    createBtn.title = full ? `已达上限（${MAX_CHARACTERS}个），请删除角色后再新建` : '';
  }

  function buildCharItem(rec: CharacterRecord, index: number): HTMLDivElement {
    const isSelected = index === selectedIndex;
    // Corrupt/future classId must not throw — fall back to the shipped sorceress def.
    const classDef = CLASS_DEFS[rec.classId] ?? getClassDef('sorceress');

    const item = document.createElement('div');
    item.style.cssText = `display:flex;align-items:center;gap:13px;padding:10px 11px;margin-bottom:5px;border-radius:4px;` +
      `border:1px solid ${isSelected ? Ui.goldDeep : Ui.goldLineSoft};` +
      `background:${isSelected ? Ui.goldFill : 'rgba(12,10,5,0.55)'};` +
      `cursor:pointer;transition:all 0.2s;` +
      (isSelected ? 'box-shadow:0 0 14px rgba(180,130,20,0.12) inset,0 0 4px rgba(180,130,20,0.08);' : '');

    const dot = document.createElement('div');
    dot.innerHTML = classEmblemSvg(classDef.id, 26);
    dot.style.cssText = 'width:38px;height:38px;border-radius:50%;flex:none;display:flex;' +
      'align-items:center;justify-content:center;' +
      `background:radial-gradient(circle at 38% 35%,rgba(160,120,255,0.5) 0%,rgba(30,20,50,0.65) 65%);` +
      `border:1px solid rgba(160,120,255,${isSelected ? '0.5' : '0.2'});` +
      (isSelected ? 'box-shadow:0 0 10px rgba(160,120,255,0.3);' : '');

    const textArea = document.createElement('div');
    textArea.style.cssText = 'flex:1;min-width:0;';
    const nameEl = document.createElement('div');
    nameEl.textContent = rec.playerName;
    nameEl.style.cssText = `font:600 14px ${FONT_UI};letter-spacing:1px;white-space:nowrap;` +
      `overflow:hidden;text-overflow:ellipsis;color:${isSelected ? Ui.goldBright : Ui.goldDim};` +
      (isSelected ? 'text-shadow:0 0 10px rgba(255,200,0,0.3);' : '');
    const metaEl = document.createElement('div');
    const playable = isPlayableClass(rec.classId);
    metaEl.textContent = playable
      ? `${classDef.name} · Lv.${rec.level}`
      : `${classDef.name} · Lv.${rec.level} · 开发中`;
    metaEl.style.cssText = `font:400 11px ${FONT_UI};margin-top:3px;letter-spacing:1px;` +
      `color:${!playable ? Ui.textDim : isSelected ? Ui.goldDim : Ui.goldDeep};`;
    textArea.append(nameEl, metaEl);
    if (!playable) item.title = 'In development';
    item.append(dot, textArea);

    item.addEventListener('mouseenter', () => {
      if (index !== selectedIndex) { item.style.background = 'rgba(26,20,8,0.65)'; item.style.borderColor = Ui.goldLine; }
    });
    item.addEventListener('mouseleave', () => {
      if (index !== selectedIndex) { item.style.background = 'rgba(12,10,5,0.55)'; item.style.borderColor = Ui.goldLineSoft; }
    });
    item.addEventListener('click', () => { if (index !== selectedIndex) selectCharacter(index); });

    return item;
  }

  function selectCharacter(index: number): void {
    selectedIndex = Math.max(0, Math.min(index, characters.length - 1));
    rebuildList();
  }

  function rebuildList(): void {
    listContainer.innerHTML = '';
    updateCharCount();

    if (characters.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `text-align:center;padding:44px 14px;color:${Ui.textDim};` +
        `font:400 13px ${FONT_UI};letter-spacing:1px;line-height:2.2;`;
      empty.innerHTML = '暂无角色<div style="font-size:12px;color:#3a3020;margin-top:6px;">请点击下方"创建新角色"</div>';
      listContainer.appendChild(empty);
      charNameLabel.textContent = '';
      setActionBtnsEnabled(false);
      updateCreateBtnState();
      cb.onSelectionChange?.(null);
      return;
    }

    setActionBtnsEnabled(true);
    updateCreateBtnState();
    characters.forEach((rec, i) => listContainer.appendChild(buildCharItem(rec, i)));
    const rec = characters[selectedIndex] ?? null;
    charNameLabel.textContent = rec ? rec.playerName : '';
    cb.onSelectionChange?.(rec);
  }

  function show(): void {
    root.style.display = 'flex';
    characters = listCharacters().sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
    selectedIndex = 0;
    hideDeleteModal();
    rebuildList();
  }
  function hide(): void { root.style.display = 'none'; }

  return {
    show,
    hide,
    dispose: () => root.remove(),
  };
}
