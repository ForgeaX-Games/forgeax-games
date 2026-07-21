// Q quest log panel + persistent top-right tracker (Spec §11).

import type { QuestStatus } from './content-ids';
import {
  FONT_UI, Ui, Z, cornerOrnamentsHtml, panelChrome, panelScrollShellCss, panelTitleStyle,
} from './ui-theme';

export interface QuestViewModel {
  readonly id: string;
  readonly title: string;
  readonly status: QuestStatus;
  readonly summary: string;
}

export interface QuestLogHandle {
  update(quests: readonly QuestViewModel[]): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  dispose(): void;
}

const STATUS_LABEL: Record<QuestStatus, string> = {
  available: '可接取',
  active: '进行中',
  ready: '可交还',
  completed: '已完成',
};

export function installQuestLog(mount: HTMLElement): QuestLogHandle {
  const tracker = document.createElement('div');
  tracker.id = 'hellforge-quest-tracker';
  tracker.style.cssText =
    `position:absolute;top:48px;right:14px;width:min(260px,38%);z-index:${Z.questTracker};` +
    'pointer-events:none;display:flex;flex-direction:column;gap:6px;';

  const panel = document.createElement('div');
  panel.id = 'hellforge-quest-log';
  panel.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    `width:min(480px,90%);z-index:${Z.questLog};display:none;` +
    'border-radius:10px;padding:16px 18px;pointer-events:auto;' +
    panelScrollShellCss(520, 64) +
    panelChrome();
  panel.insertAdjacentHTML('beforeend', cornerOrnamentsHtml());

  const title = document.createElement('div');
  title.textContent = '任务日志';
  title.style.cssText = panelTitleStyle() + 'font-size:16px;margin-bottom:12px;padding-bottom:8px;' +
    'border-bottom:1px solid rgba(224,184,74,0.35);';

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

  panel.append(title, list);
  mount.append(tracker, panel);

  let open = false;
  let last: readonly QuestViewModel[] = [];

  const paintTracker = (quests: readonly QuestViewModel[]): void => {
    tracker.replaceChildren();
    for (const q of quests) {
      if (q.status === 'available' || q.status === 'completed') continue;
      const row = document.createElement('div');
      row.style.cssText =
        `padding:6px 10px;background:rgba(12,8,6,0.72);border:1px solid ${Ui.goldLineSoft};` +
        `font:600 12px ${FONT_UI};color:${Ui.text};line-height:1.4;` +
        'border-radius:3px;text-shadow:0 1px 2px #000;';
      row.textContent = `${q.title} · ${STATUS_LABEL[q.status]}`;
      tracker.appendChild(row);
    }
  };

  const paintPanel = (quests: readonly QuestViewModel[]): void => {
    list.replaceChildren();
    for (const q of quests) {
      const card = document.createElement('div');
      card.style.cssText =
        `padding:10px 12px;background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};` +
        'border-radius:3px;';
      const head = document.createElement('div');
      head.style.cssText =
        `display:flex;justify-content:space-between;gap:8px;font:700 14px ${FONT_UI};` +
        `color:${Ui.gold};margin-bottom:6px;`;
      head.innerHTML = `<span>${q.title}</span><span style="color:${Ui.textMuted};font-size:12px">${STATUS_LABEL[q.status]}</span>`;
      const sum = document.createElement('div');
      sum.style.cssText = `font:500 13px ${FONT_UI};color:${Ui.text};line-height:1.5;`;
      sum.textContent = q.summary;
      card.append(head, sum);
      list.appendChild(card);
    }
    if (quests.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `font:500 13px ${FONT_UI};color:${Ui.textDim};`;
      empty.textContent = '尚无任务记录';
      list.appendChild(empty);
    }
  };

  return {
    update(quests) {
      last = quests;
      paintTracker(quests);
      if (open) paintPanel(quests);
    },
    setOpen(next) {
      open = next;
      panel.style.display = next ? 'block' : 'none';
      if (next) paintPanel(last);
    },
    isOpen: () => open,
    dispose() {
      tracker.remove();
      panel.remove();
      open = false;
    },
  };
}
