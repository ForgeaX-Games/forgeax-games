/**
 * Light popup chrome (N2) — shared root/card CSS for high-frequency overlays.
 * Not a modal framework: callers own mount/lifecycle; this only styles.
 */

import {
  pointerPolicyFor,
  VISUAL_POLISH_Z,
  type PopupChromeKind,
  type PointerPolicy,
} from './visual-polish-contracts';
import { FONT_UI, panelChrome, Ui, Z } from './ui-theme';

export type PopupChromeStyles = {
  readonly kind: PopupChromeKind;
  readonly policy: PointerPolicy;
  readonly zIndex: number;
  readonly rootCss: string;
  readonly cardCss: string;
};

function zFor(kind: PopupChromeKind): number {
  if (kind === 'lootCelebration' || kind === 'forgeReveal') return VISUAL_POLISH_Z.lootCelebration;
  if (kind === 'levelOrQuestBanner') return Z.banner;
  if (kind === 'deathOrSaveError') return Z.fatal;
  return Z.dialogue;
}

/**
 * Build root + card CSS. `scoped` → absolute (uiMount); else fixed (body).
 * card-only: root pointer-events none; card must set pointer-events:auto.
 */
export function popupChromeStyles(
  kind: PopupChromeKind,
  opts?: { scoped?: boolean; side?: 'center' | 'right' },
): PopupChromeStyles {
  const policy = pointerPolicyFor(kind);
  const zIndex = zFor(kind);
  const pos = opts?.scoped ? 'absolute' : 'fixed';
  const side = opts?.side ?? (kind === 'lootCelebration' ? 'right' : 'center');

  const layout = side === 'right'
    ? 'align-items:flex-end;justify-content:flex-start;padding:72px 28px 28px;'
    : 'align-items:center;justify-content:center;padding:24px;';

  const blockingBg = policy === 'auto'
    ? `background:rgba(6,4,3,0.72);`
    : 'background:transparent;';

  const rootPe = policy === 'none' || policy === 'card-only' ? 'none' : 'auto';

  const rootCss =
    `position:${pos};inset:0;z-index:${zIndex};display:none;box-sizing:border-box;` +
    `pointer-events:${rootPe};user-select:none;font:600 13px ${FONT_UI};color:${Ui.text};` +
    layout + blockingBg;

  const cardCss =
    panelChrome() +
    'pointer-events:auto;display:flex;flex-direction:column;gap:8px;' +
    (side === 'right'
      ? 'min-width:260px;max-width:min(340px,42vw);padding:16px 20px 14px;text-align:left;'
      : 'min-width:240px;max-width:min(360px,86%);padding:16px 20px 14px;text-align:center;');

  return { kind, policy, zIndex, rootCss, cardCss };
}
