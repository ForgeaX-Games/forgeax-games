// D2R-inspired lower dialogue panel — exclusive major surface via UiLayerManager.

import type { DialogueChoice, DialogueNode } from './dialogue';
import { FONT_UI, Ui, panelScrollShellCss } from './ui-theme';

export interface DialogueHandle {
  show(node: DialogueNode): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface DialogueUiCallbacks {
  onChoice(choice: DialogueChoice): void;
}

export function installDialogueUi(
  mount: HTMLElement,
  cb: DialogueUiCallbacks,
): DialogueHandle {
  const root = document.createElement('div');
  root.id = 'hellforge-dialogue';
  root.style.cssText =
    'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);' +
    'width:min(720px,92%);z-index:140;display:none;pointer-events:auto;' +
    `background:${Ui.inkPanel};border:1px solid ${Ui.goldLine};` +
    `box-shadow:0 0 0 1px ${Ui.goldDeep},0 12px 36px rgba(0,0,0,0.55);` +
    'border-radius:4px;padding:14px 18px 16px;';

  const speaker = document.createElement('div');
  speaker.style.cssText =
    `font:800 13px ${FONT_UI};color:${Ui.goldBright};letter-spacing:2px;` +
    'margin-bottom:8px;text-shadow:0 1px 2px #000;';

  const body = document.createElement('div');
  body.style.cssText =
    `font:500 15px ${FONT_UI};color:${Ui.text};line-height:1.55;` +
    'margin-bottom:14px;' + panelScrollShellCss(160, 0);

  const choices = document.createElement('div');
  choices.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;';

  root.append(speaker, body, choices);
  mount.appendChild(root);

  let open = false;

  const renderChoices = (node: DialogueNode): void => {
    choices.replaceChildren();
    for (const c of node.choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = c.label;
      btn.style.cssText =
        `font:700 13px ${FONT_UI};padding:8px 14px;cursor:pointer;` +
        `color:${Ui.text};background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};` +
        'border-radius:3px;';
      btn.addEventListener('mouseenter', () => {
        btn.style.borderColor = Ui.gold;
        btn.style.color = Ui.goldBright;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = Ui.goldLineSoft;
        btn.style.color = Ui.text;
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        cb.onChoice(c);
      });
      choices.appendChild(btn);
    }
  };

  return {
    show(node) {
      speaker.textContent = node.speaker;
      body.textContent = node.body;
      renderChoices(node);
      root.style.display = 'block';
      open = true;
    },
    close() {
      root.style.display = 'none';
      open = false;
    },
    isOpen: () => open,
    dispose() {
      root.remove();
      open = false;
    },
  };
}
