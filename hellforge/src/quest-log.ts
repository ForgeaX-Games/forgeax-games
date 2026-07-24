// Q quest log panel + persistent top-right tracker (Spec §11).

import type { QuestStatus } from './content-ids';
import { HudArt } from './hud-art';
import {
  FONT_DISPLAY, FONT_UI, Ui, Z, panelScrollShellCss, panelTitleStyle,
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

const STATUS_COLOR: Record<QuestStatus, string> = {
  available: Ui.textMuted,
  active: Ui.goldBright,
  ready: Ui.ok,
  completed: Ui.textDim,
};

export function installQuestLog(mount: HTMLElement): QuestLogHandle {
  const tracker = document.createElement('div');
  tracker.id = 'hellforge-quest-tracker';
  tracker.style.cssText =
    `position:absolute;top:48px;right:14px;width:min(260px,38%);z-index:${Z.questTracker};` +
    'pointer-events:none;display:flex;flex-direction:column;gap:6px;';

  // Frame as overlay img (no stretch of portrait art into a wide short box).
  // Content well uses a solid ink fill so grain never elongates.
  const panel = document.createElement('div');
  panel.id = 'hellforge-quest-log';
  panel.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    `width:min(440px,88%);height:min(620px,86%);z-index:${Z.questLog};display:none;` +
    'border-radius:0;pointer-events:auto;box-sizing:border-box;' +
    'background:rgba(10,7,5,0.96);border:0;box-shadow:0 0 28px rgba(0,0,0,0.85);';

  const frame = document.createElement('img');
  frame.src = HudArt.panelQuest();
  frame.alt = '';
  frame.draggable = false;
  frame.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;z-index:0;';

  const well = document.createElement('div');
  well.style.cssText =
    'position:absolute;inset:48px 40px 52px;z-index:1;display:flex;flex-direction:column;' +
    'background:rgba(8,6,4,0.88);border:1px solid rgba(224,184,74,0.14);' +
    'padding:16px 18px 14px;box-sizing:border-box;' +
    panelScrollShellCss(520, 0);

  const title = document.createElement('div');
  title.textContent = '任务日志';
  title.style.cssText = panelTitleStyle() + 'font-size:17px;margin:0 0 12px;padding:0 0 10px;' +
    'border-bottom:1px solid rgba(224,184,74,0.35);flex:none;';

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;';

  well.append(title, list);
  panel.append(frame, well);
  mount.append(tracker, panel);

  let open = false;
  let last: readonly QuestViewModel[] = [];

  const paintTracker = (quests: readonly QuestViewModel[]): void => {
    tracker.replaceChildren();
    for (const q of quests) {
      if (q.status === 'available' || q.status === 'completed') continue;
      const row = document.createElement('div');
      row.style.cssText =
        `padding:8px 12px;border:1px solid ${Ui.goldLineSoft};` +
        `background:url('${HudArt.automapParchment()}') center/cover no-repeat,rgba(12,8,6,0.85);` +
        `font:600 12px ${FONT_UI};color:${Ui.text};line-height:1.4;` +
        'border-radius:0;text-shadow:0 1px 2px #000;';
      row.textContent = `${q.title} · ${STATUS_LABEL[q.status]}`;
      tracker.appendChild(row);
    }
  };

  const paintPanel = (quests: readonly QuestViewModel[]): void => {
    list.replaceChildren();
    for (const q of quests) {
      const card = document.createElement('div');
      card.style.cssText =
        `padding:12px 12px 10px;background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};` +
        'border-radius:2px;';
      const head = document.createElement('div');
      head.style.cssText =
        'display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px;';
      const name = document.createElement('span');
      name.textContent = q.title;
      name.style.cssText = `font:700 14px ${FONT_DISPLAY};color:${Ui.goldBright};letter-spacing:1px;`;
      const st = document.createElement('span');
      st.textContent = STATUS_LABEL[q.status];
      st.style.cssText = `font:700 11px ${FONT_UI};color:${STATUS_COLOR[q.status]};flex:none;`;
      head.append(name, st);
      const sum = document.createElement('div');
      sum.style.cssText = `font:500 13px ${FONT_UI};color:${Ui.text};line-height:1.55;`;
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
