// CharSelect DOM tests — fake-DOM harness mirrors inventory-ui.test.ts's
// proven FakeEl (cssText-parsing style proxy, id registry, listener dispatch),
// trimmed to the API surface char-select.ts actually touches.
//
// Covers the N1 behavior invariants (confirm latch / validation / cap /
// show() reset / callbacks) plus the frozen chrome contract (parchment
// plaque bed, .hf-scroll well, 3:4 panel-frame hero card, display-only
// companion roster).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  EMBERWALKER_CLASS_ID,
  EMBERWALKER_DISPLAY_NAME,
  installCharSelect,
  type CharSelectCallbacks,
} from './char-select';
import {
  __clearAllSavesForTests,
  __setSaveStorageForTests,
  createCharacter,
  listCharacters,
  MAX_CHARACTERS,
  type SaveStorage,
} from './save';
import { Ui } from './ui-theme';

type FakeListener = (ev?: unknown) => void;

const idRegistry = new Map<string, FakeEl>();

/** Minimal CSSStyleDeclaration stand-in (see inventory-ui.test.ts fakeStyle). */
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
  textContent = '';
  className = '';
  value = '';
  disabled = false;
  type = '';
  title = '';
  maxLength = 0;
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

  insertAdjacentHTML(_position: string, value: string): void {
    this.html += value;
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
    this.detach();
    if (this._id) idRegistry.delete(this._id);
  }

  addEventListener(type: string, listener: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  dispatch(type: string, ev?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(ev);
  }

  click(): void {
    this.dispatch('click');
  }

  listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }
}

function installFakeDocument(): FakeEl {
  const fakeDocument = {
    head: new FakeEl('head'),
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => idRegistry.get(id) ?? null,
  };
  (globalThis as { document?: unknown }).document = fakeDocument;
  return new FakeEl('div');
}

function uninstallFakeDocument(): void {
  idRegistry.clear();
  delete (globalThis as { document?: unknown }).document;
}

function memoryStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

// ── tree queries ────────────────────────────────────────────────────────────

function collect(root: FakeEl, out: FakeEl[] = []): FakeEl[] {
  out.push(root);
  for (const child of root.children) collect(child, out);
  return out;
}

/** Own + descendant textContent, depth-first (label spans live under buttons). */
function textOf(el: FakeEl): string {
  return el.textContent + el.children.map(textOf).join('');
}

/** Own + descendant innerHTML (static SVG/copy lives in html strings). */
function htmlOf(el: FakeEl): string {
  return el.innerHTML + el.children.map(htmlOf).join('');
}

function findButton(root: FakeEl, label: string): FakeEl {
  const hit = collect(root).find((el) => el.tagName === 'button' && textOf(el).includes(label));
  if (!hit) throw new Error(`button "${label}" not found`);
  return hit;
}

function findInput(root: FakeEl): FakeEl {
  const hit = collect(root).find((el) => el.tagName === 'input');
  if (!hit) throw new Error('name input not found');
  return hit;
}

// ── harness ─────────────────────────────────────────────────────────────────

interface Harness {
  mount: FakeEl;
  root: FakeEl;
  confirmed: Array<{ classId: string }>;
  backs: number;
  classChanges: string[];
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

function installHarness(): Harness {
  const mount = installFakeDocument();
  const confirmed: Array<{ classId: string }> = [];
  let backs = 0;
  const classChanges: string[] = [];
  const cb: CharSelectCallbacks = {
    onConfirm: (rec) => confirmed.push(rec),
    onBack: () => { backs += 1; },
    onClassChange: (id) => classChanges.push(id),
  };
  const handle = installCharSelect(mount as unknown as HTMLElement, cb);
  const root = idRegistry.get('hellforge-char-select');
  if (!root) throw new Error('char-select root not registered');
  return {
    mount,
    root,
    confirmed,
    get backs() { return backs; },
    classChanges,
    show: () => handle.show(),
    hide: () => handle.hide(),
    dispose: () => handle.dispose(),
  };
}

beforeEach(() => {
  __setSaveStorageForTests(memoryStorage());
  __clearAllSavesForTests();
});

afterEach(() => {
  uninstallFakeDocument();
  __setSaveStorageForTests(null);
});

// ── chrome contract ─────────────────────────────────────────────────────────

describe('char-select chrome contract', () => {
  test('root is a transparent overlay; plaque rides .hf-scroll with a height cap', () => {
    const h = installHarness();
    expect(h.root.id).toBe('hellforge-char-select');
    expect(h.root.style['pointer-events']).toBe('none');

    const panel = collect(h.root).find((el) => el.className === 'hf-scroll');
    expect(panel).toBeDefined();
    expect(panel!.style['pointer-events']).toBe('auto');
    // Inline 100vh-based cap — 720p caps height instead of overflowing. Must
    // be vh, not %: the wrap is height:auto, so a % base is indefinite and
    // Chrome resolves the whole min() as none.
    expect(panel!.style['max-height']).toContain('min(');
    expect(panel!.style['max-height']).toContain('100vh');
    expect(panel!.style['overflow-y']).toBe('auto');
    // Plaque bottom is S5 shell-plaque-wide (owner art); DOM label/copy only.
    expect(panel!.style['background']).toContain('shell-plaque-wide.webp');
    expect(panel!.style['background']).toContain('100% 100%');
    // Corner ornaments hang on the non-scrolling wrap (hf-gem radial gradient).
    const wrap = panel!.parent!;
    expect(wrap.innerHTML).toContain('hf-gem');
  });

  test('hero card is a 3:4 panel-frame-character plate (zero distortion) with emblem + layered copy', () => {
    const h = installHarness();
    const copy = collect(h.root).find((el) => el.innerHTML.includes('暗法师'));
    expect(copy).toBeDefined();
    expect(copy!.innerHTML).toContain(EMBERWALKER_DISPLAY_NAME);
    const heroCard = copy!.parent!;
    // Frame wiring (replaces the old goldMetal CSS well): aspect-ratio 3/4
    // locks width from the fixed height, so center/100% 100% paints the
    // plate's native 3:4 canvas without stretching; % padding + overflow
    // guard keep copy inside the parchment core.
    expect(heroCard.style['background']).toContain('panel-frame-character.webp');
    expect(heroCard.style['background']).toContain('center/100% 100% no-repeat');
    expect(heroCard.style['aspect-ratio']).toBe('3/4');
    expect(heroCard.style.height).toBe('300px');
    expect(heroCard.style.overflow).toBe('hidden');
    // classEmblemSvg kept, inside its own goldMetal bezel.
    const emblem = heroCard.children[0]!;
    expect(emblem.innerHTML).toContain('<svg');
    expect(emblem.style.border).toContain(Ui.goldMetal);
  });

  test('companion roster lists all three narrative companions as 3:4 display-only cards', () => {
    const h = installHarness();
    const header = collect(h.root).find((el) => el.innerHTML.includes('旅途中汇合的同行者'));
    expect(header).toBeDefined();
    expect(header!.innerHTML).toContain('非可选职业');
    const section = header!.parent!;
    expect(section.style['pointer-events']).toBe('none');

    const html = htmlOf(section);
    for (const token of [
      '薪火嬷嬷', 'MATRON PYRA', 'FIREKEEPER', '守火者',
      '玻璃刃薇丝', 'VEX GLASSWYN', 'FROST DUELIST', '霜刃决斗者',
      '石守埃尔德林', 'STONEWARD ELDRIN', 'RUNE KEEPER', '符文守卫',
    ]) {
      expect(html).toContain(token);
    }

    // Three mini panel-frame-inventory cards — same 3:4 zero-distortion
    // recipe as the hero card (aspect-ratio locks height from width, then
    // center/100% 100%); section height stays ~150px so the plaque clears
    // the centre hero preview.
    const strip = section.children[1]!;
    expect(strip.style.display).toBe('flex');
    expect(strip.children.length).toBe(3);
    for (const col of strip.children) {
      expect(col.style['aspect-ratio']).toBe('3/4');
      expect(col.style['background']).toContain('panel-frame-inventory.webp');
      expect(col.style['background']).toContain('center/100% 100% no-repeat');
      expect(col.style['pointer-events']).toBe('none');
    }

    // Display-only: no hover/cursor affordance, zero listeners in the subtree.
    for (const el of collect(section)) {
      expect(el.style.cursor ?? '').not.toBe('pointer');
      expect(el.listenerCount()).toBe(0);
    }
  });

  test('confirm rides ShellArt S1–S3 plate (no CSS gold-rim fake chrome)', () => {
    const h = installHarness();
    const btn = findButton(h.root, '确认出战');
    const bg = String(btn.style.background ?? btn.style['background-image'] ?? '');
    expect(bg).toContain('shell-btn-idle');
    expect(bg).not.toContain('linear-gradient');
  });
});

// ── behavior invariants (must not drift with the visual rework) ─────────────

describe('char-select behavior invariants', () => {
  test('confirm creates a sorceress record once, then latches with entering label', () => {
    const h = installHarness();
    expect(EMBERWALKER_CLASS_ID).toBe('sorceress');
    h.show();

    const btn = findButton(h.root, '确认出战');
    btn.click();
    expect(h.confirmed.length).toBe(1);
    expect(h.confirmed[0]!.classId).toBe('sorceress');
    expect(listCharacters().length).toBe(1);
    expect(btn.disabled).toBe(true);
    expect(textOf(btn)).toContain('正在进入…');

    btn.click();
    expect(h.confirmed.length).toBe(1);
    expect(listCharacters().length).toBe(1);
  });

  test('short name is rejected with the validation copy', () => {
    const h = installHarness();
    h.show();
    const input = findInput(h.root);
    input.value = 'a';
    input.dispatch('input');
    findButton(h.root, '确认出战').click();
    expect(h.confirmed.length).toBe(0);
    expect(textOf(h.root)).toContain('姓名至少需要 2 个字符');
  });

  test('character cap is rejected before createCharacter runs', () => {
    const h = installHarness();
    for (let i = 0; i < MAX_CHARACTERS; i += 1) {
      createCharacter(`余烬娅${i}`, 'sorceress');
    }
    h.show();
    findButton(h.root, '确认出战').click();
    expect(h.confirmed.length).toBe(0);
    expect(listCharacters().length).toBe(MAX_CHARACTERS);
    expect(textOf(h.root)).toContain(`角色数量已达上限（${MAX_CHARACTERS}）`);
  });

  test('show() resets the latch, rerolls the name, and re-fires onClassChange', () => {
    const h = installHarness();
    h.show();
    const btn = findButton(h.root, '确认出战');
    btn.click();
    expect(btn.disabled).toBe(true);

    h.show();
    expect(btn.disabled).toBe(false);
    expect(textOf(btn)).toContain('确认出战');
    expect(btn.style.opacity).toBe('1');
    const input = findInput(h.root);
    expect(input.value.length).toBeGreaterThanOrEqual(2);
    expect(h.classChanges).toEqual(['sorceress', 'sorceress']);
  });

  test('back button fires onBack; hide() collapses; dispose() detaches', () => {
    const h = installHarness();
    findButton(h.root, '← 返回').click();
    expect(h.backs).toBe(1);

    h.hide();
    expect(h.root.style.display).toBe('none');
    h.show();
    expect(h.root.style.display).toBe('');

    h.dispose();
    expect(h.mount.children.length).toBe(0);
  });

  test('ensureUiStyles is idempotent across reinstalls (one shared sheet)', () => {
    // Two installs into the SAME document must not duplicate the sheet.
    installFakeDocument();
    const noop = (): void => undefined;
    const cb: CharSelectCallbacks = { onConfirm: noop, onBack: noop };
    installCharSelect(new FakeEl('div') as unknown as HTMLElement, cb);
    installCharSelect(new FakeEl('div') as unknown as HTMLElement, cb);
    const doc = (globalThis as unknown as { document: { head: FakeEl } }).document;
    const sheets = collect(doc.head).filter((el) => el.id === 'hellforge-ui-style');
    expect(sheets.length).toBe(1);
  });
});
