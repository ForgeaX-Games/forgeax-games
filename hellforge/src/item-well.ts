// Shared item well chrome — the ONE well language for every surface that
// seats an item (equip wells, forge cube cells, later stash cells). Extracted
// from inventory-ui (N2R): gold-brown metal bezel + inset depth; the quality
// color stays an overlay channel (thin inner ring + faint glow), never
// replacing the metal edge (UI chrome contract: 金褐金属边 + 内嵌沉入质感).

import { RARITY_META, type Rarity } from './items';
import { Ui } from './ui-theme';

// k3 #1: chamfered socket — top cave-in + bottom hairline reflection over the
// deep-well ambient. Empty wells sink further (top shadow doubled, ambient
// deepened) so the empty hole reads as a black pit vs. a seated item (k3 #4).
const WELL_DEPTH_SHADOW =
  'inset 0 3px 8px rgba(0,0,0,0.75),inset 0 -1px 0 rgba(201,184,150,0.18),inset 0 0 10px rgba(0,0,0,0.45)';
const EMPTY_WELL_DEPTH_SHADOW =
  'inset 0 6px 16px rgba(0,0,0,0.75),inset 0 -1px 0 rgba(201,184,150,0.10),inset 0 0 12px rgba(0,0,0,0.55)';
// k3 #1: 1px dark outer ring gives the metal bezel its banded thickness.
const WELL_OUTER_RING = '0 0 0 1px rgba(0,0,0,0.7)';
/** k3 #2: quality overlay — 1.5px thin inner ring + faint ambient glow. */
function qualityOverlayShadow(qCol: string | null): string {
  return qCol ? `inset 0 0 0 1.5px ${qCol}cc,inset 0 0 12px ${qCol}33` : '';
}
function wellShadow(qCol: string | null): string {
  return [
    WELL_OUTER_RING,
    qCol ? WELL_DEPTH_SHADOW : EMPTY_WELL_DEPTH_SHADOW,
    qualityOverlayShadow(qCol),
  ]
    .filter(Boolean)
    .join(',');
}

/** k3 #5: common items get a faint gold-brown wash (D3 card-back), not gray. */
const COMMON_WELL_WASH = Ui.goldDim;

export interface ItemWellOptions {
  /** Rarity seated in the well (null = empty). Drives the quality ring. */
  rarity: Rarity | null;
  /** True when an item is seated — enables the wash + seated depth. */
  filled: boolean;
}

/** Box-shadow layers only — hover overlays stack on top of this base. */
export function itemWellShadow(rarity: Rarity | null): string {
  return wellShadow(rarity ? RARITY_META[rarity].color : null);
}

/**
 * k3 #3+#5: full well chrome — faint radial backing at the floor center plus
 * a 3-6% quality wash over the translucent floor. Empties sink deeper and
 * keep a dimmed (goldDim α 0.45) bezel so they recede into the dark.
 */
export function itemWellCss({ rarity, filled }: ItemWellOptions): string {
  const qCol = rarity ? RARITY_META[rarity].color : null;
  const washHex = filled ? (rarity === 'common' ? COMMON_WELL_WASH : qCol) : null;
  const wash = washHex
    ? `radial-gradient(ellipse at center,rgba(0,0,0,0.25),transparent 70%),` +
      `linear-gradient(180deg,${washHex}0a,${washHex}0f),`
    : '';
  return (
    'background:' +
    wash +
    // N3R-N3 F5: well floor stays faintly translucent (α≈0.88) so the engraved
    // figure shows through from under the stone; icons sit above at z-index:1.
    // k3 #1: floor deepened + cooled (27,20,16→22,16,12 / 13,9,6→10,7,5).
    'linear-gradient(180deg,rgba(22,16,12,0.88),rgba(10,7,5,0.88));' +
    // k3 #1+#4: metal bezel — gold-brown edge on equipped wells, dimmed
    // (goldDim at α 0.45) on empty wells so they recede into the dark.
    `border:1px solid ${qCol ? Ui.goldMetal : 'rgba(168,132,64,0.45)'};border-radius:2px;` +
    `box-shadow:${wellShadow(qCol)};`
  );
}
