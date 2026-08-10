import {
  mountUi,
  type UiAsset,
  type UiError,
  type UiInstance,
} from "@forgeax/engine-ui";
import type {
  ExplorationOutcome,
  ExplorationTargetId,
} from "./exploration-state";
import type { ExplorationInputDevice } from "./gameplay-input";

/** The self-contained UI asset consumed by the Aetherfall exploration loop. */
export const EXPLORATION_HUD_UI_GUID = "d563d148-890b-4a91-b541-9e5b7c08f45d";

export type ExplorationHudPhase = "exploring" | "beacon-ready" | "complete";

/**
 * A small, derived projection of exploration state. The exploration owner keeps
 * its own authoritative snapshot; this is deliberately presentation-only.
 */
export interface ExplorationHudSnapshot {
  readonly title?: string;
  readonly objective?: string;
  readonly completed?: number;
  readonly total?: number;
  readonly heading?: string;
  readonly landmark?: string;
  readonly interaction?: string | null;
  readonly phase?: ExplorationHudPhase;
  readonly controls?: string;
  readonly showControls?: boolean;
  readonly recovered?: boolean;
  readonly recoveries?: number;
  readonly inputDevice?: ExplorationInputDevice;
}

export interface ExplorationHudHandle {
  readonly error?: UiError;
  readonly settingsTrigger: HTMLButtonElement | null;
  setSnapshot(snapshot: ExplorationHudSnapshot): void;
  setHighContrast(enabled: boolean): void;
  dispose(): void;
}

export interface ExplorationControlsTimer {
  advance(deltaSeconds: number): boolean;
  reset(): void;
  visible(): boolean;
}

/** Run-scoped tutorial visibility with an explicit restart boundary. */
export function createExplorationControlsTimer(
  durationSeconds = 8,
): ExplorationControlsTimer {
  const duration = Number.isFinite(durationSeconds)
    ? Math.max(0, durationSeconds)
    : 8;
  let remaining = duration;
  const visible = (): boolean => remaining > 0;
  return {
    advance(deltaSeconds) {
      const delta = Number.isFinite(deltaSeconds)
        ? Math.max(0, deltaSeconds)
        : 0;
      remaining = Math.max(0, remaining - delta);
      return visible();
    },
    reset() {
      remaining = duration;
    },
    visible,
  };
}

/** Keep a rejected interaction visible only while the player remains at that locked landmark. */
export function explorationLockedFeedback(
  outcome: ExplorationOutcome | null,
  lockedTargetId: ExplorationTargetId | undefined,
): string | null {
  if (outcome === "beacon-locked" && lockedTargetId === "last-light-beacon") {
    return "Last Light is sealed · restore 3 shrines";
  }
  if (outcome === "sanctuary-locked" && lockedTargetId === "sanctuary") {
    return "Sanctuary awaits the Last Light";
  }
  return null;
}

const DEFAULT_SNAPSHOT: Required<
  Omit<ExplorationHudSnapshot, "interaction">
> & { interaction: string | null } = Object.freeze({
  title: "AETHERFALL",
  objective: "Recover the scattered memories",
  completed: 0,
  total: 3,
  heading: "N",
  landmark: "Last Light Observatory",
  interaction: null,
  phase: "exploring",
  controls: "",
  showControls: true,
  recovered: false,
  recoveries: 0,
  inputDevice: "keyboard",
});

const EXPLORATION_DEVICE_CONTROLS: Record<ExplorationInputDevice, string> = {
  keyboard: "WASD move  ·  Shift sprint  ·  E attune  ·  R restart",
  gamepad: "Left stick move  ·  L3 sprint  ·  X attune  ·  B restart",
};

const COMPACT_PRESENTATION_CSS = `
[data-ui-slot="root"][data-density="compact"] {
  --safe-x: clamp(12px, 1.7vw, 22px);
  --safe-y: clamp(12px, 1.7vw, 20px);
  text-shadow: 0 2px 12px rgb(0 7 10 / 76%);
}
[data-ui-slot="root"][data-density="compact"] .identity,
[data-ui-slot="root"][data-density="compact"] .quest .eyebrow {
  display: none !important;
}
[data-ui-slot="root"][data-density="compact"] .quest {
  top: var(--safe-y);
  width: min(232px, calc(100% - var(--safe-x) * 2));
  padding: 9px 11px 8px;
  border: 1px solid rgb(155 202 197 / 24%);
  border-left-color: rgb(236 217 145 / 68%);
  border-radius: 9px;
  background: rgb(4 18 23 / 72%);
  box-shadow: 0 8px 26px rgb(0 8 11 / 17%);
}
[data-ui-slot="root"][data-density="compact"] .quest-meta {
  justify-content: flex-end;
}
[data-ui-slot="root"][data-density="compact"] .quest strong {
  margin: 0 0 7px;
  font-size: 10px;
  font-weight: 650;
}
[data-ui-slot="root"][data-density="compact"] .progress-track {
  height: 2px;
  border-radius: 999px;
}
[data-ui-slot="root"][data-density="compact"] [data-ui-slot="landmark"] {
  color: rgb(190 210 205 / 78%);
  font-size: clamp(10px, .75vw, 12px);
  letter-spacing: .11em;
}
[data-ui-slot="root"][data-density="compact"] .interaction,
[data-ui-slot="root"][data-density="compact"] .completion {
  bottom: var(--safe-y);
  padding: 6px 12px 6px 7px;
  border-radius: 999px;
  background: rgb(4 18 23 / 78%);
  box-shadow: 0 8px 28px rgb(0 8 11 / 20%);
}
[data-ui-slot="root"][data-density="compact"] .interaction::after {
  display: none;
}
[data-ui-slot="root"][data-density="compact"] [data-ui-slot="controls"] {
  padding: 5px 8px;
  border: 1px solid rgb(155 202 197 / 18%);
  border-radius: 6px;
  background: rgb(4 18 23 / 66%);
  color: rgb(213 230 224 / 80%);
  font-size: clamp(10px, .75vw, 12px);
  transition: opacity 240ms ease-out;
}
[data-ui-slot="root"][data-density="compact"] .settings-button {
  position: absolute;
  top: var(--safe-y);
  right: var(--safe-x);
  z-index: 2;
  min-width: 44px;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid rgb(155 202 197 / 36%);
  border-radius: 8px;
  background: rgb(4 18 23 / 78%);
  color: rgb(230 241 236 / 90%);
  font: 650 clamp(10px, .75vw, 12px)/1 ui-sans-serif, system-ui, sans-serif;
  pointer-events: auto;
  cursor: pointer;
}
[data-ui-slot="root"][data-density="compact"] .settings-button:focus-visible {
  outline: 2px solid #fff2bd;
  outline-offset: 2px;
}
[data-ui-slot="root"][data-density="compact"] .recovery-notice {
  position: absolute;
  left: 50%;
  bottom: calc(var(--safe-y) + 44px);
  z-index: 2;
  transform: translateX(-50%);
  max-width: min(320px, calc(100% - var(--safe-x) * 2));
  padding: 7px 12px;
  border: 1px solid rgb(236 217 145 / 58%);
  border-radius: 8px;
  background: rgb(4 18 23 / 88%);
  color: rgb(245 238 205 / 96%);
  font: 650 clamp(11px, .85vw, 13px)/1.25 ui-sans-serif, system-ui, sans-serif;
  text-align: center;
  white-space: nowrap;
}
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] {
  color: #fff;
  text-shadow: 0 2px 2px #000, 0 0 8px #000;
}
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] .quest,
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] .interaction,
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] .completion,
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] [data-ui-slot="controls"],
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] .settings-button,
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] .recovery-notice {
  border-color: #fff;
  background: #000;
  color: #fff;
  box-shadow: 0 0 0 1px #000;
}
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] [data-ui-slot="objective"],
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] [data-ui-slot="progress-label"],
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] [data-ui-slot="heading"],
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] [data-ui-slot="landmark"] {
  color: #fff;
}
[data-ui-slot="root"][data-density="compact"][data-high-contrast="true"] .progress-track {
  background: #fff;
}
[data-ui-slot="root"][data-density="compact"] kbd {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
[data-ui-slot="root"][data-density="compact"][data-phase="complete"] .quest,
[data-ui-slot="root"][data-density="compact"][data-phase="complete"] .compass {
  display: none;
}
[data-ui-slot="root"][data-density="compact"] .completion {
  padding: 8px 16px;
  border-color: rgb(236 217 145 / 58%);
  font-size: 11px;
}
@media (max-width: 430px) {
  [data-ui-slot="root"][data-density="compact"] .quest {
    top: var(--safe-y);
    padding: 8px 10px 7px;
  }
  [data-ui-slot="root"][data-density="compact"] .compass {
    top: calc(var(--safe-y) + 61px);
    right: auto;
    left: var(--safe-x);
  }
  [data-ui-slot="root"][data-density="compact"] .interaction {
    bottom: var(--safe-y);
  }
}
`;

function failedHud(error: UiError): ExplorationHudHandle {
  return {
    error,
    settingsTrigger: null,
    setSnapshot() {},
    setHighContrast() {},
    dispose() {},
  };
}

function slot<T extends HTMLElement>(
  shadow: ShadowRoot,
  name: string,
): T | null {
  return shadow.querySelector<T>(`[data-ui-slot="${name}"]`);
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.floor(value as number))
    : fallback;
}

/**
 * Installs viewport-local exploration chrome into the host-owned `ctx.uiRoot`.
 * `root` is intentionally required: callers must make the containment boundary
 * explicit instead of silently escaping into a page-level mount.
 */
export function installExplorationHud(opts: {
  asset: UiAsset | null;
  root: HTMLElement;
  error?: UiError;
  initialSnapshot?: ExplorationHudSnapshot;
  initialHighContrast?: boolean;
  onSettings?: () => void;
}): ExplorationHudHandle {
  if (!opts.asset) {
    return failedHud(
      opts.error ?? {
        code: "invalid-asset",
        expected: "a loaded Aetherfall exploration UiAsset",
        hint: "Load exploration-hud.pack.json before installing the exploration HUD.",
        detail: {
          message: "Exploration HUD asset is missing",
          asset: "exploration HUD UiAsset",
        },
      },
    );
  }
  const mounted = mountUi(opts.asset, { root: opts.root, layer: 52 });
  if (!mounted.ok) return failedHud(mounted.error);

  const instance: UiInstance = mounted.value;
  const shadow = instance.host.shadowRoot;
  if (!shadow) {
    instance.dispose();
    return failedHud({
      code: "invalid-asset",
      expected: "a mounted exploration UI with an open shadow root",
      hint: "Check the exploration HUD UI asset markup.",
      detail: {
        message: "Mounted exploration HUD has no shadow root",
        asset: "mounted exploration HUD",
      },
    });
  }

  const title = slot<HTMLElement>(shadow, "title");
  const objective = slot<HTMLElement>(shadow, "objective");
  const progress = slot<HTMLElement>(shadow, "progress");
  const progressLabel = slot<HTMLElement>(shadow, "progress-label");
  const progressFill = slot<HTMLElement>(shadow, "progress-fill");
  const heading = slot<HTMLElement>(shadow, "heading");
  const landmark = slot<HTMLElement>(shadow, "landmark");
  const interaction = slot<HTMLElement>(shadow, "interaction");
  const interactionCopy =
    slot<HTMLElement>(shadow, "interaction-copy") ?? interaction;
  const interactionKey = interaction?.querySelector<HTMLElement>("kbd") ?? null;
  const completion = slot<HTMLElement>(shadow, "completion");
  const controls = slot<HTMLElement>(shadow, "controls");
  const root = slot<HTMLElement>(shadow, "root");

  const setHighContrast = (enabled: boolean): void => {
    if (!root) return;
    root.dataset.highContrast = String(enabled);
    root.classList.toggle("high-contrast", enabled);
  };
  if (root) root.dataset.density = "compact";
  setHighContrast(opts.initialHighContrast === true);
  const identity = title?.closest<HTMLElement>(".identity");
  if (identity) identity.hidden = true;
  if (heading) heading.hidden = false;
  if (controls) controls.hidden = false;
  const compass = landmark?.closest<HTMLElement>(".compass");
  if (compass) compass.setAttribute("aria-label", "Destination");
  const compactStyle = document.createElement("style");
  compactStyle.dataset.aetherfallHudPresentation = "compact";
  compactStyle.textContent = COMPACT_PRESENTATION_CSS;
  shadow.append(compactStyle);
  const settingsTrigger = document.createElement("button");
  settingsTrigger.type = "button";
  settingsTrigger.className = "settings-button";
  settingsTrigger.dataset.aetherfallSettings = "";
  settingsTrigger.setAttribute("aria-label", "Open game settings");
  settingsTrigger.textContent = "Settings";
  settingsTrigger.addEventListener("click", () => opts.onSettings?.(), {
    signal: instance.signal,
  });
  root?.append(settingsTrigger);
  const recoveryNotice = document.createElement("aside");
  recoveryNotice.className = "recovery-notice";
  recoveryNotice.dataset.aetherfallRecoveryNotice = "";
  recoveryNotice.setAttribute("role", "status");
  recoveryNotice.setAttribute("aria-live", "polite");
  recoveryNotice.setAttribute("aria-atomic", "true");
  recoveryNotice.hidden = true;
  root?.append(recoveryNotice);
  let lastAnnouncedRecovery = 0;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const hideRecoveryNotice = (): void => {
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
    recoveryNotice.hidden = true;
    recoveryNotice.textContent = "";
  };

  const setSnapshot = (next: ExplorationHudSnapshot): void => {
    const snapshot = { ...DEFAULT_SNAPSHOT, ...next };
    const total = Math.max(
      1,
      nonNegativeInteger(snapshot.total, DEFAULT_SNAPSHOT.total),
    );
    const completed = Math.min(
      total,
      nonNegativeInteger(snapshot.completed, DEFAULT_SNAPSHOT.completed),
    );
    const complete = snapshot.phase === "complete";
    const beaconReady = snapshot.phase === "beacon-ready";
    const recoveries = nonNegativeInteger(snapshot.recoveries, 0);
    const controlsCopy = next.controls ??
      EXPLORATION_DEVICE_CONTROLS[snapshot.inputDevice];
    const ratio = complete ? 1 : completed / total;

    if (root) {
      root.dataset.phase = snapshot.phase;
      root.dataset.inputDevice = snapshot.inputDevice;
    }
    if (title) title.textContent = snapshot.title;
    if (objective)
      objective.textContent = complete
        ? "The Last Light is restored"
        : snapshot.objective;
    if (progress) {
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(total));
      progress.setAttribute(
        "aria-valuenow",
        String(complete ? total : completed),
      );
      progress.dataset.complete = String(complete);
    }
    if (progressLabel)
      progressLabel.textContent = complete
        ? "LAST LIGHT RESTORED"
        : `${completed}/${total} MEMORY SHRINES`;
    if (progressFill) progressFill.style.width = `${Math.round(ratio * 100)}%`;
    if (heading) heading.textContent = snapshot.heading;
    if (landmark) landmark.textContent = snapshot.landmark;
    const interactionAvailable =
      typeof snapshot.interaction === "string" &&
      snapshot.interaction.trim().length > 0 &&
      !complete;
    if (interaction) {
      interaction.hidden = !interactionAvailable;
      interaction.style.display = interaction.hidden ? "none" : "";
      interaction.dataset.state = beaconReady ? "beacon-ready" : "available";
    }
    if (interactionCopy)
      interactionCopy.textContent = interactionAvailable
        ? (snapshot.interaction?.trim() ?? "")
        : "";
    if (interactionKey) interactionKey.textContent =
      snapshot.inputDevice === "gamepad" ? "X" : "E";
    if (interaction && interactionAvailable) {
      interaction.setAttribute(
        "aria-label",
        `${snapshot.inputDevice === "gamepad" ? "X button" : "E key"}: ${snapshot.interaction?.trim() ?? ""}`,
      );
    } else interaction?.removeAttribute("aria-label");
    if (completion) {
      completion.hidden = !complete;
      completion.style.display = completion.hidden ? "none" : "";
      completion.textContent = "The Last Light burns again";
    }
    if (controls) {
      controls.textContent = controlsCopy;
      controls.hidden = !snapshot.showControls;
      controls.style.display = controls.hidden ? "none" : "";
    }
    if (recoveries === 0) {
      lastAnnouncedRecovery = 0;
      hideRecoveryNotice();
    } else if (snapshot.recovered && recoveries !== lastAnnouncedRecovery) {
      lastAnnouncedRecovery = recoveries;
      if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
      recoveryNotice.hidden = false;
      recoveryNotice.textContent = `Returned to safe ground · Recovery ${recoveries}`;
      recoveryTimer = setTimeout(hideRecoveryNotice, 2_600);
    }
  };

  setSnapshot(opts.initialSnapshot ?? {});
  return {
    settingsTrigger: root === null ? null : settingsTrigger,
    setSnapshot,
    setHighContrast,
    dispose: () => {
      hideRecoveryNotice();
      instance.dispose();
    },
  };
}
