// Hellforge Shell UI plates (S1–S7) — owner-generated plaster/parchment art.
// SSOT checklist: docs/handoff/2026-08-02-hellforge-shell-ui-art-asset-checklist.md
// Files live under assets/ui/shell/; bump SHELL_ART_REV when cutouts change.

const SHELL_ART_BASE = new URL('../assets/ui/shell/', import.meta.url).href.replace(/\/?$/, '/');
/** Bump when shell plates change so browsers drop stale WebP. */
export const SHELL_ART_REV = 'v2';

export function shellArtUrl(file: string): string {
  return `${SHELL_ART_BASE}${file}?${SHELL_ART_REV}`;
}

export const ShellArt = {
  btnIdle: () => shellArtUrl('shell-btn-idle.webp'),
  btnHover: () => shellArtUrl('shell-btn-hover.webp'),
  btnPressed: () => shellArtUrl('shell-btn-pressed.webp'),
  latchIdle: () => shellArtUrl('shell-latch-idle.webp'),
  latchHover: () => shellArtUrl('shell-latch-hover.webp'),
  latchPressed: () => shellArtUrl('shell-latch-pressed.webp'),
  plaqueWide: () => shellArtUrl('shell-plaque-wide.webp'),
  skipIdle: () => shellArtUrl('shell-skip-idle.webp'),
  skipHover: () => shellArtUrl('shell-skip-hover.webp'),
  pvTrack: () => shellArtUrl('shell-pv-track.webp'),
  pvFill: () => shellArtUrl('shell-pv-fill.webp'),
} as const;
