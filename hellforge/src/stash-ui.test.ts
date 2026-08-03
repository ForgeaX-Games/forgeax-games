import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type ItemInstance, type ItemSlot } from './items';
import { installStashPanel, type StashCallbacks } from './stash-ui';

// ── minimal fake DOM (own copy — inventory-ui.test.ts's fakes are not
// exported). Supports exactly what stash-ui touches: attribute/dataset
// presence queries (querySelectorAll / closest), event dispatch, style
// records, id registry, and a test-controlled document.elementFromPoint.
type FakeListener = (ev?: unknown) => void;

const idRegistry = new Map<string, FakeEl>();
let capturedPointer: FakeEl | null = null;

/**
 * Minimal CSSStyleDeclaration stand-in: cssText parses into camelCased props
 * (real-DOM behavior), so `display:none` in a cssText assignment is visible to
 * later `style.display` reads, and kebab keys are reachable via camelCase
 * (e.g. style.zIndex → 'z-index'). Individual prop sets append to cssText.
 */
function fakeStyle(): Record<string, string> {
  const props: Record<string, string> = {};
  return new Proxy(props, {
    get(target, key) {
      if (key === 'cssText') {
        return Object.entries(target).map(([k, v]) => `${k}:${v};`).join('');
      }
      const name = String(key);
      if (name in target) return target[name];
      const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return target[kebab];
    },
    set(target, key, value) {
      if (key === 'cssText') {
        for (const k of Object.keys(target)) delete target[k];
        for (const decl of String(value).split(';')) {
          const i = decl.indexOf(':');
          if (i < 0) continue;
          target[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
        }
        return true;
      }
      target[String(key)] = String(value);
      return true;
    },
  });
}

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = fakeStyle();
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  textContent = '';
  className = '';
  private html = '';
  private _id = '';
  private listeners = new Map<string, Set<FakeListener>>();

  constructor(readonly tagName: string) {}

  get id(): string {
    return this._id;
  }

  set id(value: string) {
    if (this._id) idRegistry.delete(this._id);
    this._id = value;
    if (value) idRegistry.set(value, this);
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    for (const child of [...this.children]) child.remove();
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  private detach(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  appendChild(child: FakeEl): FakeEl {
    child.detach();
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeEl[]): void {
    for (const child of children) this.appendChild(child);
  }

  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    if (this._id) idRegistry.delete(this._id);
  }

  addEventListener(type: string, listener: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  setPointerCapture(): void {
    capturedPointer = this;
  }

  releasePointerCapture(): void {
    if (capturedPointer === this) capturedPointer = null;
  }

  /** Test-only event dispatch (production uses real DOM events). */
  dispatch(type: string, ev?: unknown): void {
    if (capturedPointer !== null && this !== capturedPointer && type === 'mousemove') {
      capturedPointer.dispatch('pointermove', ev);
      return;
    }
    if (capturedPointer !== null && this !== capturedPointer && type === 'mouseup') {
      capturedPointer.dispatch('pointerup', ev);
      return;
    }
    const normalized = type === 'mousedown' && !this.listeners.has('mousedown') ? 'pointerdown' : type;
    for (const listener of this.listeners.get(normalized) ?? []) listener(ev);
  }

  click(): void {
    this.dispatch('click');
  }

  querySelectorAll(selector: string): FakeEl[] {
    const m = /^\[data-([a-z0-9-]+)\]$/.exec(selector);
    const key = m?.[1]?.replace(/-([a-z0-9])/g, (_dash, c: string) => c.toUpperCase());
    const found: FakeEl[] = [];
    const visit = (el: FakeEl): void => {
      if (key !== undefined && el.dataset[key] !== undefined) found.push(el);
      for (const child of el.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return found;
  }

  closest(selector: string): FakeEl | null {
    const m = /^\[data-([a-z0-9-]+)\]$/.exec(selector);
    const key = m?.[1]?.replace(/-([a-z0-9])/g, (_dash, c: string) => c.toUpperCase());
    let el: FakeEl | null = this;
    while (el) {
      if (key !== undefined && el.dataset[key] !== undefined) return el;
      el = el.parent;
    }
    return null;
  }

  contains(el: FakeEl): boolean {
    let n: FakeEl | null = el;
    while (n) {
      if (n === this) return true;
      n = n.parent;
    }
    return false;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 1280, height: 720 };
  }
}

/** Test-controlled document.elementFromPoint hit (drag drop-target tests). */
let elementFromPointTarget: FakeEl | null = null;
/** The fake document FakeEl — document-scoped drag listeners land here. */
let fakeDocument: FakeEl;

function installFakeDocument(): FakeEl {
  fakeDocument = Object.assign(new FakeEl('document'), {
    head: new FakeEl('head'),
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => idRegistry.get(id) ?? null,
    elementFromPoint: () => elementFromPointTarget,
  });
  (globalThis as { document?: unknown }).document = fakeDocument;
  return new FakeEl('div');
}

function uninstallFakeDocument(): void {
  idRegistry.clear();
  elementFromPointTarget = null;
  delete (globalThis as { document?: unknown }).document;
}

function stubItem(slot: ItemSlot, id: string): ItemInstance {
  return {
    instanceId: id,
    slot,
    rarity: 'common',
    name: id,
    ilvl: 1,
    reqLevel: 1,
    affixes: [],
    score: 10,
  };
}

const callbacks = (): StashCallbacks & { onCloseCalls: number } => {
  const cbs: StashCallbacks & { onCloseCalls: number } = {
    onMoveToBag: () => true,
    onCloseCalls: 0,
    onClose: () => {
      cbs.onCloseCalls += 1;
    },
  };
  return cbs;
};

const stashGrid = (mount: FakeEl): FakeEl =>
  mount.querySelectorAll('[data-stash-grid]')[0]!;

describe('N-Stash stash panel', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  test('renders the 12×10 grid (120 cells) with the「仓库」header badge', () => {
    const handle = installStashPanel(callbacks(), mount as unknown as HTMLElement);
    handle.update([]);
    handle.show();

    const grid = stashGrid(mount);
    expect(grid).toBeDefined();
    expect(grid.children).toHaveLength(120);
    // every socket is placed on its own row/column
    expect(grid.children[0]!.style.gridColumn).toBe('1');
    expect(grid.children[119]!.style.gridRow).toBe('10');
    const header = mount.querySelectorAll('[data-stash-header]')[0];
    expect(header).toBeDefined();
    expect(header!.textContent).toBe('仓库');
  });

  test('footer shows the occupied-cell count and usage hint, refreshing only when visible', () => {
    const handle = installStashPanel(callbacks(), mount as unknown as HTMLElement);
    handle.update([{ item: stubItem('weapon', 'first'), x: 0, y: 0 }]);
    handle.show();

    const footer = mount.querySelectorAll('[data-stash-footer]')[0];
    expect(footer).toBeDefined();
    const count = mount.querySelectorAll('[data-stash-count]')[0]!;
    // weapon = 1×3 footprint → 3 occupied cells of 120 (bag-footer「背包 60/60」idiom)
    expect(count.textContent).toBe('仓库 3/120');
    // hint span is the footer's right-hand sibling
    expect(footer!.children[1]!.textContent).toBe('拖拽 ⇄ 背包转移 · B 关闭');

    // live refresh on update()
    handle.update([
      { item: stubItem('weapon', 'first'), x: 0, y: 0 },
      { item: stubItem('ring', 'second'), x: 0, y: 3 },
    ]);
    expect(count.textContent).toBe('仓库 4/120');

    // hidden panel: update() does not re-render (same visible-only rule as the rest of the panel)
    handle.hide();
    handle.update([{ item: stubItem('ring', 'only'), x: 0, y: 0 }]);
    expect(count.textContent).toBe('仓库 4/120');
    handle.show();
    expect(count.textContent).toBe('仓库 1/120');
  });

  test('update() renders anchors with data-stash-idx and respects multi-cell footprints', () => {
    const handle = installStashPanel(callbacks(), mount as unknown as HTMLElement);
    // weapon = 1×3, ring = 1×1 (slot default footprints)
    handle.update([
      { item: stubItem('weapon', 'long-staff'), x: 1, y: 1 },
      { item: stubItem('ring', 'small-ring'), x: 5, y: 0 },
    ]);
    handle.show();

    const grid = stashGrid(mount);
    expect(grid.children).toHaveLength(122);
    const tiles = mount.querySelectorAll('[data-stash-idx]');
    expect(tiles).toHaveLength(2);
    const staff = tiles.find((el) => el.dataset.instanceId === 'long-staff')!;
    expect(staff.dataset.stashIdx).toBe('0');
    expect(staff.style.gridColumn).toBe('2 / span 1');
    expect(staff.style.gridRow).toBe('2 / span 3');
    const ring = tiles.find((el) => el.dataset.instanceId === 'small-ring')!;
    expect(ring.dataset.stashIdx).toBe('1');
    expect(ring.style.gridColumn).toBe('6 / span 1');
    expect(ring.style.gridRow).toBe('1 / span 1');
  });

  test('close ✕ fires onClose', () => {
    const cbs = callbacks();
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([]);
    handle.show();

    const close = mount.querySelectorAll('[data-close-button]')[0]!;
    expect(close.attributes['aria-label']).toBe('关闭仓库');
    close.click();
    expect(cbs.onCloseCalls).toBe(1);
  });

  test('drag from a stash item onto a [data-bag-grid] element calls onMoveToBag with the right index', () => {
    const moved: number[] = [];
    const cbs = callbacks();
    cbs.onMoveToBag = (index) => {
      moved.push(index);
      return true;
    };
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([
      { item: stubItem('weapon', 'first'), x: 0, y: 0 },
      { item: stubItem('ring', 'second'), x: 3, y: 0 },
    ]);
    handle.show();

    const bagGrid = new FakeEl('div');
    bagGrid.dataset.bagGrid = '1';
    mount.appendChild(bagGrid);
    const tile = mount
      .querySelectorAll('[data-stash-idx]')
      .find((el) => el.dataset.instanceId === 'second')!;
    tile.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
    elementFromPointTarget = bagGrid;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    // valid target → green glow on the bag grid
    expect(bagGrid.style.boxShadow).toContain('80,200,80');
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(moved).toEqual([1]);
  });

  test('drop off-target does not call onMoveToBag and cancels the drag', () => {
    const moved: number[] = [];
    const cbs = callbacks();
    cbs.onMoveToBag = (index) => {
      moved.push(index);
      return true;
    };
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([{ item: stubItem('weapon', 'first'), x: 0, y: 0 }]);
    handle.show();

    const elsewhere = new FakeEl('div');
    elsewhere.dataset.notATarget = '1';
    mount.appendChild(elsewhere);
    const tile = mount.querySelectorAll('[data-stash-idx]')[0]!;
    tile.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
    elementFromPointTarget = elsewhere;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    expect(elsewhere.style.boxShadow).toBeUndefined();
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(moved).toEqual([]);
    // ghost cleaned up after the cancelled drop
    expect(mount.children.find((c) => c.style.zIndex === '240')).toBeUndefined();
  });

  test('drag released over the world (outside mount) cancels: ghost follows, no callback, no stuck state', () => {
    const moved: number[] = [];
    const cbs = callbacks();
    cbs.onMoveToBag = (index) => {
      moved.push(index);
      return true;
    };
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([{ item: stubItem('weapon', 'first'), x: 0, y: 0 }]);
    handle.show();

    // The 3D canvas is a SIBLING of mount — events over it never bubble
    // through mount, so drag tracking must be document-scoped. elementFromPoint
    // over the world resolves to a non-mount node.
    const canvas = new FakeEl('canvas');
    const tile = mount.querySelectorAll('[data-stash-idx]')[0]!;
    tile.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
    elementFromPointTarget = canvas;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    // ghost follows the cursor even over the world
    const ghost = mount.children.find((c) => c.style.zIndex === '240')!;
    expect(ghost).toBeDefined();
    expect(ghost.style.left).toBe('200px');
    expect(ghost.style.top).toBe('200px');

    // release over the world → CANCEL: no callback, ghost + glow cleared
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(moved).toEqual([]);
    expect(mount.children.find((c) => c.style.zIndex === '240')).toBeUndefined();

    // the click-swallow is not armed by the world release — the next click
    // through mount is not eaten
    let swallowed = false;
    mount.dispatch('click', {
      stopPropagation: () => { swallowed = true; },
      preventDefault: () => {},
    });
    expect(swallowed).toBe(false);

    // no stuck state: drag tracking is deregistered — a fresh press+release on
    // a stash cell neither resumes the old drag nor commits a move
    elementFromPointTarget = null;
    tile.dispatch('mousedown', { button: 0, clientX: 300, clientY: 300 });
    fakeDocument.dispatch('mouseup', { clientX: 300, clientY: 300 });
    expect(moved).toEqual([]);
    expect(mount.children.find((c) => c.style.zIndex === '240')).toBeUndefined();
    expect(handle.isOpen()).toBe(true);
  });

  test('hide() mid-drag cancels the drag — no callback, ghost removed', () => {
    const moved: number[] = [];
    const cbs = callbacks();
    cbs.onMoveToBag = (index) => {
      moved.push(index);
      return true;
    };
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([{ item: stubItem('weapon', 'first'), x: 0, y: 0 }]);
    handle.show();

    const bagGrid = new FakeEl('div');
    bagGrid.dataset.bagGrid = '1';
    mount.appendChild(bagGrid);
    const tile = mount.querySelectorAll('[data-stash-idx]')[0]!;
    tile.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    // k3: drag ghost reads over the near-black scene — lifted warm backdrop,
    // 2px rarity border + matching glow, icon nudged brighter.
    const ghost = mount.children.find((c) => c.style.zIndex === '240')!;
    expect(ghost.style.background).toBe('rgba(52,36,18,0.92)');
    expect(ghost.style.border).toBe('2px solid #d8d8d8');
    expect(ghost.style.boxShadow).toContain('color-mix(in srgb, #d8d8d8 55%, transparent)');
    expect(ghost.children[0]!.style.filter).toBe('brightness(1.15)');

    handle.hide();
    expect(mount.children.find((c) => c.style.zIndex === '240')).toBeUndefined();

    elementFromPointTarget = bagGrid;
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(moved).toEqual([]);
    expect(handle.isOpen()).toBe(false);
  });

  test('item vanished between mousedown and mouseup → commit is a no-op, callback NOT called', () => {
    const moved: number[] = [];
    const cbs = callbacks();
    cbs.onMoveToBag = (index) => {
      moved.push(index);
      return true;
    };
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([{ item: stubItem('weapon', 'first'), x: 0, y: 0 }]);
    handle.show();

    const bagGrid = new FakeEl('div');
    bagGrid.dataset.bagGrid = '1';
    mount.appendChild(bagGrid);
    const tile = mount.querySelectorAll('[data-stash-idx]')[0]!;
    tile.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
    elementFromPointTarget = bagGrid;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    // The anchor is gone before release (stash re-synced from the domain) —
    // the drop resolves by instance id at commit time and finds nothing.
    handle.update([]);
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(moved).toEqual([]);
  });

  test('dispose() detaches the root and does not throw when called twice', () => {
    const cbs = callbacks();
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([{ item: stubItem('weapon', 'first'), x: 0, y: 0 }]);
    handle.show();
    expect(mount.children.some((c) => c.id === 'hellforge-stash')).toBe(true);

    handle.dispose();
    // root detached from the mount; close routed through onClose exactly once
    expect(mount.children.some((c) => c.id === 'hellforge-stash')).toBe(false);
    expect(cbs.onCloseCalls).toBe(1);

    // second dispose is a safe no-op — no throw, root stays detached
    handle.dispose();
    expect(mount.children.some((c) => c.id === 'hellforge-stash')).toBe(false);
  });

  test('show/hide/toggle/isOpen track visibility', () => {
    const handle = installStashPanel(callbacks(), mount as unknown as HTMLElement);
    handle.update([]);
    expect(handle.isOpen()).toBe(false);
    // hidden: the grid container exists but nothing is rendered into it
    expect(stashGrid(mount).children).toHaveLength(0);

    handle.show();
    expect(handle.isOpen()).toBe(true);
    expect(stashGrid(mount).children).toHaveLength(120);

    handle.hide();
    expect(handle.isOpen()).toBe(false);

    handle.toggle();
    expect(handle.isOpen()).toBe(true);
    handle.toggle();
    expect(handle.isOpen()).toBe(false);
  });

  test('update() while hidden does not render', () => {
    const handle = installStashPanel(callbacks(), mount as unknown as HTMLElement);
    // hidden at install time — update must not build cells or tiles
    handle.update([{ item: stubItem('weapon', 'first'), x: 0, y: 0 }]);
    expect(stashGrid(mount).children).toHaveLength(0);

    handle.show();
    expect(stashGrid(mount).children).toHaveLength(121);

    // hidden again — update leaves the stale render untouched
    handle.hide();
    handle.update([]);
    expect(stashGrid(mount).children).toHaveLength(121);

    // showing again re-renders from the latest snapshot
    handle.show();
    expect(stashGrid(mount).children).toHaveLength(120);
  });

  test('a press after a committed drag is not swallowed (real Chrome fires no click after a cross-element drag)', () => {
    const moved: number[] = [];
    const cbs = callbacks();
    cbs.onMoveToBag = (index) => {
      moved.push(index);
      return true;
    };
    const handle = installStashPanel(cbs, mount as unknown as HTMLElement);
    handle.update([
      { item: stubItem('weapon', 'first'), x: 0, y: 0 },
      { item: stubItem('ring', 'second'), x: 3, y: 0 },
    ]);
    handle.show();

    // real commit drag: stash tile → bag grid
    const bagGrid = new FakeEl('div');
    bagGrid.dataset.bagGrid = '1';
    mount.appendChild(bagGrid);
    const tile = mount
      .querySelectorAll('[data-stash-idx]')
      .find((el) => el.dataset.instanceId === 'first')!;
    tile.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
    elementFromPointTarget = bagGrid;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(moved).toEqual([0]);

    // the commit armed the click-swallow: a trailing click with NO intervening
    // press (the environment the swallow was built for) is still swallowed
    let trailingSwallowed = false;
    mount.dispatch('click', {
      stopPropagation: () => { trailingSwallowed = true; },
      preventDefault: () => {},
    });
    expect(trailingSwallowed).toBe(true);

    // real Chrome fires no click after the drag, so the flag stays armed until
    // the next DELIBERATE press — that press (mousedown, dispatched at the
    // mount level as it would arrive after bubbling from a panel tile) must
    // disarm the swallow BEFORE its click fires
    let swallowed = false;
    mount.dispatch('mousedown', { button: 0, clientX: 300, clientY: 300 });
    mount.dispatch('click', {
      stopPropagation: () => { swallowed = true; },
      preventDefault: () => {},
    });
    expect(swallowed).toBe(false);
    // the disarm cleared only the click gate — the commit callback fired once
    expect(moved).toEqual([0]);
  });
});
