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

export interface TooltipMountRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pure placement math (unit-tested): prefer right-below of the cursor, flip
 * left / up near edges, clamp ≥4px from the mount origin — and cap the tip to
 * a hard width budget (mount width − 2·pad) so it can never spill past the
 * mount's right edge (N3R G1: the diff bar shrinks/wraps instead of clipping).
 */
export function tooltipPlacement(
  clientX: number,
  clientY: number,
  tipWidth: number,
  tipHeight: number,
  m: TooltipMountRect,
  pad = 16,
): { left: number; top: number; maxWidth: number } {
  const maxWidth = Math.max(160, m.width - 2 * pad);
  const w = Math.min(tipWidth, maxWidth);
  let x = clientX - m.left + pad;
  if (x + w > m.width - 8) x = clientX - m.left - w - pad;
  let y = clientY - m.top + pad;
  if (y + tipHeight > m.height - 8) y = clientY - m.top - tipHeight - pad;
  return { left: Math.max(4, x), top: Math.max(4, y), maxWidth };
}

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
  // border-box so the inline width budget includes .hf-tip padding.
  el.style.boxSizing = 'border-box';
  mount.appendChild(el);

  const place = (clientX: number, clientY: number): void => {
    if (el.style.display === 'none') return;
    const m: TooltipMountRect = scoped
      ? mount.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    // Apply the width budget BEFORE measuring: the inline max-width overrides
    // the .hf-tip stylesheet cap, so offsetWidth reflects the true clamp.
    const budget = Math.max(160, m.width - 32);
    el.style.maxWidth = `${budget}px`;
    const p = tooltipPlacement(clientX, clientY, el.offsetWidth, el.offsetHeight, m);
    el.style.maxWidth = `${p.maxWidth}px`;
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
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
