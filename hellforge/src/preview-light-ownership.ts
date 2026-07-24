/**
 * CharSelect preview light handoff — pure helpers (no engine imports).
 *
 * Title→game calls `hide()`, which must release every preview light so
 * gameplay sun + 4 point slots are the sole URP owners.
 */

export type PreviewLightSlots = {
  keyLight: number | null;
  fillLight: number | null;
  rimLight: number | null;
  footLight: number | null;
};

const SLOT_KEYS = ['keyLight', 'fillLight', 'rimLight', 'footLight'] as const;

/** Count of non-null preview light handles (URP extraction consumers). */
export function countLivePreviewLights(slots: PreviewLightSlots): number {
  let n = 0;
  for (const key of SLOT_KEYS) {
    if (slots[key] !== null) n += 1;
  }
  return n;
}

export function previewLightsReleased(slots: PreviewLightSlots): boolean {
  return countLivePreviewLights(slots) === 0;
}

/**
 * Despawn every preview light and null the slots. Prefer despawn over
 * intensity=0 (extraction still packs zero-intensity points).
 */
export function releasePreviewLightSlots(
  despawn: (entity: number) => void,
  slots: PreviewLightSlots,
): PreviewLightSlots {
  for (const key of SLOT_KEYS) {
    const e = slots[key];
    if (e !== null) {
      try {
        despawn(e);
      } catch {
        /* world may already have torn the entity down */
      }
    }
  }
  return { keyLight: null, fillLight: null, rimLight: null, footLight: null };
}
