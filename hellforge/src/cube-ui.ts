// Forge cube — 熔炉方块 (N2 dual-column + reveal state machine).
// Domain owns recipes (crafting.ts) and bag/material mutations; this panel
// enables buttons, previews yield/cost, and presents idle→resolving→reveal.

import {
  canFuse,
  canReroll,
  canSalvage,
  rarityStepUp,
  rerollCost,
  salvageYield,
  type MaterialCounts,
  type MaterialTier,
} from './crafting';
import { RARITY_META, type Item } from './items';
import type { BagAnchor } from './bag-grid';
import { FONT_DISPLAY, FONT_UI, goldDividerHtml, titleBandCss, Ui, Z } from './ui-theme';
import { ensureUiStyles } from './ui-styles';
import { itemWellCss } from './item-well';
import { HudArt } from './hud-art';
import { slotIconUrl } from './ui-icons';
import {
  assertForgeRevealDuration,
  FORGE_REVEAL_MS_MAX,
  FORGE_REVEAL_MS_MIN,
  forgePhaseAfterRevealAck,
  forgePhaseAfterRevealTimer,
  forgePhaseAfterSettlement,
  type ForgeActionKind,
  type ForgeVisualPhase,
} from './visual-polish-contracts';

const CUBE_COLS = 3;
const CUBE_ROWS = 4;
const CUBE_SLOTS = CUBE_COLS * CUBE_ROWS;
const PANEL_ID = 'hellforge-cube';
const FORGE_CRAFT_STYLE_ID = 'hellforge-cube-craft-anim';
/** Mid-band reveal duration (contract: 1200–1800ms). */
export const FORGE_REVEAL_MS = 1500;

const ACTION_LABEL: Readonly<Record<ForgeActionKind, string>> = {
  salvage: '拆解',
  reroll: '重铸',
  fuse: '合成',
};

// ── craft show (N2R 锤炼演出) ────────────────────────────────────────────────
//
// One master timeline (var(--hf-forge-ms) == FORGE_REVEAL_MS) drives every
// layer: hammer, sparks, well flash, shake and the stepped progress bar all
// keyframe off the same four impact frames, so the show can never drift out
// of phase with itself. The reveal timer owns when the show ENDS — the CSS
// only owns how it looks while resolving runs. Pure UI layer: no FxSystem,
// no material/passes — zero c0 compat surface by construction.

/**
 * Beat anchors (ms inside the master timeline). Strikes land at 16/36/56/76%
 * of FORGE_REVEAL_MS (240/540/840/1140 at 1500ms) — anticipation ~120ms
 * before each, climax (bigger, brighter) on the last.
 */
const FORGE_STRIKES_MS = [240, 540, 840, 1140] as const;

/** Reveal ack window — the closing beat after onPresent fires. */
export const FORGE_REVEAL_ACK_MS = 700;

type ForgePalette = { core: string; tails: readonly [string, string, string, string] };

/**
 * Per-action temperature: reroll stays in the gold-orange forge band,
 * salvage runs cold steel → ember red, fuse brightens toward step-up gold
 * (legendary orange on the final burst). Burst N reads its tail from --hf-cN.
 */
const FORGE_PALETTE: Readonly<Record<ForgeActionKind, ForgePalette>> = {
  salvage: { core: '#e8eef4', tails: ['#b8c4d0', '#d08048', '#c4441e', '#e05a28'] },
  reroll: { core: '#fff2c8', tails: ['#ff8c28', '#ff9a30', '#ffa838', '#ffc040'] },
  fuse: { core: '#fff0b8', tails: ['#e8c860', '#f5d878', '#ffb040', '#ffa028'] },
};

/** Inline custom properties carrying the action palette to every show layer. */
export function forgeCraftPaletteCss(action: ForgeActionKind): string {
  const p = FORGE_PALETTE[action];
  return `--hf-core:${p.core};--hf-c1:${p.tails[0]};--hf-c2:${p.tails[1]};` +
    `--hf-c3:${p.tails[2]};--hf-c4:${p.tails[3]};`;
}

/** Live-row inline vars — the master clock + palette every show layer reads. */
export function forgeCraftRowVars(action: ForgeActionKind): string {
  return `--hf-forge-ms:${FORGE_REVEAL_MS}ms;${forgeCraftPaletteCss(action)}`;
}

const FORGE_ANVIL_SVG =
  `<svg viewBox="0 0 120 64" width="100%" aria-hidden="true">` +
  `<defs>` +
  `<linearGradient id="hf-anvil-t" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0%" stop-color="#7a6e60"/><stop offset="100%" stop-color="#2a2320"/>` +
  `</linearGradient>` +
  `<linearGradient id="hf-anvil-b" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0%" stop-color="#4a4038"/><stop offset="100%" stop-color="#1a1410"/>` +
  `</linearGradient></defs>` +
  `<ellipse cx="60" cy="57" rx="44" ry="5" fill="rgba(0,0,0,0.55)"/>` +
  `<rect x="36" y="44" width="48" height="11" rx="2" fill="url(#hf-anvil-b)" stroke="#0a0806" stroke-width="1"/>` +
  `<path d="M48 44 L52 32 L68 32 L72 44 Z" fill="url(#hf-anvil-b)"/>` +
  `<path d="M106 23 L120 26.5 L106 32 Z" fill="url(#hf-anvil-t)" stroke="#0a0806" stroke-width="0.8"/>` +
  `<rect x="9" y="18" width="11" height="14" rx="2" fill="url(#hf-anvil-t)" stroke="#0a0806" stroke-width="0.8"/>` +
  `<rect x="14" y="22" width="93" height="10" rx="2" fill="url(#hf-anvil-t)" stroke="#0a0806" stroke-width="1"/>` +
  `<rect x="16" y="22.5" width="89" height="2.4" rx="1" fill="rgba(255,214,140,0.6)"/>` +
  `</svg>`;

/** Blacksmith hammer — pivot at the grip (17, 4); head hangs at the bottom. */
const FORGE_HAMMER_SVG =
  `<svg viewBox="0 0 34 110" aria-hidden="true">` +
  `<defs><linearGradient id="hf-ham-h" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0%" stop-color="#4a4038"/><stop offset="100%" stop-color="#1c1512"/>` +
  `</linearGradient></defs>` +
  `<rect x="14.2" y="2" width="6" height="88" rx="2" fill="#6b4a26"/>` +
  `<rect x="14.2" y="2" width="2.2" height="88" fill="rgba(255,220,160,0.16)"/>` +
  `<rect x="1" y="85" width="32" height="23" rx="2.5" fill="url(#hf-ham-h)" stroke="#0e0a06" stroke-width="1.2"/>` +
  `<rect x="1" y="85" width="32" height="3.6" rx="1.7" fill="rgba(255,205,130,0.5)"/>` +
  `<rect x="12" y="0.5" width="10" height="7" rx="2" fill="#3a2c1a" stroke="#171006" stroke-width="0.8"/>` +
  `</svg>`;

/** Salvage: three jagged cracks — flash at pulses 1/2/3, hold as scars,
    re-flash at the shatter frame, die with the workpiece. */
const FORGE_CRACKS_SVG = ((): string => {
  const cracks = [
    'M96 58 L82 112 L102 160 L86 214 L104 264 L90 320',
    'M150 42 L164 98 L144 152 L160 208 L146 260 L158 332',
    'M208 68 L194 122 L214 172 L198 226 L216 278',
  ];
  const paths = cracks
    .map((d, i) =>
      `<path d="${d}" class="hf-crack hf-crack-${i + 1}" fill="none" ` +
      `stroke="var(--hf-c${i + 1})" stroke-width="4.5" stroke-opacity="0.26" stroke-linecap="round" ` +
      `stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
      `<path d="${d}" class="hf-crack hf-crack-${i + 1}" fill="none" ` +
      `stroke="var(--hf-c${i + 1})" stroke-width="1.7" stroke-linecap="round" ` +
      `stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`)
    .join('');
  return `<svg class="hf-forge-cracks" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
})();

/** Fuse: three streams from the top-row wells converging on the workpiece. */
const FORGE_STREAMS_SVG = ((): string => {
  const streams = [
    'M50 48 C 64 118, 112 162, 150 204',
    'M150 48 C 150 112, 150 162, 150 204',
    'M250 48 C 236 118, 188 162, 150 204',
  ];
  const paths = streams
    .map((d, i) => {
      const delay = i * 120;
      return (
        `<path d="${d}" class="hf-stream" style="animation-delay:${delay}ms" pathLength="1" fill="none" ` +
        `stroke="var(--hf-c3)" stroke-width="6" stroke-opacity="0.3" stroke-linecap="round" ` +
        `vector-effect="non-scaling-stroke"/>` +
        `<path d="${d}" class="hf-stream" style="animation-delay:${delay}ms" pathLength="1" fill="none" ` +
        `stroke="var(--hf-core)" stroke-width="2.2" stroke-linecap="round" ` +
        `vector-effect="non-scaling-stroke"/>`
      );
    })
    .join('');
  return `<svg class="hf-forge-streams" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
})();

/**
 * Deterministic spark fan — no RNG so tests and screenshots are stable.
 * Bursts escalate 8/10/12/14 on an up-fan (-155°..-25°) with a gravity arc
 * (--dx2/--dy2 pull down); color comes from the palette via --t:var(--hf-cN).
 * Salvage's terminal burst is wider and denser — the workpiece SHATTERS.
 */
function forgeSparkDivs(action: ForgeActionKind): string {
  const out: string[] = [];
  /** Escalating burst sizes — the show builds toward the climax strike. */
  const counts = [8, 10, 12, 14];
  for (let b = 0; b < 4; b++) {
    const shatter = action === 'salvage' && b === 3;
    const count = shatter ? 16 : counts[b]!;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const ang = ((shatter ? -170 + t * 160 : -155 + t * 130) * Math.PI) / 180;
      const dist = (shatter ? 34 : 26) + ((b * 13 + i * 29) % 34);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.9;
      const dx2 = dx * 1.5;
      const dy2 = dy * 0.4 + dist * 0.85;
      const rot = ((b * 47 + i * 31) % 140) - 70;
      out.push(
        `<i class="hf-forge-spark hf-sp-b${b + 1}" style="--t:var(--hf-c${b + 1});` +
        `--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;--dx2:${dx2.toFixed(1)}px;` +
        `--dy2:${dy2.toFixed(1)}px;--rot:${rot}deg"></i>`,
      );
    }
  }
  return out.join('');
}

/** Ambient embers — slow rise on their own loop, staggered by negative delay. */
const FORGE_EMBERS_HTML = (
  [
    ['38%', '-0.4s', '-9px'],
    ['46%', '-1.2s', '8px'],
    ['52%', '-2.1s', '-6px'],
    ['59%', '-2.8s', '10px'],
    ['65%', '-1.7s', '-8px'],
  ] as const
)
  .map(
    ([x, d, sway]) =>
      `<i class="hf-forge-ember" style="--ex:${x};--ed:${d};--sway:${sway}"></i>`,
  )
  .join('');

/** 15px caption glyph per action — hammer / shard / tri-flame. */
const ACTION_ICON: Readonly<Record<ForgeActionKind, string>> = {
  reroll:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">` +
    `<path d="M3.5 12.5 L9.2 6.8" stroke-width="1.6"/><path d="M8 3.4 L12.6 8" stroke-width="3"/></svg>`,
  salvage:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="M8 2 L12 6 L9 14 L7 9 L3 7 Z"/></svg>`,
  fuse:
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ` +
    `stroke-linecap="round" aria-hidden="true">` +
    `<path d="M3 3 L8 8 M13 3 L8 8 M8 8 L8 14"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>`,
};

/**
 * Stage markup — mounted inside the grid wrapper (strike point == grid center
 * == the workpiece). Sibling of the row overlay; both sample the palette and
 * master clock from the live row, and data-action is repeated here so branch
 * CSS works on either subtree.
 */
export function forgeCraftStageHtml(action: ForgeActionKind): string {
  const branch =
    action === 'salvage'
      ? FORGE_CRACKS_SVG + '<div class="hf-forge-shatter"></div>'
      : action === 'fuse'
        ? FORGE_STREAMS_SVG + '<div class="hf-forge-coalesce"></div>'
        : '';
  return (
    `<div class="hf-forge-stage" data-action="${action}" aria-hidden="true">` +
    '<div class="hf-forge-gridglow"></div>' +
    branch +
    `<div class="hf-forge-anvil">${FORGE_ANVIL_SVG}</div>` +
    `<div class="hf-forge-hammer">${FORGE_HAMMER_SVG}</div>` +
    '<div class="hf-forge-flash"></div>' +
    '<div class="hf-forge-ring"></div>' +
    forgeSparkDivs(action) +
    '<div class="hf-forge-bloom"></div>' +
    FORGE_EMBERS_HTML +
    '</div>'
  );
}

/**
 * Row overlay markup — backdrop focus, caption + phase-locked progress bar
 * (resolving), or the result-tinted ack flash (reveal). pointer-events:none
 * everywhere: the close button and locked wells stay reachable per contract.
 */
export function forgeCraftOverlayHtml(
  action: ForgeActionKind,
  phase: 'resolving' | 'reveal',
  tint?: string,
): string {
  if (phase === 'reveal') {
    const color = tint ?? '#ffd066';
    return (
      `<div class="hf-forge-craft hf-forge-reveal" data-action="${action}" aria-live="polite">` +
      `<div class="hf-forge-reveal-glow" style="--hf-tint:${color}"></div>` +
      `<div class="hf-forge-caption hf-forge-caption-reveal" style="color:${color}">` +
      `${ACTION_ICON[action]}${ACTION_LABEL[action]}完成</div>` +
      `</div>`
    );
  }
  return (
    `<div class="hf-forge-craft" data-action="${action}" aria-live="polite">` +
    '<div class="hf-forge-backglow"></div>' +
    '<div class="hf-forge-heatrise"></div>' +
    `<div class="hf-forge-caption">${ACTION_ICON[action]}锤炼中 · ${ACTION_LABEL[action]}</div>` +
    '<div class="hf-forge-bar"><i></i></div>' +
    '</div>'
  );
}

/** Craft-show stylesheet — regenerated from FORGE_REVEAL_MS so beats scale. */
export function forgeCraftStyleText(): string {
  const p = (ms: number): string => `${((ms / FORGE_REVEAL_MS) * 100).toFixed(2)}%`;
  const [s1, s2, s3, s4] = FORGE_STRIKES_MS;

  /** White-hot flash spike at the workpiece for one impact frame. */
  const flashSpike = (s: number, peak: number, scale: number): string => `
  ${p(s - 20)} { opacity: 0; transform: translate(-50%, -50%) scale(${(scale * 0.6).toFixed(2)}); }
  ${p(s)} { opacity: ${peak}; transform: translate(-50%, -50%) scale(${scale}); }
  ${p(s + 60)} { opacity: 0; transform: translate(-50%, -50%) scale(${(scale * 1.15).toFixed(2)}); }`;

  /** Well-rim heat ring spike (white-hot regardless of action palette). */
  const glowSpike = (s: number, a: number): string => `
  ${p(s - 20)} { box-shadow: inset 0 0 0 1.5px rgba(255,240,205,0), inset 0 0 16px rgba(255,190,90,0); }
  ${p(s)} { box-shadow: inset 0 0 0 1.5px rgba(255,240,205,${a}), inset 0 0 18px rgba(255,190,90,${(a * 0.45).toFixed(2)}); }
  ${p(s + 70)} { box-shadow: inset 0 0 0 1.5px rgba(255,240,205,0), inset 0 0 16px rgba(255,190,90,0); }`;

  /** Backdrop warm-pulse spike (returns to the 0.14 resting glow). */
  const backSpike = (s: number, peak: number): string => `
  ${p(s - 25)} { opacity: 0.14; }
  ${p(s)} { opacity: ${peak}; }
  ${p(s + 80)} { opacity: 0.14; }`;

  /** Workpiece shudder for one impact (pixel-grade, settles fast). */
  const shakeHit = (s: number, amp: number, settle: number): string => `
  ${p(s)} { transform: translate(0, 0); animation-timing-function: ease-out; }
  ${p(s + 30)} { transform: translate(${(amp * 0.4).toFixed(1)}px, ${amp}px); }
  ${p(s + settle)} { transform: translate(0, 0); }`;

  /** Spark burst at one impact frame; `big` = climax window. The p(s) frame
      must restate the transform — a missing property interpolates across the
      whole 0%→p(s+70) span, which had sparks mid-flight at the impact frame. */
  const sparkBurst = (b: number, s: number, big: boolean): string => `
@keyframes hf-spark-b${b} {
  0%, ${p(s - 8)} { opacity: 0; transform: translate(0, 0) rotate(var(--rot, 0deg)) scale(0.5); }
  ${p(s)} { opacity: 1; transform: translate(0, 0) rotate(var(--rot, 0deg)) scale(0.6); }
  ${p(s + (big ? 90 : 70))} { opacity: 0.85; transform: translate(var(--dx), var(--dy)) rotate(var(--rot, 0deg)) scale(1); }
  ${p(s + (big ? 200 : 150))}, 100% { opacity: 0; transform: translate(var(--dx2), var(--dy2)) rotate(var(--rot, 0deg)) scale(0.35); }
}`;

  return `
/* N2R craft show — one master clock (var(--hf-forge-ms)); impact frames at
   ${FORGE_STRIKES_MS.join('/')}ms shared by hammer / sparks / flash / bar / shake. */
@keyframes hf-forge-hammer {
  0% { transform: rotate(-56deg); animation-timing-function: ease-out; }
  ${p(s1! - 120)} { transform: rotate(-70deg); animation-timing-function: cubic-bezier(0.55, 0, 0.9, 0.45); }
  ${p(s1!)} { transform: rotate(-4deg); animation-timing-function: ease-out; }
  ${p(s1! + 45)} { transform: rotate(-16deg); animation-timing-function: ease-in-out; }
  ${p(s2! - 120)} { transform: rotate(-64deg); animation-timing-function: cubic-bezier(0.55, 0, 0.9, 0.45); }
  ${p(s2!)} { transform: rotate(-4deg); animation-timing-function: ease-out; }
  ${p(s2! + 45)} { transform: rotate(-16deg); animation-timing-function: ease-in-out; }
  ${p(s3! - 120)} { transform: rotate(-64deg); animation-timing-function: cubic-bezier(0.55, 0, 0.9, 0.45); }
  ${p(s3!)} { transform: rotate(-4deg); animation-timing-function: ease-out; }
  ${p(s3! + 45)} { transform: rotate(-16deg); animation-timing-function: ease-in-out; }
  ${p(s4! - 150)} { transform: rotate(-72deg); animation-timing-function: cubic-bezier(0.6, 0, 0.92, 0.5); }
  ${p(s4!)} { transform: rotate(-2deg); animation-timing-function: ease-out; }
  ${p(s4! + 60)} { transform: rotate(-14deg); animation-timing-function: ease-in-out; }
  97%, 100% { transform: rotate(-56deg); }
}
@keyframes hf-forge-hammer-fuse {
  0%, ${p(s4! - 210)} { transform: rotate(-56deg); animation-timing-function: ease-out; }
  ${p(s4! - 150)} { transform: rotate(-72deg); animation-timing-function: cubic-bezier(0.6, 0, 0.92, 0.5); }
  ${p(s4!)} { transform: rotate(-2deg); animation-timing-function: ease-out; }
  ${p(s4! + 60)} { transform: rotate(-14deg); animation-timing-function: ease-in-out; }
  97%, 100% { transform: rotate(-56deg); }
}
/* Hammer-head glint — a separate filter-only track so the transform
   interpolation above is never disturbed (same missing-keyframe trap). */
@keyframes hf-forge-hammer-glint {
  0%, 100% { filter: brightness(1); }
  ${[s1, s2, s3, s4].map((s) => `
  ${p(s! - 12)} { filter: brightness(1); }
  ${p(s!)} { filter: brightness(1.55); }
  ${p(s! + 45)} { filter: brightness(1); }`).join('')}
}
${sparkBurst(1, s1!, false)}
${sparkBurst(2, s2!, false)}
${sparkBurst(3, s3!, false)}
${sparkBurst(4, s4!, true)}
@keyframes hf-forge-flash {
  0% { opacity: 0; }
  ${flashSpike(s1!, 0.7, 0.85)}
  ${flashSpike(s2!, 0.75, 0.9)}
  ${flashSpike(s3!, 0.75, 0.9)}
  ${flashSpike(s4!, 0.78, 1.15)}
  100% { opacity: 0; }
}
@keyframes hf-forge-flash-fuse {
  0%, ${p(s4! - 30)} { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  ${p(s4!)} { opacity: 1; transform: translate(-50%, -50%) scale(1.35); }
  ${p(s4! + 90)}, 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
}
@keyframes hf-forge-gridglow {
  0%, 100% { box-shadow: inset 0 0 0 1.5px rgba(255,240,205,0), inset 0 0 16px rgba(255,190,90,0); }
  ${glowSpike(s1!, 0.5)}
  ${glowSpike(s2!, 0.55)}
  ${glowSpike(s3!, 0.55)}
  ${glowSpike(s4!, 0.85)}
}
@keyframes hf-forge-ring {
  0%, ${p(s4! - 8)} { opacity: 0; transform: translate(-50%, -50%) scale(0.15); }
  ${p(s4!)} { opacity: 0.9; transform: translate(-50%, -50%) scale(0.15); }
  ${p(s4! + 190)}, 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
}
@keyframes hf-forge-bloom {
  0%, ${p(s4! - 8)} { opacity: 0; }
  ${p(s4! + 25)} { opacity: 0.42; }
  ${p(s4! + 140)}, 100% { opacity: 0; }
}
@keyframes hf-forge-shake {
  0%, 100% { transform: translate(0, 0); }
  ${shakeHit(s1!, 1.5, 90)}
  ${shakeHit(s2!, 1.5, 90)}
  ${shakeHit(s3!, 2, 100)}
  ${shakeHit(s4!, 3, 140)}
}
@keyframes hf-forge-bar-fill {
  0% { transform: scaleX(0.02); }
  ${p(s1! - 24)} { transform: scaleX(0.04); }
  ${p(s1! + 24)} { transform: scaleX(0.22); }
  ${p(s2! - 24)} { transform: scaleX(0.24); }
  ${p(s2! + 24)} { transform: scaleX(0.46); }
  ${p(s3! - 24)} { transform: scaleX(0.48); }
  ${p(s3! + 24)} { transform: scaleX(0.7); }
  ${p(s4! - 24)} { transform: scaleX(0.73); }
  ${p(s4! + 24)} { transform: scaleX(1); }
  100% { transform: scaleX(1); }
}
@keyframes hf-forge-backglow {
  0%, 100% { opacity: 0.14; }
  ${backSpike(s1!, 0.22)}
  ${backSpike(s2!, 0.22)}
  ${backSpike(s3!, 0.24)}
  ${backSpike(s4!, 0.42)}
}
@keyframes hf-forge-heatrise {
  0%, ${p(s4! - 90)} { opacity: 0; }
  ${p(s4! + 30)} { opacity: 1; }
  ${p(FORGE_REVEAL_MS - 60)}, 100% { opacity: 0; }
}
/* Salvage cracks ACCUMULATE: each fracture flashes in at its pulse, holds a
   visible scar, re-flashes at the shatter frame, then dies with the workpiece. */
${[s1, s2, s3].map((s, i) => `
@keyframes hf-crack-${i + 1} {
  0%, ${p(s! - 12)} { opacity: 0; }
  ${p(s!)} { opacity: 0.95; }
  ${p(s! + 70)} { opacity: 0.45; }
  ${p(s4! - 10)} { opacity: 0.45; }
  ${p(s4!)} { opacity: 0.9; }
  ${p(s4! + 60)}, 100% { opacity: 0; }
}`).join('')}
@keyframes hf-stream-draw {
  0%, 12% { stroke-dashoffset: 1; opacity: 0; }
  15% { opacity: 1; }
  58% { stroke-dashoffset: 0.02; opacity: 1; }
  80% { opacity: 0.9; }
  90%, 100% { stroke-dashoffset: 0; opacity: 0; }
}
@keyframes hf-forge-coalesce {
  0%, ${p(s3! - 60)} { opacity: 0; transform: translate(-50%, -50%) scale(0.35) rotate(0deg); }
  ${p(s4! - 90)} { opacity: 0.5; transform: translate(-50%, -50%) scale(0.55) rotate(60deg); }
  ${p(s4!)} { opacity: 0.95; transform: translate(-50%, -50%) scale(1) rotate(170deg); }
  ${p(s4! + 180)}, 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.25) rotate(240deg); }
}
@keyframes hf-forge-wellignite {
  0%, 8% { filter: brightness(1); }
  14% { filter: brightness(1.7); }
  30%, 100% { filter: brightness(1.15); }
}
@keyframes hf-forge-shatter {
  0%, ${p(s4! - 10)} { opacity: 0; }
  ${p(s4!)} { opacity: 0.6; }
  ${p(s4! + 60)}, 100% { opacity: 0; }
}
@keyframes hf-ember {
  /* calc-multiply needs Chrome 111+; on older engines only the final sway
     frame degrades, and opacity is already 0 there — no visible fallout. */
  0% { opacity: 0; transform: translate(-50%, 0) translateX(0); }
  12% { opacity: 0.55; }
  60% { opacity: 0.4; transform: translate(-50%, -140px) translateX(var(--sway)); }
  100% { opacity: 0; transform: translate(-50%, -240px) translateX(calc(var(--sway) * -0.6)); }
}
@keyframes hf-forge-reveal-glow {
  0% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.55); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.35); }
}
@keyframes hf-forge-reveal-caption {
  0% { opacity: 0; transform: translate(-50%, calc(-50% + 8px)) scale(0.94); }
  22% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  78% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.02); }
}
@keyframes hf-forge-fadein {
  from { opacity: 0; }
  to { opacity: 1; }
}
.hf-forge-craft {
  position: absolute; inset: 0; z-index: 6; pointer-events: none;
  background: radial-gradient(ellipse at 26% 44%, rgba(62,32,10,0.5) 0%, rgba(12,8,5,0.4) 58%, rgba(8,6,4,0.24) 100%);
  animation: hf-forge-fadein 90ms ease-out both;
}
.hf-forge-craft.hf-forge-reveal {
  background: radial-gradient(ellipse at 50% 44%, rgba(30,20,10,0.28) 0%, rgba(8,6,4,0.12) 70%);
}
.hf-forge-stage {
  position: absolute; inset: 0; z-index: 7; pointer-events: none;
}
.hf-forge-gridglow {
  position: absolute; left: 0; top: 50%; width: 100%; aspect-ratio: 3/4;
  transform: translateY(-50%); border-radius: 2px;
  animation: hf-forge-gridglow var(--hf-forge-ms) linear both;
}
.hf-forge-cracks, .hf-forge-streams {
  display: none; position: absolute; left: 0; top: 50%; width: 100%;
  aspect-ratio: 3/4; transform: translateY(-50%);
}
[data-action='salvage'] .hf-forge-cracks, [data-action='fuse'] .hf-forge-streams { display: block; }
.hf-crack { opacity: 0; }
.hf-crack-1 { animation: hf-crack-1 var(--hf-forge-ms) linear both; }
.hf-crack-2 { animation: hf-crack-2 var(--hf-forge-ms) linear both; }
.hf-crack-3 { animation: hf-crack-3 var(--hf-forge-ms) linear both; }
.hf-stream {
  stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0;
  animation: hf-stream-draw var(--hf-forge-ms) linear both;
}
.hf-forge-coalesce {
  display: none; position: absolute; left: 50%; top: 50%; width: 34%; aspect-ratio: 1;
  border-radius: 50%; opacity: 0;
  background: conic-gradient(from 0deg, transparent, var(--hf-c4) 12%, transparent 40%, transparent 55%, var(--hf-c3) 68%, transparent 92%);
  animation: hf-forge-coalesce var(--hf-forge-ms) linear both;
}
[data-action='fuse'] .hf-forge-coalesce { display: block; }
.hf-forge-anvil {
  position: absolute; left: 50%; top: 50%; width: 60%;
  transform: translate(-50%, -34%);
}
.hf-forge-anvil > svg { display: block; width: 100%; height: auto; filter: drop-shadow(0 3px 4px rgba(0,0,0,0.6)); }
.hf-forge-hammer {
  position: absolute; left: 54%; top: 26%; width: 0; height: 26%;
  transform-origin: 0 0;
  animation: hf-forge-hammer var(--hf-forge-ms) cubic-bezier(0.4, 0, 0.6, 1) both,
    hf-forge-hammer-glint var(--hf-forge-ms) linear both;
}
.hf-forge-hammer > svg {
  position: absolute; left: 0; top: 0; transform: translate(-50%, -4%);
  height: 100%; width: auto;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.65));
}
[data-action='salvage'] .hf-forge-hammer { display: none; }
[data-action='fuse'] .hf-forge-hammer { animation-name: hf-forge-hammer-fuse, hf-forge-hammer-glint; }
[data-action='fuse'] .hf-forge-flash { animation-name: hf-forge-flash-fuse; }
[data-action='fuse'] .hf-sp-b1, [data-action='fuse'] .hf-sp-b2, [data-action='fuse'] .hf-sp-b3 { display: none; }
[data-action='salvage'] .hf-forge-spark { border-radius: 1px; }
[data-action='salvage'] .hf-sp-b4 { width: 6px; height: 6px; margin: -3px 0 0 -3px; }
.hf-forge-shatter {
  display: none; position: absolute; left: 0; top: 50%; width: 100%;
  aspect-ratio: 3/4; transform: translateY(-50%); opacity: 0;
  background: radial-gradient(circle at 50% 50%, rgba(255,250,240,0.9) 0%, rgba(255,200,140,0.35) 40%, transparent 65%);
  animation: hf-forge-shatter var(--hf-forge-ms) linear both;
}
[data-action='salvage'] .hf-forge-shatter { display: block; }
.hf-forge-flash {
  position: absolute; left: 50%; top: 50%; width: 44%; aspect-ratio: 1;
  border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, rgba(255,246,220,0.95) 0%, rgba(255,190,100,0.4) 28%, transparent 55%);
  animation: hf-forge-flash var(--hf-forge-ms) linear both;
}
.hf-forge-ring {
  position: absolute; left: 50%; top: 50%; width: 72%; aspect-ratio: 1;
  border: 2px solid rgba(255,220,150,0.75); border-radius: 50%; opacity: 0;
  animation: hf-forge-ring var(--hf-forge-ms) ease-out both;
}
.hf-forge-bloom {
  position: absolute; left: 50%; top: 50%; width: 95%; aspect-ratio: 1;
  transform: translate(-50%, -50%); border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, rgba(255,238,190,0.8) 0%, rgba(255,170,70,0.26) 36%, transparent 60%);
  animation: hf-forge-bloom var(--hf-forge-ms) linear both;
}
.hf-forge-spark {
  position: absolute; left: 50%; top: 50%; width: 4px; height: 4px;
  margin: -2px 0 0 -2px; border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, var(--hf-core, #fff2c8) 0%, var(--t, #ff9a30) 55%, transparent 75%);
  box-shadow: 0 0 6px var(--t, #ff9a30);
}
.hf-sp-b1 { animation: hf-spark-b1 var(--hf-forge-ms) linear both; }
.hf-sp-b2 { animation: hf-spark-b2 var(--hf-forge-ms) linear both; }
.hf-sp-b3 { animation: hf-spark-b3 var(--hf-forge-ms) linear both; }
.hf-sp-b4 { animation: hf-spark-b4 var(--hf-forge-ms) linear both; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; }
.hf-forge-ember {
  position: absolute; left: var(--ex); top: 64%; width: 3px; height: 3px;
  border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, #ffd890, rgba(255,140,50,0));
  animation: hf-ember 3.4s linear infinite; animation-delay: var(--ed);
}
.hf-forge-backglow {
  position: absolute; inset: 0; opacity: 0.14;
  background: radial-gradient(ellipse at 26% 46%, rgba(255,150,50,0.55) 0%, rgba(160,70,20,0.22) 45%, transparent 75%);
  animation: hf-forge-backglow var(--hf-forge-ms) linear both;
}
.hf-forge-heatrise {
  position: absolute; left: 0; right: 0; bottom: 0; height: 34%; opacity: 0;
  background: linear-gradient(0deg, rgba(255,110,30,0.25), transparent 80%);
  animation: hf-forge-heatrise var(--hf-forge-ms) linear both;
}
.hf-forge-caption {
  position: absolute; left: 50%; bottom: 14.5%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; white-space: nowrap;
  font: 700 15px ${FONT_DISPLAY}; letter-spacing: 3px; color: ${Ui.goldBright};
  text-shadow: 0 1px 0 ${Ui.goldDeep}, 0 0 14px rgba(255,140,40,0.5), 0 2px 4px rgba(0,0,0,0.7);
}
.hf-forge-caption > svg { width: 15px; height: 15px; flex: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.hf-forge-bar {
  position: absolute; left: 50%; bottom: 8.5%; transform: translateX(-50%);
  width: min(52%, 240px); height: 9px; border-radius: 2px; overflow: hidden;
  background: rgba(20,14,8,0.88); border: 1px solid ${Ui.goldLineSoft};
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.6), 0 0 10px rgba(255,140,40,0.18);
}
.hf-forge-bar > i {
  display: block; height: 100%; width: 100%;
  transform: scaleX(0.02); transform-origin: left center;
  background: linear-gradient(90deg, ${Ui.goldDeep}, ${Ui.goldBright} 60%, #ffc860);
  box-shadow: 0 0 8px rgba(255,180,70,0.55);
  animation: hf-forge-bar-fill var(--hf-forge-ms) linear both;
}
.hf-forge-reveal-glow {
  position: absolute; left: 50%; top: 44%; width: 60%; aspect-ratio: 1;
  transform: translate(-50%, -50%); border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, var(--hf-tint, #ffd066) 0%, transparent 62%);
  animation: hf-forge-reveal-glow ${FORGE_REVEAL_ACK_MS}ms ease-out both;
}
.hf-forge-caption-reveal {
  bottom: auto; top: 50%; transform: translate(-50%, -50%);
  letter-spacing: 4px; font-size: 17px;
  animation: hf-forge-reveal-caption ${FORGE_REVEAL_ACK_MS}ms ease-out both;
}
.hf-forge-live.hf-phase-resolving .hf-cube-right { opacity: 0.68; }
.hf-forge-live.hf-phase-resolving .hf-cube-grid {
  animation: hf-forge-shake var(--hf-forge-ms) linear both;
}
.hf-forge-live.hf-phase-resolving[data-action='fuse'] .hf-cube-grid > div:nth-child(1),
.hf-forge-live.hf-phase-resolving[data-action='fuse'] .hf-cube-grid > div:nth-child(2),
.hf-forge-live.hf-phase-resolving[data-action='fuse'] .hf-cube-grid > div:nth-child(3) {
  animation: hf-forge-wellignite var(--hf-forge-ms) ease-out both;
}
.hf-forge-live.hf-phase-resolving[data-action='fuse'] .hf-cube-grid > div:nth-child(2) { animation-delay: 120ms; }
.hf-forge-live.hf-phase-resolving[data-action='fuse'] .hf-cube-grid > div:nth-child(3) { animation-delay: 240ms; }
`;
}

function ensureForgeCraftStyles(): void {
  if (document.getElementById(FORGE_CRAFT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FORGE_CRAFT_STYLE_ID;
  style.textContent = forgeCraftStyleText();
  document.head.appendChild(style);
}

const TIER_LABEL: Readonly<Record<MaterialTier, string>> = {
  common: '白',
  magic: '蓝',
  rare: '黄',
};

const TIER_ORDER: readonly MaterialTier[] = ['common', 'magic', 'rare'];

export type ForgeLockReason = 'legendary' | 'wrong-recipe' | 'insufficient-shards';

export type ForgePresentPayload = {
  banner: string;
  color: string;
  sfx: 'pickup' | 'equip';
};

export type ForgeClickResult =
  | { ok: false }
  | { ok: true; present: ForgePresentPayload };

/** Pure enablement + hint — UI + tests share this (validators stay in crafting.ts). */
export function resolveForgeActions(
  items: readonly Readonly<Item>[],
  materials: MaterialCounts,
): {
  salvage: boolean;
  reroll: boolean;
  fuse: boolean;
  lockReason: ForgeLockReason | null;
  hint: string | null;
} {
  const salvage = items.length === 1 && canSalvage(items[0]!);
  const cost = items.length === 1 ? rerollCost(items[0]!) : null;
  const affordable = !!cost
    && materials.common >= cost.common
    && materials.magic >= cost.magic
    && materials.rare >= cost.rare;
  const reroll = items.length === 1 && canReroll(items[0]!) && affordable;
  const fuse = canFuse(items);

  if (items.length === 0) {
    return { salvage, reroll, fuse, lockReason: null, hint: null };
  }
  if (items.some((it) => it.rarity === 'legendary')) {
    return {
      salvage: false,
      reroll: false,
      fuse: false,
      lockReason: 'legendary',
      hint: '传奇不可拆解 / 重铸 / 合成',
    };
  }
  if (items.length === 1 && canReroll(items[0]!) && !affordable && cost) {
    const tier = items[0]!.rarity as MaterialTier;
    const need = cost[tier];
    const deficit = missingMaterials(items, materials)[tier];
    return {
      salvage,
      reroll: false,
      fuse: false,
      lockReason: 'insufficient-shards',
      hint: `材料不足：缺 ${deficit} 片${TIER_LABEL[tier]}色碎片（重铸需 ${need} 片）`,
    };
  }
  if (!salvage && !reroll && !fuse) {
    return {
      salvage: false,
      reroll: false,
      fuse: false,
      lockReason: 'wrong-recipe',
      hint: '配方不符：拆解/重铸需 1 件；合成需 3 件同稀有度（部位不限，黄×3→传奇）',
    };
  }
  return { salvage, reroll, fuse, lockReason: null, hint: null };
}

/** Pure preview copy for the right column (no RNG resolve). */
export function forgePreviewLines(
  items: readonly Readonly<Item>[],
  materials: MaterialCounts,
): { recipe: string; output: string; delta: string } {
  const actions = resolveForgeActions(items, materials);
  if (items.length === 0) {
    return {
      recipe: '尚未投入装备',
      output: '放入 1 件拆解/重铸，或 3 件同稀有度合成（黄×3 → 传奇）',
      delta: '材料变化：—',
    };
  }
  if (actions.lockReason === 'legendary') {
    return { recipe: '传奇锁定', output: '不可锻造', delta: '材料变化：—' };
  }
  if (items.length === 1 && canReroll(items[0]!) && !actions.reroll) {
    // N2R G5: reroll is the only shard-consuming recipe — when it is blocked,
    // the preview surfaces the shortage (tier + count) instead of the salvage
    // yield, so 放入即知. Salvage stays available via its own button.
    return {
      recipe: '重铸：消耗同色碎片，刷新词缀',
      output: `产出预览：同部位「${items[0]!.name}」新词缀`,
      delta: `材料变化：${shortageLines(items, materials) ?? '—'}`,
    };
  }
  if (actions.salvage && items.length === 1) {
    const y = salvageYield(items[0]!);
    const tier = items[0]!.rarity as MaterialTier;
    const n = y?.[tier] ?? 0;
    // N2R F1: salvage and reroll share the isMaterialTier gate, and the
    // shortage branch above already returned for the unaffordable case — so an
    // affordable single item always has both paths live. The three lines carry
    // both: the salvage yield AND the reroll cost (the reroll-only branch that
    // used to follow was unreachable dead code and is gone).
    const cost = rerollCost(items[0]!);
    const m = cost?.[tier] ?? 0;
    return {
      recipe: '拆解：1 件非传奇 → 同色碎片',
      output: `产出预览：+${n} ${TIER_LABEL[tier]}色碎片`,
      delta: `材料变化：${TIER_LABEL[tier]} +${n}；重铸 −${m} 片${TIER_LABEL[tier]}色碎片`,
    };
  }
  if (canFuse(items)) {
    const head = items[0]!;
    if (head.rarity === 'rare') {
      return {
        recipe: '合成：黄×3 → 传奇',
        output: '产出预览：随机传奇',
        delta: '材料变化：无碎片消耗',
      };
    }
    const next = rarityStepUp(head.rarity as MaterialTier);
    const label = next ? TIER_LABEL[next] : '?';
    return {
      recipe: `合成：同稀有度×3 → ${label}色`,
      output: `产出预览：升阶装备（部位随机）`,
      delta: '材料变化：无碎片消耗',
    };
  }
  return {
    recipe: actions.hint ?? '配方不符',
    output: '—',
    delta: '材料变化：—',
  };
}

/**
 * N2R G5: shards still missing for the currently relevant recipe — reroll is
 * the only shard-consuming action, so a single craftable item is the case
 * that can report a shortage. Per tier: need − have, floored at 0.
 */
export function missingMaterials(
  items: readonly Readonly<Item>[],
  materials: MaterialCounts,
): MaterialCounts {
  const missing: Record<MaterialTier, number> = { common: 0, magic: 0, rare: 0 };
  if (items.length !== 1) return missing;
  const cost = rerollCost(items[0]!);
  if (!cost) return missing;
  for (const tier of TIER_ORDER) {
    missing[tier] = Math.max(0, cost[tier] - materials[tier]);
  }
  return missing;
}

/**
 * Human shortage copy, e.g. 「缺 2 片蓝色碎片」 / 「缺 1 片白色碎片、缺 3 片黄色碎片」.
 * Null when nothing is missing (or no shard-consuming recipe applies).
 */
export function shortageLines(
  items: readonly Readonly<Item>[],
  materials: MaterialCounts,
): string | null {
  const missing = missingMaterials(items, materials);
  const parts = TIER_ORDER
    .filter((t) => missing[t] > 0)
    .map((t) => `缺 ${missing[t]} 片${TIER_LABEL[t]}色碎片`);
  return parts.length > 0 ? parts.join('、') : null;
}

/**
 * N2R G5: per-button disabled reason — the hover hint must match the actual
 * enablement (acceptance: 亮灰态与悬停 hint 一致，禁用原因=缺料内容).
 * Returns null when the button is enabled.
 */
export function forgeButtonReason(
  actions: ReturnType<typeof resolveForgeActions>,
  kind: ForgeActionKind,
): string | null {
  if (actions.lockReason === 'legendary') return '传奇不可拆解 / 重铸 / 合成';
  const enabled = kind === 'salvage'
    ? actions.salvage
    : kind === 'reroll'
      ? actions.reroll
      : actions.fuse;
  if (enabled) return null;
  if (kind === 'reroll' && actions.lockReason === 'insufficient-shards') {
    return actions.hint;
  }
  if (kind === 'salvage') return '拆解需 1 件非传奇装备';
  if (kind === 'reroll') return '重铸需 1 件非传奇装备';
  return '合成需 3 件同稀有度（部位不限，黄×3→传奇）';
}

export interface CubeUICallbacks {
  getBag: () => readonly BagAnchor[];
  getMaterials: () => MaterialCounts;
  /** Domain settle first; return present payload only on success (no SFX yet). */
  onSalvage: (bagIndex: number) => ForgeClickResult;
  onReroll: (bagIndex: number) => ForgeClickResult;
  onFuse: (bagIndices: readonly [number, number, number]) => ForgeClickResult;
  /** Fire after reveal timer — SFX + banner (never during resolving). */
  onPresent: (payload: ForgePresentPayload) => void;
  showNotification: (text: string, color?: string) => void;
  onClose: () => void;
}

export interface CubeUIHandle {
  isOpen(): boolean;
  toggle(): void;
  open(): void;
  close(): void;
  getCubeIndices(): number[];
  clearItems(): void;
  /** Test/observability */
  phase(): ForgeVisualPhase;
  dispose(): void;
}

if (!assertForgeRevealDuration(FORGE_REVEAL_MS)) {
  throw new Error(`FORGE_REVEAL_MS ${FORGE_REVEAL_MS} outside ${FORGE_REVEAL_MS_MIN}-${FORGE_REVEAL_MS_MAX}`);
}

export function installCubeUI(cb: CubeUICallbacks, mount: HTMLElement = document.body): CubeUIHandle {
  ensureUiStyles();
  ensureForgeCraftStyles();
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;

  let visible = false;
  let cubeIdx: number[] = [];
  let phase: ForgeVisualPhase = 'idle';
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPresent: ForgePresentPayload | null = null;
  let lastAction: ForgeActionKind | null = null;
  /** Result tint for the reveal ack (from the settled present payload). */
  let lastTint: string | null = null;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  // N2R F7: geometry locked to the frame art's native 3:4 — height-driven with
  // `aspect-ratio` (width derives), and the height min() also carries the
  // 96vw-derived term so a narrow window shrinks both axes in lockstep and the
  // painted `center/100% 100%` border is never squashed (same discipline as
  // the inventory dock). The panel itself only positions/sizes; the parchment
  // inset lives on the static wrapper below (B2), where percentage padding
  // resolves against this box's content width, not the viewport.
  panel.style.cssText = `
    position: ${scoped ? 'absolute' : 'fixed'}; top: 50%; left: 50%; transform: translate(-50%, -50%);
    height: min(calc(100% - 48px), 900px, calc(96vw * 4 / 3));
    aspect-ratio: 3/4; width: auto; max-width: 96vw;
    font-family: ${FONT_UI}; color: ${Ui.text}; z-index: ${Z.cube};
    background:url('${HudArt.panelForge()}') center/100% 100% no-repeat;
    box-shadow:0 18px 50px rgba(0,0,0,0.8);
    display: none;
    pointer-events: auto; box-sizing: border-box; overflow: hidden;
  `;
  mount.appendChild(panel);

  const inner = document.createElement('div');
  // K3: forge frame parchment is smaller than inventory's (thicker trim).
  // Measured on panel-frame-forge.webp (768×1024, 17px smooth-core scan):
  // parchment core starts x≈137 / ends x≈640 / starts y≈149 / ends y≈879 —
  // each side sits 14–34px inside the gold trim, so the % below aligns the
  // content box to the core and carries that gap as safety margin. The %
  // resolves against the panel's content-box width: 1080p → top 131.0 /
  // left 120.2 / right 112.7 / bottom 127.6px; 720p → 97.8 / 89.7 / 84.2 /
  // 95.3px. (B2: a positioned box would resolve % against the viewport.)
  inner.style.cssText = `
    display: flex; flex-direction: column; gap: 8px;
    height: 100%; min-height: 0; overflow: hidden; box-sizing: border-box;
    padding: 19.4% 16.7% 18.9% 17.8%;
  `;
  panel.appendChild(inner);

  const pill = (content: string): string =>
    `<span style="padding:2px 8px;background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};` +
    `display:inline-flex;align-items:center;gap:4px;font-size:12px;">${content}</span>`;

  function actionBtn(id: string, label: string, enabled: boolean, reason: string | null = null): string {
    const locked = phase !== 'idle';
    const on = enabled && !locked;
    // Hover hint only when the button is actually disabled by enablement —
    // mid-reveal the buttons dim for a different cause, so no reason is shown.
    const tip = !locked ? reason : null;
    return `<div id="${id}"${tip ? ` title="${tip}"` : ''} style="
      flex:1;padding:8px 0;text-align:center;
      background:${on ? `linear-gradient(180deg,${Ui.goldFill},rgba(28,20,10,0.95))` : 'rgba(16,12,8,0.6)'};
      border:2px solid ${on ? Ui.gold : '#3a3228'};border-radius:2px;
      color:${on ? Ui.goldBright : Ui.textDim};font-size:13px;font-weight:bold;font-family:${FONT_DISPLAY};
      letter-spacing:2px;text-shadow:${on ? `0 1px 0 ${Ui.goldDeep}` : 'none'};
      cursor:${on ? 'pointer' : 'not-allowed'};user-select:none;opacity:${locked ? '0.55' : '1'};">${label}</div>`;
  }

  function clearRevealTimer(): void {
    if (revealTimer !== undefined) {
      clearTimeout(revealTimer);
      revealTimer = undefined;
    }
  }

  function beginReveal(action: ForgeActionKind, present: ForgePresentPayload, afterSettle: () => void): void {
    lastAction = action;
    lastTint = present.color;
    pendingPresent = present;
    phase = forgePhaseAfterSettlement(true);
    afterSettle();
    render();
    clearRevealTimer();
    revealTimer = setTimeout(() => {
      phase = forgePhaseAfterRevealTimer();
      if (pendingPresent) {
        cb.onPresent(pendingPresent);
        pendingPresent = null;
      }
      render();
      clearRevealTimer();
      revealTimer = setTimeout(() => {
        phase = forgePhaseAfterRevealAck();
        lastAction = null;
        lastTint = null;
        render();
      }, FORGE_REVEAL_ACK_MS);
    }, FORGE_REVEAL_MS);
  }

  function render(): void {
    const bag = cb.getBag();
    const materials = cb.getMaterials();
    const cubeItems: Array<{ idx: number; item: Item }> = [];
    for (const idx of cubeIdx) {
      const item = bag[idx]?.item;
      if (item) cubeItems.push({ idx, item });
    }
    if (cubeItems.length !== cubeIdx.length) {
      cubeIdx = cubeItems.map((c) => c.idx);
    }
    const cubeSet = new Set(cubeItems.map((c) => c.idx));
    const placed = cubeItems.map((c) => c.item);
    const actions = resolveForgeActions(placed, materials);
    const preview = forgePreviewLines(placed, materials);
    const locked = phase !== 'idle';

    // Craft show: overlay carries backdrop/caption/bar (or the reveal ack);
    // the hammer-and-anvil stage mounts inside the grid wrapper below so the
    // strike point lands exactly on the workpiece (the 3×4 wells themselves).
    const liveAction = lastAction ?? 'reroll';
    const craftOverlay = phase === 'resolving'
      ? forgeCraftOverlayHtml(liveAction, 'resolving')
      : phase === 'reveal'
        ? forgeCraftOverlayHtml(liveAction, 'reveal', lastTint ?? undefined)
        : '';

    // The stage mounts inside the grid wrapper: strike point == grid center.
    const craftStage = phase === 'resolving' && lastAction ? forgeCraftStageHtml(lastAction) : '';
    let left = `
      <div style="color:${Ui.textDim};font-size:11px;margin-bottom:4px;">点击背包物品放入方块</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
        ${pill(`<span style="color:${RARITY_META.common.color};font-weight:bold;">${materials.common}</span><span style="color:${Ui.textDim};font-size:10px;">白</span>`)}
        ${pill(`<span style="color:${RARITY_META.magic.color};font-weight:bold;">${materials.magic}</span><span style="color:${Ui.textDim};font-size:10px;">蓝</span>`)}
        ${pill(`<span style="color:${RARITY_META.rare.color};font-weight:bold;">${materials.rare}</span><span style="color:${Ui.textDim};font-size:10px;">黄</span>`)}
      </div>
      <div style="position:relative;flex:1;display:flex;align-items:center;min-height:0;">
      <div class="hf-cube-grid" style="width:100%;aspect-ratio:3/4;display:grid;
        grid-template-columns:repeat(${CUBE_COLS},1fr);grid-template-rows:repeat(${CUBE_ROWS},1fr);
        background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};">`;
    for (let i = 0; i < CUBE_SLOTS; i++) {
      const x = i % CUBE_COLS;
      const y = Math.floor(i / CUBE_COLS);
      const cell = `grid-column:${x + 1};grid-row:${y + 1};`;
      const seat = cubeItems[i];
      if (!seat) {
        // N2R: same well language as the equip dock — empty wells read as
        // black pits with a dimmed gold-brown bezel (no flat gray line).
        left += `<div style="${cell}${itemWellCss({ rarity: null, filled: false })}box-sizing:border-box;"></div>`;
      } else {
        const item = seat.item;
        left += `<div data-bag-idx="${seat.idx}" style="${cell}${itemWellCss({ rarity: item.rarity, filled: true })}
          display:flex;align-items:center;justify-content:center;cursor:${locked ? 'default' : 'pointer'};box-sizing:border-box;"
          title="点击移出：${item.name}">
          <img src="${slotIconUrl(item.slot)}" alt="" draggable="false"
            style="width:80%;height:80%;object-fit:contain;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6));">
        </div>`;
      }
    }
    left += `</div>
      ${craftStage}</div>
      <div style="display:flex;gap:6px;width:100%;margin-top:auto;">
        ${actionBtn('cube-salvage', '拆解', actions.salvage, forgeButtonReason(actions, 'salvage'))}
        ${actionBtn('cube-reroll', '重铸', actions.reroll, forgeButtonReason(actions, 'reroll'))}
        ${actionBtn('cube-fuse', '合成', actions.fuse, forgeButtonReason(actions, 'fuse'))}
      </div>`;
    if (actions.hint) {
      left += `<div style="color:${Ui.danger};font-size:11px;text-align:center;margin-top:4px;">${actions.hint}</div>`;
    }

    let right = `
      <div style="font:700 12px ${FONT_DISPLAY};color:${Ui.goldBright};letter-spacing:2px;margin-bottom:6px;">配方与预览</div>
      <div style="font:600 12px ${FONT_UI};color:${Ui.textMuted};line-height:1.5;margin-bottom:8px;">${preview.recipe}</div>
      <div style="font:600 12px ${FONT_UI};color:${Ui.gold};line-height:1.5;margin-bottom:6px;">${preview.output}</div>
      <div style="font:600 12px ${FONT_UI};color:${Ui.textDim};line-height:1.5;margin-bottom:10px;">${preview.delta}</div>
      ${goldDividerHtml(2)}
      <div style="color:${Ui.textDim};font-size:11px;margin:8px 0 4px;">背包候选 ${cubeItems.length >= CUBE_SLOTS ? '（方块已满）' : `（已放入 ${cubeItems.length}/${CUBE_SLOTS}）`}</div>
      <div class="hf-scroll" style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px;align-content:flex-start;">`;
    if (!locked && cubeItems.length < CUBE_SLOTS) {
      bag.forEach((anchor, idx) => {
        if (cubeSet.has(idx)) return;
        const item = anchor.item;
        const color = RARITY_META[item.rarity].color;
        right += `<div data-add-idx="${idx}" style="
          flex:0 0 22%;aspect-ratio:1/1;box-sizing:border-box;
          border:1px solid ${color}44;background:rgba(15,12,8,0.6);
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;border-radius:2px;"
          title="${item.name}">
          <img src="${slotIconUrl(item.slot)}" alt="" draggable="false"
            style="width:75%;height:75%;object-fit:contain;pointer-events:none;">
        </div>`;
      });
    }
    right += `</div>`;

    // Live row: carries the master clock + palette so both the stage (left
    // column) and the row overlay read them; data-action drives branch CSS.
    const liveRow = phase !== 'idle' && lastAction !== null;
    const rowAttrs = liveRow
      ? ` class="hf-forge-live hf-phase-${phase}" data-action="${liveAction}"`
      : '';
    const rowVars = liveRow ? forgeCraftRowVars(liveAction) : '';

    inner.innerHTML = `
      <div style="position:relative;width:100%;flex:none;">
        <div style="${titleBandCss()}padding:4px 0;">熔炉方块</div>
        <div style="position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;color:${Ui.textDim};font-size:16px;padding:0 4px;" id="cube-close">✕</div>
      </div>
      ${goldDividerHtml(2)}
      <div${rowAttrs} style="${rowVars}position:relative;display:flex;gap:16px;width:100%;min-height:0;flex:1;align-items:stretch;">
        <!-- Left column scales with the panel (no 220px lock): 1080p → ~203px
             (wells ~67px), 720p → ~152px (wells ~50px); px cap only guards
             hypothetical ultra-wide content boxes. -->
        <div style="flex:0 0 min(46%, 240px);display:flex;flex-direction:column;">${left}</div>
        <div style="width:1px;background:linear-gradient(180deg,transparent,${Ui.goldLineSoft},transparent);"></div>
        <div class="hf-cube-right" style="flex:1;min-width:0;display:flex;flex-direction:column;">${right}</div>
        ${craftOverlay}
      </div>
    `;
    bindEvents(actions, locked);
  }

  function bindEvents(actions: ReturnType<typeof resolveForgeActions>, locked: boolean): void {
    panel.querySelector('#cube-close')?.addEventListener('click', () => {
      cb.onClose();
    });

    if (locked) return;

    panel.querySelector('#cube-salvage')?.addEventListener('click', () => {
      if (!actions.salvage || cubeIdx.length !== 1 || phase !== 'idle') return;
      const idx = cubeIdx[0]!;
      const res = cb.onSalvage(idx);
      if (!res.ok) return;
      beginReveal('salvage', res.present, () => { cubeIdx = []; });
    });

    panel.querySelector('#cube-reroll')?.addEventListener('click', () => {
      if (!actions.reroll || cubeIdx.length !== 1 || phase !== 'idle') return;
      const idx = cubeIdx[0]!;
      const res = cb.onReroll(idx);
      if (!res.ok) return;
      beginReveal('reroll', res.present, () => { /* keep placement */ });
    });

    panel.querySelector('#cube-fuse')?.addEventListener('click', () => {
      if (!actions.fuse || cubeIdx.length !== 3 || phase !== 'idle') return;
      const indices = cubeIdx.slice(0, 3) as [number, number, number];
      const res = cb.onFuse(indices);
      if (!res.ok) return;
      beginReveal('fuse', res.present, () => {
        const dest = Math.min(indices[0], indices[1], indices[2]);
        cubeIdx = [dest];
      });
    });

    panel.querySelectorAll<HTMLElement>('[data-add-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        if (phase !== 'idle') return;
        const idx = parseInt(el.dataset.addIdx!, 10);
        if (cubeIdx.length >= CUBE_SLOTS) {
          cb.showNotification('方块已满', '#ff4444');
          return;
        }
        const bag = cb.getBag();
        if (bag[idx]?.item && !cubeIdx.includes(idx)) {
          cubeIdx.push(idx);
          render();
        }
      });
    });

    panel.querySelectorAll<HTMLElement>('[data-bag-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        if (phase !== 'idle') return;
        const idx = parseInt(el.dataset.bagIdx!, 10);
        const pos = cubeIdx.indexOf(idx);
        if (pos >= 0) {
          cubeIdx.splice(pos, 1);
          render();
        }
      });
    });
  }

  function open(): void {
    visible = true;
    panel.style.display = 'flex';
    render();
  }

  function close(): void {
    visible = false;
    panel.style.display = 'none';
    // If closed mid-reveal, still flush deferred present once so SFX/banner aren't lost.
    clearRevealTimer();
    if (pendingPresent) {
      cb.onPresent(pendingPresent);
      pendingPresent = null;
    }
    phase = 'idle';
    lastAction = null;
    lastTint = null;
  }

  return {
    isOpen: () => visible,
    toggle() { if (visible) close(); else open(); },
    open,
    close,
    getCubeIndices: () => cubeIdx.slice(),
    clearItems() {
      cubeIdx = [];
      if (visible) render();
    },
    phase: () => phase,
    dispose() {
      clearRevealTimer();
      pendingPresent = null;
      panel.remove();
    },
  };
}
