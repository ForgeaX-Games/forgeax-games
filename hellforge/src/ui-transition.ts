// Screen transitions — the missing shell primitive (shell switching was
// instant display-toggles; camp↔den teleports were snap cuts). One black
// cover + a D2-style zone card (gold Cinzel name on black, optional tip).
// Opacity-only CSS transitions; JS timers are cleared in dispose (HMR-safe).

import { FONT_DISPLAY, FONT_UI, Ui } from './ui-theme';
import { ensureUiStyles } from './ui-styles';

export interface ThroughBlackOpts {
  /** ms fully black before fading back (default 120). */
  holdMs?: number;
  fadeMs?: number;
}

export interface ZoneCardOpts {
  sub?: string;
  /** Bottom gameplay tip line (D2 loading-screen convention). */
  tip?: string;
  /** ms the card stays up before fading (default 900). */
  holdMs?: number;
}

export interface UiTransitionHandle {
  /** Fade to black → run midpoint (swap screens) → fade back. */
  throughBlack(midpoint: () => void, opts?: ThroughBlackOpts): Promise<void>;
  /** Instant black cover + animated zone name, then fade out. */
  zoneCard(name: string, opts?: ZoneCardOpts): Promise<void>;
  /** True while the black cover is (partially) up — main.ts gates world move on it. */
  coverUp(): boolean;
  dispose(): void;
}

const COVER_ID = 'hellforge-ui-transition';

export function installUiTransition(mount: HTMLElement = document.body): UiTransitionHandle {
  ensureUiStyles();
  document.getElementById(COVER_ID)?.remove();
  const scoped = mount !== document.body;
  const cover = document.createElement('div');
  cover.id = COVER_ID;
  cover.className = 'hf-fade';
  cover.style.position = scoped ? 'absolute' : 'fixed';
  mount.appendChild(cover);

  const card = document.createElement('div');
  card.style.cssText =
    'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:14px;text-align:center;pointer-events:none;';
  cover.appendChild(card);

  const timers = new Set<number>();
  const later = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = window.setTimeout(() => { timers.delete(t); resolve(); }, ms);
      timers.add(t);
    });

  const setOpacity = (v: number, fadeMs: number): void => {
    cover.style.transition = `opacity ${fadeMs}ms ease`;
    cover.style.opacity = `${v}`;
  };

  return {
    async throughBlack(midpoint, opts) {
      const fadeMs = opts?.fadeMs ?? 350;
      cover.style.pointerEvents = 'auto'; // swallow clicks mid-swap
      setOpacity(1, fadeMs);
      await later(fadeMs);
      midpoint();
      await later(opts?.holdMs ?? 120);
      setOpacity(0, fadeMs);
      await later(fadeMs);
      cover.style.pointerEvents = 'none';
    },

    async zoneCard(name, opts) {
      cover.style.pointerEvents = 'auto';
      cover.style.transition = 'none';
      cover.style.opacity = '1';
      card.innerHTML =
        `<div style="font:700 32px ${FONT_DISPLAY};color:#d4a853;letter-spacing:6px;` +
        `text-shadow:0 0 20px rgba(212,168,83,0.6),0 0 40px rgba(212,168,83,0.3);margin-bottom:18px;">${name}</div>` +
        (opts?.sub
          ? `<div style="font:600 14px ${FONT_DISPLAY};color:${Ui.textMuted};letter-spacing:4px;margin-bottom:22px;">${opts.sub}</div>`
          : '<div style="margin-bottom:22px;"></div>') +
        `<div style="width:320px;height:8px;border:1px solid #5a4a2a;border-radius:4px;background:#1a1209;` +
        `box-shadow:0 0 8px rgba(90,74,42,0.4);">` +
        `<div id="hf-zone-progress" style="height:100%;width:10%;border-radius:3px;` +
        `background:linear-gradient(90deg,#6b1a1a,#a83232,#6b1a1a);transition:width 0.2s;"></div></div>` +
        (opts?.tip
          ? `<div style="font:600 13px ${FONT_UI};color:#8a7a5a;margin-top:14px;letter-spacing:2px;">${opts.tip}</div>`
          : '');
      card.style.display = 'flex';
      // Loading-screen cadence: milestones 10/30/75/90/100 across the hold.
      const holdMs = opts?.holdMs ?? 900;
      const bar = card.querySelector<HTMLElement>('#hf-zone-progress');
      const milestones: Array<[number, number]> = [[0.15, 30], [0.45, 75], [0.7, 90], [0.9, 100]];
      for (const [frac, pct] of milestones) {
        const t = window.setTimeout(() => { if (bar) bar.style.width = `${pct}%`; }, holdMs * frac);
        timers.add(t);
      }
      await later(holdMs);
      setOpacity(0, 500);
      await later(500);
      card.style.display = 'none';
      card.innerHTML = '';
      cover.style.pointerEvents = 'none';
    },

    dispose() {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
      cover.remove();
    },
    coverUp: () => cover.style.opacity !== '0' && cover.style.opacity !== '',
  };
}
