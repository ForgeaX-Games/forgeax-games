// Hellforge UI icon registry — real art replaces the emoji stand-ins
// (UI-CUTSCENE-UPGRADE-PLAN.md §2). PNGs live in assets/ui/icons/ and are
// user-owned AI-generated assets ported from the aidiablo reference project
// (dist/icons/, v0.5.0). PR10 gloves/belt/offhand also from aidiablo
// dist/icons v0.5.0 (leather_gloves / sash / orb/glowing_orb). No Blizzard art,
// no aidiablo code.
//
// Consumption: domain meta carries icon KEYS (ItemSlot / SkillId / ClassId);
// only this module maps keys to pixels. Empty paper-doll slots render the same
// PNG as a grayscale silhouette (D2 look) instead of a separate art set.

import type { ClassId } from './classes';
import type { ItemSlot } from './items';
import { Ui } from './ui-theme';

/**
 * Icon URL resolution. NOTE: `new URL(\`../assets/ui/icons/${rel}\`, import.meta.url)`
 * is transformed by Vite into a NON-recursive glob — files in subdirs
 * (skills/, cursors/) came back `undefined`. Resolving a static base and
 * concatenating sidesteps the transform and works for every depth. (The
 * trailing slash is forced: the Vite-rewritten directory URL drops it.)
 */
const ICON_BASE = new URL('../assets/ui/icons/', import.meta.url).href.replace(/\/?$/, '/');

export function uiIconUrl(rel: string): string {
  return ICON_BASE + rel;
}

const SLOT_ICON_FILE: Record<ItemSlot, string> = {
  weapon:  'weapon.png', // crystal_staff.png (hellforge weapons are staves)
  helm:    'helm.png', // iron_helm.png
  armor:   'armor.png', // chain_mail.png
  boots:   'boots.png', // leather_boots.png
  ring:    'ring.png',
  amulet:  'amulet.png',
  gloves:  'gloves.png', // leather_gloves.png (aidiablo dist/icons v0.5.0)
  belt:    'belt.png', // sash.png (aidiablo dist/icons v0.5.0)
  offhand: 'offhand.png', // orb/glowing_orb.png (aidiablo dist/icons v0.5.0)
};

/** Skill icons keyed by SkillId — value of SkillDef.icon (skills.ts DISPLAY). */
const SKILL_ICON_FILE: Record<string, string> = {
  magma: 'skills/magma.png', // mage_huodan.png
  frost: 'skills/frost.png', // mage_bingdan.png (ice shard — fits 霜牙 ice bolt)
  arc: 'skills/arc.png', // mage_shandian.png
  blink: 'skills/blink.png', // mage_chuansong.png
  // Finisher reuses magma art until dedicated icon ships (PR 6).
  'inferno-nova': 'skills/magma.png',
  // PR9 actives — reuse sibling-element PNGs (inferno-nova precedent).
  'flame-burst': 'skills/magma.png',
  'frost-nova': 'skills/frost.png',
  discharge: 'skills/arc.png',
};

export function slotIconUrl(slot: ItemSlot): string {
  return uiIconUrl(SLOT_ICON_FILE[slot]);
}

export function skillIconUrl(iconKey: string): string | null {
  const file = SKILL_ICON_FILE[iconKey];
  return file ? uiIconUrl(file) : null;
}

export interface IconImgOpts {
  /** Empty-slot silhouette: grayscale + dimmed (D2 paper-doll look). */
  silhouette?: boolean;
  /** Extra cssText appended after the standard rules. */
  extraCss?: string;
  alt?: string;
}

function makeIconImg(url: string, sizePx: number, opts?: IconImgOpts): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.alt = opts?.alt ?? '';
  img.draggable = false;
  img.style.cssText =
    `width:${sizePx}px;height:${sizePx}px;object-fit:contain;pointer-events:none;display:block;` +
    (opts?.silhouette ? 'filter:grayscale(1) brightness(0.55);opacity:0.7;' : '') +
    (opts?.extraCss ?? '');
  return img;
}

/** Paper-doll / bag / HUD chip icon for an equipment slot. */
export function slotIconImg(slot: ItemSlot, sizePx: number, opts?: IconImgOpts): HTMLImageElement {
  return makeIconImg(slotIconUrl(slot), sizePx, { ...opts, alt: opts?.alt ?? slot });
}

/**
 * Hotbar / skill-node icon. `iconKey` is SkillDef.icon ('magma' | …).
 * Returns null for unknown keys — caller decides the fallback glyph.
 */
export function skillIconImg(iconKey: string, sizePx: number, opts?: IconImgOpts): HTMLImageElement | null {
  const url = skillIconUrl(iconKey);
  return url ? makeIconImg(url, sizePx, { ...opts, alt: opts?.alt ?? iconKey }) : null;
}

/**
 * Empty paper-doll slot silhouettes (simple currentColor paths, aidiablo look —
 * rendered at low opacity inside the stone-inset slot).
 */
export function slotSilhouetteSvg(slot: ItemSlot, sizePx: number, color = '#8a7a5a'): string {
  let body = '';
  switch (slot) {
    case 'weapon': // vertical staff
      body = `<path d="M22 6 L26 10 L14 38 L10 34 Z M10 34 L8 42 L12 40 L14 38" fill="${color}"/>` +
        `<circle cx="24" cy="8" r="4" fill="none" stroke="${color}" stroke-width="2"/>`;
      break;
    case 'helm':
      body = `<path d="M10 26 Q10 10 22 10 Q34 10 34 26 L34 32 L28 32 L28 26 L16 26 L16 32 L10 32 Z" fill="${color}"/>`;
      break;
    case 'armor':
      body = `<path d="M14 10 L20 8 L24 12 L28 8 L34 10 L32 20 L32 38 L12 38 L12 20 Z" fill="${color}"/>`;
      break;
    case 'boots':
      body = `<path d="M12 8 L20 8 L20 24 L28 30 L28 38 L12 38 Z M12 34 L28 34" fill="${color}"/>`;
      break;
    case 'ring':
      body = `<circle cx="22" cy="26" r="10" fill="none" stroke="${color}" stroke-width="5"/>` +
        `<path d="M18 12 L22 6 L26 12 Z" fill="${color}"/>`;
      break;
    case 'amulet':
      body = `<path d="M12 8 Q22 20 32 8" fill="none" stroke="${color}" stroke-width="3"/>` +
        `<circle cx="22" cy="24" r="6" fill="${color}"/>`;
      break;
    case 'gloves':
      body = `<path d="M14 14 L18 10 L22 14 L26 10 L30 14 L30 28 L26 34 L18 34 L14 28 Z" fill="${color}"/>`;
      break;
    case 'belt':
      body = `<path d="M10 20 L34 20 L34 28 L10 28 Z" fill="${color}"/>` +
        `<rect x="19" y="18" width="6" height="12" fill="${color}"/>`;
      break;
    case 'offhand':
      body = `<circle cx="22" cy="22" r="10" fill="none" stroke="${color}" stroke-width="3"/>` +
        `<path d="M22 12 L22 32 M12 22 L32 22" stroke="${color}" stroke-width="2"/>`;
      break;
  }
  return `<svg viewBox="0 0 44 44" width="${sizePx}" height="${sizePx}" aria-hidden="true">${body}</svg>`;
}

/**
 * Belt potion flask (SVG — D2 belt-cell look, no emoji). Filled glass bulb
 * + neck + stopper; liquid color by kind.
 */
export function potionIconSvg(kind: 'life' | 'mana', sizePx: number): string {
  const liquid = kind === 'life' ? '#c42822' : '#3350dd';
  const liquidHi = kind === 'life' ? '#e85840' : '#4a72e0';
  return (
    `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true">` +
    `<defs><linearGradient id="hf-pot-${kind}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${liquidHi}"/><stop offset="100%" stop-color="${liquid}"/>` +
    `</linearGradient></defs>` +
    `<rect x="10" y="1.5" width="4" height="3" rx="0.8" fill="#8a8578" stroke="#3a3630" stroke-width="0.7"/>` +
    `<path d="M10.5 4.5 L13.5 4.5 L14.5 7.5 L9.5 7.5 Z" fill="rgba(220,220,210,0.35)" stroke="#3a3630" stroke-width="0.7"/>` +
    `<path d="M12 7.5 C7.5 9.5 5.5 12.5 5.5 16 A6.5 6.5 0 0 0 18.5 16 C18.5 12.5 16.5 9.5 12 7.5 Z" ` +
    `fill="url(#hf-pot-${kind})" stroke="#2a2622" stroke-width="1"/>` +
    `<ellipse cx="10" cy="13" rx="1.6" ry="2.6" fill="rgba(255,255,255,0.4)"/>` +
    `</svg>`
  );
}

// ── class emblems (SVG — aidiablo has no class icon art; drawn in-house) ────

/**
 * Class sigil for CharSelect / CharList. Simple gold-stroke SVG runes in the
 * theme language; NOT copies of any Blizzard class icon.
 */
export function classEmblemSvg(id: ClassId, sizePx: number): string {
  const stroke = `stroke="${Ui.gold}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const dim = `stroke="${Ui.goldDim}" stroke-width="4" stroke-linecap="round" fill="none"`;
  let body = '';
  switch (id) {
    case 'barbarian': // crossed axes
      body =
        `<path d="M28 76 L76 28" ${stroke}/><path d="M76 28 L62 30 M76 28 L74 42" ${stroke}/>` +
        `<path d="M76 76 L28 28" ${dim}/><path d="M28 28 L42 30 M28 28 L30 42" ${dim}/>`;
      break;
    case 'necromancer': // skull
      body =
        `<circle cx="52" cy="44" r="22" ${stroke}/>` +
        `<circle cx="44" cy="40" r="4" fill="${Ui.gold}"/><circle cx="60" cy="40" r="4" fill="${Ui.gold}"/>` +
        `<path d="M52 48 L48 56 L56 56 Z" fill="${Ui.gold}"/>` +
        `<path d="M40 66 L40 74 M48 66 L48 76 M56 66 L56 76 M64 66 L64 74" ${dim}/>`;
      break;
    case 'sorceress': // tri-element orb
      body =
        `<circle cx="52" cy="52" r="24" ${stroke}/>` +
        `<path d="M52 30 L52 44 M34 62 L46 56 M70 62 L58 56" ${dim}/>` +
        `<circle cx="52" cy="52" r="7" fill="${Ui.crimson}" stroke="${Ui.goldBright}" stroke-width="2"/>`;
      break;
    default: // locked / undeveloped classes: anvil mark
      body =
        `<path d="M30 40 L74 40 L64 52 L64 62 L70 68 L34 68 L40 62 L40 52 Z" ${stroke}/>`;
      break;
  }
  return (
    `<svg viewBox="0 0 104 104" width="${sizePx}" height="${sizePx}" aria-hidden="true">` +
    `<circle cx="52" cy="52" r="46" fill="none" stroke="${Ui.goldLineSoft}" stroke-width="3"/>` +
    `${body}</svg>`
  );
}
