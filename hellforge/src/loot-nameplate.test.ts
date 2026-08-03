import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { installLootNameplates, type NameplateDrop } from './loot-nameplate';
import { RARITY_META, type Affix, type ItemInstance, type ItemSlot, type Rarity } from './items';
import { Z } from './ui-theme';

// ── minimal fake DOM (loot-celebration.test.ts global-stub idiom) ─────────
// Surfaces loot-nameplate.ts touches: createElement / getElementById /
// head.appendChild, element style/textContent/remove, tree ops, plus a fake
// window that reports a mutable viewport (P3-a reads window.innerWidth/Height).

type FakeListener = (e?: { key?: string }) => void;

/** The fake window surface tests mutate (viewport size) and drive (keys). */
type FakeWindow = {
  innerWidth: number;
  innerHeight: number;
  dispatchKey: (type: string, key: string) => void;
};

const idRegistry = new Map<string, FakeEl>();

class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  textContent = '';
  innerHTML = '';
  private _id = '';
  private listeners = new Map<string, Set<FakeListener>>();

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

  appendChild(c: FakeEl): FakeEl {
    c.detach();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove(): void {
    this.detach();
    if (this._id) idRegistry.delete(this._id);
  }
  private detach(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }

  addEventListener(type: string, listener: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, ev?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(ev as { key?: string });
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function installFakeDom(): { mount: FakeEl } {
  const mount = new FakeEl('div');
  const doc = {
    head: new FakeEl('head'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => idRegistry.get(id) ?? null,
  };
  (globalThis as { document?: unknown }).document = doc;
  (globalThis as { window?: unknown }).window = {
    innerWidth: 1280,
    innerHeight: 720,
    dispatchKey: (type: string, key: string) => {
      mount.dispatch(type, { key });
    },
  };
  return { mount };
}

function uninstallFakeDom(): void {
  idRegistry.clear();
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
}

/** Typed view of the fake window — resize the viewport / dispatch keys. */
const win = (): FakeWindow => globalThis.window as unknown as FakeWindow;

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
    affixes: overrides.affixes ?? [{ stat: 'fireDmg', v: 0.18, label: '+18% 火焰伤害' }],
    score: 30,
  };
}

function drop(id: string, item: ItemInstance, x = 0, z = 0): NameplateDrop {
  return { id, x, y: 0.26, z, item };
}

function plateEls(mount: FakeEl): FakeEl[] {
  const root = mount.children[0];
  if (!root) return [];
  return root.children;
}

describe('installLootNameplates (G3)', () => {
  let mount: FakeEl;
  let screen: { x: number; y: number } | null;

  beforeEach(() => {
    mount = installFakeDom().mount;
    screen = { x: 640, y: 360 };
  });
  afterEach(() => {
    uninstallFakeDom();
  });

  const install = (overrides: { holdMs?: number; fadeMs?: number } = {}) =>
    installLootNameplates(mount as unknown as HTMLElement, {
      worldToScreen: () => screen,
      holdMs: overrides.holdMs,
      fadeMs: overrides.fadeMs,
    });
  const rootEl = (): FakeEl | null => idRegistry.get('hellforge-loot-nameplates') ?? null;

  test('mounts a non-blocking layer above the 3D canvas, below the HUD', () => {
    install();
    const r = rootEl()!;
    // z-index comes from the ui-theme.ts Z ladder SSOT, not a local copy.
    expect(r.style.cssText).toContain(`z-index:${Z.nameplate}`);
    expect(Z.nameplate).toBe(45);
    expect(Z.nameplate).toBeGreaterThan(Z.atmosphere);
    expect(Z.nameplate).toBeLessThan(Z.hud);
    expect(r.style.cssText).toContain('pointer-events:none');
    expect(mount.children).toHaveLength(1);
  });

  test('spawns a name tag with the item name on first tick', () => {
    const h = install();
    h.tick(0.01, [drop('l-1', item())]);
    const tags = plateEls(mount);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.textContent).toBe('灰烬之杖');
  });

  test('rarity color maps into the tag fill and glow outline', () => {
    const h = install();
    h.tick(0.01, [drop('l-1', item({ rarity: 'legendary', name: '熔渣之杖' }))]);
    const css = plateEls(mount)[0]!.style.cssText;
    expect(css).toContain(`color:${RARITY_META.legendary.color}`);
    expect(css).toContain(RARITY_META.legendary.color);
  });

  test('projects the drop anchor to screen every tick', () => {
    const h = install();
    h.tick(0.01, [drop('l-1', item())]);
    let css = plateEls(mount)[0]!.style;
    expect(css.left).toBe('640px');
    expect(css.top).toBe('360px');
    screen = { x: 100, y: 200 };
    h.tick(0.01, [drop('l-1', item())]);
    css = plateEls(mount)[0]!.style;
    expect(css.left).toBe('100px');
    expect(css.top).toBe('200px');
  });

  test('null projection hides the tag; re-entry brings it back', () => {
    const h = install();
    h.tick(0.01, [drop('l-1', item())]);
    expect(plateEls(mount)[0]!.style.display).toBe('');
    screen = null;
    h.tick(0.01, [drop('l-1', item())]);
    expect(plateEls(mount)[0]!.style.display).toBe('none');
    screen = { x: 10, y: 20 };
    h.tick(0.01, [drop('l-1', item())]);
    expect(plateEls(mount)[0]!.style.display).toBe('');
    expect(plateEls(mount)[0]!.style.left).toBe('10px');
  });

  test('lifecycle: appears → fades out after hold → removed', async () => {
    const h = install({ holdMs: 60, fadeMs: 30 });
    h.tick(0.01, [drop('l-1', item())]);
    h.tick(0.05, [drop('l-1', item())]); // t≈60ms — at the fade threshold
    const fading = plateEls(mount)[0]!.style.animation;
    expect(fading).toContain('hf-nameplate-fadeout');
    await sleep(60);
    expect(plateEls(mount)).toHaveLength(0);
  });

  test('B1: a faded tag does NOT respawn on later ticks (no show→fade→pop-back loop)', async () => {
    const h = install({ holdMs: 30, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]);
    h.tick(0.03, [drop('l-1', item())]); // t=40ms ≥ holdMs → fading
    await sleep(50); // fade completes → removed
    expect(plateEls(mount)).toHaveLength(0);
    // Original blind spot: the next tick re-spawned a full-duration tag
    // because the equipment drop never leaves the snapshot.
    for (let i = 0; i < 5; i++) h.tick(0.05, [drop('l-1', item())]);
    expect(plateEls(mount)).toHaveLength(0);
  });

  test('B1: expiry records are cleared when the drop leaves the snapshot; a reused id spawns fresh', async () => {
    const h = install({ holdMs: 40, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]);
    h.tick(0.05, [drop('l-1', item())]); // t=60ms ≥ holdMs → fading
    await sleep(50);
    expect(plateEls(mount)).toHaveLength(0);
    h.tick(0.01, []); // picked up / despawned → drop leaves the snapshot
    h.tick(0.01, [drop('l-1', item())]); // the same id appears again
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    h.tick(0.02, [drop('l-1', item())]); // 30ms into a fresh 40ms hold — still not fading
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
  });

  test('F5: a tag that finishes fading off-screen does not resurrect when the drop re-enters view', async () => {
    const h = install({ holdMs: 30, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]);
    h.tick(0.03, [drop('l-1', item())]); // t=40ms ≥ holdMs → fade starts on-screen
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
    screen = null; // camera swings away mid-fade
    await sleep(50); // the in-flight fade completes off-screen → removed
    expect(plateEls(mount)).toHaveLength(0);
    screen = { x: 640, y: 360 };
    for (let i = 0; i < 3; i++) h.tick(0.05, [drop('l-1', item())]);
    expect(plateEls(mount)).toHaveLength(0); // no fresh 3s tag
  });

  test('off-screen holds the countdown; re-entry resumes with the remaining time', async () => {
    const h = install({ holdMs: 50, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]); // 40ms left
    screen = null;
    h.tick(0.3, [drop('l-1', item())]);
    h.tick(0.3, [drop('l-1', item())]); // 600ms hidden — must not advance
    expect(plateEls(mount)).toHaveLength(1);
    screen = { x: 640, y: 360 };
    h.tick(0.03, [drop('l-1', item())]); // 40 − 30 = 10ms left — still alive
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    h.tick(0.02, [drop('l-1', item())]); // 10 − 20 ≤ 0 → fades only now
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
  });

  test('P3-a: projected outside the viewport hides the tag and freezes the countdown; re-entry resumes', () => {
    const h = install({ holdMs: 50, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]); // visible at 640,360 → 40ms left
    screen = { x: 2000, y: 2000 }; // still in front of the camera (not null), but beyond 1280×720 ± 100
    h.tick(0.3, [drop('l-1', item())]);
    h.tick(0.3, [drop('l-1', item())]); // 600ms off-viewport — must not advance
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.style.display).toBe('none');
    screen = { x: 640, y: 360 };
    h.tick(0.03, [drop('l-1', item())]); // 40 − 30 = 10ms left — still alive
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    h.tick(0.02, [drop('l-1', item())]); // 10 − 20 ≤ 0 → fades only now
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
  });

  test('P3-a: the viewport is read from the window — within the margin stays live, a shrink freezes', () => {
    const h = install({ holdMs: 100, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]); // 90ms left at 640,360
    win().innerWidth = 640;
    win().innerHeight = 360; // anchor at the right/bottom edge — inside the 100px margin
    h.tick(0.03, [drop('l-1', item())]);
    h.tick(0.03, [drop('l-1', item())]); // 60ms at the edge — visible, still counting → 30ms left
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.style.display).toBe('');
    win().innerWidth = 500;
    win().innerHeight = 300; // 640 > 500+100 → anchor now outside the viewport
    h.tick(0.2, [drop('l-1', item())]);
    h.tick(0.2, [drop('l-1', item())]); // 400ms outside — frozen at 30ms
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.style.display).toBe('none');
    win().innerWidth = 1280;
    win().innerHeight = 720;
    h.tick(0.02, [drop('l-1', item())]); // 30 − 20 = 10ms left — resumes
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    h.tick(0.02, [drop('l-1', item())]); // 10 − 20 ≤ 0 → fades only now
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
  });

  test('Alt held across the fade deadline keeps the tag alive (no expiry while held)', async () => {
    const h = install({ holdMs: 30, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]);
    (globalThis.window as unknown as { dispatchKey: (t: string, k: string) => void }).dispatchKey('keydown', 'Alt');
    for (let i = 0; i < 5; i++) h.tick(0.05, [drop('l-1', item())]); // 250ms ≫ holdMs
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    await sleep(50); // past any would-be fade window
    expect(plateEls(mount)).toHaveLength(1);
  });

  test('Alt hold freezes the countdown; release resumes it', async () => {
    const h = install({ holdMs: 100, fadeMs: 30 });
    h.tick(0.01, [drop('l-1', item())]);
    (globalThis.window as unknown as { dispatchKey: (t: string, k: string) => void }).dispatchKey('keydown', 'Alt');
    for (let i = 0; i < 5; i++) h.tick(0.05, [drop('l-1', item())]); // 250ms > holdMs
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    (globalThis.window as unknown as { dispatchKey: (t: string, k: string) => void }).dispatchKey('keyup', 'Alt');
    for (let i = 0; i < 4; i++) h.tick(0.05, [drop('l-1', item())]); // 200ms ≥ holdMs
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
    await sleep(60);
    expect(plateEls(mount)).toHaveLength(0);
  });

  test('Alt press mid-fade cancels the fade and restores the tag', async () => {
    const h = install({ holdMs: 30, fadeMs: 400 });
    h.tick(0.1, [drop('l-1', item())]); // t=100ms > holdMs → fading
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
    (globalThis.window as unknown as { dispatchKey: (t: string, k: string) => void }).dispatchKey('keydown', 'Alt');
    expect(plateEls(mount)[0]!.style.animation).toBe('none');
    expect(plateEls(mount)).toHaveLength(1);
    await sleep(60); // the cancelled fade timer must not remove the tag
    expect(plateEls(mount)).toHaveLength(1);
  });

  test('P3-b: Alt press resurrects an expired tag at full duration; release re-expires it', async () => {
    const h = install({ holdMs: 30, fadeMs: 20 });
    h.tick(0.01, [drop('l-1', item())]);
    h.tick(0.03, [drop('l-1', item())]); // t=40ms ≥ holdMs → fading
    await sleep(50); // fade completes → removed + expired
    expect(plateEls(mount)).toHaveLength(0);
    win().dispatchKey('keydown', 'Alt'); // ledger cleared → next tick re-spawns
    h.tick(0.01, [drop('l-1', item())]);
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe(''); // fresh tag, not a fade remnant
    for (let i = 0; i < 5; i++) h.tick(0.05, [drop('l-1', item())]); // 250ms ≫ 30ms hold, Alt held
    expect(plateEls(mount)).toHaveLength(1); // full-duration revive — no expiry while held
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    win().dispatchKey('keyup', 'Alt');
    h.tick(0.02, [drop('l-1', item())]); // 20ms < 30ms hold — alive
    expect(plateEls(mount)[0]!.style.animation ?? '').toBe('');
    h.tick(0.02, [drop('l-1', item())]); // 40ms ≥ 30ms → fades again
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
    await sleep(50); // re-expired through the normal path
    expect(plateEls(mount)).toHaveLength(0);
  });

  test('window blur releases a stuck Alt hold', () => {
    const h = install({ holdMs: 30 });
    h.tick(0.01, [drop('l-1', item())]);
    (globalThis.window as unknown as { dispatchKey: (t: string, k: string) => void }).dispatchKey('keydown', 'Alt');
    (globalThis.window as unknown as { dispatchKey: (t: string, k: string) => void }).dispatchKey('blur', '');
    h.tick(0.1, [drop('l-1', item())]);
    expect(plateEls(mount)[0]!.style.animation).toContain('hf-nameplate-fadeout');
  });

  test('picked-up / despawned drops remove their tags on the same tick', () => {
    const h = install();
    h.tick(0.01, [drop('l-1', item()), drop('l-2', item({ name: '第二把' }))]);
    expect(plateEls(mount)).toHaveLength(2);
    h.tick(0.01, [drop('l-1', item())]);
    expect(plateEls(mount)).toHaveLength(1);
    expect(plateEls(mount)[0]!.textContent).toBe('灰烬之杖');
  });

  test('dispose removes the layer and all local input listeners', () => {
    const h = install();
    h.tick(0.01, [drop('l-1', item())]);
    const listenersBefore = mount.listenerCount('keydown');
    expect(listenersBefore).toBeGreaterThan(0);
    h.dispose();
    expect(rootEl()).toBeNull();
    expect(mount.children).toHaveLength(0);
    expect(mount.listenerCount('keydown')).toBe(0);
    expect(mount.listenerCount('keyup')).toBe(0);
    expect(mount.listenerCount('blur')).toBe(0);
  });
});
