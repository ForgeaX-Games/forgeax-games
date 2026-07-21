// Major-panel ownership — single active surface at a time.
//
// Surfaces register show/hide; the manager never touches DOM. Unregistered
// panel ids still participate in exclusivity (open is a no-op display).

export type MajorPanel =
  | 'inventory'
  | 'skills'
  | 'quests'
  | 'character'
  | 'dialogue'
  | 'settings'
  /** Cutscene playback — registering it hijacks the exclusivity/input funnel. */
  | 'cutscene';

export type PanelSurface = {
  show: () => void;
  hide: () => void;
};

export type UiLayerManagerOptions = {
  /** Fired whenever the exclusive owner changes (including close → null). */
  onOwnershipChange?: (prev: MajorPanel | null, next: MajorPanel | null) => void;
};

export interface UiLayerManager {
  register(panel: MajorPanel, surface: PanelSurface): void;
  open(panel: MajorPanel): void;
  close(panel: MajorPanel): void;
  closeAll(): void;
  active(): MajorPanel | null;
  blocksWorldInput(): boolean;
}

export function createUiLayerManager(opts: UiLayerManagerOptions = {}): UiLayerManager {
  const surfaces = new Map<MajorPanel, PanelSurface>();
  let current: MajorPanel | null = null;

  const setActive = (next: MajorPanel | null): void => {
    if (current === next) return;
    const prev = current;
    if (prev !== null) surfaces.get(prev)?.hide();
    current = next;
    if (next !== null) surfaces.get(next)?.show();
    opts.onOwnershipChange?.(prev, next);
  };

  return {
    register(panel, surface) {
      surfaces.set(panel, surface);
    },
    open(panel) {
      setActive(panel);
    },
    close(panel) {
      if (current !== panel) return;
      setActive(null);
    },
    closeAll() {
      if (current === null) return;
      setActive(null);
    },
    active: () => current,
    blocksWorldInput: () => current !== null,
  };
}
