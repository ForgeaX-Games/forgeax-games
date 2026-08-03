// Hellforge UI theme — ClaudeCraft-adjacent forge-gold / ink / crimson tokens.
//
// One palette for Title, HUD chrome, inventory, and skill sheet. Layout shapes
// (D2 bottom bar, orb sizes) stay untouched; only color + border language unify.
// Prefer these tokens over ad-hoc hex so future recolors are one-file edits.
//
// Also owns: Z-index ladder (Z), stone-craft helpers (grain / divider / corner
// ornaments), and the Cinzel display stack (assets/ui/fonts, OFL — injected by
// ui-styles.ts). Hardcoded hex outside this file is visual debt.

export const Ui = {
  // ── forged gold ──────────────────────────────────────────────────────────
  gold: '#e0b84a',
  goldBright: '#f5d878',
  goldDeep: '#8a5e18',
  /** Inventory well bezel — normal-state metal edge (k3 polish). */
  goldMetal: '#8a6828',
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

  // ── equipment comparison deltas ───────────────────────────────────────────
  deltaUp: '#8aff9a',
  deltaDown: '#ff6a6a',
  deltaFlat: '#998f7d',

  // ── skill-tree node states (Spec §7.1) ────────────────────────────────────
  skillLocked: '#3a3020',
  skillAvailable: '#e0b84a',
  skillInvested: '#f5d878',
  skillMaxed: '#ffe8a0',
} as const;

/** CSS color for compareItems polarity. */
export function deltaColor(polarity: 'positive' | 'negative' | 'neutral'): string {
  if (polarity === 'positive') return Ui.deltaUp;
  if (polarity === 'negative') return Ui.deltaDown;
  return Ui.deltaFlat;
}

export type UiToken = typeof Ui;

/**
 * Game-wide type stack — Song (宋体) for CJK, classic serif for Latin.
 * Latin faces first so English uses Times/Georgia; CJK falls through to Song.
 */
export const FONT_UI =
  "'Times New Roman','Georgia','Songti SC','STSong','SimSun','Noto Serif CJK SC','Source Han Serif SC',serif";

/**
 * Display / titles — Cinzel (OFL, bundled woff2) for Latin glyphs & numerals,
 * CJK falls through to Song. Injected by ui-styles.ts `ensureUiStyles()`.
 */
export const FONT_DISPLAY =
  "'Cinzel','Times New Roman','Georgia','Songti SC','STSong','SimSun','Noto Serif CJK SC','Source Han Serif SC',serif";

/** HUD numerals / compact chrome — serif too (no monospace). */
export const FONT_MONO = FONT_UI;

/**
 * uiRoot-local z-index ladder — SSOT for the whole UI stack (previously
 * scattered magic numbers, incl. cube-ui's legacy z-7000). Keep gaps for
 * future layers; never stack above `fatal`.
 */
export const Z = {
  atmosphere: 40,
  haze: 41,
  nameplate: 45, // above the 3D canvas, below the HUD
  hud: 50,
  inventory: 60,
  /** Left-docked camp stash — just above the inventory slab (dual-open pair). */
  stash: 61,
  questTracker: 90,
  automap: 110,
  skillPanel: 120,
  characterPanel: 125,
  questLog: 130,
  cube: 135,
  dialogue: 140,
  banner: 145,
  cutsceneChrome: 170,
  cutsceneCaption: 175,
  shell: 200,
  renderSettings: 220,
  tooltip: 230,
  transition: 250,
  fatal: 260,
} as const;

/**
 * aidiablo stone-panel recipe (1:1 from the reference project): three-layer
 * grain over a warm stone gradient. Used by full-height side panels
 * (inventory / character / skill) — NOT the carved-rim floating panels
 * (those stay on panelChrome).
 */
export function d2StonePanelCss(): string {
  return (
    'background:' +
    'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(18,14,8,0.05) 2px,rgba(18,14,8,0.05) 4px),' +
    'repeating-linear-gradient(90deg,transparent,transparent 3px,rgba(0,0,0,0.04) 3px,rgba(0,0,0,0.04) 6px),' +
    'linear-gradient(180deg,#3a3430 0%,#302a24 30%,#28221e 60%,#2a2420 100%);'
  );
}

/**
 * Panel title band (aidiablo recipe): 20px warm gold, letterspaced, over a
 * translucent center band. Pair with goldDividerHtml underneath.
 */
export function titleBandCss(): string {
  return (
    `font:700 20px ${FONT_DISPLAY};color:#d4b05a;letter-spacing:3px;text-align:center;` +
    'text-shadow:0 0 8px rgba(212,176,90,0.35),0 1px 3px rgba(0,0,0,0.8),0 0 2px rgba(212,176,90,0.2);' +
    'background:linear-gradient(90deg,transparent 0%,rgba(40,30,18,0.35) 15%,rgba(55,42,25,0.5) 50%,rgba(40,30,18,0.35) 85%,transparent 100%);'
  );
}

/**
 * Subtle stone grain layered over the ink gradient — D2 masonry feel with zero
 * art assets. Cheap (static gradients), safe on the gameplay HUD path.
 */
export function stoneGrainCss(): string {
  return (
    'background-image:' +
    'repeating-linear-gradient(0deg,rgba(255,240,200,0.035) 0 2px,transparent 2px 5px),' +
    'repeating-linear-gradient(90deg,rgba(0,0,0,0.07) 0 3px,transparent 3px 7px),' +
    `linear-gradient(180deg,${Ui.inkPanelHi} 0%,${Ui.inkPanel} 100%);`
  );
}

/**
 * Shared panel chrome: stone grain + CARVED METAL RIM (border-image gradient)
 * + inner bevel. The rim is the Diablo signature — thick bright-to-deep gold
 * with a dark lower bevel, not a hairline. Note: border-image paints square
 * corners (border-radius is ignored by design — D2 panels are square).
 */
export function panelChrome(extra = ''): string {
  return (
    stoneGrainCss() +
    'border:3px solid transparent;' +
    `border-image:linear-gradient(180deg,${Ui.goldBright} 0%,${Ui.gold} 22%,${Ui.goldDeep} 48%,#3a2a12 62%,${Ui.goldDim} 100%) 1;` +
    `box-shadow:0 0 0 1px ${Ui.goldDeep},0 12px 40px rgba(0,0,0,0.75),` +
    `inset 0 1px 0 ${Ui.goldLineSoft},inset 0 -2px 5px rgba(0,0,0,0.55),inset 0 0 26px rgba(0,0,0,0.45);` +
    `color:${Ui.text};` +
    extra
  );
}

/** Compact gold title row (inventory / skill headers). */
export function panelTitleStyle(): string {
  return `font:800 15px ${FONT_DISPLAY};letter-spacing:4px;color:${Ui.goldBright};` +
    `text-shadow:0 1px 0 ${Ui.goldDeep},0 0 12px ${Ui.crimsonGlow};`;
}

/**
 * Internal scroll shell for major panels (Spec §11 — 1280×720).
 * Caps height to the viewport and scrolls content instead of shrinking type.
 */
export function panelScrollShellCss(designMaxPx = 560, verticalPadPx = 48): string {
  return (
    `max-height:min(${designMaxPx}px,calc(100% - ${verticalPadPx}px));` +
    'overflow-x:hidden;overflow-y:auto;' +
    'overscroll-behavior:contain;-webkit-overflow-scrolling:touch;'
  );
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

/** Gold hairline divider with a centre diamond (aidiablo panel-header recipe). */
export function goldDividerHtml(marginV = 10): string {
  return (
    `<div style="position:relative;height:1px;margin:${marginV}px 8%;` +
    `background:linear-gradient(90deg,transparent,#4a3a20 15%,#7a6238 50%,#4a3a20 85%,transparent);">` +
    `<div style="position:absolute;left:50%;top:-4px;width:8px;height:8px;transform:translateX(-50%) rotate(45deg);` +
    `background:linear-gradient(135deg,#c8a040,#8a6828);border:1px solid #6a5020;` +
    `box-shadow:0 0 4px rgba(200,160,64,0.3);"></div></div>`
  );
}

/**
 * Four ornate corner brackets with an AMBER gem rivet at each elbow —
 * aidiablo's panel-corner recipe (layered stone Ls + radial gem + specular).
 * Parent must be positioned.
 */
export function cornerOrnamentsHtml(inset = 5, size = 24): string {
  const mk = (pos: string, rot: number): string =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ` +
    `style="position:absolute;${pos};pointer-events:none;transform:rotate(${rot}deg);">` +
    `<defs><radialGradient id="hf-gem" cx="40%" cy="40%" r="60%">` +
    `<stop offset="0%" stop-color="#e08848"/><stop offset="50%" stop-color="#a06030"/><stop offset="100%" stop-color="#603018"/>` +
    `</radialGradient></defs>` +
    `<path d="M4 20 L4 8 Q4 4 8 4 L20 4" fill="none" stroke="#4a4238" stroke-width="3.5"/>` +
    `<path d="M6 20 L6 9 Q6 6 9 6 L20 6" fill="none" stroke="#5e5448" stroke-width="2.2"/>` +
    `<path d="M8.5 20 L8.5 10.5 Q8.5 8.5 10.5 8.5 L20 8.5" fill="none" stroke="#6a6058" stroke-width="1.2"/>` +
    `<circle cx="5" cy="5" r="3" fill="#1a1816"/>` +
    `<circle cx="5" cy="5" r="2.5" fill="url(#hf-gem)"/>` +
    `<circle cx="4.2" cy="4.2" r="0.8" fill="rgba(255,200,160,0.7)"/>` +
    `</svg>`;
  return (
    mk(`left:${inset}px;top:${inset}px`, 0) +
    mk(`right:${inset}px;top:${inset}px`, 90) +
    mk(`right:${inset}px;bottom:${inset}px`, 180) +
    mk(`left:${inset}px;bottom:${inset}px`, 270)
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
