// Hellforge L4 Option B runtime hooks — pure once-fire / enter-exit state.
//
// B1 room-clear beat: when a combat room's pack is fully dead, emit once.
// B2 cursed vault: first entry → card payload; damageMul active while inside
// the branch-reward volume, cleared on exit (re-entry re-applies mul, no card).
//
// Coordinates: local metres (same as EncounterPlan volumes). Callers subtract
// DUNGEON_ORIGIN before calling. DOM / SFX / loot stay in main.ts.

import {
  isInsideBranchCurseVolume,
  isRoomCleared,
  pointInRoomVolume,
  type EncounterPlan,
} from './dungeon-encounters';
import { FONT_DISPLAY, FONT_UI, Ui, Z } from './ui-theme';
import { ensureUiStyles } from './ui-styles';

export interface RoomEventState {
  killsByRoom: Map<string, number>;
  /** nodeIds that already fired the clear celebration. */
  clearFired: Set<string>;
  vaultCardShown: boolean;
  curseActive: boolean;
}

export type RoomClearBeat = {
  kind: 'room-clear';
  nodeId: string;
};

export type VaultCardPayload = {
  kind: 'vault-enter';
  /** First entry only — callers show the DOM card when present. */
  showCard: boolean;
  modifierLine: string;
  rewardLine: string;
  damageMul: number;
};

export type VaultExitEvent = {
  kind: 'vault-exit';
};

export type VaultTickEvent = VaultCardPayload | VaultExitEvent;

export function createRoomEventState(): RoomEventState {
  return {
    killsByRoom: new Map(),
    clearFired: new Set(),
    vaultCardShown: false,
    curseActive: false,
  };
}

export function resetRoomEventState(state: RoomEventState): void {
  state.killsByRoom.clear();
  state.clearFired.clear();
  state.vaultCardShown = false;
  state.curseActive = false;
}

/** Active B2 damage multiplier (1 when outside / inactive). */
export function branchCurseDamageMul(
  state: RoomEventState,
  plan: EncounterPlan,
): number {
  return state.curseActive ? plan.branchCurse.damageMul : 1;
}

function volumeNodeAt(
  plan: EncounterPlan,
  localX: number,
  localZ: number,
): string | null {
  for (const vol of plan.volumes) {
    if (pointInRoomVolume(localX, localZ, vol)) return vol.nodeId;
  }
  return null;
}

/**
 * B1 — note a den minion death at local XZ. Returns a clear beat exactly once
 * per RoomClearSpec.nodeId when the kill tally meets requiredKillCount.
 */
export function noteMonsterKill(
  state: RoomEventState,
  plan: EncounterPlan,
  localX: number,
  localZ: number,
): RoomClearBeat | null {
  const nodeId = volumeNodeAt(plan, localX, localZ);
  if (!nodeId) return null;
  const spec = plan.clears.find((c) => c.nodeId === nodeId);
  if (!spec) return null;
  if (state.clearFired.has(nodeId)) return null;

  const next = (state.killsByRoom.get(nodeId) ?? 0) + 1;
  state.killsByRoom.set(nodeId, next);
  if (!isRoomCleared(spec, next)) return null;

  state.clearFired.add(nodeId);
  return { kind: 'room-clear', nodeId };
}

/**
 * B2 — tick player presence in the branch vault volume.
 * - Enter (first): showCard + activate curse.
 * - Enter (again): activate curse, no card.
 * - Exit: deactivate curse.
 */
export function tickVaultPresence(
  state: RoomEventState,
  plan: EncounterPlan,
  localX: number,
  localZ: number,
): VaultTickEvent | null {
  const inside = isInsideBranchCurseVolume(localX, localZ, plan);
  if (inside) {
    if (state.curseActive) return null;
    state.curseActive = true;
    const showCard = !state.vaultCardShown;
    if (showCard) state.vaultCardShown = true;
    return {
      kind: 'vault-enter',
      showCard,
      modifierLine: plan.branchCurse.label,
      rewardLine: rewardLineFor(plan),
      damageMul: plan.branchCurse.damageMul,
    };
  }
  if (!state.curseActive) return null;
  state.curseActive = false;
  return { kind: 'vault-exit' };
}

function rewardLineFor(plan: EncounterPlan): string {
  const floor = plan.branchChest.qualityFloor;
  if (floor === 'exceptional') {
    return 'Vault chest: guaranteed Exceptional-or-better';
  }
  return `Vault chest: quality floor ${floor}`;
}

const VAULT_CARD_ID = 'hellforge-vault-curse-card';

/** One-shot DOM card for B2 first vault entry (auto-dismiss). */
export function showVaultCurseCard(
  mount: HTMLElement,
  opts: { modifierLine: string; rewardLine: string; holdMs?: number },
): () => void {
  ensureUiStyles();
  document.getElementById(VAULT_CARD_ID)?.remove();
  const el = document.createElement('div');
  el.id = VAULT_CARD_ID;
  const scoped = mount !== document.body;
  el.style.cssText =
    `position:${scoped ? 'absolute' : 'fixed'};inset:0;display:flex;` +
    `align-items:center;justify-content:center;pointer-events:none;z-index:${Z.transition};` +
    'background:rgba(6,4,3,0.55);';
  el.innerHTML =
    `<div style="min-width:280px;max-width:420px;padding:22px 28px;text-align:center;` +
    `background:${Ui.inkPanel};border:1px solid ${Ui.goldLine};` +
    `box-shadow:0 0 28px rgba(196,40,34,0.25),0 8px 24px rgba(0,0,0,0.55);">` +
    `<div style="font:700 22px ${FONT_DISPLAY};color:${Ui.goldBright};letter-spacing:4px;` +
    `margin-bottom:14px;">熔渣诅咒宝库</div>` +
    `<div style="font:600 13px ${FONT_UI};color:${Ui.danger};letter-spacing:1px;` +
    `margin-bottom:8px;">${escapeHtml(opts.modifierLine)}</div>` +
    `<div style="font:600 13px ${FONT_UI};color:${Ui.ok};letter-spacing:1px;">` +
    `${escapeHtml(opts.rewardLine)}</div>` +
    `</div>`;
  mount.appendChild(el);
  const holdMs = opts.holdMs ?? 2800;
  const t = window.setTimeout(() => {
    el.remove();
  }, holdMs);
  return () => {
    window.clearTimeout(t);
    el.remove();
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
