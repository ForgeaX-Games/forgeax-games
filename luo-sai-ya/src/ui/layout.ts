/** Landscape shell — board between top bar and bottom resource/trade bar. */
export const TOP_BAR_H = 46;
/** Fallback until bottom bar measures itself. */
export const BOTTOM_BAR_FALLBACK_H = 200;
export const BOTTOM_BAR_CSS_VAR = '--luo-sai-ya-bottom-h';

export function setBottomBarHeight(px: number): void {
  document.documentElement.style.setProperty(BOTTOM_BAR_CSS_VAR, `${px}px`);
}
