/**
 * MarsCraft -> forgeax-engine — AlertSystem (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/AlertSystem.ts`. Transient corner toasts
 * for gameplay events: UNDER ATTACK, unit lost, build/train/upgrade complete —
 * each with an icon + colored message, a per-type cooldown (anti-spam), auto
 * fade-out, and click-to-jump (camera focus) when the alert carries a position.
 *
 * Wiring: `alert:build_complete`/`train_complete`/`upgrade_complete` come off the
 * bus (emitted by building-system for the LOCAL player). UNDER-ATTACK + unit-lost
 * are translated here from the existing `combat:damage_taken` / `combat:kill`
 * events (filtered to local-player targets/victims + positioned from their
 * Transform). DOM-guarded (no-ops headless; `probe()` still counts for verify).
 */

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import { Faction } from '../components';
import { eventBus } from '../core/event-bus';
import { getUnitDef } from '../data/units';
import { getUpgradeDef } from '../data/upgrades';
import { resolveUiHost } from './ui-host';

type AlertType = 'under_attack' | 'unit_died' | 'build_complete' | 'train_complete' | 'upgrade_complete'
  | 'not_enough_minerals' | 'not_enough_gas' | 'supply_blocked';

const ALERT_CONFIG: Record<AlertType, { icon: string; color: string; duration: number }> = {
  under_attack:        { icon: '⚠️', color: '#ff4444', duration: 5000 },
  unit_died:           { icon: '💀', color: '#ff6666', duration: 3000 },
  build_complete:      { icon: '🏗️', color: '#66ff88', duration: 4000 },
  train_complete:      { icon: '✅', color: '#66ff88', duration: 4000 },
  upgrade_complete:    { icon: '⬆️', color: '#ffcc44', duration: 4000 },
  not_enough_minerals: { icon: '💎', color: '#66ccff', duration: 3000 },
  not_enough_gas:      { icon: '⛽', color: '#66ff88', duration: 3000 },
  supply_blocked:      { icon: '🏠', color: '#ffcc44', duration: 3000 },
};
const MAX_VISIBLE = 5;
const COOLDOWN_MS = 1500;

export interface AlertDeps {
  world: World;
  localPlayerId: number;
  /** Camera-focus for click-to-jump (world x,z). */
  onJumpTo?: (x: number, z: number) => void;
  /** Minimap ping for positioned alerts (world x,z + the alert's color). */
  onPing?: (x: number, z: number, color: string) => void;
  /** Monotonic clock (ms). Injected for determinism/headless; defaults to a counter. */
  now?: () => number;
}

export interface AlertHandle {
  /** Count of currently-shown alerts (verify). */
  active(): number;
  /** Total alerts pushed since start (verify — survives fade). */
  total(): number;
  /** Manually push an alert (verify aid). */
  push(type: string, message: string, x?: number, z?: number): void;
}

export function installAlerts(deps: AlertDeps): AlertHandle {
  const { world, localPlayerId } = deps;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  const lastAt = new Map<string, number>();
  let activeCount = 0;
  let totalCount = 0;
  let nextId = 1;

  const hasDom = typeof document !== 'undefined';
  let container: HTMLElement | null = null;
  if (hasDom) {
    if (!document.getElementById('mc-alert-style')) {
      const s = document.createElement('style'); s.id = 'mc-alert-style';
      s.textContent = `
.mc-alert-box { position:absolute; top:96px; right:12px; z-index:55; display:flex; flex-direction:column; gap:6px;
  font-family:'Segoe UI',system-ui,sans-serif; pointer-events:none; }
.mc-alert { pointer-events:auto; display:flex; align-items:center; gap:8px; min-width:200px; max-width:320px;
  background:rgba(12,8,16,0.86); border-left:3px solid #888; border-radius:6px; padding:7px 12px;
  box-shadow:0 4px 16px rgba(0,0,0,0.5); opacity:0; transform:translateX(60px); transition:opacity .25s,transform .25s;
  font-size:13px; }
.mc-alert-icon { font-size:16px; }
.mc-alert-jump { cursor:pointer; }`;
      document.head.appendChild(s);
    }
    // Mount into the disposable #game-ui-root so it's not stranded on Stop.
    const host = resolveUiHost();
    container = document.createElement('div');
    container.className = 'mc-alert-box';
    host.appendChild(container);
  }

  function push(type: string, message: string, x?: number, z?: number): void {
    const cfg = ALERT_CONFIG[type as AlertType];
    if (!cfg) return;
    const t = now();
    if (t - (lastAt.get(type) ?? -1e9) < COOLDOWN_MS) return; // per-type cooldown
    lastAt.set(type, t);
    totalCount++;
    // minimap ping for positioned alerts (drawn on the minimap overlay layer).
    if (x !== undefined && z !== undefined && deps.onPing) deps.onPing(x, z, cfg.color);
    if (!container) return; // headless: counted, no DOM
    const el = document.createElement('div');
    el.className = 'mc-alert' + (x !== undefined ? ' mc-alert-jump' : '');
    el.style.borderLeftColor = cfg.color;
    const icon = document.createElement('span'); icon.className = 'mc-alert-icon'; icon.textContent = cfg.icon;
    const msg = document.createElement('span'); msg.style.color = cfg.color; msg.textContent = message;
    el.appendChild(icon); el.appendChild(msg);
    if (x !== undefined && z !== undefined && deps.onJumpTo) {
      el.addEventListener('click', () => deps.onJumpTo!(x, z));
    }
    container.appendChild(el);
    activeCount++;
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(0)'; });
    // cap visible
    while (container.children.length > MAX_VISIBLE) {
      container.firstChild?.remove(); activeCount = Math.max(0, activeCount - 1);
    }
    // auto fade-out
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateX(60px)';
      setTimeout(() => { if (el.parentNode) { el.remove(); activeCount = Math.max(0, activeCount - 1); } }, 260);
    }, cfg.duration);
  }

  // ── local helpers ──
  const isLocal = (id: number): boolean => {
    const f = world.get(id as unknown as EntityHandle, Faction);
    return f.ok && f.value.playerId === localPlayerId;
  };
  const posOf = (id: number): { x: number; z: number } | null => {
    const t = world.get(id as unknown as EntityHandle, Transform);
    return t.ok ? { x: t.value.posX, z: t.value.posZ } : null;
  };

  // ── bus wiring ──
  // UNDER ATTACK: a local unit/building took damage (throttled by COOLDOWN_MS).
  eventBus.on('combat:damage_taken', (d) => {
    if (!isLocal(d.target)) return;
    const p = posOf(d.target);
    push('under_attack', 'Under attack!', p?.x, p?.z);
  });
  // unit lost: a local unit/building died.
  eventBus.on('combat:kill', (d) => {
    if (!isLocal(d.victim)) return;
    const p = posOf(d.victim);
    push('unit_died', 'Unit lost', p?.x, p?.z);
  });
  // build/train/upgrade complete (emitted by building-system for the local player).
  eventBus.on('alert:build_complete', (d) => {
    push('build_complete', `Complete: ${getUnitDef(d.buildingTypeId)?.displayName ?? d.buildingTypeId}`, d.x, d.z);
  });
  eventBus.on('alert:train_complete', (d) => {
    push('train_complete', `Trained: ${getUnitDef(d.unitTypeId)?.displayName ?? d.unitTypeId}`, d.x, d.z);
  });
  eventBus.on('alert:upgrade_complete', (d) => {
    push('upgrade_complete', `Upgrade: ${getUpgradeDef(d.upgradeId)?.displayName ?? d.upgradeId}`);
  });
  // resource / supply shortfalls (local-player command failures).
  eventBus.on('alert:not_enough_minerals', () => push('not_enough_minerals', 'Not enough minerals'));
  eventBus.on('alert:not_enough_gas', () => push('not_enough_gas', 'Not enough gas'));
  eventBus.on('alert:supply_blocked', () => push('supply_blocked', 'Supply blocked — build more'));

  return { active: () => activeCount, total: () => totalCount, push };
}
