import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { installIntroVideo } from './intro-video';

// Minimal fake DOM — same idiom as loot-celebration.test.ts.

type FakeListener = (ev?: { key?: string; preventDefault?: () => void }) => void;

const idRegistry = new Map<string, FakeEl>();

class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  textContent = '';
  innerHTML = '';
  type = '';
  src = '';
  poster = '';
  muted = false;
  tabIndex = 0;
  focused = false;
  private attrs = new Map<string, string>();
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

  appendChild(c: FakeEl): FakeEl {
    c.detach();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    for (const c of cs) this.appendChild(c);
  }
  insertBefore(c: FakeEl, _ref: FakeEl | null): FakeEl {
    return this.appendChild(c);
  }
  detach(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    }
  }
  remove(): void {
    this.detach();
    if (this._id) idRegistry.delete(this._id);
  }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
    if (k === 'src') this.src = '';
  }
  querySelector(sel: string): FakeEl | null {
    if (sel === 'button') {
      return this.children.find((c) => c.tagName === 'button') ?? null;
    }
    return null;
  }
  addEventListener(type: string, fn: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: FakeListener): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, ev?: { key?: string }): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ preventDefault: () => {}, ...ev });
    }
  }
  focus(): void { this.focused = true; }
  // video APIs
  pause(): void { /* noop */ }
  load(): void { /* noop */ }
  play(): Promise<void> { return Promise.resolve(); }
  click(): void { this.dispatch('click'); }
}

function installFakeDocument(): { mount: FakeEl } {
  const winListeners = new Map<string, Set<FakeListener>>();
  const doc = {
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => idRegistry.get(id) ?? null,
  };
  const win = {
    addEventListener: (type: string, fn: FakeListener) => {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: FakeListener) => {
      winListeners.get(type)?.delete(fn);
    },
  };
  (globalThis as { document?: unknown; window?: unknown }).document = doc;
  (globalThis as { document?: unknown; window?: unknown }).window = win;
  return { mount: new FakeEl('div') };
}

function uninstallFakeDocument(): void {
  idRegistry.clear();
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
}

describe('installIntroVideo', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument().mount;
  });
  afterEach(() => {
    uninstallFakeDocument();
  });

  test('click gate completes exactly-once on missing asset path', async () => {
    const reasons: string[] = [];
    const handle = installIntroVideo(mount as unknown as HTMLElement, {
      onComplete: (reason) => { reasons.push(reason); },
      videoUrl: null,
    });
    const root = idRegistry.get('hellforge-intro-video');
    expect(root).toBeTruthy();
    const gate = root!.querySelector('button');
    expect(gate?.textContent).toContain('点击进入');
    gate!.click();
    for (let i = 0; i < 40 && reasons.length === 0; i++) {
      await Bun.sleep(10);
    }
    expect(reasons).toEqual(['missingAsset']);
    gate!.click();
    await Bun.sleep(20);
    expect(reasons).toEqual(['missingAsset']);
    handle.dispose();
    expect(idRegistry.get('hellforge-intro-video')).toBeUndefined();
  });

  test('dispose clears DOM even before completion', () => {
    const handle = installIntroVideo(mount as unknown as HTMLElement, {
      onComplete: () => {},
      videoUrl: null,
    });
    expect(idRegistry.get('hellforge-intro-video')).toBeTruthy();
    handle.dispose();
    expect(idRegistry.get('hellforge-intro-video')).toBeUndefined();
  });

  test('probe false completes as missingAsset after gesture', async () => {
    const reasons: string[] = [];
    installIntroVideo(mount as unknown as HTMLElement, {
      onComplete: (r) => { reasons.push(r); },
      videoUrl: 'https://example.invalid/intro.mp4',
      probeUrl: async () => false,
    });
    idRegistry.get('hellforge-intro-video')!.querySelector('button')!.click();
    for (let i = 0; i < 40 && reasons.length === 0; i++) {
      await Bun.sleep(10);
    }
    expect(reasons).toEqual(['missingAsset']);
  });

  test('Escape skip stays scoped to the focused intro root', async () => {
    const reasons: string[] = [];
    installIntroVideo(mount as unknown as HTMLElement, {
      onComplete: (r) => { reasons.push(r); },
      videoUrl: 'https://example.invalid/intro.mp4',
      probeUrl: async () => true,
    });
    const root = idRegistry.get('hellforge-intro-video')!;
    root.querySelector('button')!.click();
    for (let i = 0; i < 40 && !root.focused; i++) {
      await Bun.sleep(10);
    }
    expect(root.focused).toBeTrue();
    root.dispatch('keydown', { key: 'Escape' });
    expect(reasons).toEqual(['skipped']);
  });
});
