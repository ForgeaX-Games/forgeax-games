import { HUMAN_PLAYER, WALL_COLS, WALL_PATTERN, WALL_ROWS } from '../core/constants';
import type { GameState, PlayerState, TakeAction, TakeSource, TileColor } from '../core/types';
import {
  canPickPatternRow,
  isPatternRowSelected,
  isSourceColorSelected,
} from './take-interaction';
import { PICK_ROW_CLASS, PICK_TILE_CLASS, ensureSelectionStyles } from './selection-styles';
import type { TakeSelectionStore } from './take-selection';
import {
  BOARD_DESIGN,
  FACTORY_SCENE,
  FACTORY_SLOTS,
  PLAY_TILE,
  PLAYER_SCREEN_SLOTS,
  WALL_TILE_BG,
  WALL_TILE_LIT,
  centerPoolSlotDesignCenter,
  centerVisualSlot,
  arrowRightImageUrl,
  boardBgImageUrl,
  boardFallbackImageUrl,
  factoryPlateImageUrl,
  factoryRingPositions,
  factoryTilePos,
  firstPlayerImageUrl,
  floorSlotImageUrl,
  patternSlotImageUrl,
  scoreBoxImageUrl,
  tableViewScales,
  tableWoodBgImageUrl,
  tileAtSlot,
  tileAtWallGrid,
  tileImageUrl,
  wallGridOutlineImageUrl,
} from './game-assets';
import {
  designToScreen,
  destDesignPoint,
  floorSlotDesignCenter,
  plusOneDesignCenter,
  resolveFactoryTilePoint,
  resolvePlusOneSourcePoint,
  resolveSourcePoint,
  resolveCenterDestPoint,
} from './take-flight-geometry';
import {
  clearTakeFlightOverlay,
  runTakeFlightAnimation,
  waitForPaint,
} from './take-flight-animation';
import {
  factoryRestTiles,
  flightDestinations,
  pickedSourceIndices,
  willClaimPlusOne,
  plusOneFloorSlotIndex,
  type FlightLeg,
  type FlightPlan,
} from './take-flight-plan';

const BOARD_ID = 'hua-zhuan-board';

const WALL_LIT_STYLE =
  'filter:drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 0 5px rgba(255,210,80,0.85));' +
  'outline:2px solid rgba(255,235,160,0.9);outline-offset:-1px;border-radius:2px;';

export interface BoardUiOptions {
  selection: TakeSelectionStore;
  onSourceColorPick: (source: TakeSource, color: TileColor) => void;
  onPatternRowPick: (row: number) => void;
  mount?: HTMLElement;
}

export interface BoardUiApi {
  refresh(state: GameState): void;
  playTakeFlight(
    state: GameState,
    action: TakeAction,
    onLanded: () => void,
  ): Promise<void>;
  dispose(): void;
}

/** Mount design-space content with a precomputed view scale */
function mountDesignScene(
  host: HTMLElement,
  designW: number,
  designH: number,
  viewScale: number,
  render: (inner: HTMLDivElement) => void,
): void {
  host.innerHTML = '';
  const vs = viewScale;

  const scaler = document.createElement('div');
  scaler.style.cssText =
    `position:relative;width:${designW * vs}px;height:${designH * vs}px;` +
    'margin:0 auto;flex-shrink:0;';
  host.appendChild(scaler);

  const inner = document.createElement('div');
  inner.style.cssText =
    `position:absolute;left:0;top:0;width:${designW}px;height:${designH}px;` +
    `transform:scale(${vs});transform-origin:top left;`;
  scaler.appendChild(inner);
  render(inner);
}

export function installBoardUi(options: BoardUiOptions): BoardUiApi {
  const { selection, onSourceColorPick, onPatternRowPick } = options;
  const mount = options.mount ?? document.body;
  ensureSelectionStyles();
  document.getElementById(BOARD_ID)?.remove();

  const root = document.createElement('div');
  root.id = BOARD_ID;
  root.style.cssText =
    'position:fixed;left:0;top:0;right:320px;bottom:0;overflow:hidden;' +
    'pointer-events:none;z-index:100;box-sizing:border-box;' +
    `background:#1a1510 url(${tableWoodBgImageUrl()}) center/cover no-repeat;`;
  mount.appendChild(root);

  const grid = document.createElement('div');
  grid.style.cssText =
    'width:100%;height:100%;display:grid;' +
    'grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1fr);' +
    'grid-template-rows:minmax(0,1fr) minmax(0,1fr);' +
    'gap:8px;padding:10px;box-sizing:border-box;pointer-events:auto;';
  root.appendChild(grid);

  const slotEls = new Map<number, HTMLDivElement>();
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div');
    el.dataset.playerSlot = String(i);
    el.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'min-width:0;min-height:0;overflow:hidden;padding:4px;';
    grid.appendChild(el);
    slotEls.set(i, el);
  }

  const factoryCell = document.createElement('div');
  factoryCell.style.cssText =
    'grid-row:1/span 2;grid-column:2;display:flex;align-items:center;justify-content:center;' +
    'position:relative;min-width:0;min-height:0;';
  grid.appendChild(factoryCell);

  slotEls.get(0)!.style.gridArea = 'p0';
  slotEls.get(1)!.style.gridArea = 'p1';
  slotEls.get(2)!.style.gridArea = 'p2';
  slotEls.get(3)!.style.gridArea = 'p3';
  factoryCell.style.gridArea = 'factory';
  grid.style.gridTemplateAreas = '"p0 factory p1" "p2 factory p3"';

  const factoryHost = document.createElement('div');
  factoryHost.style.cssText =
    'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
    'min-width:0;min-height:0;overflow:hidden;';
  factoryCell.appendChild(factoryHost);

  const factoryPlateUrl = factoryPlateImageUrl();

  let useComposedBoard = true;

  const layoutCache = {
    factoryInner: null as HTMLDivElement | null,
    boardInners: new Map<number, HTMLDivElement>(),
  };

  function tagTileEl(
    el: HTMLElement,
    attrs: Record<string, string>,
  ): HTMLElement {
    el.dataset.hzTile = '1';
    for (const [k, v] of Object.entries(attrs)) {
      el.dataset[k] = v;
    }
    return el;
  }

  function imgEl(src: string, w: number, h: number, style = ''): HTMLImageElement {
    const im = document.createElement('img');
    im.src = src;
    im.width = w;
    im.height = h;
    im.draggable = false;
    im.style.cssText = `display:block;object-fit:contain;${style}`;
    im.alt = '';
    return im;
  }

  function absImg(
    src: string,
    x: number,
    y: number,
    w: number,
    h: number,
    extra = '',
  ): HTMLImageElement {
    return imgEl(src, w, h, `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${extra}`);
  }

  function tileImg(src: string, size: number, extra = ''): HTMLImageElement {
    return imgEl(src, size, size, extra);
  }

  function isHumanTakeTurn(state: GameState): boolean {
    const p = state.players[state.currentPlayer];
    return state.phase === 'take_turn' && !!p?.isHuman;
  }

  function clickableTileAbs(
    src: string,
    size: number,
    left: number,
    top: number,
    highlighted: boolean,
    enabled: boolean,
    onClick: () => void,
    tileTags?: Record<string, string>,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = highlighted ? PICK_TILE_CLASS : '';
    wrap.style.cssText =
      `position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px;` +
      `box-sizing:border-box;` +
      (enabled ? 'cursor:pointer;' : 'pointer-events:none;');
    if (tileTags) tagTileEl(wrap, tileTags);
    wrap.appendChild(tileImg(src, size, 'width:100%;height:100%;pointer-events:none;'));
    if (enabled) {
      wrap.onclick = (e) => {
        e.stopPropagation();
        onClick();
      };
    }
    return wrap;
  }

  function placePoolTile(
    scene: HTMLDivElement,
    visualSlot: number,
    src: string,
    size: number,
    tags: Record<string, string>,
    highlighted: boolean,
    enabled: boolean,
    onClick?: () => void,
  ): void {
    const pt = centerPoolSlotDesignCenter(visualSlot);
    const left = pt.cx - size / 2;
    const top = pt.cy - size / 2;
    if (enabled && onClick) {
      scene.appendChild(
        clickableTileAbs(src, size, left, top, highlighted, true, onClick, tags),
      );
    } else {
      const im = tileImg(src, size, `position:absolute;left:${left}px;top:${top}px;`);
      tagTileEl(im, tags);
      scene.appendChild(im);
    }
  }

  function renderCenterPool(scene: HTMLDivElement, state: GameState): void {
    const tilePx = FACTORY_SCENE.tile;
    const hasPlusOne = state.hasPlusOneInCenter;
    const interactive = isHumanTakeTurn(state);

    if (hasPlusOne) {
      const pt = plusOneDesignCenter();
      const left = pt.cx - tilePx / 2;
      const top = pt.cy - tilePx / 2;
      const im = tileImg(
        firstPlayerImageUrl(),
        tilePx,
        `position:absolute;left:${left}px;top:${top}px;pointer-events:none;`,
      );
      tagTileEl(im, { hzSrc: 'plus-one' });
      scene.appendChild(im);
    }

    for (let ci = 0; ci < state.center.length; ci++) {
      const t = state.center[ci]!;
      const src: TakeSource = { kind: 'center' };
      const hi = isSourceColorSelected(state, selection, src, t);
      const tags = { hzSrc: 'center', hzCenterI: String(ci), hzColor: String(t) };
      const vis = centerVisualSlot(ci, hasPlusOne);
      if (interactive) {
        placePoolTile(scene, vis, tileImageUrl(t), tilePx, tags, hi, true, () =>
          onSourceColorPick(src, t),
        );
      } else {
        placePoolTile(scene, vis, tileImageUrl(t), tilePx, tags, false, false);
      }
    }

    if (state.center.length === 0 && !hasPlusOne) {
      const hint = centerPoolSlotDesignCenter(0);
      const empty = document.createElement('span');
      empty.textContent = '中央';
      empty.style.cssText =
        `position:absolute;left:${hint.cx - 16}px;top:${hint.cy - 6}px;` +
        'font-size:11px;color:rgba(255,255,255,0.35);pointer-events:none;';
      scene.appendChild(empty);
    }
  }

  function renderFactoriesInner(scene: HTMLDivElement, state: GameState): void {
    const fs = FACTORY_SCENE;
    scene.style.cssText = `position:relative;width:${fs.w}px;height:${fs.h}px;`;

    const positions = factoryRingPositions(fs.cx, fs.cy, fs.ringRadius);
    const interactive = isHumanTakeTurn(state);
    const tilePx = fs.tile;
    const platePx = fs.plate;

    renderCenterPool(scene, state);

    for (let i = 0; i < state.factories.length; i++) {
      const pos = positions[i]!;
      const plate = document.createElement('div');
      plate.style.cssText =
        `position:absolute;left:${pos.x - platePx / 2}px;top:${pos.y - platePx / 2}px;` +
        `width:${platePx}px;height:${platePx}px;`;
      plate.appendChild(imgEl(factoryPlateUrl, platePx, platePx));

      const tiles = state.factories[i]!;
      tiles.forEach((color, ti) => {
        const slot = FACTORY_SLOTS[ti % 4]!;
        const { left, top } = factoryTilePos(slot, platePx, tilePx);
        const src: TakeSource = { kind: 'factory', index: i };
        const hi = isSourceColorSelected(state, selection, src, color);
        const tags = {
          hzSrc: 'factory',
          hzFactoryI: String(i),
          hzFactoryTi: String(ti),
          hzColor: String(color),
        };
        if (interactive && tiles.length > 0) {
          plate.appendChild(
            clickableTileAbs(tileImageUrl(color), tilePx, left, top, hi, true, () =>
              onSourceColorPick(src, color),
            tags),
          );
        } else {
          const im = tileImg(
            tileImageUrl(color),
            tilePx,
            `position:absolute;left:${left}px;top:${top}px;`,
          );
          tagTileEl(im, tags);
          plate.appendChild(im);
        }
      });
      scene.appendChild(plate);
    }
  }

  function renderFactories(state: GameState, viewScale: number): void {
    mountDesignScene(factoryHost, FACTORY_SCENE.w, FACTORY_SCENE.h, viewScale, (inner) => {
      layoutCache.factoryInner = inner;
      renderFactoriesInner(inner, state);
    });
  }

  function renderComposedBoard(
    board: HTMLDivElement,
    state: GameState,
    p: PlayerState,
  ): void {
    const d = BOARD_DESIGN;
    const sl = d.slot;

    board.style.width = `${d.w}px`;
    board.style.height = `${d.h}px`;

    const bg = absImg(boardBgImageUrl(), 0, 0, d.w, d.h);
    bg.onerror = () => {
      useComposedBoard = false;
    };
    board.appendChild(bg);

    const sb = d.scoreBox;
    board.appendChild(absImg(scoreBoxImageUrl(), sb.x, sb.y, sb.w, sb.h));
    const scoreLabel = document.createElement('div');
    scoreLabel.textContent = String(p.score);
    scoreLabel.style.cssText =
      `position:absolute;left:${sb.x}px;top:${sb.y}px;width:${sb.w}px;height:${sb.h}px;` +
      'display:flex;align-items:center;justify-content:center;' +
      'font-size:18px;font-weight:800;color:#3d2914;pointer-events:none;';
    board.appendChild(scoreLabel);

    for (const row of d.patternRows) {
      for (const slot of row) {
        board.appendChild(absImg(patternSlotImageUrl(), slot.x, slot.y, sl.w, sl.h));
      }
    }

    for (const arr of d.arrows) {
      board.appendChild(absImg(arrowRightImageUrl(), arr.x, arr.y, d.arrow.w, d.arrow.h));
    }

    const wo = d.wallOutline;
    board.appendChild(absImg(wallGridOutlineImageUrl(), wo.x, wo.y, wo.w, wo.h));

    for (let r = 0; r < WALL_ROWS; r++) {
      for (let c = 0; c < WALL_COLS; c++) {
        const color = WALL_PATTERN[r]![c]!;
        const pos = tileAtWallGrid(d.wallOrigin, c, r, d.wallStep, WALL_TILE_BG);
        board.appendChild(
          tileImg(
            tileImageUrl(color),
            pos.size,
            `position:absolute;left:${pos.left}px;top:${pos.top}px;opacity:0.5;`,
          ),
        );
      }
    }

    for (let r = 0; r < d.patternRows.length; r++) {
      const slots = d.patternRows[r]!;
      const pr = p.patternRows[r]!;
      slots.forEach((slot, si) => {
        if (pr.tiles[si] === undefined) return;
        const pos = tileAtSlot(slot, sl.w, sl.h, PLAY_TILE);
        board.appendChild(
          tileImg(
            tileImageUrl(pr.tiles[si]!),
            pos.size,
            `position:absolute;left:${pos.left}px;top:${pos.top}px;`,
          ),
        );
      });
    }

    for (let r = 0; r < WALL_ROWS; r++) {
      for (let c = 0; c < WALL_COLS; c++) {
        if (!p.wall[r]![c]) continue;
        const color = WALL_PATTERN[r]![c]!;
        const pos = tileAtWallGrid(d.wallOrigin, c, r, d.wallStep, WALL_TILE_LIT);
        board.appendChild(
          tileImg(
            tileImageUrl(color),
            pos.size,
            `position:absolute;left:${pos.left}px;top:${pos.top}px;${WALL_LIT_STYLE}`,
          ),
        );
      }
    }

    const fl = d.floorSlot;
    for (const slot of d.floorSlots) {
      board.appendChild(absImg(floorSlotImageUrl(), slot.x, slot.y, fl.w, fl.h));
    }

    let floorIdx = 0;
    let lineIdx = 0;
    while (floorIdx < d.floorSlots.length) {
      if (p.plusOneOnFloor && floorIdx === p.plusOneFloorSlot) {
        const slot = d.floorSlots[floorIdx]!;
        const pos = tileAtSlot(slot, fl.w, fl.h, PLAY_TILE);
        board.appendChild(
          tileImg(
            firstPlayerImageUrl(),
            pos.size,
            `position:absolute;left:${pos.left}px;top:${pos.top}px;`,
          ),
        );
        floorIdx++;
        continue;
      }
      if (lineIdx >= p.floorLine.length) break;
      const slot = d.floorSlots[floorIdx]!;
      const pos = tileAtSlot(slot, fl.w, fl.h, PLAY_TILE);
      board.appendChild(
        tileImg(
          tileImageUrl(p.floorLine[lineIdx]!),
          pos.size,
          `position:absolute;left:${pos.left}px;top:${pos.top}px;`,
        ),
      );
      lineIdx++;
      floorIdx++;
    }

    if (p.id === HUMAN_PLAYER && isHumanTakeTurn(state)) {
      for (let r = 0; r < d.patternRows.length; r++) {
        const slots = d.patternRows[r]!;
        let minX = slots[0]!.x;
        let maxX = slots[0]!.x + sl.w;
        const y = slots[0]!.y;
        for (const slot of slots) {
          minX = Math.min(minX, slot.x);
          maxX = Math.max(maxX, slot.x + sl.w);
        }
        const rowEl = document.createElement('div');
        const selected = isPatternRowSelected(state, selection, r);
        const canPick = canPickPatternRow(state, selection, r);
        if (selected) rowEl.classList.add(PICK_ROW_CLASS);
        rowEl.style.cssText =
          `position:absolute;left:${minX}px;top:${y}px;width:${maxX - minX}px;height:${sl.h}px;` +
          (canPick ? 'cursor:pointer;z-index:20;' : 'pointer-events:none;');
        if (canPick) {
          rowEl.onclick = (e) => {
            e.stopPropagation();
            onPatternRowPick(r);
          };
        }
        board.appendChild(rowEl);
      }
    }
  }

  function renderFallbackBoard(board: HTMLDivElement, p: PlayerState): void {
    const d = BOARD_DESIGN;
    const sl = d.slot;
    board.style.width = `${d.w}px`;
    board.style.height = `${d.h}px`;
    board.appendChild(imgEl(boardFallbackImageUrl(), d.w, d.h, 'width:100%;height:100%;'));

    for (let r = 0; r < d.patternRows.length; r++) {
      const slots = d.patternRows[r]!;
      const pr = p.patternRows[r]!;
      slots.forEach((slot, si) => {
        if (pr.tiles[si] === undefined) return;
        const pos = tileAtSlot(slot, sl.w, sl.h, PLAY_TILE);
        board.appendChild(
          tileImg(
            tileImageUrl(pr.tiles[si]!),
            pos.size,
            `position:absolute;left:${pos.left}px;top:${pos.top}px;`,
          ),
        );
      });
    }
  }

  function renderPlayerBoards(state: GameState, boardScale: number): void {
    for (let slot = 0; slot < 4; slot++) {
      const playerId = PLAYER_SCREEN_SLOTS[slot]!;
      const p = state.players[playerId]!;
      const cell = slotEls.get(slot)!;
      cell.innerHTML = '';

      const isHuman = p.isHuman;
      const isCurrent = state.currentPlayer === playerId && state.phase === 'take_turn';

      const label = document.createElement('div');
      label.textContent = p.name;
      label.style.cssText =
        `font-size:${isHuman ? 12 : 10}px;font-weight:700;margin-bottom:2px;color:` +
        `${isHuman ? '#f5d78e' : '#c9b896'};text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;`;
      cell.appendChild(label);

      const wrap = document.createElement('div');
      wrap.style.cssText =
        'position:relative;flex:1;min-width:0;min-height:0;width:100%;' +
        'display:flex;align-items:center;justify-content:center;' +
        `border-radius:8px;padding:2px;` +
        (isCurrent
          ? 'box-shadow:0 0 0 2px rgba(96,165,250,0.85),0 0 12px rgba(59,130,246,0.35);'
          : isHuman
            ? 'box-shadow:0 0 0 1px rgba(245,215,142,0.5);'
            : 'box-shadow:0 0 0 1px rgba(255,255,255,0.08);');
      cell.appendChild(wrap);

      const boardHost = document.createElement('div');
      boardHost.style.cssText =
        'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
      wrap.appendChild(boardHost);

      mountDesignScene(boardHost, BOARD_DESIGN.w, BOARD_DESIGN.h, boardScale, (inner) => {
        layoutCache.boardInners.set(playerId, inner);
        if (useComposedBoard) {
          renderComposedBoard(inner, state, p);
        } else {
          renderFallbackBoard(inner, p);
        }
      });
    }
  }

  function buildFlightPlan(state: GameState, action: TakeAction): FlightPlan | null {
    const playerId = state.currentPlayer;
    const boardInner = layoutCache.boardInners.get(playerId);
    const factoryInner = layoutCache.factoryInner;
    if (!boardInner || !factoryInner) return null;

    const hasPlusOne = state.hasPlusOneInCenter;
    const srcIndices = pickedSourceIndices(state, action);
    const dests = flightDestinations(state, action);
    if (srcIndices.length === 0 || dests.length !== srcIndices.length) return null;

    const legs: FlightLeg[] = [];

    if (willClaimPlusOne(state, action)) {
      const from = resolvePlusOneSourcePoint(factoryInner);
      if (from) {
        const player = state.players[playerId]!;
        const plusOneSlot = plusOneFloorSlotIndex(player);
        const floorDest = floorSlotDesignCenter(plusOneSlot);
        const to = designToScreen(boardInner, BOARD_DESIGN.w, BOARD_DESIGN.h, floorDest);
        legs.push({
          color: action.color,
          sprite: 'first-player',
          from,
          to,
        });
      }
    }

    for (let i = 0; i < srcIndices.length; i++) {
      const from = resolveSourcePoint(action, srcIndices[i]!, hasPlusOne, factoryInner);
      if (!from) continue;
      const destDesign = destDesignPoint(dests[i]!, hasPlusOne);
      const to = designToScreen(boardInner, BOARD_DESIGN.w, BOARD_DESIGN.h, destDesign);
      legs.push({ color: action.color, from, to });
    }

    for (const rest of factoryRestTiles(state, action)) {
      const from = resolveFactoryTilePoint(
        rest.factoryIndex,
        rest.tileIndex,
        rest.color,
        factoryInner,
      );
      if (!from) continue;
      const to = resolveCenterDestPoint(rest.centerArrayIndex, hasPlusOne, factoryInner);
      legs.push({ color: rest.color, from, to });
    }

    return legs.length > 0 ? { legs } : null;
  }

  async function playTakeFlight(
    state: GameState,
    action: TakeAction,
    onLanded: () => void,
  ): Promise<void> {
    const plan = buildFlightPlan(state, action);
    if (!plan?.legs.length) {
      onLanded();
      return;
    }
    await runTakeFlightAnimation(plan, mount);
    onLanded();
    await waitForPaint(2);
    clearTakeFlightOverlay();
  }

  let lastState: GameState | null = null;

  function refresh(state: GameState): void {
    lastState = state;
    const { factoryScale, boardScale } = tableViewScales(root.clientWidth, root.clientHeight);
    renderPlayerBoards(state, boardScale);
    renderFactories(state, factoryScale);
  }

  const ro = new ResizeObserver(() => {
    if (lastState) refresh(lastState);
  });
  ro.observe(root);

  return {
    refresh,
    playTakeFlight,
    dispose: () => {
      ro.disconnect();
      root.remove();
    },
  };
}
