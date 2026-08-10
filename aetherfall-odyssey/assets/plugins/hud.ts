import { mountUi, type UiAsset, type UiError, type UiInstance } from '@forgeax/engine-ui';
import type { AssetLabAction, AssetLabActionResult } from './asset-lab-actions';
import { GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE } from './resources/gameplay';

export type ViewMode = 'topdown' | 'orbit' | 'fps' | 'pan';
export const HUD_UI_GUID = 'a6f3b18b-325b-4049-9dbf-3c4070e4d98a';

export interface HudHandle {
  readonly error?: UiError;
  setScore(n: number): void;
  setTargetProfileActive(active: boolean, precisionHits?: number): void;
  setTargetStatus(text: string, state: 'ready' | 'damaged' | 'disabled'): void;
  setChargeStatus(text: string, state: 'ready' | 'charging' | 'released', progress?: number): void;
  setComboStatus(text: string, state: 'ready' | 'active' | 'expired'): void;
  setAssetLabStatus(text: string, state: AssetLabActionResult['state'] | 'idle'): void;
  setAssetLabActionHandler(handler: (action: AssetLabAction) => AssetLabActionResult): void;
  setMode(mode: ViewMode): void;
  setLockStatus(text: string): void;
  floatScore(text: string, screenX: number, screenY: number): void;
  dispose(): void;
}

function failedHud(error: UiError): HudHandle {
  return { error, setScore() {}, setTargetProfileActive() {}, setTargetStatus() {}, setChargeStatus() {}, setComboStatus() {}, setAssetLabStatus() {}, setAssetLabActionHandler() {}, setMode() {}, setLockStatus() {}, floatScore() {}, dispose() {} };
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
  hidden?: boolean;
  error?: UiError;
}): HudHandle {
  if (!opts.asset) return failedHud(opts.error ?? { code: 'invalid-asset', expected: 'a loaded HUD UiAsset', hint: 'Load the HUD UI asset before installing it.', detail: { message: 'HUD asset is missing', asset: 'HUD UiAsset' } });
  const root = opts.host ?? document.body;
  let assetLabActionHandler: ((action: AssetLabAction) => AssetLabActionResult) | undefined;
  const mounted = mountUi(opts.asset, {
    root,
    layer: 50,
    onAction: (action) => {
      if (action === 'toggle-mode') opts.onToggle();
      if (action === 'open-settings') opts.onSettings?.();
      if (action === 'target-profile' || action === 'jpeg-texture' || action === 'video-texture' || action === 'sprite-atlas' || action === 'font-source' || action === 'fbx-companion') {
        const result = assetLabActionHandler?.(action);
        if (result !== undefined) setAssetLabStatus(result.text, result.state);
      }
    },
  });
  if (!mounted.ok) {
    return failedHud(mounted.error);
  }
  const instance: UiInstance = mounted.value;
  if (opts.hidden === true) instance.host.style.display = 'none';
  const shadow = instance.host.shadowRoot;
  if (!shadow) return { ...failedHud({ code: 'invalid-asset', expected: 'a mounted UI with an open shadow root', hint: 'Check the HUD UI asset markup.', detail: { message: 'Mounted HUD has no shadow root', asset: 'mounted HUD' } }), dispose: instance.dispose };
  const score = slot<HTMLElement>(shadow, 'score');
  const mission = slot<HTMLElement>(shadow, 'mission');
  const targetStatus = slot<HTMLElement>(shadow, 'target-status');
  const chargeStatus = slot<HTMLElement>(shadow, 'charge');
  const chargeLabel = chargeStatus?.querySelector<HTMLElement>('[data-ui-slot="charge-label"]') ?? chargeStatus;
  const chargeMeter = chargeStatus?.querySelector<HTMLElement>('[data-ui-slot="charge-meter"]');
  const chargeFill = chargeStatus?.querySelector<HTMLElement>('[data-ui-slot="charge-fill"]');
  const comboStatus = slot<HTMLElement>(shadow, 'combo');
  const assetLabStatus = slot<HTMLElement>(shadow, 'asset-lab-status');
  const button = shadow.querySelector<HTMLButtonElement>('[data-ui-action="toggle-mode"]');
  const targetProfileButton = shadow.querySelector<HTMLButtonElement>('[data-ui-action="target-profile"]');
  const fbxCompanionButton = shadow.querySelector<HTMLButtonElement>('[data-ui-action="fbx-companion"]');
  const spriteAtlasButton = shadow.querySelector<HTMLButtonElement>('[data-ui-action="sprite-atlas"]');
  const crosshair = slot<HTMLElement>(shadow, 'crosshair');
  const hint = slot<HTMLElement>(shadow, 'hint');
  const lockStatus = slot<HTMLElement>(shadow, 'lock-status');
  const popups = slot<HTMLElement>(shadow, 'popups');
  const popupTemplate = shadow.querySelector<HTMLTemplateElement>('[data-ui-template="score-popup"]');
  let currentScore = 0;
  let targetProfileActive = false;
  let targetProfilePrecisionHits = 0;
  spriteAtlasButton?.setAttribute('aria-label', 'PNG projectile');
  const applyMission = (): void => {
    const profileUnlocked = currentScore >= GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE;
    const precisionComplete = targetProfileActive && targetProfilePrecisionHits > 0;
    if (mission) mission.textContent = currentScore < GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE
      ? `Mission 1/3 · Score ${GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE} · ${currentScore}/${GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE}`
      : !targetProfileActive
        ? 'Mission 2/3 · Press P to apply the authored target profile'
        : !precisionComplete
          ? 'Mission 3/3 · Hit the rotating precision target'
          : 'Mission complete · Precision hit confirmed · R to replay';
    if (mission) mission.dataset.complete = profileUnlocked && precisionComplete ? 'true' : 'false';
    if (targetProfileButton) {
      targetProfileButton.disabled = !profileUnlocked;
      targetProfileButton.setAttribute('aria-disabled', String(!profileUnlocked));
      targetProfileButton.title = profileUnlocked ? 'Apply or restore the authored target profile' : `Score ${GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE} to unlock`;
    }
    if (fbxCompanionButton) {
      fbxCompanionButton.disabled = !precisionComplete;
      fbxCompanionButton.setAttribute('aria-disabled', String(!precisionComplete));
      fbxCompanionButton.title = precisionComplete ? 'Show the imported humanoid on the scored target' : 'Complete the precision mission first';
    }
  };
  let currentMode = opts.initialMode;
  const applyMode = (mode: ViewMode): void => {
    currentMode = mode;
    if (button) button.textContent = mode === 'topdown' ? 'View: Top-down > Orbit' : mode === 'orbit' ? 'View: Orbit > FPS' : mode === 'fps' ? 'View: FPS > Map' : 'View: Map > Top-down';
    if (crosshair) crosshair.style.display = mode === 'fps' ? 'block' : 'none';
    if (hint) hint.textContent = mode === 'fps'
      ? 'WASD move · click/F shoot · hold C charge · release · R restart'
      : mode === 'orbit'
        ? 'WASD move · drag to orbit · click/F shoot · hold C charge · release · R restart'
        : mode === 'pan'
          ? 'Arrows pan · wheel zoom · click/F shoot · hold C charge · release · R restart'
          : 'WASD move · aim/click shoot · hold C charge · release · R restart';
    if (lockStatus) lockStatus.style.display = mode === 'fps' || mode === 'orbit' ? 'block' : 'none';
  };
  const setScore = (n: number): void => {
    currentScore = n;
    if (score) score.textContent = `Score  ${n}`;
    applyMission();
  };
  const setTargetProfileActive = (active: boolean, precisionHits = 0): void => {
    targetProfileActive = active;
    targetProfilePrecisionHits = precisionHits;
    applyMission();
  };
  const setTargetStatus = (text: string, state: 'ready' | 'damaged' | 'disabled'): void => {
    if (!targetStatus) return;
    targetStatus.textContent = text;
    targetStatus.dataset.state = state;
  };
  const setChargeStatus = (text: string, state: 'ready' | 'charging' | 'released', progress = state === 'released' ? 1 : 0): void => {
    if (chargeStatus) {
      const ratio = Math.max(0, Math.min(1, progress));
      if (chargeLabel) chargeLabel.textContent = text;
      chargeStatus.dataset.state = state;
      chargeMeter?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      if (chargeFill) chargeFill.style.width = `${Math.round(ratio * 100)}%`;
      return;
    }
    // Older copied HUD packs have no charge slot yet. Keep the mechanic
    // discoverable through their authored hint instead of adding a DOM owner.
    if (state === 'ready') applyMode(currentMode);
    else if (hint) hint.textContent = text;
  };
  const setComboStatus = (text: string, state: 'ready' | 'active' | 'expired'): void => {
    if (!comboStatus) return;
    comboStatus.textContent = text;
    comboStatus.dataset.state = state;
  };
  const setAssetLabStatus = (text: string, state: AssetLabActionResult['state'] | 'idle'): void => {
    if (!assetLabStatus) return;
    assetLabStatus.textContent = text;
    assetLabStatus.dataset.state = state;
  };
  const setAssetLabActionHandler = (handler: (action: AssetLabAction) => AssetLabActionResult): void => {
    assetLabActionHandler = handler;
  };
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
  setChargeStatus('Hold C to charge · release to fire', 'ready', 0);
  setComboStatus('Combo ready · chain hits for a bonus', 'ready');
  setLockStatus('Click canvas to lock pointer');
  setAssetLabStatus(`Score ${GAME_DEFAULT_TARGET_PROFILE_UNLOCK_SCORE} to unlock Target profile.`, 'idle');
  return { setScore, setTargetProfileActive, setTargetStatus, setChargeStatus, setComboStatus, setAssetLabStatus, setAssetLabActionHandler, setMode: applyMode, setLockStatus, floatScore, dispose: instance.dispose };
}
