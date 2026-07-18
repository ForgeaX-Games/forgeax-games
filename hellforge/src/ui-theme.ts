// Hellforge UI theme — ClaudeCraft-adjacent forge-gold / ink / crimson tokens.
//
// One palette for Title, HUD chrome, inventory, and skill sheet. Layout shapes
// (D2 bottom bar, orb sizes) stay untouched; only color + border language unify.
// Prefer these tokens over ad-hoc hex so future recolors are one-file edits.

export const Ui = {
  // ── forged gold ──────────────────────────────────────────────────────────
  gold: '#e0b84a',
  goldBright: '#f5d878',
  goldDeep: '#8a5e18',
  goldDim: '#a88440',
  goldLine: 'rgba(224,184,74,0.72)',
  goldLineSoft: 'rgba(224,184,74,0.42)',
  goldFill: 'rgba(48,36,14,0.92)',

  // ── ink / parchment base ─────────────────────────────────────────────────
  ink: '#0a0706',
  inkPanel: 'rgba(16,11,8,0.96)',
  inkPanelHi: 'rgba(28,20,14,0.97)',
  inkWell: 'rgba(8,6,4,0.92)',
  text: '#f0e2c4',
  textMuted: '#b9a070',
  textDim: '#8a7a60',

  // ── crimson accent (blood-moon / forge heat) ──────────────────────────────
  crimson: '#c42822',
  crimsonSoft: 'rgba(196,40,34,0.55)',
  crimsonGlow: 'rgba(255,80,30,0.18)',

  // ── functional (keep readable; lightly gold-shifted) ──────────────────────
  hp: '#c45a3a',
  mp: '#4a6ec8',
  ok: '#8aff9a',
  danger: '#ff6a6a',
} as const;

export type UiToken = typeof Ui;

/**
 * Game-wide type stack — Song (宋体) for CJK, classic serif for Latin.
 * Latin faces first so English uses Times/Georgia; CJK falls through to Song.
 */
export const FONT_UI =
  "'Times New Roman','Georgia','Songti SC','STSong','SimSun','Noto Serif CJK SC','Source Han Serif SC',serif";

/** Display / titles — same Song + serif language as body (no sans / no Cinzel). */
export const FONT_DISPLAY = FONT_UI;

/** HUD numerals / compact chrome — serif too (no monospace). */
export const FONT_MONO = FONT_UI;

/** Shared panel chrome: ink fill + double gold rim (ClaudeCraft plaque feel). */
export function panelChrome(extra = ''): string {
  return (
    `background:linear-gradient(180deg,${Ui.inkPanelHi} 0%,${Ui.inkPanel} 100%);` +
    `border:2px solid ${Ui.gold};` +
    `box-shadow:0 0 0 1px ${Ui.goldDeep},0 10px 36px rgba(0,0,0,0.72),` +
    `inset 0 1px 0 ${Ui.goldLineSoft};` +
    `color:${Ui.text};` +
    extra
  );
}

/** Compact gold title row (inventory / skill headers). */
export function panelTitleStyle(): string {
  return `font:800 15px ${FONT_DISPLAY};letter-spacing:4px;color:${Ui.goldBright};` +
    `text-shadow:0 1px 0 ${Ui.goldDeep},0 0 12px ${Ui.crimsonGlow};`;
}

/** Metallic gold fill for large Title wordmarks (no filter required). */
export function metalGoldTextStyle(sizeClamp: string): string {
  return (
    `font-size:${sizeClamp};font-weight:900;letter-spacing:7px;line-height:1;` +
    `font-family:${FONT_DISPLAY};` +
    `background:linear-gradient(180deg,` +
    `${Ui.goldBright} 0%,#fff4c8 12%,${Ui.gold} 28%,${Ui.goldDeep} 52%,` +
    `#6a4210 68%,${Ui.gold} 84%,${Ui.goldBright} 100%);` +
    `-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;` +
    `filter:drop-shadow(0 2px 3px rgba(0,0,0,0.85)) drop-shadow(0 0 14px ${Ui.crimsonGlow});` +
    `position:relative;user-select:none;`
  );
}

/**
 * Round forge emblem (SVG) — sits behind Title wordmark.
 * Static geometry; no CSS filter thrash on the gameplay HUD path.
 */
export function forgeEmblemSvg(sizePx: number): string {
  const s = sizePx;
  return `<svg viewBox="0 0 200 200" width="${s}" height="${s}" aria-hidden="true">
  <defs>
    <radialGradient id="hf-em-core" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#3a1410"/>
      <stop offset="55%" stop-color="#120a08"/>
      <stop offset="100%" stop-color="#050304"/>
    </radialGradient>
    <linearGradient id="hf-em-ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${Ui.goldBright}"/>
      <stop offset="35%" stop-color="${Ui.gold}"/>
      <stop offset="70%" stop-color="${Ui.goldDeep}"/>
      <stop offset="100%" stop-color="${Ui.goldBright}"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="92" fill="url(#hf-em-core)" stroke="url(#hf-em-ring)" stroke-width="6"/>
  <circle cx="100" cy="100" r="78" fill="none" stroke="${Ui.goldDeep}" stroke-width="2" opacity="0.85"/>
  <circle cx="100" cy="100" r="68" fill="none" stroke="${Ui.crimson}" stroke-width="1.5" opacity="0.55"/>
  <!-- crossed forge marks -->
  <path d="M62 118 L100 52 L138 118" fill="none" stroke="url(#hf-em-ring)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M70 110 L130 110" fill="none" stroke="${Ui.goldDim}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="100" cy="96" r="8" fill="${Ui.crimson}" stroke="${Ui.goldBright}" stroke-width="1.5"/>
  <!-- rune ticks -->
  <g stroke="${Ui.goldDim}" stroke-width="2" stroke-linecap="round" opacity="0.75">
    <path d="M100 22 L100 34"/><path d="M100 166 L100 178"/>
    <path d="M22 100 L34 100"/><path d="M166 100 L178 100"/>
    <path d="M38 38 L48 48"/><path d="M152 152 L162 162"/>
    <path d="M162 38 L152 48"/><path d="M48 152 L38 162"/>
  </g>
</svg>`;
}
