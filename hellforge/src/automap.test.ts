import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  automapAfterPanelOpen,
  automapToggleExpanded,
} from './visual-polish-contracts';
import {
  filterReachedLandmarks,
  installAutomap,
  projectAutomap,
  resolveRuntimeExitPosition,
  type AutomapSnapshot,
} from './automap';
import { createUiLayerManager } from './ui-layer-manager';

type Listener = (event: { type: string }) => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> & { cssText: string } = { cssText: '' };
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Set<Listener>>();
  parent: FakeElement | null = null;
  textContent = '';
  id = '';
  clientWidth = 1280;
  clientHeight = 720;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  remove(): void {
    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }

  setAttribute(name: string, value: string): void {
    if (name === 'id') this.id = value;
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }

  querySelectorAll<T extends FakeElement = FakeElement>(selector: string): T[] {
    const found: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      if (
        (selector === 'canvas' && node.tagName === 'CANVAS')
        || (selector === '[data-hellforge-automap-root]' && node.dataset.hellforgeAutomapRoot === 'true')
        || (selector === '[data-automap-minimap]' && node.dataset.automapMinimap === 'true')
        || (selector === '[data-automap-expanded]' && node.dataset.automapExpanded === 'true')
        || (selector === '[data-automap-close]' && node.dataset.automapClose === 'true')
      ) {
        found.push(node);
      }
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return found as T[];
  }
}

class FakeCanvas extends FakeElement {
  width = 0;
  height = 0;
  clearCount = 0;
  arcCount = 0;

  constructor() {
    super('CANVAS');
    this.clientWidth = 220;
    this.clientHeight = 220;
  }

  getContext(): CanvasRenderingContext2D {
    return {
      setTransform: () => {},
      clearRect: () => { this.clearCount += 1; },
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      arc: () => { this.arcCount += 1; },
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D;
  }
}

let mount: FakeElement;
let fakeWindow: {
  devicePixelRatio: number;
  addEventListener: (type: string, listener: Listener) => void;
  removeEventListener: (type: string, listener: Listener) => void;
  listenerCount: () => number;
};

function installFakeDom(): void {
  mount = new FakeElement('DIV');
  const body = new FakeElement('BODY');
  const windowListeners = new Map<string, Set<Listener>>();
  fakeWindow = {
    devicePixelRatio: 1,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
    listenerCount() {
      let count = 0;
      for (const listeners of windowListeners.values()) count += listeners.size;
      return count;
    },
  };
  (globalThis as { window?: unknown }).window = fakeWindow;
  (globalThis as { document?: unknown }).document = {
    body,
    createElement: (tag: string) => tag === 'canvas' ? new FakeCanvas() : new FakeElement(tag.toUpperCase()),
    getElementById: () => null,
  };
}

function uninstallFakeDom(): void {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
}

afterEach(uninstallFakeDom);

describe('automap projection', () => {
  test('den renders only cells in the authoritative explored set', () => {
    const snapshot: AutomapSnapshot = {
      area: 'den',
      player: { x: 0, z: 0 },
      exploredDenCells: new Set(['0,0', '1,1']),
      denWalkGrid: {
        cells: new Uint8Array([
          1, 1, 0,
          0, 0, 1,
        ]),
        columns: 3,
        rows: 2,
      },
    };

    expect(projectAutomap(snapshot)).toEqual({
      area: 'den',
      player: { x: 0, z: 0 },
      cells: [
        { cx: 0, cy: 0, walkable: true },
        { cx: 1, cy: 1, walkable: false },
      ],
      landmarks: [],
      exits: [],
      questDirections: [],
    });
  });

  test('den projection reads only explored indexes, never the complete grid', () => {
    const reads: string[] = [];
    const cells = new Proxy(new Uint8Array([1, 1, 0, 0, 1, 1]), {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    projectAutomap({
      area: 'den',
      player: { x: 0, z: 0 },
      exploredDenCells: new Set(['0,0', '1,1']),
      denWalkGrid: { cells, columns: 3, rows: 2 },
    });

    expect(reads.sort()).toEqual(['0', '4']);
  });

  test('camp and wild never fabricate grid cells or reveal unauthorized markers', () => {
    const authored = [
      { id: 'reached-bridge', x: 4, z: 20, label: '熔渣石桥' },
      { id: 'unreached-ruin', x: -8, z: 30, label: '坠落熔炉遗址' },
    ] as const;
    const reached = filterReachedLandmarks(authored, new Set(['reached-bridge']));
    const snapshot: AutomapSnapshot = {
      area: 'wild',
      player: { x: 1, z: 15 },
      landmarks: reached,
      areaExits: [{ id: 'real-exit', x: 14, z: 24, label: '真实出口' }],
      questAuthorizedDirections: [{ id: 'real-exit', x: 14, z: 24, label: '前往深窟' }],
    };

    const projection = projectAutomap(snapshot);
    expect(projection.cells).toEqual([]);
    expect(projection.landmarks.map((marker) => marker.id)).toEqual(['reached-bridge']);
    expect(projection.exits.map((marker) => marker.id)).toEqual(['real-exit']);
    expect(projection.questDirections.map((marker) => marker.id)).toEqual(['real-exit']);
    expect(projection.exits[0]!.label).toBe('真实出口');
    expect(projection.questDirections[0]!.label).toBe('前往深窟');
    expect(projection.landmarks[0]!.label).toBe('熔渣石桥');
    expect(projection.landmarks.some((marker) => marker.id === 'unreached-ruin')).toBe(false);
    expect(projection.exits.some((marker) => marker.id === 'unauthorized-exit')).toBe(false);
  });

  test('runtime exit resolver keeps each boundary in its authored runtime coordinates', () => {
    const positions = {
      caveMouth: { x: 14, z: 24 },
      campGate: { x: 0, z: 14 },
      denExit: { x: 301, z: 303 },
    } as const;
    expect(resolveRuntimeExitPosition('cinderwatch-to-reach', positions)).toEqual(positions.campGate);
    expect(resolveRuntimeExitPosition('reach-to-cinderwatch', positions)).toEqual(positions.campGate);
    expect(resolveRuntimeExitPosition('reach-to-slagdeep', positions)).toEqual(positions.caveMouth);
    expect(resolveRuntimeExitPosition('slagdeep-to-reach', positions)).toEqual(positions.denExit);
  });
});

describe('automap state and lifecycle', () => {
  beforeEach(installFakeDom);

  test('panel open collapses expanded without hiding the persistent minimap', () => {
    const expanded = automapToggleExpanded({ minimapVisible: true, expanded: false });
    const afterPanel = automapAfterPanelOpen(expanded);
    expect(afterPanel).toEqual({ minimapVisible: true, expanded: false });
  });

  test('major panels collapse expanded while the persistent root remains visible', () => {
    const handle = installAutomap(mount as unknown as HTMLElement, {
      getSnapshot: () => ({
        area: 'camp',
        player: { x: 0, z: 5 },
        landmarks: [],
        questAuthorizedExits: [],
      }),
    });
    const ui = createUiLayerManager({
      onOwnershipChange: (_prev, next) => {
        if (next !== null) handle.collapseExpanded();
      },
    });

    for (const panel of ['inventory', 'craft', 'character', 'quests', 'settings'] as const) {
      handle.setExpanded(true);
      ui.open(panel);
      expect(handle.state()).toEqual({ minimapVisible: true, expanded: false });
      expect(handle.isMinimapVisible()).toBe(true);
      expect(mount.querySelectorAll('[data-hellforge-automap-root]')).toHaveLength(1);
      ui.close(panel);
    }
    handle.dispose();
  });

  test('install dispose install leaves one root and two canvases, with no stale tick', () => {
    let snapshotReads = 0;
    const snapshot: AutomapSnapshot = {
      area: 'camp',
      player: { x: 0, z: 5 },
      landmarks: [],
      questAuthorizedExits: [],
    };
    const callbacks = {
      getSnapshot: () => {
        snapshotReads += 1;
        return snapshot;
      },
    };

    const first = installAutomap(mount as unknown as HTMLElement, callbacks);
    first.tick();
    first.dispose();
    const readsAfterDispose = snapshotReads;
    first.tick();
    expect(snapshotReads).toBe(readsAfterDispose);
    expect(mount.querySelectorAll('[data-hellforge-automap-root]')).toHaveLength(0);
    expect(fakeWindow.listenerCount()).toBe(0);

    const second = installAutomap(mount as unknown as HTMLElement, callbacks);
    expect(mount.querySelectorAll('[data-hellforge-automap-root]')).toHaveLength(1);
    expect(mount.querySelectorAll('canvas')).toHaveLength(2);
    second.dispose();
    expect(mount.querySelectorAll('[data-hellforge-automap-root]')).toHaveLength(0);
    expect(fakeWindow.listenerCount()).toBe(0);
  });

  test('root is pointer-transparent and expanded map has no navigation listener', () => {
    const handle = installAutomap(mount as unknown as HTMLElement, {
      getSnapshot: () => ({
        area: 'camp',
        player: { x: 0, z: 5 },
        landmarks: [],
        questAuthorizedExits: [],
      }),
    });
    const root = mount.querySelectorAll('[data-hellforge-automap-root]')[0]!;
    const canvases = root.querySelectorAll('canvas');
    const close = root.querySelectorAll('[data-automap-close]')[0]!;

    expect(root.style.pointerEvents).toBe('none');
    expect(root.style.cssText).not.toContain('z-index:110');
    const minimapCss = root.querySelectorAll('[data-automap-minimap]')[0]!.style.cssText;
    expect(minimapCss).toContain('z-index:55');
    expect(minimapCss).toContain('left:max(12px,env(safe-area-inset-left))');
    expect(minimapCss).not.toContain('right:max(12px');
    expect(root.querySelectorAll('[data-automap-expanded]')[0]!.style.cssText).toContain('z-index:110');
    expect(canvases).toHaveLength(2);
    expect(canvases[0]!.listeners.get('click')?.size ?? 0).toBe(0);
    expect(canvases[1]!.listeners.get('click')?.size ?? 0).toBe(0);

    handle.setOpen(true);
    expect(handle.isOpen()).toBe(true);
    close.dispatch('click');
    expect(handle.isOpen()).toBe(false);
    handle.dispose();
  });

  test('den discovery and rendering never invent neighboring cells or a player cell', () => {
    const handle = installAutomap(mount as unknown as HTMLElement, {
      getSnapshot: () => ({
        area: 'den',
        player: { x: 0, z: 0 },
        exploredDenCells: new Set(['1,1']),
        denWalkGrid: { cells: new Uint8Array([1, 1, 1, 1]), columns: 2, rows: 2 },
      }),
    });
    const canvas = mount.querySelectorAll('canvas')[0] as FakeCanvas;
    expect(canvas.arcCount).toBe(0);
    expect(projectAutomap({
      area: 'den',
      player: { x: 0, z: 0 },
      exploredDenCells: new Set(['1,1']),
      denWalkGrid: { cells: new Uint8Array([1, 1, 1, 1]), columns: 2, rows: 2 },
    }).cells).toEqual([{ cx: 1, cy: 1, walkable: true }]);
    handle.dispose();
  });

  test('unchanged or coarsely unchanged snapshots do not redraw every tick', () => {
    let snapshot: AutomapSnapshot = {
      area: 'camp',
      player: { x: 0, z: 5 },
      landmarks: [],
      questAuthorizedExits: [],
    };
    const handle = installAutomap(mount as unknown as HTMLElement, {
      getSnapshot: () => snapshot,
    });
    const canvas = mount.querySelectorAll('canvas')[0] as FakeCanvas;
    const initialClears = canvas.clearCount;
    handle.tick();
    expect(canvas.clearCount).toBe(initialClears);
    snapshot = { ...snapshot, player: { x: 0.1, z: 5 } };
    handle.tick();
    expect(canvas.clearCount).toBe(initialClears);
    snapshot = { ...snapshot, player: { x: 0.6, z: 5 } };
    handle.tick(0.1);
    expect(canvas.clearCount).toBeGreaterThan(initialClears);
    handle.dispose();
  });

  test('small ticks skip snapshot production until the bounded cadence', () => {
    let snapshotReads = 0;
    const handle = installAutomap(mount as unknown as HTMLElement, {
      getSnapshot: () => {
        snapshotReads += 1;
        return {
          area: 'camp',
          player: { x: 0, z: 5 },
          landmarks: [],
          questAuthorizedExits: [],
        };
      },
    });
    const readsAfterInstall = snapshotReads;
    handle.tick(0.03);
    handle.tick(0.03);
    handle.tick(0.03);
    expect(snapshotReads).toBe(readsAfterInstall);
    handle.tick(0.04);
    expect(snapshotReads).toBe(readsAfterInstall + 1);
    handle.tick(0.03);
    handle.tick(0.03);
    handle.tick(0.03);
    expect(snapshotReads).toBe(readsAfterInstall + 1);
    handle.tick(0.1);
    expect(snapshotReads).toBe(readsAfterInstall + 2);
    handle.dispose();
  });
});
