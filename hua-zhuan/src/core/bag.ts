import { FACTORY_COUNT, NUM_COLORS, TILES_PER_COLOR } from './constants';
import type { TileColor } from './types';

export function createBag(): TileColor[] {
  const bag: TileColor[] = [];
  for (let c = 0; c < NUM_COLORS; c++) {
    for (let i = 0; i < TILES_PER_COLOR; i++) bag.push(c as TileColor);
  }
  shuffle(bag);
  return bag;
}

export function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

export function dealFactories(bag: TileColor[]): { bag: TileColor[]; factories: TileColor[][] } {
  const factories: TileColor[][] = Array.from({ length: FACTORY_COUNT }, () => []);
  const b = [...bag];
  for (let f = 0; f < FACTORY_COUNT; f++) {
    for (let t = 0; t < 4; t++) {
      if (b.length === 0) break;
      factories[f]!.push(b.pop()!);
    }
  }
  return { bag: b, factories };
}

/** Tiles needed to fill all factory displays each round */
export const TILES_PER_ROUND = FACTORY_COUNT * 4;

/**
 * Azul rule: when the bag cannot fill factories, shuffle the discard pile back in.
 */
export function dealFactoriesWithRecycle(
  bag: TileColor[],
  discard: TileColor[],
): { bag: TileColor[]; discard: TileColor[]; factories: TileColor[][]; recycled: number } {
  let b = [...bag];
  let d = [...discard];
  let recycled = 0;

  if (b.length < TILES_PER_ROUND && d.length > 0) {
    shuffle(d);
    b.push(...d);
    recycled = d.length;
    d = [];
  }

  const dealt = dealFactories(b);
  return { bag: dealt.bag, discard: d, factories: dealt.factories, recycled };
}

export function recycleTiles(discard: TileColor[], tiles: TileColor[]): TileColor[] {
  if (tiles.length === 0) return discard;
  return [...discard, ...tiles];
}
