// Den automap — SPEC §5.2 / §6, adapted to hellforge's walk grid.
//
// aidiablo's AutomapRenderer is isometric over a full world tilemap + many
// entity markers. hellforge only has a walkability grid for 熔渣深窟 (camp /
// wild are open bounds, not tiles). This overlay:
//   • mounts on ctx.uiRoot (absolute when scoped)
//   • top-down cell paint + explored fog (Set<"cx,cy">)
//   • player-centred; Tab toggles (caller owns the key)
//   • only meaningful while area === 'den'

import { CELL, CELLS } from './dungeon-layout';
import type { Dungeon } from './dungeon';
import { FONT_UI } from './ui-theme';

export interface AutomapCallbacks {
  getDungeon: () => Dungeon;
  getPlayerPos: () => { x: number; z: number };
  /** When false, drawing is skipped (still accumulates explore if den). */
  isInDen: () => boolean;
}

export interface AutomapHandle {
  toggle(): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** Call each frame from registerUpdate — explores + redraws when open. */
  tick(): void;
  dispose(): void;
}

const MAP_ID = 'hellforge-automap';
const EXPLORE_R = 5;

export function installAutomap(mount: HTMLElement, cb: AutomapCallbacks): AutomapHandle {
  document.getElementById(MAP_ID)?.remove();
  const scoped = mount !== document.body;

  const root = document.createElement('div');
  root.id = MAP_ID;
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:110;display:none;` +
    'pointer-events:none;overflow:hidden;background:rgba(4,3,2,0.42);';

  const frame = document.createElement('div');
  frame.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'display:flex;flex-direction:column;align-items:center;gap:10px;' +
    'width:min(72%,520px);max-height:78%;';

  const label = document.createElement('div');
  label.textContent = '熔渣深窟 · 自动地图  (Tab 关闭)';
  label.style.cssText = `font:700 12px ${FONT_UI};color:#c8a84e;` +
    'text-shadow:0 1px 3px #000;letter-spacing:2px;white-space:nowrap;flex:none;';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;aspect-ratio:1;max-height:100%;' +
    'border:2px solid #c8a84e;box-shadow:0 0 24px rgba(0,0,0,0.7);background:rgba(8,6,4,0.88);flex:none;';

  const emptyHint = document.createElement('div');
  emptyHint.textContent = '营地 / 荒原无地块地图 — 进入熔渣深窟后可用';
  emptyHint.style.cssText = 'display:none;padding:28px 18px;text-align:center;' +
    `font:600 14px ${FONT_UI};color:#a09070;` +
    'text-shadow:0 1px 3px #000;max-width:100%;box-sizing:border-box;';

  frame.append(label, canvas, emptyHint);
  root.appendChild(frame);
  mount.appendChild(root);

  const explored = new Set<string>();
  let open = false;
  const ctx2d = canvas.getContext('2d')!;

  const resize = (): void => {
    const css = Math.max(120, Math.min(520, Math.floor(Math.min(mount.clientWidth, mount.clientHeight) * 0.72)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(css * dpr));
    canvas.height = canvas.width;
    canvas.style.width = `${css}px`;
    canvas.style.height = `${css}px`;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const markExplore = (cx: number, cy: number): void => {
    for (let dy = -EXPLORE_R; dy <= EXPLORE_R; dy++) {
      for (let dx = -EXPLORE_R; dx <= EXPLORE_R; dx++) {
        if (dx * dx + dy * dy > EXPLORE_R * EXPLORE_R) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= CELLS || y >= CELLS) continue;
        explored.add(`${x},${y}`);
      }
    }
  };

  const draw = (): void => {
    resize();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx2d.clearRect(0, 0, w, h);

    if (!cb.isInDen()) {
      canvas.style.display = 'none';
      emptyHint.style.display = 'block';
      label.textContent = '自动地图  (Tab 关闭)';
      return;
    }
    canvas.style.display = '';
    emptyHint.style.display = 'none';
    label.textContent = '熔渣深窟 · 自动地图  (Tab 关闭)';

    const dungeon = cb.getDungeon();
    const pos = cb.getPlayerPos();
    const cell = dungeon.worldToCell(pos.x, pos.z);
    const px = cell?.cx ?? CELLS / 2;
    const py = cell?.cy ?? CELLS / 2;
    if (cell) markExplore(cell.cx, cell.cy);

    const cellPx = Math.max(4, Math.floor(Math.min(w, h) / (CELLS * 0.55)));
    const viewCells = Math.floor(Math.min(w, h) / cellPx);
    const half = Math.floor(viewCells / 2);
    const ox = Math.floor(px - half);
    const oy = Math.floor(py - half);

    for (let gy = 0; gy < viewCells; gy++) {
      for (let gx = 0; gx < viewCells; gx++) {
        const cx = ox + gx, cy = oy + gy;
        if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) continue;
        const key = `${cx},${cy}`;
        if (!explored.has(key)) continue;
        const walk = dungeon.isWalkCell(cx, cy);
        ctx2d.fillStyle = walk ? 'rgba(90,78,58,0.75)' : 'rgba(28,22,18,0.9)';
        ctx2d.fillRect(gx * cellPx, gy * cellPx, cellPx - 1, cellPx - 1);
        if (!walk) {
          ctx2d.strokeStyle = 'rgba(160,140,110,0.35)';
          ctx2d.strokeRect(gx * cellPx + 0.5, gy * cellPx + 0.5, cellPx - 2, cellPx - 2);
        }
      }
    }

    // player pip
    const lx = (px - ox) * cellPx + cellPx / 2;
    const ly = (py - oy) * cellPx + cellPx / 2;
    ctx2d.fillStyle = '#4488ff';
    ctx2d.beginPath();
    ctx2d.arc(lx, ly, Math.max(3, cellPx * 0.35), 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.strokeStyle = '#fff';
    ctx2d.lineWidth = 1.5;
    ctx2d.stroke();
  };
  void CELL; // imported for grid scale documentation / future isometric spacing

  const tick = (): void => {
    if (cb.isInDen()) {
      const cell = cb.getDungeon().worldToCell(cb.getPlayerPos().x, cb.getPlayerPos().z);
      if (cell) markExplore(cell.cx, cell.cy);
    }
    // Always redraw while open so leaving the den swaps to the empty hint
    // instead of freezing the last den frame on screen.
    if (open) draw();
  };

  return {
    toggle() { this.setOpen(!open); },
    setOpen(next: boolean) {
      open = next;
      root.style.display = open ? 'block' : 'none';
      if (open) draw();
    },
    isOpen: () => open,
    tick,
    dispose: () => root.remove(),
  };
}
