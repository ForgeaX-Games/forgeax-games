// D2R-inspired lower dialogue panel — exclusive major surface via UiLayerManager.
// Typewriter body (click anywhere on the panel to complete instantly); choice
// buttons ride the shared .hf-btn chrome.

import type { DialogueChoice, DialogueNode } from './dialogue';
import {
  FONT_DISPLAY, FONT_UI, Ui, Z, cornerOrnamentsHtml, panelChrome, panelScrollShellCss,
} from './ui-theme';
import { ensureUiStyles } from './ui-styles';

export interface DialogueHandle {
  show(node: DialogueNode): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export interface DialogueUiCallbacks {
  onChoice(choice: DialogueChoice): void;
}

/** ~55 chars/s — brisk enough that skipping is rarely needed. */
const TYPE_MS_PER_CHAR = 18;

export function installDialogueUi(
  mount: HTMLElement,
  cb: DialogueUiCallbacks,
): DialogueHandle {
  ensureUiStyles();
  const root = document.createElement('div');
  root.id = 'hellforge-dialogue';
  root.style.cssText =
    'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);' +
    `width:min(720px,92%);z-index:${Z.dialogue};display:none;pointer-events:auto;` +
    'border-radius:10px;padding:14px 18px 16px;' +
    panelChrome();
  root.insertAdjacentHTML('beforeend', cornerOrnamentsHtml());

  const speaker = document.createElement('div');
  speaker.style.cssText =
    `font:800 14px ${FONT_DISPLAY};color:${Ui.goldBright};letter-spacing:3px;` +
    'margin-bottom:8px;text-shadow:0 1px 2px #000;';

  const body = document.createElement('div');
  body.style.cssText =
    `font:500 15px ${FONT_UI};color:${Ui.text};line-height:1.55;min-height:48px;` +
    'margin-bottom:14px;' + panelScrollShellCss(160, 0);

  const choices = document.createElement('div');
  choices.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;';

  root.append(speaker, body, choices);
  mount.appendChild(root);

  let open = false;
  let typeTimer: number | undefined;
  let fullBody = '';

  const stopTyping = (): void => {
    if (typeTimer !== undefined) {
      window.clearInterval(typeTimer);
      typeTimer = undefined;
    }
  };
  const completeTyping = (): void => {
    stopTyping();
    body.textContent = fullBody;
  };
  // Click anywhere on the panel finishes the line (D2 click-to-advance feel).
  root.addEventListener('click', completeTyping);

  const startTyping = (text: string): void => {
    stopTyping();
    fullBody = text;
    let i = 0;
    body.textContent = '';
    typeTimer = window.setInterval(() => {
      i += 1;
      body.textContent = fullBody.slice(0, i);
      if (i >= fullBody.length) stopTyping();
    }, TYPE_MS_PER_CHAR);
  };

  const renderChoices = (node: DialogueNode): void => {
    choices.replaceChildren();
    for (const c of node.choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hf-btn';
      btn.textContent = c.label;
      btn.style.cssText = 'font-weight:700;font-size:13px;padding:8px 14px;';
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
      startTyping(node.body);
      renderChoices(node);
      root.style.display = 'block';
      open = true;
    },
    close() {
      stopTyping();
      root.style.display = 'none';
      open = false;
    },
    isOpen: () => open,
    dispose() {
      stopTyping();
      root.remove();
      open = false;
    },
  };
}
