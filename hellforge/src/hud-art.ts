// Hellforge HUD painted art — PR6 ship textures.
// Bottom-bar frames ship as RGBA PNG (true cutout from AI masters that baked
// checkerboard into RGB). Panel/slot plates remain alpha WebP.
// Raw 2K masters live under assets/ui/hud/{t1,t2,t3}/ (local only).

const HUD_ART_BASE = new URL('../assets/ui/hud/ship/', import.meta.url).href.replace(/\/?$/, '/');
/** Bump when ship cutouts change so browsers drop stale opaque WebP/PNG. */
const HUD_ART_REV = 'v7';

export function hudArtUrl(file: string): string {
  return `${HUD_ART_BASE}${file}?${HUD_ART_REV}`;
}

export const HudArt = {
  /** RGBA PNG — exterior + orb hole punched to true alpha. */
  globeHp: () => hudArtUrl('globe-frame-hp.png'),
  globeMp: () => hudArtUrl('globe-frame-mp.png'),
  hotbarBackplate: () => hudArtUrl('hotbar-backplate.png'),
  hotbarSlotEmpty: () => hudArtUrl('hotbar-slot-empty.webp'),
  hotbarSlotActive: () => hudArtUrl('hotbar-slot-active.webp'),
  barWingLeft: () => hudArtUrl('bar-wing-left.png'),
  barWingRight: () => hudArtUrl('bar-wing-right.png'),
  panelInventory: () => hudArtUrl('panel-frame-inventory.webp'),
  panelCharacter: () => hudArtUrl('panel-frame-character.webp'),
  /** N2R forge cube — sibling of inventory frame (crucible crest, same chrome language). */
  panelForge: () => hudArtUrl('panel-frame-forge.webp'),
  /** Skill / quest reuse C / B frames (PR6 L3 deferred dedicated menu art). */
  panelSkill: () => hudArtUrl('panel-frame-character.webp'),
  panelQuest: () => hudArtUrl('panel-frame-inventory.webp'),
  /** Semantic alias for the stash frame — dedicated「箱」art swaps in later. */
  panelStash: () => hudArtUrl('panel-frame-inventory.webp'),
  bagSlot: () => hudArtUrl('bag-slot-empty.webp'),
  equipSlot: () => hudArtUrl('equip-slot-empty.webp'),
  automapParchment: () => hudArtUrl('automap-parchment.webp'),
  automapFrame: () => hudArtUrl('automap-frame.webp'),
} as const;
