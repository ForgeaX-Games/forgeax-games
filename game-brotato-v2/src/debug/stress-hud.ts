import type { GameHost } from '@forgeax/engine-app';
import { Time, Update, type World } from '@forgeax/engine-ecs';
import { STRESS } from '../config/stress.ts';
import { countLiveEnemies } from '../runtime/enemy.ts';
import { createPerfWindow, pushFrame, type PerfWindowState } from '../stress/perf-window.ts';
import { STRESS_STATE_KEY } from '../stress/state.ts';
import type { StressState } from '../systems/stress-system.ts';
import { DEV_HUD_SYSTEM_NAME } from './dev-hud-system.ts';

export const STRESS_HUD_SYSTEM_NAME = 'brotato-v2/stress-hud';

export interface StressHud {
  readonly setVisible: (visible: boolean) => void;
  readonly update: (state: StressState, fps: number, phaseMs: { move: number; collide: number; combat: number }) => void;
  readonly dispose: () => void;
}

const STRESS_CSS = [
  '.brotato-v2-stress{position:fixed;top:24px;right:24px;z-index:46;display:none;box-sizing:border-box;width:318px;padding:14px 16px;border:1px solid #65dfff66;border-radius:12px;background:linear-gradient(145deg,#071525ee,#0b1c2de8);box-shadow:0 16px 40px #0009;color:#eaf7ff;font:500 12px/1.35 ui-sans-serif,system-ui,sans-serif;text-shadow:0 2px 12px #000;letter-spacing:.05em;pointer-events:none}',
  '.brotato-v2-stress[data-state="warn"]{border-color:#ffd36aaa}',
  '.brotato-v2-stress[data-state="frozen"]{border-color:#ff7d69cc;box-shadow:0 16px 40px #2b0808aa}',
  '.brotato-v2-stress-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;color:#65e7ff;font-size:11px;font-weight:800;letter-spacing:.16em}',
  '.brotato-v2-stress[data-state="warn"] .brotato-v2-stress-head{color:#ffd36a}',
  '.brotato-v2-stress[data-state="frozen"] .brotato-v2-stress-head{color:#ff9b8d}',
  '.brotato-v2-stress-primary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:11px}',
  '.brotato-v2-stress-primary div{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border:1px solid #ffffff16;border-radius:8px;background:#ffffff08}',
  '.brotato-v2-stress-primary b{color:#fff;font:800 29px/1 ui-monospace,SFMono-Regular,monospace;letter-spacing:0}',
  '.brotato-v2-stress-primary small,.brotato-v2-stress-detail small{color:#88a8bf;font-size:9px;letter-spacing:.12em}',
  '.brotato-v2-stress-detail{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 9px;padding-top:9px;border-top:1px solid #ffffff14}',
  '.brotato-v2-stress-detail div{display:flex;flex-direction:column;gap:2px}',
  '.brotato-v2-stress-detail b{color:#d9f6ff;font:700 12px/1.15 ui-monospace,SFMono-Regular,monospace;letter-spacing:0}',
  '.brotato-v2-stress-detail .wide{grid-column:span 2}',
].join('');

const STRESS_HTML = [
  '<aside class="brotato-v2-stress" data-state="ramp" aria-label="Brotato v2 stress test">',
  '<header class="brotato-v2-stress-head"><span>STRESS TEST</span><span data-stress-slot="elapsed">T+0.0s</span></header>',
  '<section class="brotato-v2-stress-primary"><div><b data-stress-slot="fps">--</b><small>FPS</small></div><div><b data-stress-slot="enemies">--</b><small>ENEMIES</small></div></section>',
  '<section class="brotato-v2-stress-detail">',
  '<div><small>MIN</small><b data-stress-slot="min">--</b></div><div><small>PEAK</small><b data-stress-slot="peak">--</b></div><div><small>TARGET</small><b data-stress-slot="target">--</b></div>',
  '<div><small>SPAWN</small><b data-stress-slot="spawn">--</b></div><div><small>MOVE</small><b data-stress-slot="move">--</b></div><div><small>COL</small><b data-stress-slot="collide">--</b></div>',
  '<div><small>CMB</small><b data-stress-slot="combat">--</b></div><div class="wide"><small>STATE</small><b data-stress-slot="state">RAMP</b></div>',
  '</section></aside>',
].join('');

function setText(root: ParentNode, slot: string, value: string): void {
  const element = root.querySelector<HTMLElement>(`[data-stress-slot="${slot}"]`);
  if (element !== null && element.textContent !== value) element.textContent = value;
}

function createNoopStressHud(): StressHud {
  return { setVisible: () => undefined, update: () => undefined, dispose: () => undefined };
}

export function createStressHud(host: GameHost): StressHud {
  if (typeof document === 'undefined') return createNoopStressHud();
  const root = host.uiRoot ?? host.canvas.parentElement ?? document.body;
  const style = document.createElement('style');
  style.textContent = STRESS_CSS;
  const panel = document.createElement('div');
  panel.innerHTML = STRESS_HTML;
  const owner = panel.firstElementChild as HTMLElement | null;
  if (owner === null) return createNoopStressHud();
  root.append(style, owner);
  let disposed = false;
  return {
    setVisible: (visible) => {
      if (!disposed) owner.style.display = visible ? 'block' : 'none';
    },
    update: (state, fps, phaseMs) => {
      if (disposed) return;
      const frozen = state.collapse15 !== undefined;
      const warning = state.collapse30 !== undefined;
      const mode = frozen ? 'frozen' : warning ? 'warn' : 'ramp';
      owner.dataset.state = mode;
      setText(owner, 'elapsed', `T+${state.elapsed.toFixed(1)}s`);
      setText(owner, 'fps', Number.isFinite(fps) ? fps.toFixed(1) : '--');
      setText(owner, 'enemies', String(Math.max(0, Math.floor(state.liveEnemies))));
      setText(owner, 'min', Number.isFinite(state.minFps) ? state.minFps.toFixed(1) : '--');
      setText(owner, 'peak', String(Math.max(0, Math.floor(state.peakEnemies))));
      setText(owner, 'target', String(Math.max(0, Math.round(state.targetEnemies))));
      setText(owner, 'spawn', `${Math.max(0, Math.round(state.spawnedRecently))}/s`);
      setText(owner, 'move', `${Math.max(0, phaseMs.move).toFixed(2)} ms`);
      setText(owner, 'collide', `${Math.max(0, phaseMs.collide).toFixed(2)} ms`);
      setText(owner, 'combat', `${Math.max(0, phaseMs.combat).toFixed(2)} ms`);
      setText(owner, 'state', frozen ? 'FROZEN' : warning ? 'WARN' : 'RAMP');
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      owner.remove();
      style.remove();
    },
  };
}

interface PhaseSample {
  age: number;
  move: number;
  collide: number;
  combat: number;
}

function averagePhase(samples: readonly PhaseSample[]): { move: number; collide: number; combat: number } {
  if (samples.length === 0) return { move: 0, collide: 0, combat: 0 };
  const totals = samples.reduce(
    (sum, sample) => ({
      move: sum.move + sample.move,
      collide: sum.collide + sample.collide,
      combat: sum.combat + sample.combat,
    }),
    { move: 0, collide: 0, combat: 0 },
  );
  return {
    move: totals.move / samples.length,
    collide: totals.collide / samples.length,
    combat: totals.combat / samples.length,
  };
}

/** Update-rate performance sampler and DOM presenter for the pressure session. */
export function installStressHudSystem(world: World, hud: StressHud): () => void {
  let perf: PerfWindowState = createPerfWindow();
  let phaseSamples: PhaseSample[] = [];
  let wasActive = false;
  let renderAccumulator = 0;
  const result = world.addSystem(Update, {
    name: STRESS_HUD_SYSTEM_NAME,
    after: [DEV_HUD_SYSTEM_NAME],
    queries: [],
    fn: (world) => {
      const state = world.getResource<StressState>(STRESS_STATE_KEY);
      if (!state.active) {
        if (wasActive) {
          perf = createPerfWindow();
          phaseSamples = [];
          renderAccumulator = 0;
        }
        wasActive = false;
        hud.setVisible(false);
        return;
      }
      if (!wasActive) {
        perf = createPerfWindow();
        phaseSamples = [];
        renderAccumulator = 1 / STRESS.hud.updateHz;
        wasActive = true;
        hud.setVisible(true);
      }
      const delta = Math.max(0, world.getResource(Time).delta);
      const verdict = pushFrame(perf, delta);
      state.minFps = verdict.minFps;
      const enemies = countLiveEnemies(world);
      state.liveEnemies = enemies;
      state.peakEnemies = Math.max(state.peakEnemies, enemies);
      if (state.collapse30 === undefined && verdict.warn) {
        state.collapse30 = { fps: verdict.fps, enemies, at: state.elapsed };
      }
      if (state.collapse15 === undefined && verdict.freeze) {
        state.collapse15 = { fps: verdict.fps, enemies, at: state.elapsed };
        state.frozenAt = state.elapsed;
      }
      for (const sample of phaseSamples) sample.age += delta;
      phaseSamples.push({ age: 0, ...state.phaseMs });
      while ((phaseSamples[0]?.age ?? 0) > STRESS.perf.windowSeconds) phaseSamples.shift();
      renderAccumulator += delta;
      if (renderAccumulator < 1 / STRESS.hud.updateHz) return;
      renderAccumulator %= 1 / STRESS.hud.updateHz;
      hud.update(state, verdict.fps, averagePhase(phaseSamples));
    },
  });
  result.unwrap();
  return () => {
    const removed = world.removeSystem(Update, STRESS_HUD_SYSTEM_NAME);
    if (!removed.ok && removed.error.code !== 'system-before-unknown') throw removed.error;
  };
}
