import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  FORGE_REVEAL_ACK_MS,
  FORGE_REVEAL_MS,
  forgeButtonReason,
  forgeCraftOverlayHtml,
  forgeCraftPaletteCss,
  forgeCraftRowVars,
  forgeCraftStageHtml,
  forgeCraftStyleText,
  forgePreviewLines,
  installCubeUI,
  missingMaterials,
  resolveForgeActions,
  shortageLines,
  type CubeUICallbacks,
} from './cube-ui';
import { assertForgeRevealDuration } from './visual-polish-contracts';
import type { ItemInstance } from './items';
import { Ui } from './ui-theme';

function item(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: overrides.instanceId ?? 'i-1',
    slot: overrides.slot ?? 'weapon',
    rarity: overrides.rarity ?? 'common',
    name: overrides.name ?? '试装',
    ilvl: overrides.ilvl ?? 2,
    reqLevel: overrides.reqLevel ?? 1,
    affixes: overrides.affixes ?? [{ stat: 'maxHp', v: 1, label: '+1' }],
    score: overrides.score ?? 1,
    legendary: overrides.legendary,
  };
}

const zero = { common: 0, magic: 0, rare: 0 };

describe('resolveForgeActions', () => {
  test('legendary locks all three with legendary reason', () => {
    const legend = item({ rarity: 'legendary', legendary: 'slag-staff' });
    const st = resolveForgeActions([legend], { common: 99, magic: 99, rare: 99 });
    expect(st.salvage).toBe(false);
    expect(st.reroll).toBe(false);
    expect(st.fuse).toBe(false);
    expect(st.lockReason).toBe('legendary');
  });

  test('one common: salvage on; reroll needs shards', () => {
    const it = item({ rarity: 'common' });
    const broke = resolveForgeActions([it], zero);
    expect(broke.salvage).toBe(true);
    expect(broke.reroll).toBe(false);
    expect(broke.lockReason).toBe('insufficient-shards');

    const rich = resolveForgeActions([it], { common: 2, magic: 0, rare: 0 });
    expect(rich.salvage).toBe(true);
    expect(rich.reroll).toBe(true);
    expect(rich.lockReason).toBeNull();
  });

  test('three same-slot commons enable fuse only', () => {
    const trio = [
      item({ slot: 'gloves', rarity: 'common', instanceId: 'a' }),
      item({ slot: 'gloves', rarity: 'common', instanceId: 'b' }),
      item({ slot: 'gloves', rarity: 'common', instanceId: 'c' }),
    ];
    const st = resolveForgeActions(trio, zero);
    expect(st.salvage).toBe(false);
    expect(st.reroll).toBe(false);
    expect(st.fuse).toBe(true);
    expect(st.lockReason).toBeNull();
  });

  test('relaxed recipe: cross-slot same-rarity trios fuse (incl. rare→legendary)', () => {
    const commons = resolveForgeActions([
      item({ slot: 'weapon', rarity: 'common', instanceId: 'a' }),
      item({ slot: 'helm', rarity: 'common', instanceId: 'b' }),
      item({ slot: 'belt', rarity: 'common', instanceId: 'c' }),
    ], zero);
    expect(commons.fuse).toBe(true);
    expect(commons.lockReason).toBeNull();

    const rares = resolveForgeActions([
      item({ slot: 'ring', rarity: 'rare', instanceId: 'r1' }),
      item({ slot: 'amulet', rarity: 'rare', instanceId: 'r2' }),
      item({ slot: 'boots', rarity: 'rare', instanceId: 'r3' }),
    ], zero);
    expect(rares.fuse).toBe(true);
    expect(rares.lockReason).toBeNull();
  });

  test('mixed rarity trio → wrong-recipe', () => {
    const st = resolveForgeActions([
      item({ slot: 'weapon', rarity: 'common', instanceId: 'a' }),
      item({ slot: 'helm', rarity: 'magic', instanceId: 'b' }),
      item({ slot: 'belt', rarity: 'common', instanceId: 'c' }),
    ], zero);
    expect(st.salvage).toBe(false);
    expect(st.fuse).toBe(false);
    expect(st.lockReason).toBe('wrong-recipe');
  });

  test('mixed placement → wrong-recipe', () => {
    const st = resolveForgeActions([
      item({ slot: 'weapon', rarity: 'common' }),
      item({ slot: 'helm', rarity: 'common' }),
    ], zero);
    expect(st.salvage).toBe(false);
    expect(st.fuse).toBe(false);
    expect(st.lockReason).toBe('wrong-recipe');
  });
});

describe('forgePreviewLines / reveal duration (N2)', () => {
  test('reveal ms stays inside F0 contract band', () => {
    expect(assertForgeRevealDuration(FORGE_REVEAL_MS)).toBe(true);
  });

  test('salvage preview shows shard yield delta', () => {
    const p = forgePreviewLines([item({ rarity: 'rare' })], { common: 0, magic: 0, rare: 99 });
    expect(p.output).toContain('黄');
    expect(p.delta).toContain('+');
  });

  test('fuse rare trio previews legendary', () => {
    const trio = [
      item({ rarity: 'rare', instanceId: 'a' }),
      item({ rarity: 'rare', instanceId: 'b' }),
      item({ rarity: 'rare', instanceId: 'c' }),
    ];
    const p = forgePreviewLines(trio, zero);
    expect(p.recipe).toContain('传奇');
    expect(p.output).toContain('传奇');
  });
});

describe('missingMaterials / shortageLines (N2R G5)', () => {
  test('empty cube → no shortage, empty-state guidance copy', () => {
    expect(missingMaterials([], zero)).toEqual({ common: 0, magic: 0, rare: 0 });
    expect(shortageLines([], zero)).toBeNull();
    const p = forgePreviewLines([], zero);
    expect(p.recipe).toBe('尚未投入装备');
    expect(p.output).toContain('放入 1 件');
    expect(p.output).toContain('3 件同稀有度');
  });

  test('common item with no white shards → 缺 2 片白色碎片 (reroll cost 2)', () => {
    const it = item({ rarity: 'common' });
    expect(missingMaterials([it], zero)).toEqual({ common: 2, magic: 0, rare: 0 });
    expect(shortageLines([it], zero)).toBe('缺 2 片白色碎片');
  });

  test('magic item with a partial wallet reports the gap (cost 3, have 1 → 2)', () => {
    const it = item({ rarity: 'magic' });
    const have = { common: 0, magic: 1, rare: 0 };
    expect(missingMaterials([it], have)).toEqual({ common: 0, magic: 2, rare: 0 });
    expect(shortageLines([it], have)).toBe('缺 2 片蓝色碎片');
  });

  test('rare item with no yellow shards → 缺 4 片黄色碎片 (reroll cost 4)', () => {
    const it = item({ rarity: 'rare' });
    expect(missingMaterials([it], zero)).toEqual({ common: 0, magic: 0, rare: 4 });
    expect(shortageLines([it], zero)).toBe('缺 4 片黄色碎片');
  });

  test('affordable reroll / fuse trio / legendary → never a shortage', () => {
    const common = item({ rarity: 'common' });
    expect(shortageLines([common], { common: 2, magic: 0, rare: 0 })).toBeNull();
    const trio = [
      item({ rarity: 'magic', instanceId: 'a' }),
      item({ rarity: 'magic', instanceId: 'b' }),
      item({ rarity: 'magic', instanceId: 'c' }),
    ];
    expect(shortageLines(trio, zero)).toBeNull();
    expect(shortageLines([item({ rarity: 'legendary', legendary: 'slag-staff' })], zero)).toBeNull();
  });
});

describe('forgePreviewLines shortage copy (N2R G5)', () => {
  test('insufficient reroll delta names tier + count', () => {
    const p = forgePreviewLines([item({ rarity: 'magic' })], { common: 0, magic: 1, rare: 0 });
    expect(p.recipe).toContain('重铸');
    expect(p.delta).toBe('材料变化：缺 2 片蓝色碎片');
  });

  test('affordable single item previews both the salvage yield and the reroll cost', () => {
    const p = forgePreviewLines([item({ rarity: 'rare' })], { common: 0, magic: 0, rare: 4 });
    expect(p.recipe).toContain('拆解');
    expect(p.output).toContain('+4');
    expect(p.output).toContain('黄');
    // F1: reroll shares the salvage gate, so an affordable single item must
    // surface the reroll cost too — the reroll-only branch was dead code.
    expect(p.delta).toBe('材料变化：黄 +4；重铸 −4 片黄色碎片');
  });

  test('resolveForgeActions hint carries the same shortage (button/reason parity)', () => {
    const st = resolveForgeActions([item({ rarity: 'rare' })], { common: 0, magic: 0, rare: 1 });
    expect(st.lockReason).toBe('insufficient-shards');
    expect(st.hint).toBe('材料不足：缺 3 片黄色碎片（重铸需 4 片）');
  });
});

describe('forgeButtonReason — disabled hover hints match enablement (N2R G5)', () => {
  test('insufficient shards: salvage stays enabled, reroll names the shortage, fuse is wrong-recipe', () => {
    const a = resolveForgeActions([item({ rarity: 'rare' })], { common: 0, magic: 0, rare: 1 });
    expect(forgeButtonReason(a, 'salvage')).toBeNull();
    expect(forgeButtonReason(a, 'reroll')).toBe('材料不足：缺 3 片黄色碎片（重铸需 4 片）');
    expect(forgeButtonReason(a, 'fuse')).toBe('合成需 3 件同稀有度（部位不限，黄×3→传奇）');
  });

  test('legendary lock names the same reason on every button', () => {
    const a = resolveForgeActions([item({ rarity: 'legendary', legendary: 'slag-staff' })], { common: 99, magic: 99, rare: 99 });
    for (const kind of ['salvage', 'reroll', 'fuse'] as const) {
      expect(forgeButtonReason(a, kind)).toBe('传奇不可拆解 / 重铸 / 合成');
    }
  });

  test('empty cube guides each button', () => {
    const a = resolveForgeActions([], zero);
    expect(forgeButtonReason(a, 'salvage')).toBe('拆解需 1 件非传奇装备');
    expect(forgeButtonReason(a, 'reroll')).toBe('重铸需 1 件非传奇装备');
    expect(forgeButtonReason(a, 'fuse')).toBe('合成需 3 件同稀有度（部位不限，黄×3→传奇）');
  });

  test('enabled buttons carry no reason', () => {
    const a = resolveForgeActions([item({ rarity: 'common' })], { common: 2, magic: 0, rare: 0 });
    expect(forgeButtonReason(a, 'salvage')).toBeNull();
    expect(forgeButtonReason(a, 'reroll')).toBeNull();
  });
});

// ── N2R B2/F7 DOM shim ───────────────────────────────────────────────────────
// Minimal fake DOM (mirrors inventory-ui.test.ts): cube-ui only needs element
// creation, style cssText capture, id lookup, and `#id`/`[data-*]` queries for
// structure assertions. innerHTML is a plain string — children built via
// createElement/appendChild are what the geometry test inspects.

type FakeListener = (ev?: unknown) => void;

const idRegistry = new Map<string, FakeEl>();

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  textContent = '';
  private html = '';
  private _id = '';

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

  appendChild(child: FakeEl): FakeEl {
    if (child.parent) {
      child.parent.children = child.parent.children.filter((c) => c !== child);
      child.parent = null;
    }
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
    if (this._id) idRegistry.delete(this._id);
  }

  addEventListener(_type: string, _listener: FakeListener): void {}
  removeEventListener(_type: string, _listener: FakeListener): void {}

  /** `#id` lookup through the registry — cube-ui binds via querySelector('#…'). */
  querySelector(selector: string): FakeEl | null {
    const m = /^#([A-Za-z0-9_-]+)$/.exec(selector);
    return m ? idRegistry.get(m[1]!) ?? null : null;
  }

  querySelectorAll(selector: string): FakeEl[] {
    const m = /^\[data-([a-z0-9-]+)\]$/.exec(selector);
    if (!m) return [];
    const key = m[1]!.replace(/-([a-z0-9])/g, (_dash, c: string) => c.toUpperCase());
    const found: FakeEl[] = [];
    const visit = (el: FakeEl): void => {
      if (el.dataset[key] !== undefined) found.push(el);
      for (const child of el.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return found;
  }
}

function installFakeDocument(): FakeEl {
  const doc = {
    head: new FakeEl('head'),
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => idRegistry.get(id) ?? null,
  };
  (globalThis as { document?: unknown }).document = doc;
  return new FakeEl('div');
}

function uninstallFakeDocument(): void {
  idRegistry.clear();
  delete (globalThis as { document?: unknown }).document;
}

function cubeCallbacks(): CubeUICallbacks {
  return {
    getBag: () => [],
    getMaterials: () => zero,
    onSalvage: () => ({ ok: false }),
    onReroll: () => ({ ok: false }),
    onFuse: () => ({ ok: false }),
    onPresent: () => {},
    showNotification: () => {},
    onClose: () => {},
  };
}

describe('cube panel geometry (N2R B2/F7)', () => {
  let mount: FakeEl;

  beforeEach(() => {
    mount = installFakeDocument();
  });

  afterEach(() => {
    uninstallFakeDocument();
  });

  /** Install + open (exercises render into the wrapper), then return the panel. */
  function install(): FakeEl {
    const handle = installCubeUI(cubeCallbacks(), mount as unknown as HTMLElement);
    handle.open();
    const panel = mount.children[0]!;
    expect(panel.id).toBe('hellforge-cube');
    return panel;
  }

  test('panel positions/sizes only — no percentage padding on the positioned box', () => {
    const css = install().style.cssText;
    // B2: a positioned box would resolve % padding against the viewport
    // (1080p: 201.6px per side), crushing the recipe preview — the panel
    // itself carries no padding at all.
    expect(css).not.toContain('padding');
  });

  test('3:4 frame survives any window — aspect-ratio plus the 96vw term in the height min()', () => {
    const css = install().style.cssText;
    expect(css).toContain('aspect-ratio: 3/4');
    expect(css).toContain('width: auto');
    expect(css).toContain('max-width: 96vw');
    // F7: height shrinks with 96vw too (96vw × 4/3), so the ratio is explicit
    // even when the width cap would bite — the painted border never squashes.
    expect(css).toContain('height: min(calc(100% - 48px), 900px, calc(96vw * 4 / 3))');
  });

  test('parchment inset lives on a static inner wrapper with percentage padding', () => {
    const panel = install();
    // exactly one child — the wrapper; rendered content must never replace it
    expect(panel.children).toHaveLength(1);
    const inner = panel.children[0]!;
    expect(inner.parent).toBe(panel);
    const css = inner.style.cssText;
    // static (non-positioned) child: % padding resolves against the panel's
    // content-box width — K3-measured forge parchment core (art 137/640/149/879
    // on 768×1024) maps to 1080p ~120.2/112.7/131.0/127.6px per side
    expect(css).toContain('padding: 19.4% 16.7% 18.9% 17.8%');
    expect(css).toContain('height: 100%');
    expect(css).toContain('box-sizing: border-box');
    expect(css).toContain('overflow: hidden');
  });

  test('panel carries no ink backplate — trimmed frame corners stay transparent', () => {
    const css = install().style.cssText;
    // P2: the forge art is alpha-trimmed at the corners; a full-rect ink layer
    // underneath would read as a black box when the scene passes behind it.
    expect(css).toContain('center/100% 100% no-repeat');
    expect(css).not.toContain(Ui.inkPanel);
  });

  test('well grid scales with the panel — % width + aspect-ratio, no fixed 48px cells', () => {
    const html = install().children[0]!.innerHTML;
    // B: the 3×4 grid is a %-width CSS grid (no CELL_SIZE px math); cells stay
    // square via the container's 3:4 aspect-ratio — 1080p ~67px, 720p ~50px.
    expect(html).toContain('aspect-ratio:3/4');
    expect(html).toContain('grid-template-columns:repeat(3,1fr)');
    expect(html).toContain('grid-template-rows:repeat(4,1fr)');
    expect(html).not.toContain('48px');
  });

  test('left column leaves the 220px lock — % flex-basis with a px cap', () => {
    const html = install().children[0]!.innerHTML;
    expect(html).toContain('flex:0 0 min(46%, 240px)');
    expect(html).not.toContain('flex:0 0 220px');
  });

  test('candidate area fills the right column — no 220px max-height cutoff', () => {
    const html = install().children[0]!.innerHTML;
    expect(html).toContain('class="hf-scroll"');
    expect(html).toContain('flex:1;min-height:0');
    expect(html).not.toContain('max-height:220px');
  });

  test('left column distributes vertically — grid centered, buttons pinned to bottom', () => {
    const html = install().children[0]!.innerHTML;
    // B: no single empty gap below the buttons — the grid rides in a flex:1
    // centering wrapper and the button row pins to the column bottom via
    // margin-top:auto (acceptance 2: 纵向吃满无大块空白客厅).
    expect(html).toContain('flex:1;display:flex;align-items:center');
    expect(html).toContain('margin-top:auto');
  });
});

// ── N2R craft show (锤炼演出) ────────────────────────────────────────────────
// Structural assertions on the pure markup/style builders — the fake DOM
// cannot drive a click into `resolving`, so the show is tested at the source.

describe('forge craft show — master timeline (N2R)', () => {
  const css = forgeCraftStyleText();

  test('every animated layer samples the same clock — var(--hf-forge-ms), no independent loops', () => {
    // The stub's `0.55s ease-in-out infinite` hammer is gone; hammer/sparks/
    // flash/bar/shake all run one shot on the shared master timeline.
    expect(css).toContain('animation: hf-forge-hammer var(--hf-forge-ms)');
    expect(css).toContain('animation: hf-spark-b1 var(--hf-forge-ms)');
    expect(css).toContain('animation: hf-spark-b4 var(--hf-forge-ms)');
    expect(css).toContain('animation: hf-forge-flash var(--hf-forge-ms)');
    expect(css).toContain('animation: hf-forge-bar-fill var(--hf-forge-ms)');
    expect(css).toContain('animation: hf-forge-shake var(--hf-forge-ms)');
    expect(css).toContain('animation: hf-forge-gridglow var(--hf-forge-ms)');
    expect(css).not.toContain('0.55s');
    // Only the ambient embers may loop (atmosphere, not a beat) — exactly one
    // `infinite` in the whole stylesheet, on the ember rule.
    expect(css.match(/infinite/g) ?? []).toHaveLength(1);
    expect(css).toContain('animation: hf-ember 3.4s linear infinite');
  });

  test('impact frames land at 16/36/56/76% of FORGE_REVEAL_MS (240/540/840/1140 @1500)', () => {
    // Hammer slam keyframes at every strike anchor.
    for (const pct of ['16.00%', '36.00%', '56.00%', '76.00%']) {
      expect(css).toContain(pct);
    }
  });

  test('progress bar is stepped (jump at strikes, hold between) — not one linear fill', () => {
    const bar = css.slice(css.indexOf('@keyframes hf-forge-bar-fill'));
    const stops = bar.match(/scaleX\(/g) ?? [];
    // 0% + 2 per strike (creep + jump) + 100% ≫ the stub's single from→to.
    expect(stops.length).toBeGreaterThanOrEqual(9);
    expect(bar).toContain('scaleX(1)');
  });

  test('stage carries hammer / anvil / sparks / flash / ring / embers; sparks are particles not a blob', () => {
    const stage = forgeCraftStageHtml('reroll');
    expect(stage).toContain('hf-forge-hammer');
    expect(stage).toContain('hf-forge-anvil');
    expect(stage).toContain('hf-forge-flash');
    expect(stage).toContain('hf-forge-ring');
    expect(stage).toContain('hf-forge-bloom');
    const sparks = stage.match(/hf-forge-spark hf-sp-b/g) ?? [];
    expect(sparks.length).toBeGreaterThanOrEqual(24); // 4 bursts × ≥6 particles
    const embers = stage.match(/hf-forge-ember/g) ?? [];
    expect(embers.length).toBeGreaterThanOrEqual(4);
  });

  test('overlay + stage both keep pointer-events:none (close button stays clickable)', () => {
    const overlay = forgeCraftOverlayHtml('reroll', 'resolving');
    expect(overlay).toContain('class="hf-forge-craft"');
    expect(css).toContain('.hf-forge-craft {');
    expect(css).toMatch(/\.hf-forge-craft \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.hf-forge-stage \{[^}]*pointer-events: none/);
  });

  test('three actions are distinguishable: palette, branch assets, caption icon', () => {
    // Palettes differ per action (cold→ember salvage, gold reroll, step-up fuse).
    const salvage = forgeCraftPaletteCss('salvage');
    const reroll = forgeCraftPaletteCss('reroll');
    const fuse = forgeCraftPaletteCss('fuse');
    expect(salvage).not.toBe(reroll);
    expect(reroll).not.toBe(fuse);
    for (const pal of [salvage, reroll, fuse]) {
      expect(pal).toContain('--hf-c4:');
    }
    // Branch assets: salvage cracks, fuse streams + coalescence, reroll neither.
    expect(forgeCraftStageHtml('salvage')).toContain('hf-forge-cracks');
    expect(forgeCraftStageHtml('salvage')).not.toContain('hf-forge-streams');
    expect(forgeCraftStageHtml('fuse')).toContain('hf-forge-streams');
    expect(forgeCraftStageHtml('fuse')).toContain('hf-forge-coalesce');
    expect(forgeCraftStageHtml('reroll')).not.toContain('hf-forge-cracks');
    expect(forgeCraftStageHtml('reroll')).not.toContain('hf-forge-streams');
    // Branch CSS: no hammer for salvage, single-strike hammer + burst-4-only
    // sparks for fuse, fragments (not round sparks) for salvage.
    expect(css).toContain("[data-action='salvage'] .hf-forge-hammer { display: none; }");
    expect(css).toContain("[data-action='fuse'] .hf-forge-hammer { animation-name: hf-forge-hammer-fuse, hf-forge-hammer-glint; }");
    expect(css).toContain("[data-action='salvage'] .hf-forge-spark { border-radius: 1px; }");
    // Caption carries a per-action glyph.
    expect(forgeCraftOverlayHtml('salvage', 'resolving')).toContain('锤炼中 · 拆解');
    expect(forgeCraftOverlayHtml('reroll', 'resolving')).toContain('锤炼中 · 重铸');
    expect(forgeCraftOverlayHtml('fuse', 'resolving')).toContain('锤炼中 · 合成');
    expect(forgeCraftOverlayHtml('fuse', 'resolving')).toContain('<svg');
  });

  test('reveal ack: tint glow + 完成 caption inside the FORGE_REVEAL_ACK_MS window', () => {
    expect(FORGE_REVEAL_ACK_MS).toBe(700);
    const reveal = forgeCraftOverlayHtml('reroll', 'reveal', '#88ccff');
    expect(reveal).toContain('hf-forge-reveal');
    expect(reveal).toContain('重铸完成');
    expect(reveal).toContain('--hf-tint:#88ccff');
    expect(reveal).toContain('color:#88ccff');
    expect(css).toContain(`hf-forge-reveal-glow ${FORGE_REVEAL_ACK_MS}ms`);
    // Tint falls back gracefully when no present payload survived.
    expect(forgeCraftOverlayHtml('fuse', 'reveal')).toContain('--hf-tint:#ffd066');
  });

  test('data-action is present on overlay and stage roots so branch CSS binds', () => {
    expect(forgeCraftOverlayHtml('salvage', 'resolving')).toContain('data-action="salvage"');
    expect(forgeCraftStageHtml('fuse')).toContain('data-action="fuse"');
  });

  test('live row vars carry the master clock locked to FORGE_REVEAL_MS', () => {
    // The "contract window rescales the whole show" promise lives here.
    expect(forgeCraftRowVars('reroll')).toContain(`--hf-forge-ms:${FORGE_REVEAL_MS}ms`);
    expect(forgeCraftRowVars('fuse')).toContain('--hf-c4:');
  });

  test('salvage cracks accumulate — flash, hold as scars, re-flash at the shatter frame', () => {
    // Per-crack absolute keyframes (no staggered delays): crack N flashes at
    // strike N, holds 0.45 until s4, re-flashes 0.9 at the shatter, then dies.
    for (const n of [1, 2, 3]) {
      expect(css).toContain(`@keyframes hf-crack-${n}`);
      expect(css).toContain(`.hf-crack-${n} { animation: hf-crack-${n} var(--hf-forge-ms) linear both; }`);
    }
    expect(css).not.toContain('hf-crack-flash');
  });
});
