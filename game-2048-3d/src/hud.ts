import { mountUi, type UiAsset, type UiError, type UiInstance } from '@forgeax/engine-ui';

export type ViewMode = 'topdown' | 'orbit' | 'fps' | 'pan';
export const HUD_UI_GUID = '2a6b806f-126f-4512-a738-5698c4cce8b6';

export interface HudHandle {
  readonly error?: UiError;
  setScore(n: number): void;
  setMode(mode: ViewMode): void;
  setLockStatus(text: string): void;
  floatScore(text: string, screenX: number, screenY: number): void;
  dispose(): void;
}

function failedHud(error: UiError): HudHandle {
  return { error, setScore() {}, setMode() {}, setLockStatus() {}, floatScore() {}, dispose() {} };
}

function slot<T extends HTMLElement>(shadow: ShadowRoot, name: string): T | null {
  return shadow.querySelector<T>(`[data-ui-slot="${name}"]`);
}

export function installHud(opts: {
  asset: UiAsset | null;
  initialMode: ViewMode;
  onToggle: () => void;
  onSettings?: () => void;
  host?: HTMLElement;
  error?: UiError;
}): HudHandle {
  if (!opts.asset) return failedHud(opts.error ?? { code: 'invalid-asset', expected: 'a loaded HUD UiAsset', hint: 'Load the HUD UI asset before installing it.', detail: { message: 'HUD asset is missing', asset: 'HUD UiAsset' } });
  const root = opts.host ?? document.body;
  const mounted = mountUi(opts.asset, {
    root,
    layer: 50,
    onAction: (action) => {
      if (action === 'toggle-mode') opts.onToggle();
      if (action === 'open-settings') opts.onSettings?.();
    },
  });
  if (!mounted.ok) {
    return failedHud(mounted.error);
  }
  const instance: UiInstance = mounted.value;
  const shadow = instance.host.shadowRoot;
  if (!shadow) return { ...failedHud({ code: 'invalid-asset', expected: 'a mounted UI with an open shadow root', hint: 'Check the HUD UI asset markup.', detail: { message: 'Mounted HUD has no shadow root', asset: 'mounted HUD' } }), dispose: instance.dispose };
  const score = slot<HTMLElement>(shadow, 'score');
  const button = shadow.querySelector<HTMLButtonElement>('[data-ui-action="toggle-mode"]');
  const crosshair = slot<HTMLElement>(shadow, 'crosshair');
  const hint = slot<HTMLElement>(shadow, 'hint');
  const lockStatus = slot<HTMLElement>(shadow, 'lock-status');
  const popups = slot<HTMLElement>(shadow, 'popups');
  const popupTemplate = shadow.querySelector<HTMLTemplateElement>('[data-ui-template="score-popup"]');
  const applyMode = (mode: ViewMode): void => {
    if (button) button.textContent = mode === 'topdown' ? 'View: Top-down > Orbit' : mode === 'orbit' ? 'View: Orbit > FPS' : mode === 'fps' ? 'View: FPS > Map' : 'View: Map > Top-down';
    if (crosshair) crosshair.style.display = mode === 'fps' ? 'block' : 'none';
    if (hint) hint.textContent = mode === 'fps'
      ? 'Click canvas to lock pointer - WASD move - Q/E fly - Shift run - wheel speed - F/click shoot - B visibility - L JPEG - P profile - N atlas - V visual (mesh/sprite/lit) - ESC release'
      : mode === 'orbit'
        ? 'Orbit camera - wheel zoom - click canvas for mouse look - WASD move - F/click shoot - B visibility - L JPEG - P profile - N atlas - V visual (mesh/sprite/lit)'
        : mode === 'pan'
          ? 'Map camera - arrows pan - wheel zoom - F/click shoot - B visibility - L JPEG - P profile - N atlas - V visual (mesh/sprite/lit)'
          : 'WASD move - wheel zoom - click shoot - B visibility - L JPEG - P profile - N atlas - V visual (mesh/sprite/lit) - aim toward cursor';
    if (lockStatus) lockStatus.style.display = mode === 'fps' || mode === 'orbit' ? 'block' : 'none';
  };
  const setScore = (n: number): void => { if (score) score.textContent = `Score  ${n}`; };
  const setLockStatus = (text: string): void => { if (lockStatus) lockStatus.textContent = text; };
  const floatScore = (text: string, x: number, y: number): void => {
    if (!popups) return;
    const node = popupTemplate?.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
    const popup = node ?? document.createElement('span');
    popup.textContent = text;
    popup.classList.add('score-popup');
    Object.assign(popup.style, { position: 'absolute', left: `${x}px`, top: `${y}px`, pointerEvents: 'none' });
    popups.append(popup);
    setTimeout(() => popup.remove(), 1000);
  };
  setScore(0);
  applyMode(opts.initialMode);
  setLockStatus('Click canvas to lock pointer');
  return { setScore, setMode: applyMode, setLockStatus, floatScore, dispose: instance.dispose };
}
