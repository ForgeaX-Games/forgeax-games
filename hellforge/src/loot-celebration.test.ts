import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { installLootCelebration } from './loot-celebration';
import { RARITY_META, type Affix, type ItemInstance, type ItemSlot, type Rarity } from './items';

// ── minimal fake DOM (save-schema.test.ts global-stub idiom) ──────────────
// Only the surface loot-celebration.ts touches: createElement / getElementById
// / head.appendChild, element style/id/textContent/innerHTML, tree ops
// (appendChild/append/replaceChildren/remove), click listeners, offsetWidth.

type FakeListener = () => void;

const idRegistry = new Map<string, FakeEl>();

class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  textContent = '';
  innerHTML = '';
  private listeners = new Map<string, Set<FakeListener>>();
  private _id = '';

  constructor(tag: string) {
    this.tagName = tag;
  }

  get id(): string {
    return this._id;
  }
  set id(v: string) {
    if (this._id) idRegistry.delete(this._id);
    this._id = v;
    if (v) idRegistry.set(v, this);
  }

  get offsetWidth(): number {
    return 0;
  }

  appendChild(c: FakeEl): FakeEl {
    c.detach();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    for (const c of cs) this.appendChild(c);
  }
  replaceChildren(...cs: FakeEl[]): void {
    for (const c of [...this.children]) c.remove();
    this.append(...cs);
  }
  /** Detach from parent without unregistering the id (re-parent move). */
  detach(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
  remove(): void {
    this.detach();
    if (this._id) idRegistry.delete(this._id);
  }

  addEventListener(type: string, fn: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: FakeListener): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

function textOf(el: FakeEl): string {
  return el.textContent + el.innerHTML + el.children.map(textOf).join('');
}

function findAll(el: FakeEl, pred: (e: FakeEl) => boolean, out: FakeEl[] = []): FakeEl[] {
  if (pred(el)) out.push(el);
  for (const c of el.children) findAll(c, pred, out);
  return out;
}

function installFakeDocument(): { mount: FakeEl } {
  const doc = {
    head: new FakeEl('head'),
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => idRegistry.get(id) ?? null,
  };
  (globalThis as { document?: unknown }).document = doc;
  return { mount: new FakeEl('div') };
}

function uninstallFakeDocument(): void {
  idRegistry.clear();
  delete (globalThis as { document?: unknown }).document;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function item(overrides: {
  slot?: ItemSlot;
  rarity?: Rarity;
  name?: string;
  affixes?: Affix[];
} = {}): ItemInstance {
  return {
    instanceId: 'inst-1',
    slot: overrides.slot ?? 'weapon',
    rarity: overrides.rarity ?? 'rare',
    name: overrides.name ?? '灰烬之杖',
    ilvl: 5,
    reqLevel: 1,
    affixes: overrides.affixes ?? [
      { stat: 'fireDmg', v: 0.18, label: '+18% 火焰伤害' },
      { stat: 'maxHp', v: 42, label: '+42 生命上限' },
    ],
    score: 30,
  };
}

const ROOT_ID = 'hellforge-loot-celebration';

describe('installLootCelebration', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument().mount;
  });
  afterEach(() => {
    uninstallFakeDocument();
  });

  const install = (autoDismissMs = 25) =>
    installLootCelebration(mount as unknown as HTMLElement, { autoDismissMs });
  const root = (): FakeEl | null => idRegistry.get(ROOT_ID) ?? null;

  test('safe to install and never show: mounted but display:none', () => {
    install();
    expect(root()).not.toBeNull();
    expect(mount.children).toHaveLength(1);
    expect(root()!.style.cssText).toContain('display:none');
    expect(root()!.style.display).not.toBe('flex');
  });

  test('show() creates the card with item name, rarity label and affixes', () => {
    const h = install();
    h.show(item());
    const r = root()!;
    expect(r.style.display).toBe('flex');
    const all = textOf(r);
    expect(all).toContain('灰烬之杖');
    expect(all).toContain(RARITY_META.rare.label);
    expect(all).toContain('+18% 火焰伤害');
    expect(all).toContain('+42 生命上限');
  });

  test('item name carries the rarity color', () => {
    const h = install();
    h.show(item({ rarity: 'legendary', name: '炎狱核心' }));
    const nameEl = findAll(root()!, (e) => e.textContent === '炎狱核心')[0]!;
    expect(nameEl.style.cssText).toContain(RARITY_META.legendary.color);
  });

  test('auto-dismiss timer hides the card', async () => {
    const h = install(25);
    h.show(item());
    expect(root()!.style.display).toBe('flex');
    await sleep(70);
    expect(root()!.style.display).toBe('none');
  });

  test('click anywhere dismisses immediately', () => {
    const h = install(5000);
    h.show(item());
    root()!.dispatch('click');
    expect(root()!.style.display).toBe('none');
  });

  test('show during show replaces (latest wins) and restarts the timer', async () => {
    const h = install(50);
    h.show(item({ name: '第一把' }));
    await sleep(25);
    h.show(item({ name: '第二把' }));
    const all = textOf(root()!);
    expect(all).toContain('第二把');
    expect(all).not.toContain('第一把');
    await sleep(35); // t=60: first card's timer (fires at 50) must be cancelled
    expect(root()!.style.display).toBe('flex');
    await sleep(35); // t=95: second card's own timer has elapsed
    expect(root()!.style.display).toBe('none');
  });

  test('dispose removes everything and cancels the pending timer', async () => {
    const h = install(30);
    h.show(item());
    h.dispose();
    expect(root()).toBeNull();
    expect(mount.children).toHaveLength(0);
    await sleep(60); // the cancelled timer must not re-show or throw
    expect(root()).toBeNull();
    expect(mount.children).toHaveLength(0);
  });
});
