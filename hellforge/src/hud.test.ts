// HUD G6/G7/G9 visual contracts (handoff 2026-08-01 gap absorption) — pure
// style-resolution tests plus a fake-DOM installHud wiring check for the G9
// potion key badge (the badge's cssText must really come from slotBadgeCss,
// not from a hand-rolled 8px fallback).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  FLOAT_TEXT_TIERS,
  installHud,
  resolveFloatTextStyle,
  skillIconAffordCss,
  skillSlotBadgeKey,
  slotBadgeCss,
  SLOT_BADGE_FONT_PX,
} from './hud';
import { KeyBindings } from './key-bindings';
import { Ui } from './ui-theme';

const fontSizeOf = (css: string): number => {
  const m = /font-size:(\d+(?:\.\d+)?)px/.exec(css);
  return m ? Number(m[1]) : NaN;
};

// ── fake DOM for installHud (same harness pattern as inventory-ui.test.ts) ──
type FakeListener = (ev?: unknown) => void;

const hudIdRegistry = new Map<string, FakeEl>();

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  textContent = '';
  className = '';
  classList = { add: () => {}, remove: () => {} };
  private html = '';
  private _id = '';
  private listeners = new Map<string, Set<FakeListener>>();

  constructor(readonly tagName: string) {}

  get id(): string {
    return this._id;
  }

  set id(value: string) {
    if (this._id) hudIdRegistry.delete(this._id);
    this._id = value;
    if (value) hudIdRegistry.set(value, this);
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
    this.detach();
    if (this._id) hudIdRegistry.delete(this._id);
  }

  addEventListener(type: string, fn: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: FakeListener): void {
    this.listeners.get(type)?.delete(fn);
  }
}

function findAll(el: FakeEl, pred: (e: FakeEl) => boolean, out: FakeEl[] = []): FakeEl[] {
  if (pred(el)) out.push(el);
  for (const child of el.children) findAll(child, pred, out);
  return out;
}

function installFakeDocument(): FakeEl {
  const doc = {
    head: new FakeEl('head'),
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
    getElementById: (id: string) => hudIdRegistry.get(id) ?? null,
  };
  (globalThis as { document?: unknown }).document = doc;
  return new FakeEl('div');
}

function uninstallFakeDocument(): void {
  hudIdRegistry.clear();
  delete (globalThis as { document?: unknown }).document;
}

describe('floatText tiers (G6)', () => {
  test('combat: larger + heavier + layered outline + longer dwell than ambient', () => {
    const combat = resolveFloatTextStyle({ tier: 'combat' });
    const ambient = resolveFloatTextStyle({ tier: 'ambient' });
    // 字号分层: combat 18–20px, ambient 12–14px (handoff G6).
    expect(combat.fontSize).toBeGreaterThan(ambient.fontSize);
    expect(combat.fontSize).toBeGreaterThanOrEqual(18);
    expect(combat.fontSize).toBeLessThanOrEqual(20);
    expect(ambient.fontSize).toBeGreaterThanOrEqual(12);
    expect(ambient.fontSize).toBeLessThanOrEqual(14);
    // 描边分层: combat 多层 text-shadow, ambient 轻描边.
    expect(combat.fontWeight).toBeGreaterThanOrEqual(ambient.fontWeight);
    expect(combat.textShadow.split(',').length).toBeGreaterThan(ambient.textShadow.split(',').length);
    expect(combat.textShadow.split(',').length).toBeGreaterThanOrEqual(3);
    // 滞留: combat 稍长.
    expect(combat.durationSec).toBeGreaterThan(ambient.durationSec);
    // 动画沿用 hf-float-rise 家族, combat 独立 keyframe (位移更远).
    expect(combat.animation).toContain('hf-float-rise');
    expect(ambient.animation).toBe('hf-float-rise');
    expect(combat.animation).toBe('hf-float-rise-combat');
  });

  test('colors come from Ui tokens, not ad-hoc hex', () => {
    expect(FLOAT_TEXT_TIERS.ambient.color).toBe(Ui.goldBright);
    expect(FLOAT_TEXT_TIERS.combat.color).toBe(Ui.text);
  });

  test('backward compatible: no tier / no style → ambient defaults, no throw', () => {
    expect(() => resolveFloatTextStyle(undefined)).not.toThrow();
    const def = resolveFloatTextStyle();
    expect(def).toEqual(FLOAT_TEXT_TIERS.ambient);
  });

  test('legacy {color,size} calls keep their explicit values, ambient chrome', () => {
    const legacy = resolveFloatTextStyle({ color: '#ff6a6a', size: 14 });
    expect(legacy.color).toBe('#ff6a6a');
    expect(legacy.fontSize).toBe(14);
    expect(legacy.textShadow).toBe(FLOAT_TEXT_TIERS.ambient.textShadow);
    expect(legacy.animation).toBe(FLOAT_TEXT_TIERS.ambient.animation);
  });

  test('explicit color/size override tier presets', () => {
    const st = resolveFloatTextStyle({ tier: 'combat', color: '#fff', size: 24 });
    expect(st.fontSize).toBe(24);
    expect(st.color).toBe('#fff');
    expect(st.textShadow).toBe(FLOAT_TEXT_TIERS.combat.textShadow);
  });

  test('tier-only combat resolves to the preset 20px — explicit size is the only override', () => {
    // main.ts's onHit passes no size for normal hits (size: undefined), so the
    // combat tier's 20px must reach the float text; explicit crit/kill sizes
    // still win when set.
    expect(resolveFloatTextStyle({ tier: 'combat' }).fontSize).toBe(FLOAT_TEXT_TIERS.combat.fontSize);
    expect(resolveFloatTextStyle({ tier: 'combat' }).fontSize).toBe(20);
    expect(resolveFloatTextStyle({ tier: 'combat', size: undefined }).fontSize).toBe(20);
    expect(resolveFloatTextStyle({ tier: 'combat', size: 26 }).fontSize).toBe(26);
  });
});

describe('skill slot key badges (G7)', () => {
  test('badge text resolves from key-bindings current bindings, not hardcoded digits', () => {
    const kb = new KeyBindings();
    const getKey = (id: string): string => kb.getKey(id);
    // Defaults: skill1..skill4 = '1'..'4' (KEY_ACTIONS).
    expect(skillSlotBadgeKey(0, getKey)).toBe('1');
    expect(skillSlotBadgeKey(1, getKey)).toBe('2');
    expect(skillSlotBadgeKey(2, getKey)).toBe('3');
    expect(skillSlotBadgeKey(3, getKey)).toBe('4');
  });

  test('rebound keys surface formatted through the badge', () => {
    const bound = { skill1: 'q', skill2: 'y', skill3: '1', skill4: 'tab' };
    const getKey = (id: string): string => bound[id as keyof typeof bound] ?? '';
    expect(skillSlotBadgeKey(0, getKey)).toBe('Q'); // formatKey uppercases
    expect(skillSlotBadgeKey(1, getKey)).toBe('Y');
    expect(skillSlotBadgeKey(2, getKey)).toBe('1');
    expect(skillSlotBadgeKey(3, getKey)).toBe('Tab'); // formatKey named-key map
  });

  test('belt cells (out of 1–4 range) yield "" → callers fall back to slot key', () => {
    const getKey = (): string => 'x';
    expect(skillSlotBadgeKey(4, getKey)).toBe('');
    expect(skillSlotBadgeKey(5, getKey)).toBe('');
  });
});

describe('mana-starved grey (G7)', () => {
  test('castable but mana < cost → icon desaturated', () => {
    expect(skillIconAffordCss(false, false, false)).toContain('grayscale');
  });

  test('restored the moment affordable flips back', () => {
    expect(skillIconAffordCss(true, false, false)).toBe('');
  });

  test('locked/empty keep the existing root-level grey (no double grey)', () => {
    expect(skillIconAffordCss(false, true, false)).toBe('');
    expect(skillIconAffordCss(false, false, true)).toBe('');
  });
});

describe('potion count badge (G9)', () => {
  test('1080p-readable baseline: ≥ 12px with an outline', () => {
    const css = slotBadgeCss('#c8a84e', 'none');
    expect(SLOT_BADGE_FONT_PX).toBeGreaterThanOrEqual(12);
    expect(fontSizeOf(css)).toBe(SLOT_BADGE_FONT_PX);
    // Multi-layer text-shadow = outline; dark ink chip keeps it off the icon.
    expect((css.match(/#000,/g) ?? []).length).toBe(2); // 3 shadow layers
    expect(css).toContain('background:rgba(10,7,6,0.62)');
    expect(css).toContain('display:none;'); // initial hidden for skill slots
  });

  test('badge corner stays out of the icon main visual', () => {
    expect(slotBadgeCss('#c8a84e')).toContain('bottom:2px;right:2px');
    // Potion key badges take the top-left corner variant (pre-G9 position).
    expect(slotBadgeCss(Ui.goldDim, '', 'top-left')).toContain('top:0;left:2px');
  });
});

describe('installHud potion key badge wiring (G9)', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });
  afterEach(() => {
    uninstallFakeDocument();
  });

  const potionSlot = {
    icon: '', name: '生命药水', key: '5', manaCost: 0, cooldownPct: 0,
    locked: false, unlockLevel: 1, affordable: true, potion: 'life' as const, count: 3, empty: false,
  };

  test('potion key badge cssText really comes from slotBadgeCss: 12px chip + layered outline, top-left kept', () => {
    const hud = installHud(mount as unknown as HTMLElement);
    hud.setSkills([potionSlot]);
    // The key badge is the only node with a top-left corner chip.
    const keyEl = findAll(mount, (e) => (e.style.cssText ?? '').includes('top:0;left:2px'))[0];
    expect(keyEl).toBeDefined();
    const css = keyEl!.style.cssText;
    // Wiring, not function output: the installed badge is exactly the
    // slotBadgeCss top-left variant (goldDim hue — distinct from the count
    // badge's potion color).
    expect(css).toBe(slotBadgeCss(Ui.goldDim, '', 'top-left'));
    // G9: font-size aligned with the skill key badges (≥12px) + layered outline.
    expect(fontSizeOf(css)).toBeGreaterThanOrEqual(12);
    expect((css.match(/#000/g) ?? []).length).toBe(2); // 3 shadow layers
    expect(css).toContain('rgba(0,0,0,0.85)');
    // Position unchanged (G9 only aligns size + outline, not the corner).
    expect(css).toContain('top:0;left:2px');
    // Count badge next to it keeps the potion hue (#c8a84e) — the two badges
    // stay distinguishable.
    const countEl = findAll(mount, (e) => (e.style.cssText ?? '').includes('bottom:2px;right:2px'))[0];
    expect(countEl?.style.cssText).toContain('color:#c8a84e');
  });
});
