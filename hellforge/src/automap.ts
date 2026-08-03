// Hellforge information map — one snapshot, two projections.
//
// The minimap is persistent UI chrome. The expanded projection is a read-only
// view of the same snapshot; it never owns navigation, collision, pathfinding,
// click-to-move, or exploration authority.

import type {
  AreaMapSnapshot,
  AutomapUiState,
} from './visual-polish-contracts';
import { VISUAL_POLISH_Z } from './visual-polish-contracts';
import { HudArt } from './hud-art';
import { FONT_UI, Ui, Z, panelTitleStyle } from './ui-theme';
import type { AreaExitId } from './content-ids';

export interface AutomapWalkGrid {
  readonly cells: ArrayLike<number>;
  readonly columns: number;
  readonly rows: number;
}

/** F0's snapshot plus the den grid supplied by the existing Dungeon authority. */
export interface AutomapSnapshot extends AreaMapSnapshot {
  readonly denWalkGrid?: AutomapWalkGrid;
  readonly denPlayerCell?: { readonly cx: number; readonly cy: number };
  readonly areaExits?: readonly AutomapMarkerInput[];
  readonly questAuthorizedDirections?: readonly AutomapMarkerInput[];
}

export interface AutomapCallbacks {
  getSnapshot: () => AutomapSnapshot;
}

export interface AutomapCell {
  readonly cx: number;
  readonly cy: number;
  readonly walkable: boolean;
}

export interface AutomapMarker {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly label?: string;
}

export interface AutomapMarkerInput {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly label?: string;
}

export interface RuntimeExitPositions {
  readonly caveMouth: { readonly x: number; readonly z: number };
  readonly campGate: { readonly x: number; readonly z: number };
  readonly denExit: { readonly x: number; readonly z: number };
}

/** Resolve authored runtime exit IDs without creating a second map authority. */
export function resolveRuntimeExitPosition(
  id: AreaExitId,
  positions: RuntimeExitPositions,
): { readonly x: number; readonly z: number } | null {
  switch (id) {
    case 'reach-to-slagdeep':
      return positions.caveMouth;
    case 'cinderwatch-to-reach':
    case 'reach-to-cinderwatch':
      return positions.campGate;
    case 'slagdeep-to-reach':
      return positions.denExit;
    default:
      return null;
  }
}

export interface AutomapProjection {
  readonly area: AutomapSnapshot['area'];
  readonly player: AutomapSnapshot['player'];
  readonly playerCell?: { readonly cx: number; readonly cy: number };
  readonly cells: readonly AutomapCell[];
  readonly landmarks: readonly AutomapMarker[];
  readonly exits: readonly AutomapMarker[];
  readonly questDirections: readonly AutomapMarker[];
}

export interface AutomapHandle {
  toggle(): void;
  /** Compatibility name: controls only the expanded projection. */
  setOpen(open: boolean): void;
  setExpanded(expanded: boolean): void;
  collapseExpanded(): void;
  /** Compatibility name: true only when the expanded projection is open. */
  isOpen(): boolean;
  isExpanded(): boolean;
  isMinimapVisible(): boolean;
  state(): AutomapUiState;
  /** Call from the existing bounded runtime tick with its elapsed seconds. */
  tick(dt?: number): void;
  dispose(): void;
}

const MAP_ID = 'hellforge-automap';
const ROOT_DATA_KEY = 'hellforgeAutomapRoot';
const MINIMAP_FALLBACK_PX = 220;
const EXPANDED_FALLBACK_PX = 640;
const SNAPSHOT_REFRESH_CADENCE_S = 0.1;
const MAX_DPR = 2;

type RootWithDisposer = HTMLDivElement & {
  __hellforgeAutomapDispose?: () => void;
};

type CanvasSurface = {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D | null;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
};

function asMarker(
  marker: AutomapMarkerInput,
): AutomapMarker {
  return {
    id: marker.id,
    x: marker.x,
    z: marker.z,
    ...(marker.label ? { label: marker.label } : {}),
  };
}

/**
 * Session-local discovery is deliberately supplied by main.ts. The map only
 * filters the already-reached IDs; it never scans navigation or render state.
 */
export function filterReachedLandmarks(
  landmarks: readonly { readonly id: string; readonly x: number; readonly z: number }[],
  reachedIds: ReadonlySet<string>,
): readonly AutomapMarker[] {
  return landmarks.filter((landmark) => reachedIds.has(landmark.id)).map(asMarker);
}

function parseCellKey(key: string): { cx: number; cy: number } | null {
  const [rawX, rawY, extra] = key.split(',');
  if (extra !== undefined) return null;
  const cx = Number(rawX);
  const cy = Number(rawY);
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return null;
  return { cx, cy };
}

/**
 * Build the only render model consumed by both canvases.
 *
 * Important: den cells are read by iterating the authoritative explored set,
 * never by scanning the complete walk grid. A wall cell is valid only when its
 * key is explored; an unexplored walkable cell is not emitted.
 */
export function projectAutomap(snapshot: AutomapSnapshot): AutomapProjection {
  const cells: AutomapCell[] = [];
  const grid = snapshot.denWalkGrid;
  if (snapshot.area === 'den' && grid && snapshot.exploredDenCells) {
    for (const key of snapshot.exploredDenCells) {
      const cell = parseCellKey(key);
      if (
        cell === null
        || cell.cx < 0
        || cell.cy < 0
        || cell.cx >= grid.columns
        || cell.cy >= grid.rows
      ) {
        continue;
      }
      const value = grid.cells[cell.cy * grid.columns + cell.cx];
      if (value === undefined) continue;
      cells.push({ ...cell, walkable: value !== 0 });
    }
    cells.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  }

  return {
    area: snapshot.area,
    player: { x: snapshot.player.x, z: snapshot.player.z },
    ...(snapshot.denPlayerCell ? { playerCell: { ...snapshot.denPlayerCell } } : {}),
    cells,
    landmarks: (snapshot.landmarks ?? []).map(asMarker),
    exits: (snapshot.areaExits ?? snapshot.questAuthorizedExits ?? []).map(asMarker),
    questDirections: (
      snapshot.questAuthorizedDirections
      ?? snapshot.questAuthorizedExits
      ?? []
    ).map(asMarker),
  };
}

function projectionSignature(projection: AutomapProjection): string {
  const point = (p: { readonly x: number; readonly z: number }): string =>
    `${(Math.round(p.x * 2) / 2).toFixed(1)},${(Math.round(p.z * 2) / 2).toFixed(1)}`;
  const marker = (m: AutomapMarker): string =>
    `${m.id}:${point(m)}:${m.label ?? ''}`;
  return [
    projection.area,
    projection.area === 'den'
      ? projection.playerCell
        ? `${projection.playerCell.cx},${projection.playerCell.cy}`
        : 'no-player-cell'
      : point(projection.player),
    projection.cells.map((c) => `${c.cx},${c.cy},${c.walkable ? 1 : 0}`).join(';'),
    projection.landmarks.map(marker).join(';'),
    projection.exits.map(marker).join(';'),
    projection.questDirections.map(marker).join(';'),
  ].join('|');
}

function canvasCssSize(surface: CanvasSurface, fallback: number): { width: number; height: number } {
  const width = Math.max(1, Math.round(surface.canvas.clientWidth || fallback));
  const height = Math.max(1, Math.round(surface.canvas.clientHeight || fallback));
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  if (surface.cssWidth !== width || surface.cssHeight !== height || surface.dpr !== dpr) {
    surface.cssWidth = width;
    surface.cssHeight = height;
    surface.dpr = dpr;
    surface.canvas.width = Math.max(1, Math.floor(width * dpr));
    surface.canvas.height = Math.max(1, Math.floor(height * dpr));
    surface.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return { width, height };
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.fillStyle = Ui.gold;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff8e0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawDen(
  ctx: CanvasRenderingContext2D,
  projection: AutomapProjection,
  grid: AutomapWalkGrid,
  width: number,
  height: number,
): void {
  const cellWidth = width / Math.max(1, grid.columns);
  const cellHeight = height / Math.max(1, grid.rows);
  for (const cell of projection.cells) {
    const x = cell.cx * cellWidth;
    const y = cell.cy * cellHeight;
    ctx.fillStyle = cell.walkable ? 'rgba(90,78,58,0.75)' : 'rgba(28,22,18,0.9)';
    ctx.fillRect(x, y, Math.max(1, cellWidth - 1), Math.max(1, cellHeight - 1));
    if (!cell.walkable) {
      ctx.strokeStyle = 'rgba(160,140,110,0.35)';
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, cellWidth - 2), Math.max(1, cellHeight - 2));
    }
  }
  if (projection.playerCell) {
    const px = projection.playerCell.cx;
    const py = projection.playerCell.cy;
    drawPlayer(ctx, (px + 0.5) * cellWidth, (py + 0.5) * cellHeight, Math.max(3, Math.min(cellWidth, cellHeight) * 0.35));
  }
}

function areaBounds(projection: AutomapProjection): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const points = [
    projection.player,
    ...projection.landmarks,
    ...projection.exits,
    ...projection.questDirections,
  ];
  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minZ = points[0]!.z;
  let maxZ = points[0]!.z;
  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const pad = Math.max(3, Math.max(maxX - minX, maxZ - minZ) * 0.18);
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

function drawArea(
  ctx: CanvasRenderingContext2D,
  projection: AutomapProjection,
  width: number,
  height: number,
  expanded: boolean,
): void {
  const bounds = areaBounds(projection);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const xOf = (x: number): number => ((x - bounds.minX) / spanX) * width;
  const yOf = (z: number): number => ((z - bounds.minZ) / spanZ) * height;
  const marker = (m: AutomapMarker, color: string, radius: number): void => {
    const x = xOf(m.x);
    const y = yOf(m.z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (expanded) {
      ctx.fillStyle = Ui.text;
      ctx.font = `600 11px ${FONT_UI}`;
      ctx.fillText(m.label ?? m.id, x + radius + 4, y + 4);
    }
  };
  for (const landmark of projection.landmarks) marker(landmark, '#91c7a0', expanded ? 5 : 3);
  for (const exit of projection.exits) marker(exit, '#ef9b50', expanded ? 5 : 3);
  for (const direction of projection.questDirections) marker(direction, '#f5d878', expanded ? 4 : 3);
  drawPlayer(ctx, xOf(projection.player.x), yOf(projection.player.z), expanded ? 6 : 4);
}

function drawSurface(
  surface: CanvasSurface,
  projection: AutomapProjection,
  grid: AutomapWalkGrid | undefined,
  fallback: number,
  expanded: boolean,
): void {
  const ctx = surface.context;
  if (!ctx) return;
  const { width, height } = canvasCssSize(surface, fallback);
  ctx.clearRect(0, 0, width, height);
  if (projection.area === 'den' && grid) {
    drawDen(ctx, projection, grid, width, height);
  } else {
    drawArea(ctx, projection, width, height, expanded);
  }
}

function removeStaleRoots(mount: HTMLElement): void {
  for (const stale of mount.querySelectorAll<HTMLElement>('[data-hellforge-automap-root]')) {
    const cleanup = (stale as RootWithDisposer).__hellforgeAutomapDispose;
    cleanup?.();
    stale.remove();
  }
}

let activeHandle: AutomapHandle | null = null;

export function installAutomap(mount: HTMLElement, cb: AutomapCallbacks): AutomapHandle {
  activeHandle?.dispose();
  activeHandle = null;
  removeStaleRoots(mount);

  const scoped = mount !== document.body;
  const root = document.createElement('div') as RootWithDisposer;
  root.id = MAP_ID;
  root.dataset[ROOT_DATA_KEY] = 'true';
  root.style.cssText =
    `position:${scoped ? 'absolute' : 'fixed'};inset:0;` +
    'display:block;pointer-events:none;overflow:hidden;background:transparent;';
  root.style.pointerEvents = 'none';
  root.style.display = 'block';

  // N-Stash: avoid overlap when the left dock opens (hide or shift the minimap then).
  const minimap = document.createElement('div');
  minimap.dataset.automapMinimap = 'true';
  minimap.style.cssText =
    `position:absolute;top:max(12px,env(safe-area-inset-top));` +
    `left:max(12px,env(safe-area-inset-left));width:clamp(200px,18vw,240px);` +
    `height:clamp(200px,18vw,240px);z-index:${VISUAL_POLISH_Z.minimap};` +
    'box-sizing:border-box;padding:10px;pointer-events:none;' +
    `background:url('${HudArt.automapFrame()}') center/100% 100% no-repeat;`;
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.style.cssText =
    `display:block;width:100%;height:100%;pointer-events:none;` +
    `background:url('${HudArt.automapParchment()}') center/cover no-repeat,${Ui.inkWell};`;
  minimap.appendChild(minimapCanvas);

  const backdrop = document.createElement('div');
  backdrop.style.cssText =
    `position:absolute;inset:0;z-index:${Z.automap};display:none;` +
    'background:rgba(4,3,2,0.42);pointer-events:none;';
  const expanded = document.createElement('div');
  expanded.dataset.automapExpanded = 'true';
  expanded.style.cssText =
    'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    `z-index:${Z.automap};` +
    'display:none;flex-direction:column;align-items:center;gap:8px;' +
    'width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 32px);' +
    'box-sizing:border-box;pointer-events:none;padding:8px;';
  const title = document.createElement('div');
  title.dataset.automapTitle = 'true';
  title.style.cssText = panelTitleStyle() + 'letter-spacing:3px;white-space:nowrap;flex:none;';
  const mapFrame = document.createElement('div');
  mapFrame.style.cssText =
    'position:relative;padding:18px;width:min(680px,calc(100vw - 68px),calc(100vh - 132px));' +
    'max-width:100%;box-sizing:border-box;flex:none;' +
    `background:url('${HudArt.automapFrame()}') center/100% 100% no-repeat;`;
  const expandedCanvas = document.createElement('canvas');
  expandedCanvas.style.cssText =
    'display:block;width:100%;aspect-ratio:1;max-height:calc(100vh - 120px);' +
    `background:url('${HudArt.automapParchment()}') center/cover no-repeat,${Ui.inkWell};` +
    'pointer-events:none;';
  mapFrame.appendChild(expandedCanvas);
  const close = document.createElement('button');
  close.type = 'button';
  close.dataset.automapClose = 'true';
  close.textContent = '× 关闭';
  close.style.cssText =
    `position:absolute;right:18px;top:8px;z-index:${Z.automap + 1};` +
    `font:700 12px ${FONT_UI};color:${Ui.goldBright};` +
    'background:rgba(12,8,6,0.86);border:1px solid rgba(224,184,74,0.4);' +
    'padding:5px 9px;cursor:pointer;pointer-events:auto;';
  const hint = document.createElement('div');
  hint.textContent = 'Tab 展开 / 收起 · 地图仅供查看';
  hint.style.cssText = `font:600 11px ${FONT_UI};color:${Ui.textMuted};text-shadow:0 1px 3px #000;`;
  expanded.append(title, mapFrame, hint, close);
  root.append(minimap, backdrop, expanded);
  mount.appendChild(root);

  const miniSurface: CanvasSurface = {
    canvas: minimapCanvas,
    context: minimapCanvas.getContext('2d'),
    cssWidth: 0,
    cssHeight: 0,
    dpr: 0,
  };
  const expandedSurface: CanvasSurface = {
    canvas: expandedCanvas,
    context: expandedCanvas.getContext('2d'),
    cssWidth: 0,
    cssHeight: 0,
    dpr: 0,
  };

  let uiState: AutomapUiState = { minimapVisible: true, expanded: false };
  let disposed = false;
  let dirty = true;
  let lastSignature = '';
  let lastGrid: AutomapWalkGrid | undefined;
  let elapsedSinceRefresh = SNAPSHOT_REFRESH_CADENCE_S;
  let resizeObserver: ResizeObserver | null = null;

  const refresh = (): void => {
    if (disposed) return;
    const snapshot = cb.getSnapshot();
    const projection = projectAutomap(snapshot);
    const signature = projectionSignature(projection);
    if (!dirty && signature === lastSignature) {
      elapsedSinceRefresh = 0;
      return;
    }
    dirty = false;
    lastSignature = signature;
    elapsedSinceRefresh = 0;
    lastGrid = snapshot.denWalkGrid;
    const areaLabel = projection.area === 'den'
      ? '熔渣深窟 · 自动地图'
      : projection.area === 'wild'
        ? '灰烬荒原 · 信息地图'
        : '余烬哨站 · 信息地图';
    title.textContent = `${areaLabel}  (Tab 收起)`;
    drawSurface(miniSurface, projection, lastGrid, MINIMAP_FALLBACK_PX, false);
    if (uiState.expanded) {
      drawSurface(expandedSurface, projection, lastGrid, EXPANDED_FALLBACK_PX, true);
    }
  };

  const setExpanded = (next: boolean): void => {
    if (disposed || uiState.expanded === next) return;
    uiState = { minimapVisible: uiState.minimapVisible, expanded: next };
    expanded.style.display = next ? 'flex' : 'none';
    backdrop.style.display = next ? 'block' : 'none';
    dirty = true;
    refresh();
  };

  const onClose = (): void => setExpanded(false);
  close.addEventListener('click', onClose);

  const onResize = (): void => {
    dirty = true;
    refresh();
  };
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);
  }

  const handle: AutomapHandle = {
    toggle() { setExpanded(!uiState.expanded); },
    setOpen(next) { setExpanded(next); },
    setExpanded,
    collapseExpanded() { setExpanded(false); },
    isOpen: () => uiState.expanded,
    isExpanded: () => uiState.expanded,
    isMinimapVisible: () => uiState.minimapVisible,
    state: () => ({ ...uiState }),
    tick(dt = 0) {
      if (disposed) return;
      if (dirty) {
        refresh();
        return;
      }
      elapsedSinceRefresh += Math.max(0, dt);
      if (elapsedSinceRefresh >= SNAPSHOT_REFRESH_CADENCE_S) refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      window.removeEventListener('resize', onResize);
      close.removeEventListener('click', onClose);
      root.__hellforgeAutomapDispose = undefined;
      root.remove();
      if (activeHandle === handle) activeHandle = null;
      lastGrid = undefined;
    },
  };
  root.__hellforgeAutomapDispose = handle.dispose;
  activeHandle = handle;
  refresh();
  return handle;
}
