/**
 * MarsCraft -> forgeax-engine — IdleTrackerUI (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/IdleTrackerUI.ts`: two buttons showing the
 * count of IDLE workers + IDLE production buildings; clicking one cycles to the
 * next idle entity (selects it + centres the camera). Idle worker = a local
 * Harvester in HARVEST_STATE.IDLE; idle production = a complete local building
 * whose type can produce and whose production queue is empty. DOM-guarded +
 * throttled-rAF; `probe()` reports the counts for verify.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import {
  Harvester, Building, Faction, Health, HARVEST_STATE, BUILDING_STATE,
  buildingTypeId, buildingProductionQueue,
} from '../components';
import { getBuildingDef } from '../data/buildings';
import type { SelectionHandle } from '../systems/selection';
import { resolveUiHost } from './ui-host';

export interface IdleTrackerDeps {
  world: World;
  localPlayerId: number;
  selection: SelectionHandle;
  onJumpTo?: (x: number, z: number) => void;
}

export interface IdleTrackerHandle {
  active(): boolean;
  probe(): { idleWorkers: number; idleProduction: number };
  dispose(): void;
}

const STYLE_ID = 'mc-idle-style';
const CSS = `
.mc-idle { position:absolute; top:8px; left:8px; z-index:53; display:flex; flex-direction:column; gap:5px;
  font-family:'Segoe UI',system-ui,sans-serif; }
.mc-idle-btn { display:flex; align-items:center; gap:5px; background:rgba(12,8,16,0.78); border:1px solid #4a3a5a;
  border-radius:6px; padding:4px 9px; font-size:13px; color:#8a7a9a; cursor:default; }
.mc-idle-has { color:#ffd24a; border-color:#ffd24a; cursor:pointer; box-shadow:0 0 7px rgba(255,200,60,0.35); }
.mc-idle-cnt { font-weight:700; }
`;

export function installIdleTracker(deps: IdleTrackerDeps): IdleTrackerHandle {
  const { world, localPlayerId, selection } = deps;
  let workerIdx = 0, prodIdx = 0;

  const idleWorkers = (): EntityHandle[] => {
    const out: EntityHandle[] = [];
    for (let raw = 0; raw < 9000; raw++) {
      const e = raw as unknown as EntityHandle;
      const h = world.get(e, Harvester);
      if (!h.ok || h.value.state !== HARVEST_STATE.IDLE) continue;
      const f = world.get(e, Faction);
      if (!f.ok || f.value.playerId !== localPlayerId) continue;
      const hp = world.get(e, Health);
      if (hp.ok && hp.value.isDead) continue;
      out.push(e);
    }
    return out;
  };

  const idleProduction = (): EntityHandle[] => {
    const out: EntityHandle[] = [];
    for (let raw = 0; raw < 9000; raw++) {
      const e = raw as unknown as EntityHandle;
      const b = world.get(e, Building);
      if (!b.ok || b.value.state !== BUILDING_STATE.COMPLETE) continue;
      const f = world.get(e, Faction);
      if (!f.ok || f.value.playerId !== localPlayerId) continue;
      const tid = buildingTypeId.get(e);
      const def = tid ? getBuildingDef(tid) : undefined;
      if (!def || (def.canProduce?.length ?? 0) === 0) continue;
      const q = buildingProductionQueue.get(e);
      if (q && q.length > 0) continue; // busy
      out.push(e);
    }
    return out;
  };

  const jumpSelect = (list: EntityHandle[], idxRef: { i: number }): void => {
    if (list.length === 0) return;
    idxRef.i = idxRef.i % list.length;
    const e = list[idxRef.i];
    idxRef.i++;
    selection.select([e]);
    const t = world.get(e, Transform);
    if (t.ok && deps.onJumpTo) deps.onJumpTo(t.value.pos[0], t.value.pos[2]);
  };

  if (typeof document === 'undefined') {
    return { active: () => false, probe: () => ({ idleWorkers: idleWorkers().length, idleProduction: idleProduction().length }), dispose: () => {} };
  }
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
  }
  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const host = resolveUiHost();
  const box = document.createElement('div'); box.className = 'mc-idle';
  const workerBtn = document.createElement('div'); workerBtn.className = 'mc-idle-btn';
  const prodBtn = document.createElement('div'); prodBtn.className = 'mc-idle-btn';
  box.appendChild(workerBtn); box.appendChild(prodBtn); host.appendChild(box);

  workerBtn.addEventListener('click', () => jumpSelect(idleWorkers(), { get i() { return workerIdx; }, set i(v) { workerIdx = v; } }));
  prodBtn.addEventListener('click', () => jumpSelect(idleProduction(), { get i() { return prodIdx; }, set i(v) { prodIdx = v; } }));

  let raf = 0, alive = true, acc = 0, last = performance.now();
  let lastSig = '';
  function update(): void {
    const w = idleWorkers().length, p = idleProduction().length;
    const sig = `${w}|${p}`;
    if (sig === lastSig) return;
    lastSig = sig;
    workerBtn.className = 'mc-idle-btn' + (w > 0 ? ' mc-idle-has' : '');
    workerBtn.innerHTML = `<span>⛏️ Idle</span><span class="mc-idle-cnt">${w}</span>`;
    prodBtn.className = 'mc-idle-btn' + (p > 0 ? ' mc-idle-has' : '');
    prodBtn.innerHTML = `<span>🏭 Idle</span><span class="mc-idle-cnt">${p}</span>`;
  }
  const tick = (): void => {
    if (!alive) return;
    const t = performance.now(); acc += t - last; last = t;
    if (acc >= 300) { acc = 0; update(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  update();

  return {
    active: () => alive,
    probe: () => ({ idleWorkers: idleWorkers().length, idleProduction: idleProduction().length }),
    dispose: () => { alive = false; if (raf) cancelAnimationFrame(raf); box.remove(); },
  };
}
