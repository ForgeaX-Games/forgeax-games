// Cutscene DOM chrome — letterbox bars, fade cover, caption line. Dumb
// presenter: main.ts samples cutscene.ts each frame and pushes values here.
// Bars/captions ride CSS transitions; fade opacity is set per frame (cheap,
// no layout). Z slots come from the ui-theme ladder (below shell, above HUD).

import { FONT_DISPLAY, FONT_UI, Ui, Z } from './ui-theme';

export interface CutsceneUiHandle {
  /** 0..1 — bars ease themselves via CSS transform transitions. */
  setLetterbox(open: number): void;
  /** 0..1 cover opacity (set per frame from the timeline). */
  setFade(v: number): void;
  setCaption(cap: { text: string; sub?: string } | null): void;
  /** Instant reset to the idle/invisible state (skip or dispose path). */
  reset(): void;
  dispose(): void;
}

const ROOT_ID = 'hellforge-cutscene';
/** Bars cover this fraction of viewport height each (D2R cinematic ≈ 12%). */
const BAR_FRAC = 0.11;

export function installCutsceneUi(mount: HTMLElement = document.body): CutsceneUiHandle {
  document.getElementById(ROOT_ID)?.remove();
  const scoped = mount !== document.body;
  const pos = scoped ? 'absolute' : 'fixed';

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.style.cssText = `position:${pos};inset:0;z-index:${Z.cutsceneChrome};pointer-events:none;display:none;`;

  const mkBar = (edge: 'top' | 'bottom'): HTMLDivElement => {
    const bar = document.createElement('div');
    bar.style.cssText =
      `position:absolute;left:0;right:0;${edge}:0;height:${BAR_FRAC * 100}%;` +
      `background:#000;box-shadow:0 ${edge === 'top' ? '2px' : '-2px'} 0 ${Ui.goldLineSoft};` +
      'transition:transform 0.6s cubic-bezier(0.22,0.8,0.3,1);' +
      `transform:translateY(${edge === 'top' ? '-101%' : '101%'});`;
    return bar;
  };
  const barTop = mkBar('top');
  const barBottom = mkBar('bottom');

  const fade = document.createElement('div');
  fade.style.cssText = `position:${pos};inset:0;z-index:${Z.cutsceneChrome + 1};` +
    'background:#000;opacity:0;pointer-events:none;';

  const caption = document.createElement('div');
  caption.style.cssText =
    `position:absolute;left:50%;bottom:${BAR_FRAC * 100 + 3}%;transform:translateX(-50%);` +
    `z-index:${Z.cutsceneCaption};text-align:center;max-width:min(720px,86%);` +
    'opacity:0;transition:opacity 0.35s ease;pointer-events:none;';
  const captionText = document.createElement('div');
  captionText.style.cssText =
    `font:700 26px ${FONT_DISPLAY};color:${Ui.goldBright};letter-spacing:5px;` +
    'text-shadow:0 0 18px rgba(230,180,90,0.45),0 2px 8px #000;';
  const captionSub = document.createElement('div');
  captionSub.style.cssText =
    `font:600 13px ${FONT_UI};color:${Ui.textMuted};letter-spacing:2px;margin-top:6px;`;
  caption.append(captionText, captionSub);

  root.append(barTop, barBottom, fade, caption);
  mount.appendChild(root);

  let lastCaption: string | null = null;

  return {
    setLetterbox(open) {
      root.style.display = 'block';
      const on = open > 0.5;
      barTop.style.transform = on ? 'translateY(0%)' : 'translateY(-101%)';
      barBottom.style.transform = on ? 'translateY(0%)' : 'translateY(101%)';
    },
    setFade(v) {
      if (v > 0.001) root.style.display = 'block';
      fade.style.opacity = `${Math.max(0, Math.min(1, v))}`;
    },
    setCaption(cap) {
      const key = cap ? `${cap.text}|${cap.sub ?? ''}` : null;
      if (key === lastCaption) return;
      lastCaption = key;
      if (!cap) {
        caption.style.opacity = '0';
        return;
      }
      captionText.textContent = cap.text;
      captionSub.textContent = cap.sub ?? '';
      captionSub.style.display = cap.sub ? '' : 'none';
      caption.style.opacity = '1';
    },
    reset() {
      lastCaption = null;
      root.style.display = 'none';
      fade.style.opacity = '0';
      caption.style.opacity = '0';
      barTop.style.transform = 'translateY(-101%)';
      barBottom.style.transform = 'translateY(101%)';
    },
    dispose() { root.remove(); },
  };
}
