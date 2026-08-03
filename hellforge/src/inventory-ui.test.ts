import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { emptyEquipment, type Equipment, type ItemInstance, type ItemSlot, type Rarity } from './items';
import {
  DOLL_WELL_SIZE,
  INVENTORY_BAG_GEOMETRY,
  INVENTORY_EQUIPMENT_SLOTS,
  INVENTORY_SLOT_ICON_PX,
  bagClickEquipTarget,
  normalizeInventorySelection,
  installInventory,
  resolveInventoryDetail,
  resolveInventorySelection,
  wornSlotForCompare,
  type InventoryCallbacks,
} from './inventory-ui';
import { tooltipPlacement } from './ui-tooltip';

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

  get offsetWidth(): number { return 0; }
  get offsetHeight(): number { return 0; }

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

  replaceChildren(...children: FakeEl[]): void {
    this.innerHTML = '';
    this.append(...children);
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

  listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }

  querySelectorAll(selector: string): FakeEl[] {
    // Generic `[data-foo-bar]` attribute-presence matcher (dataset keys are
    // camelCased). Unknown selector shapes match nothing.
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
    // Same `[data-foo-bar]` attribute-presence matcher, walking up the parent
    // chain (drag drop-target resolution uses closest on elementFromPoint hits).
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

function stubItem(slot: ItemSlot, id: string, score: number): ItemInstance {
  return {
    instanceId: id,
    slot,
    rarity: 'common',
    name: id,
    ilvl: 1,
    reqLevel: 1,
    affixes: [],
    score,
  };
}

describe('PR10 T5 inventory wornSlotForCompare', () => {
  test('single-slot items resolve to that EquipSlot', () => {
    const eq = emptyEquipment();
    expect(wornSlotForCompare(eq, 'weapon')).toBe('weapon');
    eq.weapon = stubItem('weapon', 'w', 10);
    expect(wornSlotForCompare(eq, 'weapon')).toBe('weapon');
  });

  test('rings: prefer empty slot (emptier) over occupied', () => {
    const eq: Equipment = emptyEquipment();
    eq.ring1 = stubItem('ring', 'r1', 50);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring2');
    eq.ring1 = null;
    eq.ring2 = stubItem('ring', 'r2', 50);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring1');
  });

  test('rings: both filled → weaker score', () => {
    const eq: Equipment = emptyEquipment();
    eq.ring1 = stubItem('ring', 'strong', 90);
    eq.ring2 = stubItem('ring', 'weak', 20);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring2');
    eq.ring1 = stubItem('ring', 'weak2', 5);
    eq.ring2 = stubItem('ring', 'strong2', 80);
    expect(wornSlotForCompare(eq, 'ring')).toBe('ring1');
  });

  test('ring bag click targets the same weaker slot used for comparison', () => {
    const eq: Equipment = emptyEquipment();
    eq.ring1 = stubItem('ring', 'strong', 90);
    eq.ring2 = stubItem('ring', 'weak', 20);
    expect(bagClickEquipTarget(eq, 'ring')).toBe('ring2');
  });
});

describe('N3 C1 inventory information layer', () => {
  test('selection identity survives a prior bag splice and resolves the current index', () => {
    const eq = emptyEquipment();
    const before = [
      { item: stubItem('ring', 'spliced-first', 10), x: 0, y: 0 },
      { item: stubItem('ring', 'selected-ring', 20), x: 1, y: 0 },
    ];
    expect(resolveInventorySelection('selected-ring', eq, before)).toMatchObject({
      instanceId: 'selected-ring',
      source: 'bag',
      bagIndex: 1,
    });

    const afterPriorSplice = [
      { item: stubItem('ring', 'selected-ring', 20), x: 0, y: 0 },
    ];
    expect(resolveInventorySelection('selected-ring', eq, afterPriorSplice)).toMatchObject({
      instanceId: 'selected-ring',
      source: 'bag',
      bagIndex: 0,
    });
  });

  test('selection normalization clears when the selected instance was removed', () => {
    const eq = emptyEquipment();
    const bag = [{ item: stubItem('ring', 'survivor', 20), x: 0, y: 0 }];
    expect(normalizeInventorySelection('removed-ring', eq, bag)).toBeNull();
    expect(resolveInventorySelection('removed-ring', eq, bag)).toBeNull();
  });

  test('selected detail exposes rarity styling and positive/negative trade-offs', () => {
    const equipped = stubItem('weapon', 'equipped-weapon', 40);
    equipped.rarity = 'common';
    equipped.affixes = [
      { stat: 'maxHp', v: 5, label: '+5 生命上限' },
      { stat: 'cdr', v: 0.08, label: '-8% 技能冷却' },
    ];
    const candidate = stubItem('weapon', 'candidate-weapon', 60);
    candidate.rarity = 'rare';
    candidate.affixes = [
      { stat: 'maxHp', v: 10, label: '+10 生命上限' },
      { stat: 'cdr', v: 0.05, label: '-5% 技能冷却' },
    ];
    const eq: Equipment = { ...emptyEquipment(), weapon: equipped };
    const detail = resolveInventoryDetail(
      'candidate-weapon',
      eq,
      [{ item: candidate, x: 0, y: 0 }],
      1,
    );

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      rarityLabel: '稀有',
      rarityColor: '#ffd04a',
      comparison: expect.arrayContaining([
        expect.objectContaining({ stat: 'maxHp', polarity: 'positive' }),
        expect.objectContaining({ stat: 'cdr', polarity: 'negative' }),
      ]),
    });
  });

  test('keeps exactly ten equipment slots and the existing 12×5 bag geometry', () => {
    expect(INVENTORY_EQUIPMENT_SLOTS).toHaveLength(10);
    expect(new Set(INVENTORY_EQUIPMENT_SLOTS).size).toBe(10);
    expect(INVENTORY_BAG_GEOMETRY).toEqual({
      cols: 12,
      rows: 5,
      // N3R-N3 F4: default pitch 40px→38px (12×5 spans untouched)
      cellPx: 38,
      gapPx: 4,
    });
  });
});

describe('N3 C1 inventory teardown', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const callbacks = () => ({
    onEquipFromBag: () => false,
    onUnequip: () => false,
    onMelt: () => {},
    onClose: () => {
      throw new ReferenceError('uiLayers is not initialized');
    },
  });

  test('real dispose contains early close failure and removes listeners, root, and fallback tooltip', () => {
    const handle = installInventory(
      callbacks(),
      mount as unknown as HTMLElement,
    );
    handle.update(emptyEquipment(), [], 1, 0, { common: 0, magic: 0, rare: 0 });
    handle.show();

    // the click-swallow capture + the press-disarm capture stay on mount —
    // drag tracking is document-scoped per drag (startDrag/endDrag)
    expect(mount.listenerCount()).toBe(2);
    expect(mount.children).toHaveLength(2);
    expect(idRegistry.get('hellforge-inventory')).not.toBeNull();
    expect(idRegistry.get('hellforge-ui-tooltip')).not.toBeNull();

    expect(() => handle.dispose()).not.toThrow();
    expect(mount.listenerCount()).toBe(0);
    expect(mount.children).toHaveLength(0);
    expect(idRegistry.get('hellforge-inventory')).toBeUndefined();
    expect(idRegistry.get('hellforge-ui-tooltip')).toBeUndefined();
  });

  test('real dispose does not dispose an injected shared tooltip', () => {
    let tooltipDisposals = 0;
    const tooltip = {
      show: () => {},
      move: () => {},
      hide: () => {},
      dispose: () => { tooltipDisposals += 1; },
    };
    const handle = installInventory(
      callbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );

    expect(idRegistry.get('hellforge-ui-tooltip')).toBeUndefined();
    expect(() => handle.dispose()).not.toThrow();
    expect(tooltipDisposals).toBe(0);
    expect(mount.listenerCount()).toBe(0);
    expect(mount.children).toHaveLength(0);
  });
});

// ── N3R shared fakes ─────────────────────────────────────────────────────────
const n3rCallbacks = (): InventoryCallbacks => ({
  onEquipFromBag: () => false,
  onUnequip: () => false,
  onMelt: () => {},
  onClose: () => {},
});

/** Tooltip handle that records the HTML handed to show(). */
const captureTooltip = () => {
  const shown: string[] = [];
  const tooltip = {
    show: (content: unknown) => { shown.push(String(content)); },
    move: () => {},
    hide: () => {},
    dispose: () => {},
  };
  return { shown, tooltip };
};

describe('N3R G1 diff bar layout and tooltip width budget', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  test('bag hover tooltip stacks the diff as a bottom full-width bar, not a third column', () => {
    const { shown, tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    const eq: Equipment = { ...emptyEquipment(), weapon: stubItem('weapon', 'worn-w', 10) };
    handle.update(
      eq,
      [{ item: stubItem('weapon', 'cand-w', 20), x: 0, y: 0 }],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();

    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'cand-w');
    expect(tile).toBeDefined();
    tile!.dispatch('mousemove', { clientX: 900, clientY: 300 });

    expect(shown).toHaveLength(1);
    const html = shown[0]!;
    // column shell: item columns row on top, diff bar full-width at the bottom
    expect(html).toContain('flex-direction:column');
    expect(html).toContain('width:100%');
    expect(html).toContain('对比');
    expect(html).not.toContain('min-width:140px');
    // both item columns stay; the diff bar comes after them
    expect(html).toContain('背包');
    expect(html).toContain('已装备');
    expect(html.indexOf('对比')).toBeGreaterThan(html.indexOf('已装备'));
  });

  test('tooltipPlacement caps width to the mount budget and keeps the tip on-screen', () => {
    // 1080p, cursor in the right half, wide tip: flips left, stays inside.
    const m = { left: 0, top: 0, width: 1920, height: 1080 };
    const wide = tooltipPlacement(1500, 500, 700, 300, m);
    expect(wide.maxWidth).toBe(1920 - 32);
    expect(wide.left).toBeGreaterThanOrEqual(4);
    expect(wide.left + Math.min(700, wide.maxWidth)).toBeLessThanOrEqual(1920 - 8);
    // Narrow mount: the budget shrinks the tip instead of clipping it.
    const narrow = tooltipPlacement(100, 100, 700, 300, { left: 0, top: 0, width: 400, height: 300 });
    expect(narrow.maxWidth).toBe(400 - 32);
    expect(narrow.left + Math.min(700, narrow.maxWidth)).toBeLessThanOrEqual(400 - 8);
  });

  test('detail card renders tradeoffs as a full-width bar after the two-column grid', () => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    const equipped = stubItem('weapon', 'worn-w', 10);
    equipped.affixes = [{ stat: 'maxHp', v: 5, label: '+5 生命上限' }];
    const candidate = stubItem('weapon', 'cand-w', 20);
    candidate.affixes = [{ stat: 'maxHp', v: 10, label: '+10 生命上限' }];
    const eq: Equipment = { ...emptyEquipment(), weapon: equipped };
    handle.update(eq, [{ item: candidate, x: 0, y: 0 }], 1, 0, { common: 0, magic: 0, rare: 0 });
    handle.show();

    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'cand-w');
    tile!.dispatch('click');

    const detail = mount.querySelectorAll('[data-inventory-detail]')[0]!;
    const html = detail.innerHTML;
    expect(html).toContain('grid-template-columns');
    expect(html).toContain('优势');
    expect(html).toContain('width:100%');
    // tradeoff bar is appended after the two-column grid
    expect(html.indexOf('width:100%')).toBeGreaterThan(html.indexOf('grid-template-columns'));
  });
});

describe('N3R G4 bag tabs', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const setup = (): void => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(
      emptyEquipment(),
      [],
      1,
      120,
      { common: 2, magic: 1, rare: 0 },
      { life: 3, mana: 1 },
    );
    handle.show();
  };

  const tabButton = (id: string): FakeEl =>
    mount.querySelectorAll('[data-bag-tab]').find((el) => el.dataset.bagTab === id)!;
  const tabPane = (id: string): FakeEl =>
    mount.querySelectorAll('[data-bag-tab-pane]').find((el) => el.dataset.bagTabPane === id)!;
  const bagGrid = (): FakeEl => mount.querySelectorAll('[data-bag-grid]')[0]!;
  const bagCount = (): FakeEl => mount.querySelectorAll('[data-bag-count]')[0]!;

  test('equipment tab is the default: 12×5 grid rendered, count lands in the footer', () => {
    setup();
    expect(bagGrid().style.display).toBe('grid');
    expect(bagGrid().children).toHaveLength(60);
    expect(tabPane('consumables').style.display).toBe('none');
    expect(tabPane('materials').style.display).toBe('none');
    expect(bagCount().textContent).toBe('背包 0/60');
  });

  test('consumables tab lists potion stock from update props with use hints', () => {
    setup();
    tabButton('consumables').click();
    expect(bagGrid().style.display).toBe('none');
    const pane = tabPane('consumables');
    expect(pane.style.display).toBe('flex');
    expect(pane.innerHTML).toContain('生命药水');
    expect(pane.innerHTML).toContain('×3');
    expect(pane.innerHTML).toContain('法力药水');
    expect(pane.innerHTML).toContain('×1');
    expect(pane.innerHTML).toContain('按 5');
    expect(pane.innerHTML).toContain('按 6');
    // N3R-R: row cards carry the potion flask art (gradient ids are per-kind)
    expect(pane.innerHTML).toContain('hf-pot-life');
    expect(pane.innerHTML).toContain('hf-pot-mana');
    expect(bagCount().textContent).toBe('消耗 4');
  });

  test('materials tab lists shard counts and the footer keeps gold plus the tiny count', () => {
    setup();
    tabButton('materials').click();
    const pane = tabPane('materials');
    expect(pane.style.display).toBe('flex');
    expect(pane.innerHTML).toContain('白色碎片');
    expect(pane.innerHTML).toContain('×2');
    expect(pane.innerHTML).toContain('蓝色碎片');
    expect(pane.innerHTML).toContain('×1');
    expect(pane.innerHTML).toContain('黄色碎片');
    // N3R-R: row cards carry the shard art (gradient ids are per-tier)
    expect(pane.innerHTML).toContain('hf-shard-common');
    expect(pane.innerHTML).toContain('hf-shard-magic');
    expect(pane.innerHTML).toContain('hf-shard-rare');
    expect(bagCount().textContent).toBe('材料 3');
    // footer currency row: gold pill first, tiny count label beside it —
    // materials pills migrated to this tab
    const currency = mount.querySelectorAll('[data-inventory-currency]')[0]!;
    expect(currency.children).toHaveLength(2);
    expect(currency.children[0]!.innerHTML).toContain('金币');
    expect(currency.children[0]!.innerHTML).toContain('120');
    expect(currency.children[1]!.textContent).toBe('材料 3');
  });

  test('switching back to equipment re-renders the 12×5 grid', () => {
    setup();
    tabButton('materials').click();
    expect(bagGrid().style.display).toBe('none');
    tabButton('equipment').click();
    expect(bagGrid().style.display).toBe('grid');
    expect(bagGrid().children).toHaveLength(60);
    expect(bagCount().textContent).toBe('背包 0/60');
  });
});

describe('N3R-R3 S2 engraved paper doll', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  test('silhouette is one crisp bone-white engraving — no aura, no breathe, no blur (fallback pending A7)', () => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(emptyEquipment(), [], 1, 0, { common: 0, magic: 0, rare: 0 });
    handle.show();

    const sil = mount.querySelectorAll('[data-paper-doll-silhouette]')[0];
    expect(sil).toBeDefined();
    // invariants kept: behind the slots, never interactive
    expect(sil!.style.cssText).toContain('z-index:0');
    expect(sil!.style.cssText).toContain('pointer-events:none');
    // S2 + N3R-N3 F5: bone-white/parchment engraved strokes (α 0.9→1.0) over a
    // low-alpha fill (0.13→0.16) so the figure still reads through the wells;
    // 96:160 body
    expect(sil!.innerHTML).toContain('stroke="rgba(201,184,150,1.0)"');
    expect(sil!.innerHTML).toContain('fill="rgba(201,184,150,0.16)"');
    expect(sil!.style.cssText).toContain('width:132px;height:220px');
    expect(sil!.innerHTML).toContain('width="132" height="220"');
    // F5 配套校准: the element carries its full engraving opacity now
    expect(sil!.style.cssText).toContain('opacity:1.0');
    // exactly one crisp layer: no blur under-layer, no breathing animation, no gold aura
    expect(sil!.innerHTML.match(/<svg/g)).toHaveLength(1);
    expect(sil!.innerHTML).not.toContain('blur');
    expect(sil!.innerHTML).not.toContain('hf-doll-breathe');
    expect(sil!.style.cssText).not.toContain('drop-shadow');
    // stage-floor pool stays a weak dark-warm radial (≤0.10), not a light source
    const glow = mount.querySelectorAll('[data-paper-doll-glow]')[0];
    expect(glow).toBeDefined();
    expect(glow!.style.cssText).toContain('radial-gradient');
    expect(glow!.style.cssText).toContain('rgba(64,46,26,0.10)');
    expect(glow!.style.cssText).toContain('z-index:0');
  });
});

describe('N3R-R visual rework: portrait slab, flat wells, visible doll', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const boot = (): void => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(
      emptyEquipment(),
      [],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
      { life: 2, mana: 1 },
    );
    handle.show();
  };

  test('root restores the painted frame locked to its native 3:4 geometry', () => {
    boot();
    const root = idRegistry.get('hellforge-inventory');
    expect(root).toBeDefined();
    const css = root!.style.cssText;
    // N3R-R2: 画框恢复 — background 是 3:4 石板框资产，center/100% 100% 零畸变
    // 的前提是盒子本身锁 3:4（aspect-ratio 让 width 由 height 推导）
    expect(css).toContain('panel-frame-inventory.webp');
    expect(css).toContain('center/100% 100% no-repeat');
    expect(css).toContain('aspect-ratio:3/4');
    expect(css).toContain('height:min(calc(100% - 48px),900px)');
    expect(css).toContain('width:auto');
    expect(css).toContain('max-width:96vw');
    expect(css).toContain('right:0');
    expect(css).toContain('top:24px');
    // 纯 CSS 石板 + border-image 金边外壳已移除
    expect(css).not.toContain('repeating-linear-gradient');
    expect(css).not.toContain('border-image');
  });

  test('body inset is percentage-based so content sits inside the parchment core', () => {
    boot();
    const root = idRegistry.get('hellforge-inventory')!;
    const body = root.children[0]!;
    // 顶部 11.5% 避开框顶铁砧纹章；两侧 10.5% 避开熔岩纹石边；底部 10%
    expect(body.style.cssText).toContain('padding:11.5% 10.5% 10%');
    // 内衬是百分比，内容区半透明背景仍让羊皮纸透出
    const grid = mount.querySelectorAll('[data-bag-grid]')[0];
    expect(grid!.style.cssText).toContain('rgba(8,6,4,0.35)');
  });

  test('bag grid scales via CSS vars and the 720p media query tightens them', () => {
    boot();
    const grid = mount.querySelectorAll('[data-bag-grid]')[0]!;
    // 12×5 行列数与 span 逻辑零改动，只有格径走变量（N3R-N3 F4: 默认 38px）
    expect(grid!.children).toHaveLength(60);
    expect(grid.style.cssText).toContain('var(--hf-bag-cell,38px)');
    expect(grid.style.cssText).toContain('var(--hf-bag-gap,4px)');
    const cell = grid.children[0]!;
    expect(cell.style.cssText).toContain('var(--hf-bag-cell,38px)');
    // max-height:800px 媒体查询：28px 格 + 3px 缝 + 剪影收紧 + detail 72px 上限
    const root = idRegistry.get('hellforge-inventory')!;
    const styleEl = root.children.find((el) => el.tagName === 'style');
    expect(styleEl).toBeDefined();
    const css = styleEl!.textContent;
    expect(css).toContain('@media (max-height:800px)');
    expect(css).toContain('--hf-bag-cell:28px');
    expect(css).toContain('--hf-bag-gap:3px');
    expect(css).toContain('[data-inventory-detail]{flex:none;max-height:72px;');
    // S1/S2: the multi-size doll grid scales at 720p; the breathing keyframes are gone
    expect(css).toContain('[data-doll-body]{transform:scale(0.85)');
    expect(css).toContain('scale(0.82)');
    expect(css).not.toContain('hf-doll-breathe');
    // N3R v1.1: the 720p scroll column carries .hf-scroll so its scrollbar is
    // forged chrome, not the native white-gray bar
    const layout = mount.querySelectorAll('[data-inventory-layout]')[0]!;
    expect(layout.className).toContain('hf-scroll');
  });

  test('content is a single vertical column (doll on top, bag below)', () => {
    boot();
    const layout = mount.querySelectorAll('[data-inventory-layout]')[0];
    expect(layout).toBeDefined();
    expect(layout!.style.cssText).toContain('flex-direction:column');
    expect(layout!.style.cssText).not.toContain('grid-template-columns');
  });

  test('equip wells and bag sockets are flat CSS — no painted gem-frame art', () => {
    boot();
    const well = mount.querySelectorAll('[data-slot]')[0];
    expect(well).toBeDefined();
    expect(well!.style.cssText).not.toContain('url(');
    // k3 #4: empty wells carry a dimmed goldDim bezel and doubled top inset
    expect(well!.style.cssText).toContain('border:1px solid rgba(168,132,64,0.45)');
    expect(well!.style.cssText).toContain('inset 0 6px 16px');
    const grid = mount.querySelectorAll('[data-bag-grid]')[0];
    expect(grid!.children).toHaveLength(60);
    const cell = grid!.children[0]!;
    expect(cell.style.cssText).not.toContain('url(');
    // 背包格线明显轻于装备井
    expect(cell.style.cssText).toContain('rgba(138,122,90,0.18)');
    expect(cell.style.cssText).toContain('rgba(8,6,4,0.4)');
  });

  test('empty equip well keeps its slot silhouette; no breathing or blur layers remain', () => {
    boot();
    const well = mount.querySelectorAll('[data-slot]')[0]!;
    const sil = well.children[0]!;
    expect(sil.style.cssText).toContain('opacity:0.3');
    expect(sil.innerHTML).toContain('<svg');
    const doll = mount.querySelectorAll('[data-paper-doll-silhouette]')[0]!;
    expect(doll.innerHTML).not.toContain('hf-doll-breathe');
    expect(doll.innerHTML).not.toContain('blur');
  });
});

describe('N3R-R3 visual target spec (S1 well array, S3 stage, S4 detail fold, S5 gold plaque)', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const boot = (gold = 0): void => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(
      emptyEquipment(),
      [],
      1,
      gold,
      { common: 0, magic: 0, rare: 0 },
      { life: 2, mana: 1 },
    );
    handle.show();
  };

  test('S1: multi-size wells wrap the figure — uneven 6×5 tracks with all ten slot areas', () => {
    boot();
    const doll = mount.querySelectorAll('[data-doll-body]')[0]!;
    expect(doll).toBeDefined();
    // N3R v1.1: side wells 44→56px (gloves/boots climb into row 4), the armor
    // pair gives up 88→84 each — total stays 408px
    expect(doll.style.cssText).toContain('grid-template-columns:64px 56px 84px 84px 56px 64px');
    // N3R-N3 F1: rows 60/40/53/53/38 → 46/40/53/53/52 — helm 106px→92px pays
    // for the bottom row 38px→52px so its wells carry ~40px icons.
    expect(doll.style.cssText).toContain('grid-template-rows:46px 40px 53px 53px 52px');
    expect(doll.style.cssText).toContain(
      "grid-template-areas:'. . helm helm . .' 'weapon . helm helm amulet offhand' " +
        "'weapon . armor armor . offhand' 'weapon gloves armor armor boots offhand' " +
        "'ring1 gloves belt belt boots ring2'",
    );
    // no uniform 4×4 table anymore
    expect(doll.style.cssText).not.toContain('repeat(4,52px)');
    // N3R v1.1: gloves/boots wells span rows 4-5 (56×111); doll track height
    // stays 244px + 4 gaps×6 = 268 (+8 padding) — no doll-height growth
    expect(DOLL_WELL_SIZE.gloves).toEqual({ w: 56, h: 111 });
    expect(DOLL_WELL_SIZE.boots).toEqual({ w: 56, h: 111 });
    const trackH = 46 + 40 + 53 + 53 + 52;
    expect(trackH + 4 * 6 + 8).toBeLessThanOrEqual(310);
    // ten wells, one per slot, each carrying its named grid area
    const wells = mount.querySelectorAll('[data-slot]');
    expect(wells).toHaveLength(10);
    for (const slot of ['helm', 'weapon', 'armor', 'amulet', 'offhand', 'gloves', 'belt', 'ring1', 'boots', 'ring2']) {
      expect(wells.find((el) => el.dataset.slot === slot)?.style.cssText).toContain(`grid-area:${slot}`);
    }
  });

  test('S3: equip stage floor and gold hairline separate stage from bag zone', () => {
    boot();
    const stage = mount.querySelectorAll('[data-stage-pane]')[0]!;
    expect(stage).toBeDefined();
    // warm-dark stage floor, lighter than the bag zone; restrained edge
    expect(stage.style.cssText).toContain(
      'linear-gradient(180deg,rgba(52,40,26,0.55) 0%,rgba(20,14,9,0.25) 100%)',
    );
    expect(stage.style.cssText).toContain('border-radius:4px');
    const divider = mount.querySelectorAll('[data-stage-divider]')[0]!;
    expect(divider).toBeDefined();
    // gold hairline (goldDividerHtml) between the stage and the bag pane
    expect(divider.innerHTML).toContain('linear-gradient(90deg,transparent,#4a3a20');
    const layout = mount.querySelectorAll('[data-inventory-layout]')[0]!;
    expect(layout.children.map((c) => c.tagName)).toEqual(['div', 'div', 'div']);
    expect(layout.children[1]).toBe(divider);
    // tab row follows the divider zone (DOM order untouched)
    expect(mount.querySelectorAll('[data-bag-tab]')).toHaveLength(3);
  });

  test('S4: detail card folds to a thin strip by default and expands on selection', () => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    const equipped = stubItem('weapon', 'worn-w', 10);
    const candidate = stubItem('weapon', 'cand-w', 20);
    candidate.affixes = [{ stat: 'maxHp', v: 5, label: '+5 生命上限' }];
    const eq: Equipment = { ...emptyEquipment(), weapon: equipped };
    handle.update(eq, [{ item: candidate, x: 0, y: 0 }], 1, 0, { common: 0, magic: 0, rare: 0 });
    handle.show();

    const detail = mount.querySelectorAll('[data-inventory-detail]')[0]!;
    // N3R-N3 F4: collapsed strip 30px→26px, no flex growth, hint text
    expect(detail.style.cssText).toContain('flex:0 1 auto');
    expect(detail.style.cssText).toContain('min-height:26px');
    expect(detail.innerHTML).toContain('点击物品查看');

    // selecting an item expands the card — capped at 96px with in-card
    // scrolling so the footer never leaves the parchment core (G1 diff bar
    // untouched); F3 keeps a 6px side inset
    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'cand-w')!;
    tile.dispatch('click');
    expect(detail.style.cssText).toContain('flex:0 1 auto');
    expect(detail.style.cssText).toContain('max-height:96px');
    expect(detail.style.cssText).toContain('overflow:auto');
    expect(detail.style.cssText).toContain('width:calc(100% - 12px)');
    // N3R v1.1: the in-card scroll surface carries the forged .hf-scroll
    // chrome — the native white-gray scrollbar never shows in the expanded card
    expect(detail.className).toContain('hf-scroll');
    expect(detail.innerHTML).toContain('grid-template-columns');
    expect(detail.innerHTML).toContain('优势');
  });

  test('S5: gold sits in a small gold-rimmed plaque with a coin icon; hints stay right', () => {
    boot(120);
    const currency = mount.querySelectorAll('[data-inventory-currency]')[0]!;
    // N3R-N3 去字: the bag count rides beside the plaque as a tiny dim label
    expect(currency.children).toHaveLength(2);
    const plaque = currency.children[0]!;
    // gold-rimmed plate + coin icon + count
    expect(plaque.innerHTML).toContain('hf-coin');
    expect(plaque.innerHTML).toContain('<circle cx="10" cy="10" r="8.5"');
    expect(plaque.innerHTML).toContain('120');
    expect(plaque.innerHTML).toContain('金币');
    const count = currency.children[1]!;
    expect(count.textContent).toBe('背包 0/60');
    expect(count.style.cssText).toContain('font:600 10px');
    expect(count.style.cssText).toContain('color:#8a7a58');
  });
});

describe('N3R-N3 spec F1-F5 fine-tuning', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const boot = (): void => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(
      { ...emptyEquipment(), weapon: stubItem('weapon', 'worn-w', 10) },
      [],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();
  };

  test('F1: icon map — big wells get big icons, weapon ≥48px, everything in [28,96]', () => {
    expect(INVENTORY_SLOT_ICON_PX.armor).toBeGreaterThan(INVENTORY_SLOT_ICON_PX.ring1);
    expect(INVENTORY_SLOT_ICON_PX.helm).toBeGreaterThan(INVENTORY_SLOT_ICON_PX.amulet);
    expect(INVENTORY_SLOT_ICON_PX.weapon).toBeGreaterThanOrEqual(48);
    expect(INVENTORY_SLOT_ICON_PX.offhand).toBeGreaterThanOrEqual(48);
    // N3R v1.1: gloves/boots wells climb a row (56×111) → icons ≥44px, closing
    // in on the weapon well's 51px "almost fills the well" look
    expect(INVENTORY_SLOT_ICON_PX.gloves).toBeGreaterThanOrEqual(44);
    expect(INVENTORY_SLOT_ICON_PX.boots).toBeGreaterThanOrEqual(44);
    // armor stays height-bound — still the largest icon, ≥88px
    expect(INVENTORY_SLOT_ICON_PX.armor).toBeGreaterThanOrEqual(88);
    for (const px of Object.values(INVENTORY_SLOT_ICON_PX)) {
      expect(px).toBeGreaterThanOrEqual(28);
      expect(px).toBeLessThanOrEqual(96);
    }
  });

  test('F1: equipped well renders the icon at the mapped size — no item-name text inside the well', () => {
    boot();
    const well = mount.querySelectorAll('[data-slot]').find((el) => el.dataset.slot === 'weapon')!;
    expect(well.dataset.instanceId).toBe('worn-w');
    // F2: icon only — the name lives in the tooltip and the detail card
    expect(well.children).toHaveLength(1);
    const icon = well.children[0]!;
    expect(icon.style.cssText).toContain(`width:${INVENTORY_SLOT_ICON_PX.weapon}px`);
    expect(icon.style.cssText).toContain(`height:${INVENTORY_SLOT_ICON_PX.weapon}px`);
    expect(icon.style.cssText).toContain('object-fit:contain');
  });

  test('F2: empty wells scale the silhouette to the well; slot name is hover-only', () => {
    boot();
    const helmWell = mount.querySelectorAll('[data-slot]').find((el) => el.dataset.slot === 'helm')!;
    // silhouette at the mapped size, no persistent 9px label under it
    expect(helmWell.children).toHaveLength(1);
    expect(helmWell.children[0]!.innerHTML).toContain(`width="${INVENTORY_SLOT_ICON_PX.helm}" height="${INVENTORY_SLOT_ICON_PX.helm}"`);
    // hover-only slot name (悬停提示)
    const { shown, tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(emptyEquipment(), [], 1, 0, { common: 0, magic: 0, rare: 0 });
    handle.show();
    const emptyWell = mount.querySelectorAll('[data-slot]').find((el) => el.dataset.slot === 'helm')!;
    emptyWell.dispatch('mousemove', { clientX: 400, clientY: 200 });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain('头盔');
  });

  test('F3: tab row centers on the grid axis; detail/footer keep a 6px inset', () => {
    boot();
    const bagTabsRow = mount.querySelectorAll('[data-bag-tabs-row]')[0]!;
    const bagPane = bagTabsRow.parent!;
    expect(bagPane.style.cssText).toContain('align-items:center');
    expect(mount.querySelectorAll('[data-bag-tabs-row]')).toHaveLength(1);
    const detail = mount.querySelectorAll('[data-inventory-detail]')[0]!;
    expect(detail.style.cssText).toContain('width:calc(100% - 12px)');
    // footer is the last bagPane child (tabs, grid, panes, detail, footer)
    const footer = bagPane.children[bagPane.children.length - 1]!;
    expect(footer.style.cssText).toContain('width:calc(100% - 12px)');
  });

  test('F4: body hard-guards the parchment core; detail scrolls internally; 720p caps it at 72px', () => {
    boot();
    const root = idRegistry.get('hellforge-inventory')!;
    expect(root.children[0]!.style.cssText).toContain('overflow:hidden');
    // expand the detail card by selecting the equipped weapon
    mount
      .querySelectorAll('[data-slot]')
      .find((el) => el.dataset.instanceId === 'worn-w')!
      .dispatch('click');
    const detail = mount.querySelectorAll('[data-inventory-detail]')[0]!;
    expect(detail.style.cssText).toContain('max-height:96px');
    expect(detail.style.cssText).toContain('overflow:auto');
    const styleEl = root.children.find((el) => el.tagName === 'style')!;
    expect(styleEl.textContent).toContain('max-height:72px');
  });

  test('F5: well floors are faintly translucent so the engraving shows through', () => {
    boot();
    const well = mount.querySelectorAll('[data-slot]')[0]!;
    // k3 #1: floor deepened + cooled, α stays 0.88 (engraving still shows)
    expect(well.style.cssText).toContain('linear-gradient(180deg,rgba(22,16,12,0.88),rgba(10,7,5,0.88))');
  });
});

describe('N3R-N3 inventory de-texting (去字)', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const boot = (): void => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(
      { ...emptyEquipment(), weapon: stubItem('weapon', 'worn-w', 10) },
      [{ item: stubItem('ring', 'bag-r', 20), x: 0, y: 0 }],
      1,
      120,
      { common: 0, magic: 0, rare: 0 },
      { life: 1, mana: 0 },
    );
    handle.show();
  };

  const collectText = (el: FakeEl): string[] => {
    const out: string[] = [];
    const visit = (n: FakeEl): void => {
      if (n.textContent) out.push(n.textContent);
      for (const child of n.children) visit(child);
    };
    visit(el);
    return out;
  };

  test('panel leads with the stage: no big title band, no stage title, no bag title row', () => {
    boot();
    const root = idRegistry.get('hellforge-inventory')!;
    // the header row and its gold hairline are gone — body holds the column only
    const body = root.children[0]!;
    expect(body.children).toHaveLength(1);
    // the doll stage holds just the wells body — no「烬行者 · 装备」title
    const stage = mount.querySelectorAll('[data-stage-pane]')[0]!;
    expect(stage.children).toHaveLength(1);
    expect(stage.children[0]!.dataset.dollBody).toBe('1');
    // no bag title row anywhere
    expect(mount.querySelectorAll('[data-bag-title]')).toHaveLength(0);
    // no leftover big-title text in the whole tree
    const texts = collectText(root);
    expect(texts).not.toContain('背包与装备');
    expect(texts.find((t) => t.includes('烬行者'))).toBeUndefined();
  });

  test('close stays as a small corner button on the frame, outside any title bar', () => {
    boot();
    const close = mount.querySelectorAll('[data-close-button]')[0]!;
    expect(close).toBeDefined();
    expect(close.style.cssText).toContain('position:absolute');
    expect(close.style.cssText).toContain('top:10px');
    expect(close.style.cssText).toContain('right:10px');
    expect(close.style.cssText).toContain('width:28px');
    expect(close.style.cssText).toContain('height:28px');
    expect(close.attributes['aria-label']).toBe('关闭背包');
    // it is a root-level corner control, not a member of the content column
    const root = idRegistry.get('hellforge-inventory')!;
    expect(close.parent).toBe(root);
  });

  test('bag count degrades to a tiny dim label beside the footer gold plaque', () => {
    boot();
    const currency = mount.querySelectorAll('[data-inventory-currency]')[0]!;
    const count = mount.querySelectorAll('[data-bag-count]')[0]!;
    // 10px dim text, right next to the gold pill
    expect(count.style.cssText).toContain('font:600 10px');
    expect(count.style.cssText).toContain('color:#8a7a58');
    expect(currency.children[0]!.innerHTML).toContain('金币');
    expect(currency.children[1]).toBe(count);
    expect(count.textContent).toBe('背包 1/60');
    // the same count mirrors into the grid's aria-label
    const grid = mount.querySelectorAll('[data-bag-grid]')[0]!;
    expect(grid.attributes['aria-label']).toBe('背包 1/60');
  });
});

describe('N3R-N4 k3 well polish (metal bezel, recessed icons, empty-vs-equipped)', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const bootEquipped = (rarity: Rarity): void => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    const weapon = stubItem('weapon', 'worn-w', 10);
    weapon.rarity = rarity;
    handle.update(
      { ...emptyEquipment(), weapon },
      [],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();
  };

  const weaponWell = (): FakeEl =>
    mount.querySelectorAll('[data-slot]').find((el) => el.dataset.slot === 'weapon')!;

  test('k3 #1+#2: equipped well = gold-brown metal bezel + dark outer ring + chamfered insets; quality stays a thin inner ring', () => {
    bootEquipped('rare');
    const css = weaponWell().style.cssText;
    // the metal edge is the bezel now — not the old hairline
    expect(css).toContain('border:1px solid #8a6828');
    expect(css).not.toContain('border:1px solid rgba(138,122,90,0.35)');
    // 1px dark outer ring for banded bezel thickness
    expect(css).toContain('0 0 0 1px rgba(0,0,0,0.7)');
    // bidirectional chamfer: top cave-in + bottom hairline reflection
    expect(css).toContain('inset 0 3px 8px rgba(0,0,0,0.75)');
    expect(css).toContain('inset 0 -1px 0 rgba(201,184,150,0.18)');
    // quality overlay: 1.5px inner ring — never a 2px edge replacing the metal
    expect(css).toContain('inset 0 0 0 1.5px #ffd04acc');
    expect(css).not.toContain('inset 0 0 0 2px');
  });

  test('k3 #3: equipped icon seats into the recess — dark drop-shadow only, no gold glow', () => {
    bootEquipped('common');
    const icon = weaponWell().children[0]!;
    expect(icon.style.cssText).toContain('filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6))');
    expect(icon.style.cssText).not.toContain('drop-shadow(0 0 ');
    // floor center gets a faint radial backing so the icon reads as recessed
    expect(weaponWell().style.cssText).toContain('radial-gradient(ellipse at center,rgba(0,0,0,0.25)');
  });

  test('k3 #5: equipped floor carries a 3-6% quality wash; common keeps gold-brown', () => {
    bootEquipped('rare');
    expect(weaponWell().style.cssText).toContain('linear-gradient(180deg,#ffd04a0a,#ffd04a0f)');
    bootEquipped('common');
    expect(weaponWell().style.cssText).toContain('linear-gradient(180deg,#a884400a,#a884400f)');
  });

  test('k3 #4: empty wells sink — doubled top inset, dimmed bezel, fainter silhouette, no quality wash', () => {
    const { tooltip } = captureTooltip();
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip },
    );
    handle.update(emptyEquipment(), [], 1, 0, { common: 0, magic: 0, rare: 0 });
    handle.show();
    const well = mount.querySelectorAll('[data-slot]')[0]!;
    const css = well.style.cssText;
    expect(css).toContain('border:1px solid rgba(168,132,64,0.45)');
    expect(css).toContain('inset 0 6px 16px rgba(0,0,0,0.75)');
    expect(well.children[0]!.style.cssText).toContain('opacity:0.3');
    // empty wells are never quality-washed
    expect(css).not.toContain('linear-gradient(180deg,#');
  });
});

describe('N-Stash dual-open drop target (bag → stash grid)', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  const stashGrid = (): FakeEl => {
    const grid = new FakeEl('div');
    grid.dataset.stashGrid = '1';
    mount.appendChild(grid);
    return grid;
  };

  /** Bag-tile drag helpers — press on the tile, then move/up on the fake document. */
  const dragBagItem = (tile: FakeEl): void => {
    tile.dispatch('mousedown', { button: 0, clientX: 100, clientY: 100 });
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
  };

  test('bag-item drag dropped on a [data-stash-grid] element calls onStashFromBag with the right bag index', () => {
    const movedToStash: number[] = [];
    const handle = installInventory(
      {
        ...n3rCallbacks(),
        onStashFromBag: (index) => {
          movedToStash.push(index);
          return true;
        },
      },
      mount as unknown as HTMLElement,
      { tooltip: captureTooltip().tooltip },
    );
    handle.update(
      emptyEquipment(),
      [
        { item: stubItem('weapon', 'stash-me', 10), x: 0, y: 0 },
        { item: stubItem('ring', 'stay-put', 20), x: 3, y: 0 },
      ],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();

    const grid = stashGrid();
    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'stash-me')!;
    dragBagItem(tile);
    // k3: drag ghost reads over the near-black scene — lifted warm backdrop,
    // 2px rarity border + matching glow, icon nudged brighter.
    const ghost = mount.children.find((c) => c.style.zIndex === '240')!;
    expect(ghost.style.background).toBe('rgba(52,36,18,0.92)');
    expect(ghost.style.border).toBe('2px solid #d8d8d8');
    expect(ghost.style.boxShadow).toContain('color-mix(in srgb, #d8d8d8 55%, transparent)');
    expect(ghost.children[0]!.style.filter).toBe('brightness(1.15)');
    // cursor over the stash grid → valid drop target (green glow)
    elementFromPointTarget = grid;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    expect(grid.style.boxShadow).toContain('80,200,80');
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(movedToStash).toEqual([0]);
  });

  test('without the onStashFromBag callback the stash grid is not a valid target', () => {
    const handle = installInventory(
      n3rCallbacks(),
      mount as unknown as HTMLElement,
      { tooltip: captureTooltip().tooltip },
    );
    handle.update(
      emptyEquipment(),
      [{ item: stubItem('weapon', 'stash-me', 10), x: 0, y: 0 }],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();

    const grid = stashGrid();
    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'stash-me')!;
    dragBagItem(tile);
    elementFromPointTarget = grid;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    // no glow — dropTargetAt never offers an unwired stash grid
    expect(grid.style.boxShadow).toBeUndefined();
    expect(grid.style.background).toBeUndefined();
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    // drag cancels cleanly: ghost removed from the mount
    expect(mount.children.find((c) => c.style.zIndex === '240')).toBeUndefined();
  });

  test('equip-well drags still commit as equips when the cursor is over a slot', () => {
    const equips: Array<[number, string]> = [];
    const handle = installInventory(
      {
        ...n3rCallbacks(),
        onEquipFromBag: (index, target) => {
          equips.push([index, target ?? '']);
          return true;
        },
      },
      mount as unknown as HTMLElement,
      { tooltip: captureTooltip().tooltip },
    );
    const eq: Equipment = { ...emptyEquipment(), weapon: stubItem('weapon', 'worn-w', 10) };
    handle.update(
      eq,
      [{ item: stubItem('ring', 'ring-cand', 20), x: 0, y: 0 }],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();

    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'ring-cand')!;
    dragBagItem(tile);
    const well = mount.querySelectorAll('[data-slot]').find((el) => el.dataset.slot === 'ring1')!;
    elementFromPointTarget = well;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    expect(well.style.boxShadow).toContain('80,200,80');
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(equips).toEqual([[0, 'ring1']]);
  });

  test('drag released over the world (outside mount) cancels: ghost follows, no callback, no stuck state', () => {
    const equips: Array<[number, string]> = [];
    const toStash: number[] = [];
    const handle = installInventory(
      {
        ...n3rCallbacks(),
        onEquipFromBag: (index, target) => {
          equips.push([index, target ?? '']);
          return true;
        },
        onStashFromBag: (index) => {
          toStash.push(index);
          return true;
        },
      },
      mount as unknown as HTMLElement,
      { tooltip: captureTooltip().tooltip },
    );
    handle.update(
      emptyEquipment(),
      [{ item: stubItem('weapon', 'drag-me', 10), x: 0, y: 0 }],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();

    // The 3D canvas is a SIBLING of mount — events over it never bubble
    // through mount, so drag tracking must be document-scoped. elementFromPoint
    // over the world resolves to a non-mount node.
    const canvas = new FakeEl('canvas');
    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'drag-me')!;
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
    expect(equips).toEqual([]);
    expect(toStash).toEqual([]);
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
    // a tile neither resumes the old drag nor commits it
    elementFromPointTarget = null;
    tile.dispatch('mousedown', { button: 0, clientX: 300, clientY: 300 });
    fakeDocument.dispatch('mouseup', { clientX: 300, clientY: 300 });
    expect(equips).toEqual([]);
    expect(toStash).toEqual([]);
    expect(mount.children.find((c) => c.style.zIndex === '240')).toBeUndefined();
    expect(handle.isOpen()).toBe(true);
  });

  test('a press after a committed drag is not swallowed (real Chrome fires no click after a cross-element drag)', () => {
    const equips: Array<[number, string]> = [];
    const movedToStash: number[] = [];
    const handle = installInventory(
      {
        ...n3rCallbacks(),
        onEquipFromBag: (index, target) => {
          equips.push([index, target ?? '']);
          return true;
        },
        onStashFromBag: (index) => {
          movedToStash.push(index);
          return true;
        },
      },
      mount as unknown as HTMLElement,
      { tooltip: captureTooltip().tooltip },
    );
    handle.update(
      emptyEquipment(),
      [
        { item: stubItem('weapon', 'stash-me', 10), x: 0, y: 0 },
        { item: stubItem('ring', 'stay-put', 20), x: 3, y: 0 },
      ],
      1,
      0,
      { common: 0, magic: 0, rare: 0 },
    );
    handle.show();

    // real commit drag: bag tile → stash grid
    const grid = stashGrid();
    const tile = mount
      .querySelectorAll('[data-instance-id]')
      .find((el) => el.dataset.instanceId === 'stash-me')!;
    dragBagItem(tile);
    elementFromPointTarget = grid;
    fakeDocument.dispatch('mousemove', { clientX: 200, clientY: 200 });
    fakeDocument.dispatch('mouseup', { clientX: 200, clientY: 200 });
    expect(movedToStash).toEqual([0]);
    expect(equips).toEqual([]);

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
    expect(movedToStash).toEqual([0]);
    expect(equips).toEqual([]);
  });
});
