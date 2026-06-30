import { PLAYER_COLORS, TERRAIN_INFO } from '../core/constants';
import {
  getBuildableRoadEdges,
  getBuildableVillageVertices,
  getSetupRoadEdges,
  getUpgradeableVertices,
  isValidRobberTile,
  isValidSetupVillage,
} from '../core/rules';
import { boardBounds, cornerPos, HEX_SIZE, hexPixelCenter, portLabel } from '../core/map';
import { BOTTOM_BAR_CSS_VAR, BOTTOM_BAR_FALLBACK_H, setBottomBarHeight, TOP_BAR_H } from './layout';
import { isHumanActive } from '../systems/phase-controller';
import type { GameState } from '../core/types';

const BOARD_ID = 'luo-sai-ya-board';
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

/** 村庄：小房子图标 */
function appendVillageIcon(parent: SVGGElement, x: number, y: number, color: string): void {
  const g = svgEl('g');
  g.setAttribute('transform', `translate(${x},${y})`);
  g.setAttribute('pointer-events', 'none');

  const halo = svgEl('circle');
  halo.setAttribute('r', '13');
  halo.setAttribute('fill', 'rgba(0,0,0,0.45)');
  halo.setAttribute('stroke', '#fff');
  halo.setAttribute('stroke-width', '1.5');
  g.appendChild(halo);

  const roof = svgEl('polygon');
  roof.setAttribute('points', '0,-9 9,1 -9,1');
  roof.setAttribute('fill', color);
  roof.setAttribute('stroke', '#fff');
  roof.setAttribute('stroke-width', '1.2');
  roof.setAttribute('stroke-linejoin', 'round');
  g.appendChild(roof);

  const body = svgEl('rect');
  body.setAttribute('x', '-6');
  body.setAttribute('y', '1');
  body.setAttribute('width', '12');
  body.setAttribute('height', '8');
  body.setAttribute('rx', '1');
  body.setAttribute('fill', color);
  body.setAttribute('stroke', '#fff');
  body.setAttribute('stroke-width', '1.2');
  g.appendChild(body);

  const door = svgEl('rect');
  door.setAttribute('x', '-2');
  door.setAttribute('y', '4');
  door.setAttribute('width', '4');
  door.setAttribute('height', '5');
  door.setAttribute('fill', 'rgba(0,0,0,0.35)');
  g.appendChild(door);

  parent.appendChild(g);
}

/** 城镇：双塔城堡图标 */
function appendTownIcon(parent: SVGGElement, x: number, y: number, color: string): void {
  const g = svgEl('g');
  g.setAttribute('transform', `translate(${x},${y})`);
  g.setAttribute('pointer-events', 'none');

  const halo = svgEl('circle');
  halo.setAttribute('r', '15');
  halo.setAttribute('fill', 'rgba(0,0,0,0.45)');
  halo.setAttribute('stroke', '#fcd34d');
  halo.setAttribute('stroke-width', '2');
  g.appendChild(halo);

  const wall = svgEl('rect');
  wall.setAttribute('x', '-10');
  wall.setAttribute('y', '2');
  wall.setAttribute('width', '20');
  wall.setAttribute('height', '9');
  wall.setAttribute('fill', color);
  wall.setAttribute('stroke', '#fff');
  wall.setAttribute('stroke-width', '1.2');
  g.appendChild(wall);

  for (const tx of [-7, 5]) {
    const tower = svgEl('rect');
    tower.setAttribute('x', String(tx));
    tower.setAttribute('y', '-6');
    tower.setAttribute('width', '6');
    tower.setAttribute('height', '17');
    tower.setAttribute('fill', color);
    tower.setAttribute('stroke', '#fff');
    tower.setAttribute('stroke-width', '1.2');
    g.appendChild(tower);

    const cren = svgEl('rect');
    cren.setAttribute('x', String(tx - 0.5));
    cren.setAttribute('y', '-9');
    cren.setAttribute('width', '7');
    cren.setAttribute('height', '4');
    cren.setAttribute('fill', color);
    cren.setAttribute('stroke', '#fff');
    cren.setAttribute('stroke-width', '1');
    g.appendChild(cren);
  }

  const gate = svgEl('rect');
  gate.setAttribute('x', '-3');
  gate.setAttribute('y', '5');
  gate.setAttribute('width', '6');
  gate.setAttribute('height', '6');
  gate.setAttribute('fill', 'rgba(0,0,0,0.4)');
  g.appendChild(gate);

  parent.appendChild(g);
}

/** 强盗：面具人形 + 剑 */
function appendRobberIcon(parent: SVGGElement, x: number, y: number): void {
  const g = svgEl('g');
  g.setAttribute('transform', `translate(${x},${y})`);
  g.setAttribute('pointer-events', 'none');

  const halo = svgEl('circle');
  halo.setAttribute('r', '16');
  halo.setAttribute('fill', 'rgba(127,29,29,0.92)');
  halo.setAttribute('stroke', '#fca5a5');
  halo.setAttribute('stroke-width', '2.5');
  g.appendChild(halo);

  const head = svgEl('circle');
  head.setAttribute('cy', '-4');
  head.setAttribute('r', '5');
  head.setAttribute('fill', '#1e293b');
  head.setAttribute('stroke', '#f8fafc');
  head.setAttribute('stroke-width', '1.2');
  g.appendChild(head);

  const mask = svgEl('rect');
  mask.setAttribute('x', '-4');
  mask.setAttribute('y', '-6');
  mask.setAttribute('width', '8');
  mask.setAttribute('height', '4');
  mask.setAttribute('rx', '1');
  mask.setAttribute('fill', '#450a0a');
  g.appendChild(mask);

  const body = svgEl('rect');
  body.setAttribute('x', '-5');
  body.setAttribute('y', '1');
  body.setAttribute('width', '10');
  body.setAttribute('height', '9');
  body.setAttribute('rx', '2');
  body.setAttribute('fill', '#334155');
  body.setAttribute('stroke', '#f8fafc');
  body.setAttribute('stroke-width', '1');
  g.appendChild(body);

  const blade = svgEl('line');
  blade.setAttribute('x1', '6');
  blade.setAttribute('y1', '8');
  blade.setAttribute('x2', '14');
  blade.setAttribute('y2', '-2');
  blade.setAttribute('stroke', '#e2e8f0');
  blade.setAttribute('stroke-width', '2.5');
  blade.setAttribute('stroke-linecap', 'round');
  g.appendChild(blade);

  const label = svgEl('text');
  label.setAttribute('y', '22');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('fill', '#fecaca');
  label.setAttribute('font-size', '9');
  label.setAttribute('font-weight', '800');
  label.textContent = '强盗';
  g.appendChild(label);

  parent.appendChild(g);
}

export interface BoardUiApi {
  refresh(state: GameState): void;
  /** 收割骰和：高亮对应数字格，保持到回合结束 */
  setHarvestHighlight(state: GameState, sum: number): void;
  /** 掷出 7：强盗事件高亮，保持到回合结束 */
  setRobberHighlight(state: GameState): void;
  clearTurnHighlights(): void;
  /** @deprecated 使用 setHarvestHighlight */
  flashDiceTiles(state: GameState, sum: number, durationMs?: number): void;
  setVisible(visible: boolean): void;
  onVertexClick(fn: (id: string) => void): void;
  onEdgeClick(fn: (id: string) => void): void;
  onTileClick(fn: (id: number) => void): void;
  dispose(): void;
}

type TurnHighlight =
  | { kind: 'harvest'; sum: number }
  | { kind: 'robber' };

export function installBoardUi(): BoardUiApi {
  document.getElementById(BOARD_ID)?.remove();

  const root = document.createElement('div');
  root.id = BOARD_ID;
  root.style.cssText =
    `position:fixed;left:0;top:${TOP_BAR_H}px;right:0;bottom:var(${BOTTOM_BAR_CSS_VAR},${BOTTOM_BAR_FALLBACK_H}px);overflow:auto;` +
    'background:radial-gradient(ellipse at 50% 40%,#1e3a5f 0%,#0c1220 72%);' +
    'display:flex;align-items:center;justify-content:center;z-index:100;';
  document.body.appendChild(root);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'display:block;max-width:100%;max-height:100%;';
  root.appendChild(svg);

  let vtxFn: ((id: string) => void) | null = null;
  let edgeFn: ((id: string) => void) | null = null;
  let tileFn: ((id: number) => void) | null = null;

  let turnHighlight: TurnHighlight | null = null;
  let pulseRaf = 0;
  let pulseState: GameState | null = null;

  function stopPulseLoop(): void {
    cancelAnimationFrame(pulseRaf);
    pulseRaf = 0;
    pulseState = null;
  }

  function clearTurnHighlights(): void {
    turnHighlight = null;
    stopPulseLoop();
  }

  function ensurePulseLoop(state: GameState): void {
    pulseState = state;
    if (pulseRaf !== 0) return;
    const loop = () => {
      if (!turnHighlight || !pulseState) {
        stopPulseLoop();
        return;
      }
      refresh(pulseState);
      pulseRaf = requestAnimationFrame(loop);
    };
    pulseRaf = requestAnimationFrame(loop);
  }

  function setHarvestHighlight(state: GameState, sum: number): void {
    turnHighlight = { kind: 'harvest', sum };
    ensurePulseLoop(state);
    refresh(state);
  }

  function setRobberHighlight(state: GameState): void {
    turnHighlight = { kind: 'robber' };
    ensurePulseLoop(state);
    refresh(state);
  }

  function flashDiceTiles(state: GameState, sum: number, _durationMs?: number): void {
    setHarvestHighlight(state, sum);
  }

  function hexPoints(q: number, r: number, size: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = cornerPos(q, r, i, size);
      pts.push(`${p.x},${p.y}`);
    }
    return pts.join(' ');
  }

  function refresh(state: GameState): void {
    const board = state.board;
    const human = isHumanActive(state);
    const b = boardBounds(board);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const ox = -b.minX;
    const oy = -b.minY;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = '';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${ox},${oy})`);
    svg.appendChild(g);

    const robberPick =
      (human && state.phase === 'turn_robber_move') ||
      (human && state.phase === 'turn_develop' && state.humanDevelopMode === 'knight');
    const setupVillage = human && state.phase === 'setup_village';
    const setupRoad = human && state.phase === 'setup_road';
    const buildRoad = human && state.phase === 'turn_develop' && state.humanDevelopMode === 'road';
    const buildVillage = human && state.phase === 'turn_develop' && state.humanDevelopMode === 'village';
    const upgradeTown = human && state.phase === 'turn_develop' && state.humanDevelopMode === 'upgrade';
    const setupPid = state.setupPlayerIndex;
    const harvestSum = turnHighlight?.kind === 'harvest' ? turnHighlight.sum : null;
    const robberEvent = turnHighlight?.kind === 'robber';
    const robberMovePhase =
      state.phase === 'turn_robber_move' ||
      (state.phase === 'turn_develop' && state.humanDevelopMode === 'knight');

    for (const tile of board.tiles) {
      const info = TERRAIN_INFO[tile.terrain];
      const canPickRobber = robberPick && isValidRobberTile(state, tile.id);
      const isRobberSel = state.selectedTileId === tile.id;
      const isHarvestMatch =
        harvestSum !== null && tile.number === harvestSum && tile.terrain !== 'desert';
      const isRobberHome = robberEvent && state.robberTileId === tile.id;
      const isRobberTarget = robberEvent && robberMovePhase && canPickRobber;
      const isRobberBlocked = robberEvent && state.blockedTileId === tile.id && tile.id !== state.robberTileId;
      const pulse =
        isHarvestMatch || isRobberHome || isRobberTarget
          ? 0.55 + 0.45 * Math.sin(Date.now() / 140)
          : 0;

      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', hexPoints(tile.q, tile.r, HEX_SIZE));
      poly.setAttribute('fill', info.color);
      if (isHarvestMatch) {
        poly.setAttribute('stroke', '#fef08a');
        poly.setAttribute('stroke-width', String(4 + pulse * 4));
      } else if (isRobberTarget) {
        poly.setAttribute('stroke', isRobberSel ? '#fbbf24' : '#fb923c');
        poly.setAttribute('stroke-width', String(4 + pulse * 3));
      } else if (isRobberHome) {
        poly.setAttribute('stroke', '#f87171');
        poly.setAttribute('stroke-width', String(5 + pulse * 4));
      } else if (isRobberBlocked) {
        poly.setAttribute('stroke', '#94a3b8');
        poly.setAttribute('stroke-width', '3');
      } else {
        poly.setAttribute('stroke', isRobberSel ? '#fbbf24' : state.robberTileId === tile.id ? '#7f1d1d' : '#1e293b');
        poly.setAttribute('stroke-width', isRobberSel || state.robberTileId === tile.id ? '4' : '2');
      }
      if (state.blockedTileId === tile.id) poly.setAttribute('opacity', '0.55');
      if (canPickRobber) {
        poly.style.cursor = 'pointer';
        poly.addEventListener('click', () => tileFn?.(tile.id));
      }
      g.appendChild(poly);

      if (isHarvestMatch) {
        const glow = svgEl('polygon');
        glow.setAttribute('points', hexPoints(tile.q, tile.r, HEX_SIZE));
        glow.setAttribute('fill', `rgba(254,240,138,${0.12 + pulse * 0.22})`);
        glow.setAttribute('stroke', 'none');
        glow.setAttribute('pointer-events', 'none');
        g.appendChild(glow);
      }
      if (isRobberHome || isRobberTarget) {
        const glow = svgEl('polygon');
        glow.setAttribute('points', hexPoints(tile.q, tile.r, HEX_SIZE));
        const glowColor = isRobberTarget
          ? `rgba(251,146,60,${0.14 + pulse * 0.2})`
          : `rgba(248,113,113,${0.18 + pulse * 0.24})`;
        glow.setAttribute('fill', glowColor);
        glow.setAttribute('stroke', 'none');
        glow.setAttribute('pointer-events', 'none');
        g.appendChild(glow);
      }

      const c = hexPixelCenter(tile.q, tile.r, HEX_SIZE);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(c.x));
      label.setAttribute('y', String(c.y - 6));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#fff');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-weight', '700');
      label.setAttribute('pointer-events', 'none');
      label.textContent = info.name;
      g.appendChild(label);

      if (tile.number !== null) {
        const nt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        nt.setAttribute('x', String(c.x));
        nt.setAttribute('y', String(c.y + 14));
        nt.setAttribute('text-anchor', 'middle');
        nt.setAttribute('fill', tile.number === 6 || tile.number === 8 ? '#fef08a' : '#f1f5f9');
        nt.setAttribute('font-size', '12');
        nt.setAttribute('font-weight', '600');
        nt.setAttribute('pointer-events', 'none');
        nt.textContent = String(tile.number);
        g.appendChild(nt);
      }

      if (state.robberTileId === tile.id) {
        appendRobberIcon(g, c.x, c.y + 8);
      }
    }

    for (const v of board.vertices.values()) {
      if (!v.port) continue;
      const len = Math.hypot(v.x, v.y) || 1;
      const px = v.x + (v.x / len) * 14;
      const py = v.y + (v.y / len) * 14;
      const dock = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dock.setAttribute('cx', String(px));
      dock.setAttribute('cy', String(py));
      dock.setAttribute('r', '11');
      dock.setAttribute('fill', '#0369a1');
      dock.setAttribute('stroke', '#7dd3fc');
      dock.setAttribute('stroke-width', '2');
      dock.setAttribute('pointer-events', 'none');
      g.appendChild(dock);
      const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      anchor.setAttribute('x', String(px));
      anchor.setAttribute('y', String(py + 4));
      anchor.setAttribute('text-anchor', 'middle');
      anchor.setAttribute('fill', '#e0f2fe');
      anchor.setAttribute('font-size', '11');
      anchor.setAttribute('pointer-events', 'none');
      anchor.textContent = '⚓';
      g.appendChild(anchor);
      const trade = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      trade.setAttribute('x', String(px));
      trade.setAttribute('y', String(py - 14));
      trade.setAttribute('text-anchor', 'middle');
      trade.setAttribute('fill', '#bae6fd');
      trade.setAttribute('font-size', '9');
      trade.setAttribute('font-weight', '700');
      trade.setAttribute('pointer-events', 'none');
      trade.textContent = portLabel(v.port);
      g.appendChild(trade);
    }

    for (const e of board.edges.values()) {
      const v1 = board.vertices.get(e.v1)!;
      const v2 = board.vertices.get(e.v2)!;

      let interactive = false;
      let highlight = false;

      if (setupRoad) {
        const valid = getSetupRoadEdges(state, setupPid).includes(e.id);
        interactive = valid;
        highlight = valid;
      } else if (buildRoad) {
        const valid = getBuildableRoadEdges(state, state.currentPlayer).includes(e.id);
        interactive = valid;
        highlight = valid;
      }

      if (interactive) {
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hit.setAttribute('x1', String(v1.x));
        hit.setAttribute('y1', String(v1.y));
        hit.setAttribute('x2', String(v2.x));
        hit.setAttribute('y2', String(v2.y));
        hit.setAttribute('stroke', state.selectedEdge === e.id ? '#f59e0b' : highlight ? '#fbbf24' : 'transparent');
        hit.setAttribute('stroke-width', state.selectedEdge === e.id ? '10' : '14');
        hit.setAttribute('stroke-linecap', 'round');
        hit.setAttribute('opacity', state.selectedEdge === e.id ? '1' : '0.75');
        hit.style.cursor = 'pointer';
        hit.addEventListener('click', () => edgeFn?.(e.id));
        g.appendChild(hit);
      }
    }

    for (const e of board.edges.values()) {
      if (!state.placements.roads.has(e.id)) continue;
      const v1 = board.vertices.get(e.v1)!;
      const v2 = board.vertices.get(e.v2)!;
      let owner = state.placements.roadOwners.get(e.id) ?? 0;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(v1.x));
      line.setAttribute('y1', String(v1.y));
      line.setAttribute('x2', String(v2.x));
      line.setAttribute('y2', String(v2.y));
      line.setAttribute('stroke', PLAYER_COLORS[owner] ?? '#fff');
      line.setAttribute('stroke-width', '6');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('pointer-events', 'none');
      g.appendChild(line);
    }

    for (const [vid, owner] of state.placements.villages) {
      const v = board.vertices.get(vid)!;
      const isTown = state.placements.towns.has(vid);
      const color = PLAYER_COLORS[owner] ?? '#fff';
      if (isTown) appendTownIcon(g, v.x, v.y, color);
      else appendVillageIcon(g, v.x, v.y, color);
    }

    if (setupVillage) {
      for (const v of board.vertices.values()) {
        const valid = isValidSetupVillage(state, v.id).ok;
        if (!valid) continue;
        const sel = state.selectedVertex === v.id;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(v.x));
        dot.setAttribute('cy', String(v.y));
        dot.setAttribute('r', sel ? '9' : '7');
        dot.setAttribute('fill', sel ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.2)');
        dot.setAttribute('stroke', sel ? '#f59e0b' : '#fbbf24');
        dot.setAttribute('stroke-width', sel ? '3' : '2');
        dot.style.cursor = 'pointer';
        dot.addEventListener('click', () => vtxFn?.(v.id));
        g.appendChild(dot);
      }
    }

    if (buildVillage) {
      const validSet = new Set(getBuildableVillageVertices(state, state.currentPlayer));
      for (const v of board.vertices.values()) {
        if (!validSet.has(v.id)) continue;
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(v.x));
        dot.setAttribute('cy', String(v.y));
        dot.setAttribute('r', '8');
        dot.setAttribute('fill', 'rgba(34,197,94,0.35)');
        dot.setAttribute('stroke', '#22c55e');
        dot.setAttribute('stroke-width', '2');
        dot.style.cursor = 'pointer';
        dot.addEventListener('click', () => vtxFn?.(v.id));
        g.appendChild(dot);
      }
    }

    if (upgradeTown) {
      const validSet = new Set(getUpgradeableVertices(state, state.currentPlayer));
      for (const vid of validSet) {
        const v = board.vertices.get(vid)!;
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('cx', String(v.x));
        ring.setAttribute('cy', String(v.y));
        ring.setAttribute('r', '14');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#a855f7');
        ring.setAttribute('stroke-width', '3');
        ring.setAttribute('stroke-dasharray', '4 3');
        ring.style.cursor = 'pointer';
        ring.addEventListener('click', () => vtxFn?.(v.id));
        g.appendChild(ring);
      }
    }
  }

  return {
    refresh,
    setHarvestHighlight,
    setRobberHighlight,
    clearTurnHighlights,
    flashDiceTiles,
    setVisible(visible: boolean) {
      root.style.display = visible ? 'flex' : 'none';
    },
    onVertexClick(fn) {
      vtxFn = fn;
    },
    onEdgeClick(fn) {
      edgeFn = fn;
    },
    onTileClick(fn) {
      tileFn = fn;
    },
    dispose() {
      clearTurnHighlights();
      root.remove();
    },
  };
}
