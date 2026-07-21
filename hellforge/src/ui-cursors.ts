// Context cursors — gauntlet PNGs replace the OS arrow (assets are user-owned
// aidiablo AI art, see ui-icons.ts header). v1 wires a global default + text
// input caret; world-hover contexts (attack/loot/talk/portal) plug into
// setCursor() once a cheap hover seam exists (A2 HUD phase decision).

import { uiIconUrl } from './ui-icons';

export type CursorKind = 'default' | 'attack' | 'interact' | 'loot' | 'talk' | 'portal';

const CURSOR_ID = 'hellforge-ui-cursors';

function cssUrl(kind: CursorKind): string {
  // 32px source PNGs; hotspot near the fingertip (top-left-ish).
  return `url('${uiIconUrl(`cursors/${kind}.png`)}') 4 4, auto`;
}

export interface UiCursorHandle {
  /** Swap the world cursor context; 'default' restores. */
  setCursor(kind: CursorKind): void;
  dispose(): void;
}

/**
 * Install cursor rules: default gauntlet on body/canvas/uiRoot, text caret in
 * inputs. Buttons keep the gauntlet (D2 convention); world-hover contexts call
 * setCursor() once a cheap hover seam exists (A2 decision).
 */
export function installUiCursors(): UiCursorHandle {
  document.getElementById(CURSOR_ID)?.remove();
  const s = document.createElement('style');
  s.id = CURSOR_ID;
  let current: CursorKind = 'default';
  const render = (): void => {
    // One gauntlet everywhere (D2 convention — DOM buttons keep it too);
    // only text fields get the OS caret.
    s.textContent =
      `body,canvas,#game-ui-root,#game-ui-root *{cursor:${cssUrl(current)};}` +
      `input,textarea,[contenteditable="true"]{cursor:text !important;}`;
  };
  render();
  document.head.appendChild(s);
  return {
    setCursor(kind) {
      if (kind === current) return;
      current = kind;
      render();
    },
    dispose() { s.remove(); },
  };
}
