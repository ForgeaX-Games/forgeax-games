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
} from '@forgeax/engine-render';
import { FONT_UI } from './ui-theme';
import {
  ATMOSPHERE_CSS_OVERLAYS_ENABLED,
  RENDER_SETTINGS_DEFAULTS,
  type RenderSettingsDefaults,
} from './render-settings-defaults';

export type RenderSettings = RenderSettingsDefaults;

export { ATMOSPHERE_CSS_OVERLAYS_ENABLED, RENDER_SETTINGS_DEFAULTS };

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
  /**
   * Called whenever HDR-chain atmosphere knobs change (vignette / haze / atmoTemp).
   * T1: drives hellforge::atmosphere PostProcessParams — not CSS overlays.
   */
  onAtmosphere?: (s: RenderSettings) => void;
  /**
   * Camera projection params used by applyCamera.
   * `getVerticalFovRad` must read from the gameplay CameraRigState (sole FOV SSOT).
   */
  proj: { getVerticalFovRad: () => number; near: number; far: number };
  /**
   * When false, skip the window F10 listener so a host (UiLayerManager) owns
   * toggle exclusivity. Default true (Title shell).
   */
  bindHotkey?: boolean;
  /**
   * Optional per-area exposure scale (PR2c T3). Applied inside applyCamera so
   * Camera stays a single writer: `settings.exposure * getExposureMul()`.
   */
  getExposureMul?: () => number;
};

export type RenderSettingsApi = {
  get: () => RenderSettings;
  /** ONLY writer of Camera component fields. */
  applyCamera: () => void;
  /** Surface API for UiLayerManager.register. */
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  dispose: () => void;
};

// v3: dark hellforge grade — Belfast HDR peaks crushed so sky isn't blown white.
// Grade table SSOT (tonemap / exposure / whitePoint / bloom): render-settings-defaults.ts (PR2c T4).
const LS_KEY = 'hellforge.render.v3';
const STYLE_ID = 'hf-rs-style';
const PANEL_ID = 'hf-rs';

/** Fallback clear when skybox unavailable — keep in sync with main.ts SKY_CLEAR. */
const SKY_CLEAR = [0.055, 0.018, 0.012, 1] as const;

const DEFAULTS = RENDER_SETTINGS_DEFAULTS;

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
  const {
    world, camera, getAspect, onLighting, onParticles, onDisplay, onAudio, onAtmosphere, proj,
    getExposureMul,
  } = args;

  const applyCamera = (): void => {
    const clear = tempShiftClear(SKY_CLEAR, settings.atmoTemp);
    const exposureMul = getExposureMul?.() ?? 1;
    world.set(camera, Camera, {
      ...perspective({
        fov: proj.getVerticalFovRad(),
        aspect: getAspect(),
        near: proj.near,
        far: proj.far,
      }),
      tonemap: tonemapConst(settings.tonemap),
      exposure: settings.exposure * exposureMul,
      whitePoint: settings.whitePoint,
      antialias: antialiasConst(settings.antialias),
      bloom: settings.bloom ? BLOOM_ENABLED : BLOOM_DISABLED,
      bloomThreshold: settings.bloomThreshold,
      bloomIntensity: settings.bloomIntensity,
      bloomBlurRadius: settings.bloomBlurRadius,
      ...clear,
    });
  };

  const persistAndNotify = (opts: {
    lighting?: boolean;
    particles?: boolean;
    display?: boolean;
    audio?: boolean;
    atmosphere?: boolean;
  }): void => {
    save(settings);
    // Display first so renderScale can resize the canvas before applyCamera
    // reads getAspect().
    if (opts.display) onDisplay?.(settings);
    applyCamera();
    // HDR atmosphere pass (T1) — never resurrect CSS #hf-rs-vignette / #hf-rs-haze.
    if (opts.atmosphere !== false) onAtmosphere?.(settings);
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
      isOpen: () => false,
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
  // L3: strip any leftover CSS gloom overlays from older sessions / HMR.
  document.getElementById('hf-rs-vignette')?.remove();
  document.getElementById('hf-rs-haze')?.remove();

  const scoped = args.mount !== document.body;

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
      // Vignette/haze rows are grouped under 'camera'; atmoTemp under 'lighting'.
      atmosphere: group === 'camera' || group === 'lighting',
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
  const isOpen = (): boolean =>
    panel.style.display !== 'none' && panel.style.display !== '';
  const toggle = (): void => {
    if (isOpen()) close();
    else open();
  };

  const bindHotkey = args.bindHotkey !== false;
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'F10') {
      e.preventDefault();
      toggle();
    }
  };
  if (bindHotkey) window.addEventListener('keydown', onKey);

  // Apply persisted settings on install (camera + lighting + particles + display + audio).
  persistAndNotify({ lighting: true, particles: true, display: true, audio: true });

  return {
    get: () => settings,
    applyCamera,
    open,
    close,
    toggle,
    isOpen,
    dispose: () => {
      if (bindHotkey) window.removeEventListener('keydown', onKey);
      panel.remove();
      document.getElementById('hf-rs-vignette')?.remove();
      document.getElementById('hf-rs-haze')?.remove();
    },
  };
}
