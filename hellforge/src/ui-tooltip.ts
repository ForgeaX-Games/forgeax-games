// Global hover tooltip — one singleton per uiRoot, replacing native `title`
// attrs (hud.ts) and the panel-local tip (inventory-ui.ts). Screen-edge
// clamped; content is caller-built HTML (escaped at the source, same as the
// existing renderTipCol path). Positioned in mount-local coordinates.

import { ensureUiStyles } from './ui-styles';

export interface UiTooltipHandle {
  /** Show with content at client (page) coordinates. */
  show(content: string | Node, clientX: number, clientY: number): void;
  /** Reposition (call on mousemove). */
  move(clientX: number, clientY: number): void;
  hide(): void;
  dispose(): void;
}

const TIP_ID = 'hellforge-ui-tooltip';

/**
 * Install (or return the existing) tooltip for `mount`. The element is a
 * sibling of the installing panel so it stacks above every MajorPanel.
 */
export function installUiTooltip(mount: HTMLElement = document.body): UiTooltipHandle {
  ensureUiStyles();
  document.getElementById(TIP_ID)?.remove();
  const scoped = mount !== document.body;
  const el = document.createElement('div');
  el.id = TIP_ID;
  el.className = 'hf-tip';
  el.style.position = scoped ? 'absolute' : 'fixed';
  mount.appendChild(el);

  const place = (clientX: number, clientY: number): void => {
    if (el.style.display === 'none') return;
    const pad = 16;
    const m = scoped
      ? mount.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Prefer right-below of the cursor; flip left / up near edges.
    let x = clientX - m.left + pad;
    if (x + w > m.width - 8) x = clientX - m.left - w - pad;
    let y = clientY - m.top + pad;
    if (y + h > m.height - 8) y = clientY - m.top - h - pad;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;
  };

  return {
    show(content, clientX, clientY) {
      if (typeof content === 'string') el.innerHTML = content;
      else el.replaceChildren(content);
      el.style.display = 'block';
      place(clientX, clientY);
    },
    move: place,
    hide() { el.style.display = 'none'; },
    dispose() { el.remove(); },
  };
}
