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
import { FONT_UI } from './ui-theme';

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
  /** CSS horizon / smoke haze strength (fake distance fog; not engine Fog). */
  haze: number; // 0..1 default 0.55
  particleDensity: number; // 0..2 default 1
  particleStyle: 'auto' | 'ash' | 'snow' | 'off';
  /** Backbuffer scale vs CSS size × devicePixelRatio (0.5..1.5). */
  renderScale: number;
  /** Cap gameplay update rate; 0 = unlimited. */
  fpsCap: number;
  /** Scene BGM gain 0..1 (HTMLAudio; default under SFX so hits stay readable). */
  bgmVolume: number;
  /** Synthesized SFX gain 0..1 (scales sfx.ts master). */
  sfxVolume: number;
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
  /** Called whenever renderScale / fpsCap change. */
  onDisplay?: (s: RenderSettings) => void;
  /** Called whenever bgmVolume / sfxVolume change. */
  onAudio?: (s: RenderSettings) => void;
  /** Camera projection params used by applyCamera. */
  proj: { fov: number; near: number; far: number };
};

export type RenderSettingsApi = {
  get: () => RenderSettings;
  /** ONLY writer of Camera component fields. */
  applyCamera: () => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  dispose: () => void;
};

// v3: dark hellforge grade — Belfast HDR peaks crushed so sky isn't blown white.
const LS_KEY = 'hellforge.render.v3';
const STYLE_ID = 'hf-rs-style';
const PANEL_ID = 'hf-rs';
const VIGNETTE_ID = 'hf-rs-vignette';
const HAZE_ID = 'hf-rs-haze';

/** Fallback clear when skybox unavailable — keep in sync with main.ts SKY_CLEAR. */
const SKY_CLEAR = [0.055, 0.018, 0.012, 1] as const;

const DEFAULTS: RenderSettings = {
  tonemap: 'aces',
  exposure: 0.42,
  whitePoint: 4.5,
  antialias: 'fxaa',
  bloom: true,
  bloomThreshold: 1.9,
  bloomIntensity: 0.50,
  bloomBlurRadius: 4.5,
  sunMul: 0.55,
  ambientMul: 0.42,
  fireMul: 1.4,
  fillMul: 0.70,
  atmoTemp: 0.50,
  vignette: 0.65,
  haze: 0.70,
  particleDensity: 1.15,
  particleStyle: 'auto',
  renderScale: 1,
  fpsCap: 0,
  bgmVolume: 0.22,
  sfxVolume: 1,
};

const CSS = `
#${PANEL_ID} {
  /* Above shell (z=200) so Title "设置" can open the same panel. */
  position: absolute; left: 14px; top: 64px; z-index: 220;
  pointer-events: auto; display: none; user-select: none;
  font: 600 12px ${FONT_UI}; color: #e8dcc8;
  max-height: calc(100% - 80px); overflow-y: auto;
  width: 280px; padding: 12px 14px 14px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(24,16,12,0.96), rgba(14,9,7,0.96));
  border: 1px solid rgba(200,150,80,0.45);
  box-shadow: 0 10px 36px rgba(0,0,0,0.7);
}
#${PANEL_ID} .hf-rs-title {
  font: 800 13px ${FONT_UI};
  color: #e8cf9a; letter-spacing: 2px; margin: 0 0 10px;
}
#${PANEL_ID} .hf-rs-sec {
  font: 700 11px ${FONT_UI};
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
  padding: 7px; font: 700 12px ${FONT_UI};
}
#${VIGNETTE_ID} {
  position: absolute; inset: 0; z-index: 40; pointer-events: none;
  /* Stronger dark rim + ember wash for Diablo-dark grade. */
  background:
    radial-gradient(ellipse at 50% 70%, rgba(120, 32, 8, 0.18) 0%, transparent 50%),
    radial-gradient(ellipse at center, transparent 32%, rgba(0, 0, 0, 0.96) 100%);
}
#${HAZE_ID} {
  position: absolute; inset: 0; z-index: 41; pointer-events: none;
  /* Fake distance fog: heavier ash vault + horizon wash (Diablo outdoor). */
  background:
    linear-gradient(180deg,
      rgba(12, 5, 4, 0.45) 0%,
      rgba(20, 8, 5, 0.18) 22%,
      transparent 34%,
      rgba(42, 16, 8, 0.38) 50%,
      rgba(22, 9, 5, 0.55) 66%,
      rgba(8, 3, 2, 0.35) 100%),
    radial-gradient(ellipse 130% 60% at 50% 56%,
      rgba(48, 18, 8, 0.48) 0%,
      rgba(22, 8, 5, 0.22) 48%,
      transparent 74%);
}
`;

function sanitize(partial: Partial<RenderSettings>): RenderSettings {
  const s = { ...DEFAULTS, ...partial };
  const scales = [0.5, 0.75, 1, 1.25, 1.5];
  if (!scales.includes(s.renderScale)) s.renderScale = DEFAULTS.renderScale;
  const caps = [0, 30, 60, 120];
  if (!caps.includes(s.fpsCap)) s.fpsCap = DEFAULTS.fpsCap;
  s.bgmVolume = clamp(Number.isFinite(s.bgmVolume) ? s.bgmVolume : DEFAULTS.bgmVolume, 0, 1);
  s.sfxVolume = clamp(Number.isFinite(s.sfxVolume) ? s.sfxVolume : DEFAULTS.sfxVolume, 0, 1);
  return s;
}

function load(): RenderSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULTS };
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    return sanitize(JSON.parse(raw) as Partial<RenderSettings>);
  } catch {
    return { ...DEFAULTS };
  }
}

/** Read persisted knobs before the F10 panel is installed (Title canvas sizing). */
export function loadRenderSettings(): RenderSettings {
  return load();
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
  base: readonly [number, number, number, number],
  t: number,
): { clearColor: [number, number, number, number] } {
  const tt = clamp(t, -1, 1);
  return {
    clearColor: [
      Math.max(0, base[0] * (1 + 0.18 * tt)),
      Math.max(0, base[1]),
      Math.max(0, base[2] * (1 - 0.22 * tt)),
      base[3],
    ],
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
  const { world, camera, getAspect, onLighting, onParticles, onDisplay, onAudio, proj } = args;

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

  const applyAtmosphereOverlay = (): void => {
    if (typeof document === 'undefined') return;
    const v = document.getElementById(VIGNETTE_ID);
    if (v) v.style.opacity = String(clamp(settings.vignette, 0, 0.8));
    const h = document.getElementById(HAZE_ID);
    if (h) h.style.opacity = String(clamp(settings.haze, 0, 1));
  };

  const persistAndNotify = (opts: {
    lighting?: boolean;
    particles?: boolean;
    display?: boolean;
    audio?: boolean;
  }): void => {
    save(settings);
    // Display first so renderScale can resize the canvas before applyCamera
    // reads getAspect().
    if (opts.display) onDisplay?.(settings);
    applyCamera();
    applyAtmosphereOverlay();
    if (opts.lighting) onLighting(settings);
    if (opts.particles) onParticles(settings);
    if (opts.audio) onAudio?.(settings);
  };

  if (typeof document === 'undefined') {
    persistAndNotify({ lighting: true, particles: true, display: true, audio: true });
    return {
      get: () => settings,
      applyCamera,
      open: () => {},
      close: () => {},
      toggle: () => {},
      dispose: () => {},
    };
  }

  {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = CSS;
  }

  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(VIGNETTE_ID)?.remove();
  document.getElementById(HAZE_ID)?.remove();

  const scoped = args.mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';

  const vignetteEl = document.createElement('div');
  vignetteEl.id = VIGNETTE_ID;
  vignetteEl.style.position = posKind;
  vignetteEl.style.opacity = String(clamp(settings.vignette, 0, 0.8));
  args.mount.appendChild(vignetteEl);

  const hazeEl = document.createElement('div');
  hazeEl.id = HAZE_ID;
  hazeEl.style.position = posKind;
  hazeEl.style.opacity = String(clamp(settings.haze, 0, 1));
  args.mount.appendChild(hazeEl);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  if (!scoped) panel.style.position = 'fixed';
  args.mount.appendChild(panel);

  type NumKey =
    | 'exposure' | 'whitePoint' | 'bloomThreshold' | 'bloomIntensity' | 'bloomBlurRadius'
    | 'sunMul' | 'ambientMul' | 'fireMul' | 'fillMul' | 'atmoTemp' | 'vignette' | 'haze'
    | 'particleDensity' | 'bgmVolume' | 'sfxVolume';
  type SelectKey = 'tonemap' | 'antialias' | 'particleStyle' | 'renderScale' | 'fpsCap';
  type RowGroup = 'camera' | 'lighting' | 'particles' | 'display' | 'audio';
  type RowDef =
    | {
        kind: 'range';
        key: NumKey;
        label: string;
        min: number;
        max: number;
        step: number;
        digits?: number;
        group: RowGroup;
      }
    | {
        kind: 'select';
        key: SelectKey;
        label: string;
        options: Array<{ value: string; label: string }>;
        group: RowGroup;
      }
    | {
        kind: 'check';
        key: 'bloom';
        label: string;
        group: 'camera';
      };

  const rows: Array<{ sec?: string; row: RowDef }> = [
    { sec: '音频', row: {
      kind: 'range', key: 'bgmVolume', label: '音乐', min: 0, max: 1, step: 0.02, group: 'audio',
    } },
    { row: {
      kind: 'range', key: 'sfxVolume', label: '音效', min: 0, max: 1, step: 0.02, group: 'audio',
    } },
    { sec: '画面', row: {
      kind: 'select', key: 'renderScale', label: '渲染尺寸', group: 'display',
      options: [
        { value: '0.5', label: '50%' },
        { value: '0.75', label: '75%' },
        { value: '1', label: '100%' },
        { value: '1.25', label: '125%' },
        { value: '1.5', label: '150%' },
      ],
    } },
    { row: {
      kind: 'select', key: 'fpsCap', label: '帧速率', group: 'display',
      options: [
        { value: '0', label: '不限制' },
        { value: '30', label: '30 FPS' },
        { value: '60', label: '60 FPS' },
        { value: '120', label: '120 FPS' },
      ],
    } },
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
    { row: { kind: 'range', key: 'haze', label: '雾气', min: 0, max: 1, step: 0.02, group: 'camera' } },
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
  title.textContent = '设置 · F10';
  panel.appendChild(title);

  const valEls = new Map<string, HTMLElement>();

  const notifyFor = (group: RowDef['group']): void => {
    persistAndNotify({
      lighting: group === 'lighting',
      particles: group === 'particles',
      display: group === 'display',
      audio: group === 'audio',
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
        } else if (key === 'particleStyle') {
          settings.particleStyle = sel.value as RenderSettings['particleStyle'];
        } else if (key === 'renderScale') {
          settings.renderScale = parseFloat(sel.value);
        } else if (key === 'fpsCap') {
          settings.fpsCap = parseInt(sel.value, 10);
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
    persistAndNotify({ lighting: true, particles: true, display: true, audio: true });
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

  // Apply persisted settings on install (camera + lighting + particles + display + audio).
  persistAndNotify({ lighting: true, particles: true, display: true, audio: true });

  return {
    get: () => settings,
    applyCamera,
    open,
    close,
    toggle,
    dispose: () => {
      window.removeEventListener('keydown', onKey);
      panel.remove();
      vignetteEl.remove();
      hazeEl.remove();
    },
  };
}
