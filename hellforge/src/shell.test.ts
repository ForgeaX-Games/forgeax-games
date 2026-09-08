import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { installShell } from './shell';

type FakeListener = (ev?: { key?: string; preventDefault?: () => void }) => void;

const idRegistry = new Map<string, FakeEl>();

class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  textContent = '';
  type = '';
  tabIndex = 0;
  clientWidth = 1920;
  clientHeight = 1080;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<FakeListener>>();
  private _id = '';
  private _innerHTML = '';

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

  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(v: string) {
    this._innerHTML = v;
    if (v === '') {
      for (const c of this.children) c.parent = null;
      this.children = [];
    }
  }

  appendChild(c: FakeEl): FakeEl {
    c.detach();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    for (const child of cs) this.appendChild(child);
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
  querySelector(sel: string): FakeEl | null {
    if (sel === 'button') return this.descendants().find((c) => c.tagName === 'button') ?? null;
    return null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    if (sel === 'button') return this.descendants().filter((c) => c.tagName === 'button');
    return [];
  }
  descendants(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) {
      out.push(c, ...c.descendants());
    }
    return out;
  }
  addEventListener(type: string, fn: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: FakeListener): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ preventDefault: () => {} });
    }
  }
  click(): void { this.dispatch('click'); }
  getContext(): Record<string, unknown> {
    const gradient = { addColorStop() { /* noop */ } };
    return {
      setTransform() { /* noop */ },
      clearRect() { /* noop */ },
      beginPath() { /* noop */ },
      arc() { /* noop */ },
      fill() { /* noop */ },
      fillRect() { /* noop */ },
      createRadialGradient: () => gradient,
      fillStyle: '',
      globalAlpha: 1,
      shadowBlur: 0,
      shadowColor: '',
    };
  }
}

function installFakeDocument(): { mount: FakeEl } {
  const winListeners = new Map<string, Set<FakeListener>>();
  const head = new FakeEl('head');
  const doc = {
    head,
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => idRegistry.get(id) ?? null,
  };
  const win = {
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080,
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

describe('installShell loading failure', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument().mount;
  });
  afterEach(() => {
    uninstallFakeDocument();
  });

  test('title stays interactive when camp has not loaded', () => {
    const news: string[] = [];
    const handle = installShell(mount as unknown as HTMLElement, {
      onNewGame: () => { news.push('new'); },
      onContinue: () => {},
      onSettings: () => {},
      hasSave: () => false,
    });
    const root = idRegistry.get('hellforge-shell');
    const start = root?.querySelectorAll('button').find((b) => b.textContent === '开始游戏');
    expect(start).toBeTruthy();
    start!.click();
    expect(news).toEqual(['new']);
    handle.dispose();
  });

  test('showLoadingFailure exposes 重试 without faking 100% progress', () => {
    const retries: string[] = [];
    const handle = installShell(mount as unknown as HTMLElement, {
      onNewGame: () => {},
      onContinue: () => {},
      onSettings: () => {},
      hasSave: () => false,
    });
    handle.showLoading('正在加载角色与场景…');
    handle.showLoadingFailure('营地 Scene payload 加载失败。', () => { retries.push('retry'); });
    const root = idRegistry.get('hellforge-shell');
    const retry = root?.querySelectorAll('button').find((b) => b.textContent === '重试');
    expect(retry).toBeTruthy();
    expect(retry!.style.display).not.toBe('none');
    retry!.click();
    expect(retries).toEqual(['retry']);
    handle.dispose();
  });
});
