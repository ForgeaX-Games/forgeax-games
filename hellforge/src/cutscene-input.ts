import type { MajorPanel } from './ui-layer-manager';

/** Panel / chrome keys that must not steal cutscene ownership. */
export function cutsceneBlocksChromeKey(active: MajorPanel | null): boolean {
  return active === 'cutscene';
}
