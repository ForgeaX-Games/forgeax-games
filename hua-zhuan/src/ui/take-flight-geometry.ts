import {
  BOARD_DESIGN,
  CENTER_POOL,
  FACTORY_SCENE,
  FACTORY_SLOTS,
  FLOOR_SLOT_H,
  FLOOR_SLOT_W,
  PLAY_TILE,
  centerPoolSlotDesignCenter,
  centerVisualSlot,
  factoryRingPositions,
  factoryTilePos,
  tileAtSlot,
} from './game-assets';
import type { TakeAction, TileColor } from '../core/types';
import type { FlightDestination, ScreenPoint } from './take-flight-plan';

/** Design-space center + size for a factory plate tile */
export function factoryTileDesignCenter(factoryIndex: number, tileIndex: number): ScreenPoint {
  const fs = FACTORY_SCENE;
  const ring = factoryRingPositions(fs.cx, fs.cy, fs.ringRadius);
  const pos = ring[factoryIndex]!;
  const plateLeft = pos.x - fs.plate / 2;
  const plateTop = pos.y - fs.plate / 2;
  const slot = FACTORY_SLOTS[tileIndex % 4]!;
  const { left, top } = factoryTilePos(slot, fs.plate, fs.tile);
  const size = fs.tile;
  return {
    cx: plateLeft + left + size / 2,
    cy: plateTop + top + size / 2,
    size,
  };
}

export function patternSlotDesignCenter(row: number, slotInRow: number): ScreenPoint {
  const slot = BOARD_DESIGN.patternRows[row]![slotInRow]!;
  const pos = tileAtSlot(slot, BOARD_DESIGN.slot.w, BOARD_DESIGN.slot.h, PLAY_TILE);
  return { cx: pos.left + pos.size / 2, cy: pos.top + pos.size / 2, size: PLAY_TILE };
}

export function floorSlotDesignCenter(floorIndex: number): ScreenPoint {
  const slot = BOARD_DESIGN.floorSlots[floorIndex]!;
  if (!slot) {
    const last = BOARD_DESIGN.floorSlots[BOARD_DESIGN.floorSlots.length - 1]!;
    const pos = tileAtSlot(last, FLOOR_SLOT_W, FLOOR_SLOT_H, PLAY_TILE);
    return { cx: pos.left + pos.size / 2, cy: pos.top + pos.size / 2, size: PLAY_TILE };
  }
  const pos = tileAtSlot(slot, FLOOR_SLOT_W, FLOOR_SLOT_H, PLAY_TILE);
  return { cx: pos.left + pos.size / 2, cy: pos.top + pos.size / 2, size: PLAY_TILE };
}

export function centerArrayDesignCenter(
  centerArrayIndex: number,
  hasPlusOne: boolean,
): ScreenPoint {
  const vis = centerVisualSlot(centerArrayIndex, hasPlusOne);
  return centerPoolSlotDesignCenter(vis);
}

export function plusOneDesignCenter(): ScreenPoint {
  return centerPoolSlotDesignCenter(CENTER_POOL.plusOneVisualSlot);
}

/** Map design coords on a scaled scene inner element → viewport pixels */
export function designToScreen(
  inner: HTMLElement,
  designW: number,
  designH: number,
  point: ScreenPoint,
): ScreenPoint {
  const r = inner.getBoundingClientRect();
  const sx = r.width / designW;
  const sy = r.height / designH;
  const s = (sx + sy) / 2;
  return {
    cx: r.left + point.cx * sx,
    cy: r.top + point.cy * sy,
    size: point.size * s,
  };
}

export function destDesignPoint(
  dest: FlightDestination,
  hasPlusOne: boolean,
): ScreenPoint {
  if (dest.kind === 'pattern') {
    return patternSlotDesignCenter(dest.row, dest.slotIndex);
  }
  if (dest.kind === 'floor') {
    return floorSlotDesignCenter(dest.slotIndex);
  }
  return centerArrayDesignCenter(dest.slotIndex, hasPlusOne);
}

export function centerTileSelector(centerIndex: number, color: number): string {
  return `[data-hz-src="center"][data-hz-center-i="${centerIndex}"][data-hz-color="${color}"]`;
}

export function factoryTileSelector(
  factoryIndex: number,
  tileIndex: number,
  color: number,
): string {
  return `[data-hz-src="factory"][data-hz-factory-i="${factoryIndex}"][data-hz-factory-ti="${tileIndex}"][data-hz-color="${color}"]`;
}

export function readElementCenter(el: Element): ScreenPoint {
  const r = el.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width };
}

export function resolveFactoryTilePoint(
  factoryIndex: number,
  tileIndex: number,
  color: TileColor,
  factoryRoot: HTMLElement | null,
): ScreenPoint | null {
  if (!factoryRoot) return null;
  const sel = factoryTileSelector(factoryIndex, tileIndex, color);
  const el = factoryRoot.querySelector(sel);
  if (el) return readElementCenter(el);
  const design = factoryTileDesignCenter(factoryIndex, tileIndex);
  return designToScreen(factoryRoot, FACTORY_SCENE.w, FACTORY_SCENE.h, design);
}

export function resolvePlusOneSourcePoint(factoryRoot: HTMLElement | null): ScreenPoint | null {
  if (!factoryRoot) return null;
  const el = factoryRoot.querySelector('[data-hz-src="plus-one"]');
  if (el) return readElementCenter(el);
  const design = plusOneDesignCenter();
  return designToScreen(factoryRoot, FACTORY_SCENE.w, FACTORY_SCENE.h, design);
}

export function resolveSourcePoint(
  action: TakeAction,
  sourceTileIndex: number,
  hasPlusOne: boolean,
  factoryRoot: HTMLElement | null,
): ScreenPoint | null {
  if (!factoryRoot) return null;
  const color = action.color;

  if (action.source.kind === 'factory') {
    return resolveFactoryTilePoint(action.source.index, sourceTileIndex, color, factoryRoot);
  }

  const sel = centerTileSelector(sourceTileIndex, color);
  const el = factoryRoot.querySelector(sel);
  if (el) return readElementCenter(el);
  const design = centerArrayDesignCenter(sourceTileIndex, hasPlusOne);
  return designToScreen(factoryRoot, FACTORY_SCENE.w, FACTORY_SCENE.h, design);
}

export function resolveCenterDestPoint(
  centerArrayIndex: number,
  hasPlusOne: boolean,
  factoryRoot: HTMLElement,
): ScreenPoint {
  const design = centerArrayDesignCenter(centerArrayIndex, hasPlusOne);
  return designToScreen(factoryRoot, FACTORY_SCENE.w, FACTORY_SCENE.h, design);
}
