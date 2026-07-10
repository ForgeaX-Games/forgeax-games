/**
 * Hellforge runtime render-settings panel (F10).
 *
 * Persists post-process / lighting / atmosphere / particle knobs to localStorage,
 * applies Camera fields via a single writer (`applyCamera`), and notifies the
 * host for lighting multipliers and particle density/style.
 *
 * Skeleton patterns from marscraft `settings-panel.ts`: LS load/save merge,
 * range rows, immediate apply, F10 toggle.
 */

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import {
  ANTIALIAS_FXAA,
  ANTIALIAS_MSAA,
  ANTIALIAS_NONE,
  BLOOM_DISABLED,
  BLOOM_ENABLED,
  Camera,
  perspective,
  TONEMAP_ACES_FILMIC,
  TONEMAP_AGX,
  TONEMAP_CINEON,
  TONEMAP_LINEAR,
  TONEMAP_NEUTRAL,
  TONEMAP_REINHARD_EXTENDED,
} from '@forgeax/engine-runtime';

export interface RenderSettings {
  tonemap: 'aces' | 'agx' | 'neutral' | 'cineon' | 'reinhard' | 'linear';
  exposure: number; // 0.2..3 default 1
  whitePoint: number; // 1..8 default 4
  antialias: 'none' | 'fxaa' | 'msaa';
  bloom: boolean;
  bloomThreshold: number; // 0.5..3 default 1.25
  bloomIntensity: number; // 0..2 default 0.55
  bloomBlurRadius: number; // 1..8 default 4
  sunMul: number; // 0..2.5 default 1
  ambientMul: number; // 0..3 default 1
  fireMul: number; // 0..2 default 1
  fillMul: number; // 0..2 default 1
  atmoTemp: number; // -1..1 default 0
  vignette: number; // 0..0.8 default 0.22
  particleDensity: number; // 0..2 default 1
  particleStyle: 'auto' | 'ash' | 'snow' | 'off';
}

export type InstallRenderSettingsArgs = {
  mount: HTMLElement;
  world: World;
  camera: EntityHandle;
  /** Returns current aspect for perspective. */
  getAspect: () => number;
  /** Called whenever lighting multipliers / atmoTemp change. */
  onLighting: (s: RenderSettings) => void;
  /** Called whenever particleDensity/style change. */
  onParticles: (s: RenderSettings) => void;
  /** Camera projection params used by applyCamera. */
  proj: { fov: number; near: number; far: number };
};

export type RenderSettingsApi = {
  get: () => RenderSettings;
  /** ONLY writer of Camera component fields. */
  applyCamera: () => void;
  toggle: () => void;
  dispose: () => void;
};

const LS_KEY = 'hellforge.render.v1';
const STYLE_ID = 'hf-rs-style';
const PANEL_ID = 'hf-rs';
const VIGNETTE_ID = 'hf-rs-vignette';

/** Same RGB as private SKY_CLEAR in main.ts (clearA defaults to 1). */
const SKY_CLEAR = { clearR: 0.32, clearG: 0.07, clearB: 0.035, clearA: 1 } as const;

const DEFAULTS: RenderSettings = {
  tonemap: 'aces',
  exposure: 1,
  whitePoint: 4,
  antialias: 'fxaa',
  bloom: true,
  bloomThreshold: 1.25,
  bloomIntensity: 0.55,
  bloomBlurRadius: 4,
  sunMul: 1,
  ambientMul: 1,
  fireMul: 1,
  fillMul: 1,
  atmoTemp: 0,
  vignette: 0.22,
  particleDensity: 1,
  particleStyle: 'auto',
};

const CSS = `
#${PANEL_ID} {
  position: absolute; left: 14px; top: 64px; z-index: 58;
  pointer-events: auto; display: none; user-select: none;
  font: 600 12px ui-monospace, Menlo, Consolas, monospace; color: #e8dcc8;
  max-height: calc(100% - 80px); overflow-y: auto;
  width: 280px; padding: 12px 14px 14px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(24,16,12,0.96), rgba(14,9,7,0.96));
  border: 1px solid rgba(200,150,80,0.45);
  box-shadow: 0 10px 36px rgba(0,0,0,0.7);
}
#${PANEL_ID} .hf-rs-title {
  font: 800 13px ui-sans-serif, system-ui, sans-serif;
  color: #e8cf9a; letter-spacing: 2px; margin: 0 0 10px;
}
#${PANEL_ID} .hf-rs-sec {
  font: 700 11px ui-sans-serif, system-ui, sans-serif;
  color: #c4a878; letter-spacing: 1px;
  margin: 10px 0 4px; padding-top: 6px;
  border-top: 1px solid rgba(120,90,50,0.35);
}
#${PANEL_ID} .hf-rs-sec:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
#${PANEL_ID} .hf-rs-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 3px 0; font-size: 11px; color: #d8c8b0;
}
#${PANEL_ID} .hf-rs-row label { flex: 1; min-width: 0; }
#${PANEL_ID} .hf-rs-row input[type=range] { width: 118px; accent-color: #c4883a; }
#${PANEL_ID} .hf-rs-row select {
  width: 118px; background: #1a120e; color: #e8dcc8;
  border: 1px solid rgba(160,120,60,0.45); border-radius: 4px; font: inherit;
}
#${PANEL_ID} .hf-rs-row input[type=checkbox] { accent-color: #c4883a; }
#${PANEL_ID} .hf-rs-val {
  width: 36px; text-align: right; color: #a89880; font-variant-numeric: tabular-nums;
}
#${PANEL_ID} .hf-rs-reset {
  margin-top: 12px; width: 100%; cursor: pointer;
  background: linear-gradient(180deg, #6a4a2a, #3a2818); color: #f0e0c0;
  border: 1px solid rgba(200,150,80,0.55); border-radius: 6px;
  padding: 7px; font: 700 12px ui-sans-serif, system-ui, sans-serif;
}
#${VIGNETTE_ID} {
  position: absolute; inset: 0; z-index: 40; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.92) 100%);
}
`;

function load(): RenderSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS };
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RenderSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: RenderSettings): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / private mode */
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Color-temp shift on clear RGB: warmer → more R / less B. */
function tempShiftClear(
  base: { clearR: number; clearG: number; clearB: number; clearA: number },
  t: number,
): { clearR: number; clearG: number; clearB: number; clearA: number } {
  const tt = clamp(t, -1, 1);
  return {
    clearR: Math.max(0, base.clearR * (1 + 0.18 * tt)),
    clearG: Math.max(0, base.clearG),
    clearB: Math.max(0, base.clearB * (1 - 0.22 * tt)),
    clearA: base.clearA,
  };
}

function tonemapConst(mode: RenderSettings['tonemap']): number {
  switch (mode) {
    case 'aces':
      return TONEMAP_ACES_FILMIC;
    case 'agx':
      return TONEMAP_AGX;
    case 'neutral':
      return TONEMAP_NEUTRAL;
    case 'cineon':
      return TONEMAP_CINEON;
    case 'reinhard':
      return TONEMAP_REINHARD_EXTENDED;
    case 'linear':
      return TONEMAP_LINEAR;
  }
}

function antialiasConst(mode: RenderSettings['antialias']): number {
  switch (mode) {
    case 'none':
      return ANTIALIAS_NONE;
    case 'fxaa':
      return ANTIALIAS_FXAA;
    case 'msaa':
      return ANTIALIAS_MSAA;
  }
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function installRenderSettings(args: InstallRenderSettingsArgs): RenderSettingsApi {
  const settings = load();
  const { world, camera, getAspect, onLighting, onParticles, proj } = args;

  const applyCamera = (): void => {
    const clear = tempShiftClear(SKY_CLEAR, settings.atmoTemp);
    world.set(camera, Camera, {
      ...perspective({
        fov: proj.fov,
        aspect: getAspect(),
        near: proj.near,
        far: proj.far,
      }),
      tonemap: tonemapConst(settings.tonemap),
      exposure: settings.exposure,
      whitePoint: settings.whitePoint,
      antialias: antialiasConst(settings.antialias),
      bloom: settings.bloom ? BLOOM_ENABLED : BLOOM_DISABLED,
      bloomThreshold: settings.bloomThreshold,
      bloomIntensity: settings.bloomIntensity,
      bloomBlurRadius: settings.bloomBlurRadius,
      ...clear,
    });
  };

  const applyVignette = (): void => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(VIGNETTE_ID);
    if (el) el.style.opacity = String(clamp(settings.vignette, 0, 0.8));
  };

  const persistAndNotify = (opts: { lighting?: boolean; particles?: boolean }): void => {
    save(settings);
    applyCamera();
    applyVignette();
    if (opts.lighting) onLighting(settings);
    if (opts.particles) onParticles(settings);
  };

  if (typeof document === 'undefined') {
    persistAndNotify({ lighting: true, particles: true });
    return {
      get: () => settings,
      applyCamera,
      toggle: () => {},
      dispose: () => {},
    };
  }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(VIGNETTE_ID)?.remove();

  const scoped = args.mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';

  const vignetteEl = document.createElement('div');
  vignetteEl.id = VIGNETTE_ID;
  vignetteEl.style.position = posKind;
  vignetteEl.style.opacity = String(clamp(settings.vignette, 0, 0.8));
  args.mount.appendChild(vignetteEl);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  if (!scoped) panel.style.position = 'fixed';
  args.mount.appendChild(panel);

  type NumKey =
    | 'exposure' | 'whitePoint' | 'bloomThreshold' | 'bloomIntensity' | 'bloomBlurRadius'
    | 'sunMul' | 'ambientMul' | 'fireMul' | 'fillMul' | 'atmoTemp' | 'vignette' | 'particleDensity';
  type SelectKey = 'tonemap' | 'antialias' | 'particleStyle';
  type RowDef =
    | {
        kind: 'range';
        key: NumKey;
        label: string;
        min: number;
        max: number;
        step: number;
        digits?: number;
        group: 'camera' | 'lighting' | 'particles';
      }
    | {
        kind: 'select';
        key: SelectKey;
        label: string;
        options: Array<{ value: string; label: string }>;
        group: 'camera' | 'lighting' | 'particles';
      }
    | {
        kind: 'check';
        key: 'bloom';
        label: string;
        group: 'camera';
      };

  const rows: Array<{ sec?: string; row: RowDef }> = [
    { sec: '后处理', row: {
      kind: 'select', key: 'tonemap', label: 'Tonemap', group: 'camera',
      options: [
        { value: 'aces', label: 'ACES' },
        { value: 'agx', label: 'AgX' },
        { value: 'neutral', label: 'Neutral' },
        { value: 'cineon', label: 'Cineon' },
        { value: 'reinhard', label: 'Reinhard' },
        { value: 'linear', label: 'Linear' },
      ],
    } },
    { row: { kind: 'range', key: 'exposure', label: 'Exposure', min: 0.2, max: 3, step: 0.05, group: 'camera' } },
    { row: { kind: 'range', key: 'whitePoint', label: 'White point', min: 1, max: 8, step: 0.1, group: 'camera' } },
    { row: {
      kind: 'select', key: 'antialias', label: '抗锯齿', group: 'camera',
      options: [
        { value: 'none', label: 'None' },
        { value: 'fxaa', label: 'FXAA' },
        { value: 'msaa', label: 'MSAA' },
      ],
    } },
    { row: { kind: 'check', key: 'bloom', label: 'Bloom', group: 'camera' } },
    { row: { kind: 'range', key: 'bloomThreshold', label: 'Bloom 阈值', min: 0.5, max: 3, step: 0.05, group: 'camera' } },
    { row: { kind: 'range', key: 'bloomIntensity', label: 'Bloom 强度', min: 0, max: 2, step: 0.05, group: 'camera' } },
    { row: { kind: 'range', key: 'bloomBlurRadius', label: 'Bloom 半径', min: 1, max: 8, step: 0.5, digits: 1, group: 'camera' } },
    { sec: '光影', row: { kind: 'range', key: 'sunMul', label: '太阳 ×', min: 0, max: 2.5, step: 0.05, group: 'lighting' } },
    { row: { kind: 'range', key: 'ambientMul', label: '环境 ×', min: 0, max: 3, step: 0.05, group: 'lighting' } },
    { row: { kind: 'range', key: 'fireMul', label: '火焰 ×', min: 0, max: 2, step: 0.05, group: 'lighting' } },
    { row: { kind: 'range', key: 'fillMul', label: '补光 ×', min: 0, max: 2, step: 0.05, group: 'lighting' } },
    { sec: '大气', row: { kind: 'range', key: 'atmoTemp', label: '色温', min: -1, max: 1, step: 0.05, group: 'lighting' } },
    { row: { kind: 'range', key: 'vignette', label: '暗角', min: 0, max: 0.8, step: 0.02, group: 'camera' } },
    { sec: '粒子', row: { kind: 'range', key: 'particleDensity', label: '密度', min: 0, max: 2, step: 0.05, group: 'particles' } },
    { row: {
      kind: 'select', key: 'particleStyle', label: '样式', group: 'particles',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'ash', label: 'Ash' },
        { value: 'snow', label: 'Snow' },
        { value: 'off', label: 'Off' },
      ],
    } },
  ];

  const title = document.createElement('div');
  title.className = 'hf-rs-title';
  title.textContent = '渲染设置 · F10';
  panel.appendChild(title);

  const valEls = new Map<string, HTMLElement>();

  const notifyFor = (group: RowDef['group']): void => {
    persistAndNotify({
      lighting: group === 'lighting',
      particles: group === 'particles',
    });
  };

  for (const { sec, row } of rows) {
    if (sec) {
      const h = document.createElement('div');
      h.className = 'hf-rs-sec';
      h.textContent = sec;
      panel.appendChild(h);
    }
    const wrap = document.createElement('div');
    wrap.className = 'hf-rs-row';
    const lab = document.createElement('label');
    lab.textContent = row.label;
    wrap.appendChild(lab);

    if (row.kind === 'range') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(row.min);
      input.max = String(row.max);
      input.step = String(row.step);
      input.value = String(settings[row.key] as number);
      const val = document.createElement('span');
      val.className = 'hf-rs-val';
      val.textContent = fmt(settings[row.key] as number, row.digits ?? 2);
      valEls.set(row.key, val);
      input.addEventListener('input', () => {
        const n = clamp(parseFloat(input.value), row.min, row.max);
        settings[row.key] = n;
        val.textContent = fmt(n, row.digits ?? 2);
        notifyFor(row.group);
      });
      wrap.append(input, val);
    } else if (row.kind === 'select') {
      const sel = document.createElement('select');
      for (const opt of row.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      sel.value = String(settings[row.key]);
      sel.addEventListener('change', () => {
        const key = row.key;
        if (key === 'tonemap') {
          settings.tonemap = sel.value as RenderSettings['tonemap'];
        } else if (key === 'antialias') {
          settings.antialias = sel.value as RenderSettings['antialias'];
        } else {
          settings.particleStyle = sel.value as RenderSettings['particleStyle'];
        }
        notifyFor(row.group);
      });
      wrap.appendChild(sel);
      valEls.set(row.key, sel);
    } else {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = settings.bloom;
      input.addEventListener('change', () => {
        settings.bloom = input.checked;
        notifyFor(row.group);
      });
      wrap.appendChild(input);
      valEls.set(row.key, input);
    }
    panel.appendChild(wrap);
  }

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'hf-rs-reset';
  resetBtn.textContent = '重置默认';
  resetBtn.addEventListener('click', () => {
    Object.assign(settings, DEFAULTS);
    // Sync controls from DEFAULTS
    for (const { row } of rows) {
      const el = valEls.get(row.key);
      if (!el) continue;
      if (row.kind === 'range') {
        const input = el.previousElementSibling as HTMLInputElement | null;
        const n = settings[row.key] as number;
        if (input) input.value = String(n);
        el.textContent = fmt(n, row.digits ?? 2);
      } else if (row.kind === 'select') {
        (el as HTMLSelectElement).value = String(settings[row.key]);
      } else {
        (el as HTMLInputElement).checked = settings.bloom;
      }
    }
    persistAndNotify({ lighting: true, particles: true });
  });
  panel.appendChild(resetBtn);

  const open = (): void => {
    panel.style.display = 'block';
  };
  const close = (): void => {
    panel.style.display = 'none';
  };
  const toggle = (): void => {
    if (panel.style.display === 'none' || panel.style.display === '') open();
    else close();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'F10') {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener('keydown', onKey);

  // Apply persisted settings on install (camera + lighting + particles + vignette).
  persistAndNotify({ lighting: true, particles: true });

  return {
    get: () => settings,
    applyCamera,
    toggle,
    dispose: () => {
      window.removeEventListener('keydown', onKey);
      panel.remove();
      vignetteEl.remove();
    },
  };
}
