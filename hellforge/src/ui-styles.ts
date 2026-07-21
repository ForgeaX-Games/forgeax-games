// Shared injected stylesheet — the ONE place class-based CSS lives for
// cross-cutting UI chrome (precedent: render-settings.ts). Layout stays inline
// cssText; stateful chrome (:hover/:active), @font-face and keyframes need a
// real stylesheet, so they collect here instead of proliferating JS hover
// handlers. Idempotent; every installer calls ensureUiStyles() first.

import { FONT_DISPLAY, FONT_UI, Ui, Z } from './ui-theme';

const STYLE_ID = 'hellforge-ui-style';

// See ui-icons.ts uiIconUrl for why base+concat (not a dynamic template URL).
const FONT_BASE = new URL('../assets/ui/fonts/', import.meta.url).href.replace(/\/?$/, '/');

function fontUrl(file: string): string {
  return FONT_BASE + file;
}

// Google Fonts unicode-range splits (see assets/ui/fonts/LICENSE-CINZEL.txt).
const CINZEL_LATIN_EXT_RANGE =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,' +
  'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const CINZEL_LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

function fontFace(file: string, range: string): string {
  return (
    '@font-face{' +
    "font-family:'Cinzel';font-style:normal;font-weight:400 900;font-display:swap;" +
    `src:url('${fontUrl(file)}') format('woff2');unicode-range:${range};}`
  );
}

/**
 * Inject the shared stylesheet once. Covers:
 *  • Cinzel @font-face (OFL; latin + latin-ext subsets)
 *  • .hf-btn — gold plaque button with hover glow / press settle
 *  • .hf-tip — global tooltip chrome (ui-tooltip.ts positions it)
 *  • .hf-fade — full-cover transition (ui-transition.ts drives opacity)
 *  • .hf-icon — <img> pixel-art rules
 *  • .hf-orb-wave — transform-only orb liquid drift (GPU-cheap; no filters,
 *    honouring the hud.ts rasterization warning)
 */
export function ensureUiStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent =
    fontFace('cinzel-latin-ext.woff2', CINZEL_LATIN_EXT_RANGE) +
    fontFace('cinzel-latin.woff2', CINZEL_LATIN_RANGE) +
    `
.hf-btn{position:relative;cursor:pointer;pointer-events:auto;user-select:none;
  background:linear-gradient(180deg,#2a2014 0%,#14100a 100%);
  border:1px solid ${Ui.goldLineSoft};border-radius:4px;color:${Ui.text};
  font-family:${FONT_UI};letter-spacing:3px;
  transition:border-color .15s,box-shadow .15s,color .15s,transform .06s;}
.hf-btn:hover{border-color:${Ui.gold};color:${Ui.goldBright};
  box-shadow:0 0 12px ${Ui.crimsonGlow},inset 0 0 10px rgba(224,184,74,0.10);}
.hf-btn:active{transform:scale(.97);}
.hf-btn:disabled,.hf-btn[aria-disabled="true"]{opacity:.45;cursor:not-allowed;
  box-shadow:none;color:${Ui.textMuted};}
.hf-btn--primary{background:linear-gradient(180deg,#3a2a12 0%,#1c130a 100%);
  border-color:${Ui.gold};color:${Ui.goldBright};font-family:${FONT_DISPLAY};}

.hf-tip{position:absolute;z-index:${Z.tooltip};display:none;pointer-events:none;
  min-width:220px;max-width:340px;width:max-content;padding:10px 14px;border-radius:2px;
  background:rgba(0,0,0,0.96);border:1px solid #5a3a1a;
  box-shadow:0 2px 10px rgba(0,0,0,0.9),inset 0 0 1px rgba(90,58,26,0.3);
  font:600 13px ${FONT_UI};line-height:1.65;color:#ddd;}

.hf-fade{position:absolute;inset:0;z-index:${Z.transition};pointer-events:none;
  background:#000;opacity:0;transition:opacity .35s ease;}

.hf-icon{image-rendering:auto;user-select:none;}

@keyframes hf-orb-wave1{
  0%{transform:translateX(0) rotate(0deg);}
  25%{transform:translateX(-4px) rotate(1.5deg);}
  50%{transform:translateX(2px) rotate(-1deg);}
  75%{transform:translateX(-2px) rotate(0.5deg);}
  100%{transform:translateX(0) rotate(0deg);}
}
@keyframes hf-orb-wave2{
  0%{transform:translateX(0) rotate(0deg);}
  25%{transform:translateX(3px) rotate(-1deg);}
  50%{transform:translateX(-3px) rotate(1.5deg);}
  75%{transform:translateX(2px) rotate(-0.5deg);}
  100%{transform:translateX(0) rotate(0deg);}
}
@keyframes hf-orb-glow{
  0%,100%{opacity:0.3;}
  50%{opacity:0.5;}
}
.hf-orb-wave1{animation:hf-orb-wave1 3.5s ease-in-out infinite;will-change:transform;}
.hf-orb-wave2{animation:hf-orb-wave2 2.8s ease-in-out infinite;will-change:transform;}
.hf-orb-glow{animation:hf-orb-glow 4s ease-in-out infinite;}

@keyframes hf-zone-card{
  0%{opacity:0;letter-spacing:16px;}
  18%{opacity:1;letter-spacing:8px;}
  82%{opacity:1;}
  100%{opacity:0;}
}
`;
  document.head.appendChild(s);
}
