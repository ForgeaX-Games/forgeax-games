/**
 * Layout SSOT — 1 design pixel = 1 asset pixel after normalize-ui-assets.py.
 * Screen display: apply a single CSS transform scale on each scene root only.
 */

export const TILE_FILES = [
  'tile-blue-star',
  'tile-orange-flower',
  'tile-red-diamond',
  'tile-cyan-swirl',
  'tile-dark-cross',
] as const;

/** Playable tile — pattern / factory / center / floor / +1 */
export const PLAY_TILE = 48;

/** Wall grid fills 400×400 outline: 5×5 @ 80px, tiles flush */
export const WALL_STEP = 80;
export const WALL_TILE_BG = 80;
export const WALL_TILE_LIT = 66;

export const FLOOR_SLOT_W = 50;
export const FLOOR_SLOT_H = 50;

const SRC = '../../assets/source';

function assetUrl(file: string): string {
  return new URL(`${SRC}/${file}`, import.meta.url).href;
}

export function tileImageUrl(color: number): string {
  const base = TILE_FILES[color] ?? TILE_FILES[0];
  return assetUrl(`${base}.png`);
}

export function firstPlayerImageUrl(): string {
  return assetUrl('tile-first-player.png');
}

export function factoryPlateImageUrl(): string {
  return assetUrl('factory-plate.png');
}

export function boardBgImageUrl(): string {
  return assetUrl('main_board_bg.png');
}

/** Full-table wood texture — tiled from AI tile then stretched to 2400×1600 */
export function tableWoodBgImageUrl(): string {
  return assetUrl('table_wood_bg.png');
}

export function boardFallbackImageUrl(): string {
  return assetUrl('player-board.png');
}

export function scoreBoxImageUrl(): string {
  return assetUrl('score_box_bg.png');
}

export function patternSlotImageUrl(): string {
  return assetUrl('pattern_slot_empty.png');
}

export function wallGridOutlineImageUrl(): string {
  return assetUrl('wall_grid_outline.png');
}

export function arrowRightImageUrl(): string {
  return assetUrl('arrow_right_icon.png');
}

export function floorSlotImageUrl(): string {
  return assetUrl('floor_slot_empty.png');
}

const SLOT = 70;

/** Player board — design space 900×650 (ui-final-guide main board area) */
export const BOARD_DESIGN = {
  w: 900,
  h: 650,
  scoreBox: { x: 370, y: 30, w: 160, h: 60 },
  wallOutline: { x: 470, y: 120, w: 400, h: 400 },
  slot: { w: SLOT, h: SLOT },
  arrow: { w: 24, h: 18 },
  patternRows: [
    [{ x: 350, y: 125 }],
    [{ x: 270, y: 205 }, { x: 350, y: 205 }],
    [{ x: 190, y: 285 }, { x: 270, y: 285 }, { x: 350, y: 285 }],
    [{ x: 110, y: 365 }, { x: 190, y: 365 }, { x: 270, y: 365 }, { x: 350, y: 365 }],
    [{ x: 30, y: 445 }, { x: 110, y: 445 }, { x: 190, y: 445 }, { x: 270, y: 445 }, { x: 350, y: 445 }],
  ] as { x: number; y: number }[][],
  wallOrigin: { x: 470, y: 120 },
  wallStep: WALL_STEP,
  arrows: [
    { x: 435, y: 151 },
    { x: 435, y: 231 },
    { x: 435, y: 311 },
    { x: 435, y: 391 },
    { x: 435, y: 471 },
  ] as { x: number; y: number }[],
  floorSlot: { w: FLOOR_SLOT_W, h: FLOOR_SLOT_H },
  floorSlots: [
    { x: 175, y: 575 },
    { x: 240, y: 575 },
    { x: 305, y: 575 },
    { x: 370, y: 575 },
    { x: 435, y: 575 },
    { x: 500, y: 575 },
    { x: 565, y: 575 },
  ] as { x: number; y: number }[],
} as const;

export const PLAYER_SCREEN_SLOTS: readonly number[] = [0, 1, 2, 3] as const;

/** Factory plate asset is 160px; display size in factory scene */
export const FACTORY_PLATE = 128;
export const FACTORY_TILE = 38;

function factoryRingRadius(platePx: number, margin = 1.04): number {
  return Math.ceil((platePx / (2 * Math.sin(Math.PI / 9))) * margin);
}

const FACTORY_RING_R = factoryRingRadius(FACTORY_PLATE);
const FACTORY_EXTENT = FACTORY_RING_R + FACTORY_PLATE / 2 + 6;

/** Tight square canvas — scales down with the table, not the full viewport height */
export const FACTORY_SCENE = {
  w: FACTORY_EXTENT * 2,
  h: FACTORY_EXTENT * 2,
  cx: FACTORY_EXTENT,
  cy: FACTORY_EXTENT,
  plate: FACTORY_PLATE,
  tile: FACTORY_TILE,
  ringRadius: FACTORY_RING_R,
} as const;

/** Central pool — fixed grid; slot coords known before take resolves */
export const CENTER_POOL = {
  cols: 5,
  gap: 4,
  tile: FACTORY_TILE,
  /** Visual slot index reserved for +1 marker when present */
  plusOneVisualSlot: 0,
} as const;

export function centerPoolCellStep(): number {
  return CENTER_POOL.tile + CENTER_POOL.gap;
}

/** Map center array index → visual grid slot (+1 occupies slot 0 when shown) */
export function centerVisualSlot(centerArrayIndex: number, hasPlusOne: boolean): number {
  return (hasPlusOne ? 1 : 0) + centerArrayIndex;
}

export function centerPoolOrigin(): { x: number; y: number } {
  const step = centerPoolCellStep();
  const gridW = CENTER_POOL.cols * step - CENTER_POOL.gap;
  return {
    x: FACTORY_SCENE.cx - gridW / 2,
    y: FACTORY_SCENE.cy - step * 1.15,
  };
}

/** Design-space center of a central-pool grid cell (visual slot index) */
export function centerPoolSlotDesignCenter(visualSlot: number): {
  cx: number;
  cy: number;
  size: number;
} {
  const step = centerPoolCellStep();
  const { x: ox, y: oy } = centerPoolOrigin();
  const col = visualSlot % CENTER_POOL.cols;
  const row = Math.floor(visualSlot / CENTER_POOL.cols);
  const size = CENTER_POOL.tile;
  return {
    cx: ox + col * step + size / 2,
    cy: oy + row * step + size / 2,
    size,
  };
}

/** Table grid proportions (center factory = 50% width, four corner boards) */
export const TABLE_LAYOUT = {
  /** Center column = 50% of table width (grid 1fr 2fr 1fr) */
  factoryColFrac: 0.5,
  gap: 8,
  labelH: 18,
  /** Collect boards render slightly smaller than their cell fit */
  boardShrink: 0.86,
  factoryMaxScale: 1,
  boardMaxScale: 0.48,
} as const;

export interface TableViewScales {
  factoryScale: number;
  boardScale: number;
}

export const FACTORY_SLOTS = [
  { x: 48, y: 48 },
  { x: 112, y: 48 },
  { x: 48, y: 112 },
  { x: 112, y: 112 },
] as const;

export function factoryRingPositions(
  cx: number,
  cy: number,
  radius: number,
  count = 9,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return out;
}

/** Compute view scale to fit design rect into container (single scale factor) */
export function fitScale(
  containerW: number,
  containerH: number,
  designW: number,
  designH: number,
  maxScale = Infinity,
): number {
  if (containerW <= 0 || containerH <= 0) return 0.45;
  return Math.min(containerW / designW, containerH / designH, maxScale);
}

/**
 * Factory fills half the table width; boards use a separate (smaller) scale.
 */
export function tableViewScales(rootW: number, rootH: number): TableViewScales {
  const { factoryColFrac, gap, labelH, boardShrink, factoryMaxScale, boardMaxScale } =
    TABLE_LAYOUT;
  const pad = 20;
  const usableW = Math.max(320, rootW - pad);
  const usableH = Math.max(240, rootH - pad);

  const factoryColW = usableW * factoryColFrac;
  const boardCellW = (usableW - factoryColW - gap * 2) / 2;
  const boardCellH = (usableH - gap) / 2 - labelH;

  const factoryScale = fitScale(
    factoryColW,
    usableH,
    FACTORY_SCENE.w,
    FACTORY_SCENE.h,
    factoryMaxScale,
  );
  const boardScale =
    fitScale(boardCellW, boardCellH, BOARD_DESIGN.w, BOARD_DESIGN.h, boardMaxScale) *
    boardShrink;

  return { factoryScale, boardScale };
}

/** Center tile inside slot rect (design px) */
export function tileAtSlot(
  slot: { x: number; y: number },
  slotW: number,
  slotH: number,
  tileSize: number,
): { left: number; top: number; size: number } {
  return {
    left: slot.x + (slotW - tileSize) / 2,
    top: slot.y + (slotH - tileSize) / 2,
    size: tileSize,
  };
}

/** Wall cell grid (design px) — step 80 fills 400×400 */
export function tileAtWallGrid(
  origin: { x: number; y: number },
  col: number,
  row: number,
  step: number,
  tileSize: number,
): { left: number; top: number; size: number } {
  const baseX = origin.x + col * step;
  const baseY = origin.y + row * step;
  return {
    left: baseX + (step - tileSize) / 2,
    top: baseY + (step - tileSize) / 2,
    size: tileSize,
  };
}

/** Factory tile anchor on plate (design px, plate top-left origin) */
export function factoryTilePos(
  slot: { x: number; y: number },
  plateSize: number,
  tileSize: number,
): { left: number; top: number } {
  const s = plateSize / 160;
  return {
    left: slot.x * s - tileSize / 2,
    top: slot.y * s - tileSize / 2,
  };
}
