/**
 * MarsCraft -> forgeax-engine — Control groups (M19 UI port)
 * =============================================================================
 * SC-style control groups 0-9: the STORAGE + hotkeys behind the source
 * `ControlGroupBar` (the source kept groups in its InputManager; the port had no
 * control-group support). Each frame reads the raw input:
 *   - Ctrl + Digit N  → ASSIGN the current selection to group N.
 *   - Digit N         → RECALL group N (select it, pruning dead members).
 *   - Digit N twice   → recall + CENTER the camera on the group (double-tap).
 * The ControlGroupBar UI reads `getGroup(n)` to render the tabs.
 *
 * ⚠️ one-shot keys: `input.wasJustPressed(code, true)` — justPressed only holds a
 * code on its INITIAL press (input.ts skips key-repeat), and clearing it here
 * stops re-fire while held. Recall prunes despawned members (world.get→!ok).
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import type { InputState } from '../input';
import type { SelectionHandle } from './selection';

const DOUBLE_TAP_S = 0.3;

export interface ControlGroupDeps {
  input: InputState;
  selection: SelectionHandle;
  /** Camera centre-on for double-tap recall. */
  jumpTo?: (x: number, z: number) => void;
}

export interface ControlGroupHandle {
  /** Live (dead-pruned) members of group `n` (0-9). */
  getGroup(n: number): EntityHandle[];
  /** {n: count} for every non-empty group + the active group (verify + UI). */
  probe(): { groups: Record<number, number>; active: number };
  /** Assign / recall programmatically (verify aid). */
  assign(n: number): void;
  recall(n: number): void;
}

export class ControlGroupSystem implements ControlGroupHandle {
  readonly name = 'ControlGroupSystem';
  private _world!: World;
  private readonly _deps: ControlGroupDeps;
  private readonly _groups = new Map<number, EntityHandle[]>();
  private _active = -1;
  private _gameTime = 0;
  private readonly _lastRecall = new Map<number, number>();

  constructor(deps: ControlGroupDeps) { this._deps = deps; }

  install(world: World): ControlGroupHandle {
    this._world = world;
    world.addSystem({
      name: this.name,
      queries: [],
      resources: ['Time'],
      fn: () => {
        const { input } = this._deps;
        this._gameTime += world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        const ctrl = input.keys.has('ControlLeft') || input.keys.has('ControlRight');
        for (let n = 0; n <= 9; n++) {
          if (!input.wasJustPressed(`Digit${n}`, true)) continue;
          if (ctrl) this.assign(n);
          else this._recallWithDoubleTap(n);
        }
      },
    });
    return this;
  }

  /** Snapshot the current selection into group `n`. */
  assign(n: number): void {
    const sel = this._deps.selection.getSelected();
    this._groups.set(n, [...sel]);
    this._active = n;
  }

  /** Select group `n` (pruning dead). */
  recall(n: number): void {
    const live = this.getGroup(n);
    if (live.length === 0) return;
    this._deps.selection.select(live);
    this._active = n;
  }

  private _recallWithDoubleTap(n: number): void {
    const live = this.getGroup(n);
    if (live.length === 0) return;
    this._deps.selection.select(live);
    this._active = n;
    const last = this._lastRecall.get(n) ?? -1e9;
    if (this._gameTime - last < DOUBLE_TAP_S && this._deps.jumpTo) {
      // double-tap → centre camera on the group centroid.
      let sx = 0, sz = 0, cnt = 0;
      for (const e of live) {
        const t = this._world.get(e, Transform);
        if (t.ok) { sx += t.value.pos[0]; sz += t.value.pos[2]; cnt++; }
      }
      if (cnt > 0) this._deps.jumpTo(sx / cnt, sz / cnt);
    }
    this._lastRecall.set(n, this._gameTime);
  }

  getGroup(n: number): EntityHandle[] {
    const g = this._groups.get(n);
    if (!g || g.length === 0) return [];
    // prune despawned members (dead units drop their Transform).
    const live = g.filter((e) => this._world.get(e, Transform).ok);
    if (live.length !== g.length) this._groups.set(n, live);
    return live;
  }

  probe(): { groups: Record<number, number>; active: number } {
    const out: Record<number, number> = {};
    for (let n = 0; n <= 9; n++) {
      const c = this.getGroup(n).length;
      if (c > 0) out[n] = c;
    }
    return { groups: out, active: this._active };
  }
}
